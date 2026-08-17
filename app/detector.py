from __future__ import annotations

import asyncio
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

import cv2
import numpy as np

from app.coco import COCO_CLASSES


MODEL_NAME = os.getenv("YOLO_MODEL", "yolov8n.pt")
MODEL_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.35"))
MODEL_IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "640"))

# Normalized (label, confidence, x, y, width, height) boxes. Stable across frames.
MOCK_TEMPLATES: tuple[tuple[str, float, float, float, float, float], ...] = (
    ("person", 0.92, 0.08, 0.12, 0.28, 0.78),
    ("cup", 0.81, 0.40, 0.48, 0.16, 0.22),
    ("laptop", 0.87, 0.55, 0.40, 0.38, 0.42),
)


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def decode_jpeg(frame_bytes: bytes) -> np.ndarray:
    """Decode a browser-sent JPEG frame into an OpenCV BGR image."""
    if not frame_bytes:
        raise ValueError("Empty frame received")

    frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
    frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)

    if frame is None:
        raise ValueError("Could not decode frame")

    return frame


def _class_name(names: Any, class_id: int) -> str:
    if isinstance(names, dict):
        return str(names.get(class_id, class_id))

    try:
        return str(names[class_id])
    except (IndexError, TypeError):
        return str(class_id)


def names_to_list(names: Any) -> list[str]:
    if isinstance(names, dict):
        keys = sorted(names, key=lambda key: int(key) if str(key).isdigit() else str(key))
        return [str(names[key]) for key in keys]
    if names is None:
        return list(COCO_CLASSES)
    return [str(name) for name in names]


class Detector(Protocol):
    is_mock: bool
    model_name: str
    names: Any

    def detect(
        self,
        frame: np.ndarray,
        *,
        confidence: float,
        imgsz: int,
    ) -> list[dict[str, Any]]: ...


class MockDetector:
    """Deterministic stand-in so CI and machines without weights can run."""

    is_mock = True

    def __init__(self) -> None:
        self.model_name = "mock"
        self.names = {index: name for index, name in enumerate(COCO_CLASSES)}

    def detect(
        self,
        frame: np.ndarray,
        *,
        confidence: float,
        imgsz: int,
    ) -> list[dict[str, Any]]:
        del imgsz
        height, width = frame.shape[:2]
        detections: list[dict[str, Any]] = []

        for label, score, norm_x, norm_y, norm_w, norm_h in MOCK_TEMPLATES:
            if score < confidence:
                continue
            detections.append(
                {
                    "label": label,
                    "confidence": round(float(score), 4),
                    "box": {
                        "x": round(norm_x * width, 2),
                        "y": round(norm_y * height, 2),
                        "width": round(norm_w * width, 2),
                        "height": round(norm_h * height, 2),
                    },
                }
            )

        return detections


class YOLODetector:
    is_mock = False

    def __init__(self, model: Any, model_name: str) -> None:
        self._model = model
        self.model_name = model_name
        self.names = getattr(model, "names", {})

    def detect(
        self,
        frame: np.ndarray,
        *,
        confidence: float,
        imgsz: int,
    ) -> list[dict[str, Any]]:
        results = self._model.predict(
            frame,
            conf=confidence,
            imgsz=imgsz,
            verbose=False,
        )
        height, width = frame.shape[:2]
        result = results[0]
        detections: list[dict[str, Any]] = []

        if result.boxes is None:
            return detections

        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        classes = result.boxes.cls.cpu().numpy().astype(int)
        names = getattr(result, "names", self.names)

        for box, score, class_id in zip(boxes, confidences, classes):
            x1, y1, x2, y2 = box.astype(float)
            x1 = float(np.clip(x1, 0, width))
            y1 = float(np.clip(y1, 0, height))
            x2 = float(np.clip(x2, 0, width))
            y2 = float(np.clip(y2, 0, height))
            detections.append(
                {
                    "label": _class_name(names, int(class_id)),
                    "confidence": round(float(score), 4),
                    "box": {
                        "x": round(x1, 2),
                        "y": round(y1, 2),
                        "width": round(max(0.0, x2 - x1), 2),
                        "height": round(max(0.0, y2 - y1), 2),
                    },
                }
            )

        return detections


def _ultralytics_available() -> bool:
    try:
        import ultralytics  # noqa: F401
    except Exception:
        return False
    return True


def _weights_available(model_name: str) -> bool:
    candidates = (
        Path(model_name),
        Path.cwd() / model_name,
        Path(__file__).resolve().parent.parent / model_name,
    )
    return any(path.is_file() for path in candidates)


def _should_use_mock() -> bool:
    if _env_flag("YOLO_MOCK"):
        return True
    if not _ultralytics_available():
        return True
    if _env_flag("YOLO_DOWNLOAD"):
        return False
    return not _weights_available(MODEL_NAME)


@lru_cache(maxsize=1)
def load_model() -> Detector:
    """Return a detector. Never raises — falls back to MockDetector."""
    try:
        if _should_use_mock():
            return MockDetector()
        from ultralytics import YOLO

        return YOLODetector(YOLO(MODEL_NAME), MODEL_NAME)
    except Exception:
        return MockDetector()


def filter_detections(
    detections: list[dict[str, Any]],
    allowed_labels: list[str] | None,
) -> list[dict[str, Any]]:
    if allowed_labels is None:
        return detections
    allowed = {label.lower() for label in allowed_labels}
    return [
        detection
        for detection in detections
        if str(detection.get("label", "")).lower() in allowed
    ]


def run_detection(
    frame: np.ndarray,
    *,
    confidence: float | None = None,
    imgsz: int | None = None,
    allowed_labels: list[str] | None = None,
) -> dict[str, Any]:
    detector = load_model()
    conf = MODEL_CONFIDENCE if confidence is None else confidence
    size = MODEL_IMAGE_SIZE if imgsz is None else imgsz
    detections = detector.detect(frame, confidence=conf, imgsz=size)
    detections = filter_detections(detections, allowed_labels)
    height, width = frame.shape[:2]
    return {
        "type": "detections",
        "frame_width": width,
        "frame_height": height,
        "detections": detections,
    }


async def detect_objects(
    frame_bytes: bytes,
    *,
    confidence: float | None = None,
    imgsz: int | None = None,
    allowed_labels: list[str] | None = None,
) -> dict[str, Any]:
    frame = decode_jpeg(frame_bytes)
    return await asyncio.to_thread(
        run_detection,
        frame,
        confidence=confidence,
        imgsz=imgsz,
        allowed_labels=allowed_labels,
    )


def get_runtime() -> dict[str, Any]:
    detector = load_model()
    return {
        "model": detector.model_name,
        "mock": bool(detector.is_mock),
        "confidence": MODEL_CONFIDENCE,
        "imgsz": MODEL_IMAGE_SIZE,
        "class_names": names_to_list(detector.names),
    }
