import cv2
import numpy as np
import pytest

from app.detector import (
    MOCK_TEMPLATES,
    MockDetector,
    _class_name,
    decode_jpeg,
    load_model,
    run_detection,
)


def test_decode_jpeg_round_trip() -> None:
    image = np.zeros((32, 48, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)

    assert ok

    decoded = decode_jpeg(encoded.tobytes())

    assert decoded.shape == image.shape


def test_decode_jpeg_rejects_empty_frame() -> None:
    with pytest.raises(ValueError, match="Empty frame"):
        decode_jpeg(b"")


def test_class_name_handles_dict_and_sequence() -> None:
    assert _class_name({0: "person"}, 0) == "person"
    assert _class_name(["person", "bicycle"], 1) == "bicycle"
    assert _class_name([], 99) == "99"


def test_load_model_is_mock_without_weights() -> None:
    detector = load_model()
    assert isinstance(detector, MockDetector)
    assert detector.is_mock is True
    assert detector.model_name == "mock"


def test_mock_detector_returns_stable_boxes_for_jpeg() -> None:
    image = np.zeros((240, 320, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok

    frame = decode_jpeg(encoded.tobytes())
    first = run_detection(frame, confidence=0.35, imgsz=640)
    second = run_detection(frame, confidence=0.35, imgsz=640)

    assert first["type"] == "detections"
    assert first["frame_width"] == 320
    assert first["frame_height"] == 240
    labels = [item["label"] for item in first["detections"]]
    assert labels == ["person", "cup", "laptop"]
    assert first["detections"] == second["detections"]

    person = first["detections"][0]
    _, score, norm_x, norm_y, norm_w, norm_h = MOCK_TEMPLATES[0]
    assert person["confidence"] == score
    assert person["box"] == {
        "x": round(norm_x * 320, 2),
        "y": round(norm_y * 240, 2),
        "width": round(norm_w * 320, 2),
        "height": round(norm_h * 240, 2),
    }


def test_mock_detector_respects_confidence_and_label_filter() -> None:
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    high = run_detection(frame, confidence=0.9)
    assert [item["label"] for item in high["detections"]] == ["person"]

    filtered = run_detection(
        frame,
        confidence=0.35,
        allowed_labels=["cup"],
    )
    assert [item["label"] for item in filtered["detections"]] == ["cup"]
