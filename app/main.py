from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.detector import (
    MODEL_CONFIDENCE,
    MODEL_IMAGE_SIZE,
    detect_objects,
    get_runtime,
)
from app.protocol import (
    ClientConfig,
    ProtocolError,
    enrich_payload,
    parse_control_message,
    validate_frame_bytes,
)
from app.stats import stats


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="Real-Time Object Detection",
    description="FastAPI, WebSockets, OpenCV, and YOLOv8 live object detection.",
    version=__version__,
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
async def health() -> dict[str, Any]:
    runtime = get_runtime()
    return {
        "status": "ok",
        "model": runtime["model"],
        "mock": runtime["mock"],
        "version": __version__,
    }


@app.get("/api/config")
async def api_config() -> dict[str, Any]:
    runtime = get_runtime()
    return {
        "model": runtime["model"],
        "confidence": runtime["confidence"],
        "imgsz": runtime["imgsz"],
        "class_names": runtime["class_names"],
        "mock": runtime["mock"],
        "version": __version__,
        "max_frame_bytes": 2_500_000,
    }


@app.get("/api/stats")
async def api_stats() -> dict[str, Any]:
    return stats.as_dict()


@app.get("/api/classes")
async def api_classes() -> dict[str, list[str]]:
    runtime = get_runtime()
    return {"classes": runtime["class_names"]}


@app.websocket("/ws/detect")
async def detect_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    config = ClientConfig(confidence=MODEL_CONFIDENCE, imgsz=MODEL_IMAGE_SIZE)
    send_lock = asyncio.Lock()
    infer_lock = asyncio.Lock()
    frame_id = 0
    inflight: set[asyncio.Task[None]] = set()

    async def safe_send(payload: dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def handle_frame(frame: bytes, assigned_id: int, session: ClientConfig) -> None:
        started = time.perf_counter()
        try:
            infer_started = time.perf_counter()
            payload = await detect_objects(
                frame,
                confidence=session.confidence,
                imgsz=session.imgsz,
                allowed_labels=session.allowed_labels,
            )
            inference_ms = (time.perf_counter() - infer_started) * 1000
            latency_ms = (time.perf_counter() - started) * 1000
            enrich_payload(
                payload,
                frame_id=assigned_id,
                latency_ms=latency_ms,
                inference_ms=inference_ms,
                watchlist=session.watchlist,
            )
            stats.record_success(latency_ms)
            await safe_send(payload)
        except Exception as exc:
            stats.record_error(str(exc))
            try:
                await safe_send({"type": "error", "message": str(exc)})
            except Exception:
                return

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            text = message.get("text")
            if text is not None:
                try:
                    updates = parse_control_message(text)
                    config.apply_update(updates)
                    await safe_send({"type": "config_ack", "config": config.as_public_dict()})
                except ProtocolError as exc:
                    stats.record_error(str(exc))
                    await safe_send(
                        {"type": "error", "code": exc.code, "message": str(exc)}
                    )
                except Exception as exc:
                    stats.record_error(str(exc))
                    await safe_send({"type": "error", "message": str(exc)})
                continue

            frame = message.get("bytes")
            if frame is None:
                continue

            try:
                validate_frame_bytes(frame)
            except ProtocolError as exc:
                stats.record_error(str(exc))
                await safe_send(
                    {"type": "error", "code": exc.code, "message": str(exc)}
                )
                continue

            if infer_lock.locked():
                await safe_send({"type": "busy"})
                continue

            frame_id += 1
            session = config.snapshot()
            assigned = frame_id

            async def run_infer(
                payload_frame: bytes = frame,
                assigned_id: int = assigned,
                session_config: ClientConfig = session,
            ) -> None:
                async with infer_lock:
                    await handle_frame(payload_frame, assigned_id, session_config)

            task = asyncio.create_task(run_infer())
            inflight.add(task)
            task.add_done_callback(inflight.discard)
    except WebSocketDisconnect:
        pass
    finally:
        for task in list(inflight):
            task.cancel()
