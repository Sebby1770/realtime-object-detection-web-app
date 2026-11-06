from __future__ import annotations

import asyncio
import importlib.util
import itertools
import json
import os
import threading
import time
import weakref
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import __version__
from app.copilot import (
    MAX_IMAGE_BYTES,
    CopilotError,
    ask_prepared,
    prepare_call,
    provider_catalog,
    stream_copilot,
)
from app.detector import (
    ModelUnavailable,
    clamp_confidence,
    detect_objects,
    env_flag,
    model_info,
    model_status,
    warmup,
)
from app.stats import SessionStats
from app.tracker import SimpleTracker
from app.virtualcam import StudioBridge

APP_VERSION = __version__
STUDIO_FRAME_BYTES = int(os.getenv("STUDIO_FRAME_BYTES", str(2 * 1024 * 1024)))
studio_bridge = StudioBridge()
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_ALLOWED_ORIGINS = {
    "http://localhost:8000",
    "http://127.0.0.1:8000",
}
DEFAULT_ALLOWED_HOSTS = "localhost,127.0.0.1,testserver"
ALLOWED_HOSTS = [
    host.strip() for host in os.getenv("ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS).split(",") if host.strip()
] or ["*"]
MAX_FRAME_BYTES = int(os.getenv("MAX_FRAME_BYTES", str(512 * 1024)))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024)))
MAX_BATCH_IMAGES = int(os.getenv("MAX_BATCH_IMAGES", "12"))
# 0.06 s lets the UI's 15 detections-per-second setting through.
MIN_FRAME_INTERVAL_SECONDS = float(os.getenv("MIN_FRAME_INTERVAL_SECONDS", "0.06"))
MAX_WS_CONNECTIONS = int(os.getenv("MAX_WS_CONNECTIONS", "4"))
MAX_COPILOT_BODY_BYTES = int(2.5 * 1024 * 1024)
MAX_COPILOT_IN_FLIGHT = 2
COPILOT_TIMEOUT_SECONDS = 90.0
ACTIVE_CONNECTIONS = 0

SECURITY_HEADERS: list[tuple[bytes, bytes]] = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
    (b"permissions-policy", b"camera=(self), microphone=(self), display-capture=(), geolocation=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
    # Other sites cannot embed /api/studio.mjpg or snapshots in an <img>; OBS and same-origin pages are unaffected.
    (b"cross-origin-resource-policy", b"same-origin"),
]


class SecurityHeadersMiddleware:
    """Pure ASGI middleware so SSE and MJPEG responses are never buffered."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_index = scope.get("method") == "GET" and scope.get("path") == "/"

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() not in {key for key, _ in SECURITY_HEADERS}
                    and not (is_index and name.lower() == b"cache-control")
                ]
                headers.extend(SECURITY_HEADERS)
                if is_index:
                    headers.append((b"cache-control", b"no-cache"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if env_flag("YOLO_WARMUP", default=True):
        threading.Thread(target=warmup, name="yolo-warmup", daemon=True).start()
    yield


app = FastAPI(
    title="Real-Time Object Detection",
    description=(
        "Dual-runtime live object detection with an invisible studio effect "
        "and a Grok, ChatGPT, or Claude copilot."
    ),
    version=APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(
        origin.strip().rstrip("/")
        for origin in os.getenv("WS_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    )
    or sorted(DEFAULT_ALLOWED_ORIGINS),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.exception_handler(ModelUnavailable)
async def model_unavailable_handler(_request: Request, exc: ModelUnavailable) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": str(exc)})


def allowed_origins() -> set[str]:
    configured = os.getenv("WS_ALLOWED_ORIGINS", "")
    if not configured:
        return DEFAULT_ALLOWED_ORIGINS
    return {origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()}


def is_allowed_origin(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if not origin:
        return False
    return origin.rstrip("/") in allowed_origins()


def validate_image_upload(upload: UploadFile, data: bytes) -> None:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are accepted.")
    if not data:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Image exceeds the 8MB limit.")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html")


def virtualcam_installed() -> bool:
    try:
        return importlib.util.find_spec("pyvirtualcam") is not None
    except (ImportError, ValueError):
        return False


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "active_connections": ACTIVE_CONNECTIONS,
        "max_connections": MAX_WS_CONNECTIONS,
        "model": model_status(),
        "features": {
            "virtualcam": virtualcam_installed(),
            "copilot": True,
            "copilot_streaming": True,
        },
    }


@app.get("/api/model")
async def model_metadata() -> dict[str, object]:
    try:
        return await asyncio.to_thread(model_info)
    except ModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/copilot")
async def copilot_catalog() -> dict[str, object]:
    return {"providers": provider_catalog(), "streaming": True, "max_image_bytes": MAX_IMAGE_BYTES}


_COPILOT_SLOTS: dict[int, float] = {}
_COPILOT_TOKENS = itertools.count(1)


def _acquire_copilot_slot() -> int:
    now = time.monotonic()
    # A slot whose holder vanished (for example a stream cancelled before it
    # started) expires instead of blocking the copilot forever.
    for token, started in list(_COPILOT_SLOTS.items()):
        if now - started > COPILOT_TIMEOUT_SECONDS + 30:
            _COPILOT_SLOTS.pop(token, None)
    if len(_COPILOT_SLOTS) >= MAX_COPILOT_IN_FLIGHT:
        raise HTTPException(status_code=429, detail="The copilot is still answering. Try again in a moment.")
    token = next(_COPILOT_TOKENS)
    _COPILOT_SLOTS[token] = now
    return token


def _release_copilot_slot(token: int) -> None:
    _COPILOT_SLOTS.pop(token, None)


async def read_copilot_body(request: Request) -> object:
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != "application/json":
        raise HTTPException(status_code=415, detail="Send JSON with Content-Type: application/json.")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_COPILOT_BODY_BYTES:
        raise HTTPException(status_code=413, detail="That request is too large.")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_COPILOT_BODY_BYTES:
            raise HTTPException(status_code=413, detail="That request is too large.")
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Expected JSON.") from exc


@app.post("/api/copilot")
async def copilot_ask(request: Request) -> dict[str, str]:
    body = await read_copilot_body(request)
    try:
        call = prepare_call(body)
    except CopilotError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    token = _acquire_copilot_slot()
    try:
        return await asyncio.to_thread(ask_prepared, call, COPILOT_TIMEOUT_SECONDS)
    except CopilotError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    finally:
        _release_copilot_slot(token)


@app.post("/api/copilot/stream")
async def copilot_stream(request: Request) -> StreamingResponse:
    body = await read_copilot_body(request)
    try:
        call = prepare_call(body, stream=True)
    except CopilotError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    token = _acquire_copilot_slot()

    async def events() -> AsyncIterator[str]:
        try:
            async for chunk in stream_copilot(call, COPILOT_TIMEOUT_SECONDS):
                yield chunk
        finally:
            _release_copilot_slot(token)

    stream = events()
    # A client that disconnects before the body starts (Stop right after Ask) never runs the
    # generator, so its finally never fires; the finalizer still frees the slot.
    weakref.finalize(stream, _release_copilot_slot, token)
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/detect")
async def detect_upload(
    image: Annotated[UploadFile, File()],
    confidence: float | None = None,
) -> dict[str, object]:
    frame_bytes = await image.read()
    validate_image_upload(image, frame_bytes)
    payload = await detect_objects(frame_bytes, confidence=clamp_confidence(confidence))
    return payload


@app.post("/api/detect/batch")
async def detect_batch(
    images: Annotated[list[UploadFile], File()],
    confidence: float | None = None,
) -> dict[str, object]:
    if not images:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    results: list[dict[str, object]] = []
    threshold = clamp_confidence(confidence)
    for upload in images[:MAX_BATCH_IMAGES]:
        frame_bytes = await upload.read()
        if not frame_bytes:
            raise HTTPException(status_code=400, detail="Empty image upload.")
        validate_image_upload(upload, frame_bytes)
        payload = await detect_objects(frame_bytes, confidence=threshold)
        payload["filename"] = upload.filename
        results.append(payload)
    if not results:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    return {
        "count": len(results),
        "results": results,
        "skipped": max(0, len(images) - MAX_BATCH_IMAGES),
    }


@app.get("/api/stats")
async def session_stats() -> dict[str, str | int | float | list[str]]:
    return _SESSION_STATS.as_dict()


@app.get("/api/virtualcam/status")
async def virtualcam_status() -> dict[str, object]:
    return studio_bridge.status()


@app.post("/api/virtualcam/frame")
async def virtualcam_frame(request: Request) -> dict[str, object]:
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty frame.")
    if len(payload) > STUDIO_FRAME_BYTES:
        raise HTTPException(status_code=400, detail="Frame exceeds the 2MB studio limit.")
    if not payload.startswith(b"\xff\xd8"):
        raise HTTPException(status_code=400, detail="Expected a JPEG frame.")
    studio_bridge.push(payload)
    return studio_bridge.status()


@app.get("/api/studio.mjpg")
async def studio_mjpeg() -> StreamingResponse:
    return StreamingResponse(studio_mjpeg_frames(), media_type="multipart/x-mixed-replace; boundary=frame")


async def studio_mjpeg_frames():
    last: bytes | None = None
    while True:
        frame = studio_bridge.snapshot()
        if frame and frame is not last:
            last = frame
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        await asyncio.sleep(0.05)


_SESSION_STATS = SessionStats()


def _sync_global_stats(session_stats: SessionStats) -> None:
    _SESSION_STATS.frames_processed = session_stats.frames_processed
    _SESSION_STATS.detections_total = session_stats.detections_total
    _SESSION_STATS.classes_seen = set(session_stats.classes_seen)
    _SESSION_STATS.latency_samples = list(session_stats.latency_samples)
    _SESSION_STATS.roi_alerts = session_stats.roi_alerts


@app.websocket("/ws/detect")
async def detect_socket(websocket: WebSocket) -> None:
    global ACTIVE_CONNECTIONS

    if not is_allowed_origin(websocket):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if ACTIVE_CONNECTIONS >= MAX_WS_CONNECTIONS:
        await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER)
        return

    await websocket.accept()
    ACTIVE_CONNECTIONS += 1
    last_frame_at = 0.0
    confidence_threshold: float | None = None
    class_filter: list[str] | None = None
    processing = False
    tracker = SimpleTracker()
    session_stats = SessionStats()
    frame_id = 0

    try:
        while True:
            message = await websocket.receive()
            started = time.perf_counter()

            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect()

            if "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                message_type = payload.get("type")
                if message_type == "config":
                    if "confidence" in payload:
                        try:
                            confidence_threshold = clamp_confidence(payload["confidence"])
                        except (TypeError, ValueError):
                            pass
                    if "classes" in payload:
                        classes = payload["classes"]
                        class_filter = [str(value) for value in classes][:80] if isinstance(classes, list) else None
                    await websocket.send_json(
                        {
                            "type": "config_ack",
                            "ok": True,
                            "confidence": confidence_threshold,
                            "classes": class_filter,
                        }
                    )
                elif message_type == "roi_alert":
                    session_stats.record_roi_alert()
                    _sync_global_stats(session_stats)
                    await websocket.send_json(
                        {
                            "type": "roi_alert_ack",
                            "ok": True,
                            "roi_alerts": session_stats.roi_alerts,
                        }
                    )
                continue

            frame = message.get("bytes")
            if not frame:
                continue

            try:
                if processing:
                    await websocket.send_json(
                        {
                            "type": "dropped",
                            "message": "Previous frame still processing.",
                        }
                    )
                    continue

                if len(frame) > MAX_FRAME_BYTES:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Frame is too large for processing.",
                        }
                    )
                    continue

                if started - last_frame_at < MIN_FRAME_INTERVAL_SECONDS:
                    await websocket.send_json(
                        {
                            "type": "throttled",
                            "message": "Frame rate is too high.",
                        }
                    )
                    continue
                last_frame_at = started
                processing = True
                frame_id += 1
                payload = await detect_objects(
                    frame,
                    confidence=confidence_threshold,
                    class_filter=class_filter,
                    tracker=tracker,
                )
                payload["frame_id"] = frame_id
                payload.setdefault("inference_ms", None)
                payload["latency_ms"] = round(
                    (time.perf_counter() - started) * 1000,
                    1,
                )
                session_stats.record_frame(
                    payload.get("detections", []),
                    payload["latency_ms"],
                )
                _sync_global_stats(session_stats)
                payload["session"] = session_stats.as_dict()
                await websocket.send_json(payload)
                processing = False
            except WebSocketDisconnect:
                raise
            except ModelUnavailable as exc:
                processing = False
                await websocket.send_json({"type": "error", "code": "model_unavailable", "message": str(exc)})
            except Exception:
                processing = False
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Unable to process this frame.",
                        }
                    )
                except WebSocketDisconnect:
                    raise
    except WebSocketDisconnect:
        return
    finally:
        ACTIVE_CONNECTIONS = max(0, ACTIVE_CONNECTIONS - 1)
