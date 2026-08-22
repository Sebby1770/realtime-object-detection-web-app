from __future__ import annotations

import asyncio
import os
from functools import lru_cache
from typing import Any


MODEL_NAME = os.getenv("YOLO_MODEL", "yolov8n.pt")
MODEL_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.35"))
MODEL_IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "640"))
MIN_CONFIDENCE = 0.05
MAX_CONFIDENCE = 0.95


def clamp_confidence(confidence: float | None) -> float:
    value = MODEL_CONFIDENCE if confidence is None else float(confidence)
    return max(MIN_CONFIDENCE, min(MAX_CONFIDENCE, value))


def decode_jpeg(frame_bytes: bytes) -> Any:
    """Decode a browser-sent JPEG frame into an OpenCV BGR image."""
    if not frame_bytes:
        raise ValueError("Empty frame received")

    import cv2
    import numpy as np

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


def run_detection(
    frame: Any,
    *,
    confidence: float | None = None,
    class_filter: list[str] | None = None,
    tracker: Any | None = None,
) -> dict[str, Any]:
    import numpy as np

    model = load_model()
    threshold = clamp_confidence(confidence)
    results = model.predict(
        frame,
        conf=threshold,
        imgsz=MODEL_IMAGE_SIZE,
        verbose=False,
    )

    height, width = frame.shape[:2]
    result = results[0]
    detections: list[dict[str, Any]] = []

    if result.boxes is not None:
        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy().astype(int)
        names = getattr(result, "names", getattr(model, "names", {}))

        for box, box_confidence, class_id in zip(boxes, confidences, class_ids):
            x1, y1, x2, y2 = box.astype(float)
            x1 = float(np.clip(x1, 0, width))
            y1 = float(np.clip(y1, 0, height))
            x2 = float(np.clip(x2, 0, width))
            y2 = float(np.clip(y2, 0, height))

            label = _class_name(names, int(class_id))
            if class_filter and label not in class_filter:
                continue
            detections.append(
                {
                    "label": label,
                    "confidence": round(float(box_confidence), 4),
                    "box": {
                        "x": round(x1, 2),
                        "y": round(y1, 2),
                        "width": round(max(0.0, x2 - x1), 2),
                        "height": round(max(0.0, y2 - y1), 2),
                    },
                }
            )

    if tracker is not None:
        detections = tracker.assign(detections)

    class_counts: dict[str, int] = {}
    for detection in detections:
        class_counts[detection["label"]] = class_counts.get(detection["label"], 0) + 1

    return {
        "type": "detections",
        "frame_width": width,
        "frame_height": height,
        "confidence_threshold": round(threshold, 4),
        "class_counts": class_counts,
        "detections": detections,
    }


def model_info() -> dict[str, Any]:
    model = load_model()
    names = getattr(model, "names", {})
    if isinstance(names, dict):
        classes = [str(value) for value in names.values()]
    else:
        classes = [str(name) for name in names]
    return {
        "model": MODEL_NAME,
        "confidence_default": MODEL_CONFIDENCE,
        "image_size": MODEL_IMAGE_SIZE,
        "classes": classes,
    }


async def detect_objects(
    frame_bytes: bytes,
    *,
    confidence: float | None = None,
    class_filter: list[str] | None = None,
    tracker: Any | None = None,
) -> dict[str, Any]:
    frame = decode_jpeg(frame_bytes)
    return await asyncio.to_thread(
        run_detection,
        frame,
        confidence=confidence,
        class_filter=class_filter,
        tracker=tracker,
    )
