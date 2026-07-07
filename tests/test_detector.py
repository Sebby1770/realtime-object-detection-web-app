import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main
from app.detector import _class_name, decode_jpeg, model_info, run_detection


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


def test_websocket_rejects_untrusted_origin() -> None:
    client = TestClient(main.app)

    with pytest.raises(Exception):
        with client.websocket_connect(
            "/ws/detect",
            headers={"origin": "https://evil.example"},
        ):
            pass


def test_model_info_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeModel:
        names = {0: "person", 1: "bicycle"}

    monkeypatch.setattr("app.detector.load_model", lambda: FakeModel())
    client = TestClient(main.app)
    response = client.get("/api/model")
    assert response.status_code == 200
    payload = response.json()
    assert "model" in payload
    assert payload["classes"] == ["person", "bicycle"]


def test_health_reports_version() -> None:
    client = TestClient(main.app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["version"] == "1.1.0"


def test_run_detection_filters_by_class(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeTensor:
        def __init__(self, values):
            self._values = values

        def numpy(self):
            return self._values

    class FakeBoxes:
        xyxy = type("T", (), {"cpu": lambda self: FakeTensor(np.array([[1.0, 2.0, 10.0, 12.0]]))})()
        conf = type("T", (), {"cpu": lambda self: FakeTensor(np.array([0.9]))})()
        cls = type("T", (), {"cpu": lambda self: FakeTensor(np.array([0]))})()

    class FakeResult:
        boxes = FakeBoxes()
        names = {0: "person", 1: "bicycle"}

    class FakeModel:
        names = {0: "person", 1: "bicycle"}

        def predict(self, frame, conf, imgsz, verbose):
            return [FakeResult()]

    monkeypatch.setattr("app.detector.load_model", lambda: FakeModel())
    frame = np.zeros((32, 48, 3), dtype=np.uint8)
    all_detections = run_detection(frame, classes=None)
    filtered = run_detection(frame, classes=["bicycle"])
    assert len(all_detections["detections"]) == 1
    assert filtered["detections"] == []


def test_websocket_rejects_large_frame(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "MAX_FRAME_BYTES", 4)
    monkeypatch.setattr(main, "MIN_FRAME_INTERVAL_SECONDS", 0)
    client = TestClient(main.app)

    with client.websocket_connect(
        "/ws/detect",
        headers={"origin": "http://127.0.0.1:8000"},
    ) as websocket:
        websocket.send_bytes(b"too-large")
        message = websocket.receive_json()

    assert message == {
        "type": "error",
        "message": "Frame is too large for processing.",
    }
