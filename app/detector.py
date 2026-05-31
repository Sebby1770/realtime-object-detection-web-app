from __future__ import annotations

import asyncio
import os
from functools import lru_cache
from typing import Any

import cv2
import numpy as np


MODEL_NAME = os.getenv("YOLO_MODEL", "yolov8n.pt")
MODEL_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.35"))
MODEL_IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "640"))


def decode_jpeg(frame_bytes: bytes) -> np.ndarray:
    """Decode a browser-sent JPEG frame into an OpenCV BGR image."""
    if not frame_bytes:
        raise ValueError("Empty frame received")

    frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
    frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)

    if frame is None:
        raise ValueError("Could not decode frame")

    return frame


@lru_cache(maxsize=1)
def load_model() -> Any:
    from ultralytics import YOLO

    return YOLO(MODEL_NAME)


def _class_name(names: Any, class_id: int) -> str:
    if isinstance(names, dict):
        return str(names.get(class_id, class_id))

    try:
        return str(names[class_id])
    except (IndexError, TypeError):
        return str(class_id)


def run_detection(frame: np.ndarray) -> dict[str, Any]:
    model = load_model()
    results = model.predict(
        frame,
        conf=MODEL_CONFIDENCE,
        imgsz=MODEL_IMAGE_SIZE,
        verbose=False,
    )

    height, width = frame.shape[:2]
    result = results[0]
    detections: list[dict[str, Any]] = []

    if result.boxes is not None:
        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        classes = result.boxes.cls.cpu().numpy().astype(int)
        names = getattr(result, "names", getattr(model, "names", {}))

        for box, confidence, class_id in zip(boxes, confidences, classes):
            x1, y1, x2, y2 = box.astype(float)
            x1 = float(np.clip(x1, 0, width))
            y1 = float(np.clip(y1, 0, height))
            x2 = float(np.clip(x2, 0, width))
            y2 = float(np.clip(y2, 0, height))

            detections.append(
                {
                    "label": _class_name(names, int(class_id)),
                    "confidence": round(float(confidence), 4),
                    "box": {
                        "x": round(x1, 2),
                        "y": round(y1, 2),
                        "width": round(max(0.0, x2 - x1), 2),
                        "height": round(max(0.0, y2 - y1), 2),
                    },
                }
            )

    return {
        "type": "detections",
        "frame_width": width,
        "frame_height": height,
        "detections": detections,
    }


async def detect_objects(frame_bytes: bytes) -> dict[str, Any]:
    frame = decode_jpeg(frame_bytes)
    return await asyncio.to_thread(run_detection, frame)

