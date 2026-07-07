from __future__ import annotations

import json
import os
import time
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.detector import detect_objects, model_info
from app.stats import SessionStats
from app.tracker import SimpleTracker


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_ALLOWED_ORIGINS = {
    "http://localhost:8000",
    "http://127.0.0.1:8000",
}
MAX_FRAME_BYTES = int(os.getenv("MAX_FRAME_BYTES", str(512 * 1024)))
MIN_FRAME_INTERVAL_SECONDS = float(os.getenv("MIN_FRAME_INTERVAL_SECONDS", "0.08"))
MAX_WS_CONNECTIONS = int(os.getenv("MAX_WS_CONNECTIONS", "4"))
ACTIVE_CONNECTIONS = 0

app = FastAPI(
    title="Real-Time Object Detection",
    description="FastAPI, WebSockets, OpenCV, and YOLOv8 live object detection.",
    version="1.4.0",
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
async def health() -> dict[str, str | int]:
    return {
        "status": "ok",
        "version": "1.4.0",
        "active_connections": ACTIVE_CONNECTIONS,
        "max_connections": MAX_WS_CONNECTIONS,
    }


@app.get("/api/model")
async def model_metadata() -> dict[str, object]:
    return model_info()


@app.post("/api/detect")
async def detect_upload(
    image: UploadFile = File(...),
    confidence: float | None = None,
) -> dict[str, object]:
    frame_bytes = await image.read()
    if not frame_bytes:
        return {"type": "error", "message": "Empty image upload."}
    payload = await detect_objects(frame_bytes, confidence=confidence)
    return payload


@app.post("/api/detect/batch")
async def detect_batch(
    images: list[UploadFile] = File(...),
    confidence: float | None = None,
) -> dict[str, object]:
    results: list[dict[str, object]] = []
    for upload in images[:12]:
        frame_bytes = await upload.read()
        if not frame_bytes:
            continue
        payload = await detect_objects(frame_bytes, confidence=confidence)
        payload["filename"] = upload.filename
        results.append(payload)
    return {"count": len(results), "results": results}


@app.get("/api/stats")
async def session_stats() -> dict[str, str | int | float | list[str]]:
    return _SESSION_STATS.as_dict()


_SESSION_STATS = SessionStats()


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
                if payload.get("type") == "config":
                    if "confidence" in payload:
                        confidence_threshold = float(payload["confidence"])
                    if "classes" in payload:
                        class_filter = [str(value) for value in payload["classes"]]
                    await websocket.send_json({"type": "config_ack", "ok": True})
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
                            "type": "error",
                            "message": "Frame rate is too high.",
                        }
                    )
                    continue
                last_frame_at = started
                processing = True
                payload = await detect_objects(
                    frame,
                    confidence=confidence_threshold,
                    class_filter=class_filter,
                    tracker=tracker,
                )
                payload["latency_ms"] = round(
                    (time.perf_counter() - started) * 1000,
                    1,
                )
                session_stats.record_frame(
                    payload.get("detections", []),
                    payload["latency_ms"],
                )
                _SESSION_STATS.frames_processed = session_stats.frames_processed
                _SESSION_STATS.detections_total = session_stats.detections_total
                _SESSION_STATS.classes_seen = set(session_stats.classes_seen)
                _SESSION_STATS.latency_samples = list(session_stats.latency_samples)
                payload["session"] = session_stats.as_dict()
                await websocket.send_json(payload)
                processing = False
            except WebSocketDisconnect:
                raise
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
