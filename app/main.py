from __future__ import annotations

import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.detector import detect_objects


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="Real-Time Object Detection",
    description="FastAPI, WebSockets, OpenCV, and YOLOv8 live object detection.",
    version="1.0.0",
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/detect")
async def detect_socket(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        while True:
            frame = await websocket.receive_bytes()
            started = time.perf_counter()

            try:
                payload = await detect_objects(frame)
                payload["latency_ms"] = round(
                    (time.perf_counter() - started) * 1000,
                    1,
                )
                await websocket.send_json(payload)
            except Exception as exc:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": str(exc),
                    }
                )
    except WebSocketDisconnect:
        return

