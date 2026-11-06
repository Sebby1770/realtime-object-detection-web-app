from __future__ import annotations

import asyncio
import math
import os
import threading
import time
from functools import lru_cache
from typing import Any

MODEL_NAME = os.getenv("YOLO_MODEL", "yolov8n.pt")
MODEL_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.35"))
MODEL_IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "640"))
MIN_CONFIDENCE = 0.05
MAX_CONFIDENCE = 0.95

TRUTHY = {"1", "true", "yes", "on"}

COCO_CLASSES: tuple[str, ...] = (
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
    "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
    "teddy bear", "hair drier", "toothbrush",
)  # fmt: skip

UNAVAILABLE_MESSAGE = (
    "Ultralytics is not installed. Run pip install -r requirements.txt, "
    "or start with YOLO_MOCK=1 for a simulated detector."
)


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in TRUTHY


class ModelUnavailable(RuntimeError):
    """The detection model cannot be loaded in this environment."""


_STATUS_LOCK = threading.Lock()
_STATUS: dict[str, Any] = {"loaded": False, "mock": False, "error": None, "warmup_ms": None}


def _mark_loaded(model: Any) -> None:
    with _STATUS_LOCK:
        _STATUS["loaded"] = True
        _STATUS["mock"] = isinstance(model, MockModel)
        _STATUS["error"] = None


def model_status() -> dict[str, Any]:
    with _STATUS_LOCK:
        return {
            "name": MODEL_NAME,
            "loaded": bool(_STATUS["loaded"]),
            "mock": bool(_STATUS["mock"]) or env_flag("YOLO_MOCK"),
            "error": _STATUS["error"],
            "warmup_ms": _STATUS["warmup_ms"],
        }


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


class _MockTensor:
    def __init__(self, values: Any) -> None:
        self._values = values

    def cpu(self) -> _MockTensor:
        return self

    def numpy(self) -> Any:
        return self._values


class _MockBoxes:
    def __init__(self, xyxy: Any, conf: Any, cls: Any) -> None:
        self.xyxy = _MockTensor(xyxy)
        self.conf = _MockTensor(conf)
        self.cls = _MockTensor(cls)


class _MockResult:
    def __init__(self, boxes: _MockBoxes, names: dict[int, str]) -> None:
        self.boxes = boxes
        self.names = names


class MockModel:
    """Deterministic stand-in for YOLO: a swaying person, a laptop and a cup."""

    names: dict[int, str] = dict(enumerate(COCO_CLASSES))

    def __init__(self) -> None:
        self._t = 0
        self._lock = threading.Lock()

    def predict(self, frame: Any, conf: float = 0.25, imgsz: int = 640, verbose: bool = False) -> list[_MockResult]:
        import numpy as np

        with self._lock:
            self._t += 1
            t = self._t
        height, width = frame.shape[:2]
        sway = math.sin(t / 9) * 0.12 * width
        candidates = [
            # (x1, y1, x2, y2), confidence, class id
            ((0.30 * width + sway, 0.12 * height, 0.56 * width + sway, 0.96 * height), 0.91, 0),
            ((0.58 * width, 0.55 * height, 0.90 * width, 0.88 * height), 0.84, 63),
            ((0.08 * width, 0.66 * height, 0.20 * width, 0.86 * height), 0.72, 41),
        ]
        kept = [item for item in candidates if item[1] >= conf]
        xyxy = np.array([item[0] for item in kept], dtype=float).reshape(-1, 4)
        confidences = np.array([item[1] for item in kept], dtype=float)
        classes = np.array([item[2] for item in kept], dtype=float)
        return [_MockResult(_MockBoxes(xyxy, confidences, classes), self.names)]


@lru_cache(maxsize=1)
def load_model() -> Any:
    if env_flag("YOLO_MOCK"):
        return MockModel()
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise ModelUnavailable(UNAVAILABLE_MESSAGE) from exc

    return YOLO(MODEL_NAME)


def _get_model() -> Any:
    # Looked up through the module global so tests can monkeypatch load_model.
    model = globals()["load_model"]()
    _mark_loaded(model)
    return model


def warmup() -> None:
    """Load the model and run one tiny inference. Never raises."""
    try:
        import numpy as np

        started = time.perf_counter()
        model = _get_model()
        model.predict(np.zeros((64, 64, 3), dtype=np.uint8), conf=MODEL_CONFIDENCE, imgsz=64, verbose=False)
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        with _STATUS_LOCK:
            _STATUS["warmup_ms"] = elapsed
    except Exception as exc:  # noqa: BLE001 - warmup must never crash the server
        with _STATUS_LOCK:
            _STATUS["error"] = str(exc)


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

    model = _get_model()
    threshold = clamp_confidence(confidence)
    inference_started = time.perf_counter()
    results = model.predict(
        frame,
        conf=threshold,
        imgsz=MODEL_IMAGE_SIZE,
        verbose=False,
    )
    inference_ms = round((time.perf_counter() - inference_started) * 1000, 1)

    height, width = frame.shape[:2]
    result = results[0]
    detections: list[dict[str, Any]] = []

    if result.boxes is not None:
        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy().astype(int)
        names = getattr(result, "names", getattr(model, "names", {}))

        for box, box_confidence, class_id in zip(boxes, confidences, class_ids, strict=False):
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
        "inference_ms": inference_ms,
        "class_counts": class_counts,
        "detections": detections,
    }


def model_info() -> dict[str, Any]:
    model = _get_model()
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
        "mock": isinstance(model, MockModel),
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
