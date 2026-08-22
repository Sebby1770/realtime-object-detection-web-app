import pytest
from fastapi.testclient import TestClient

from app import main
from app.detector import _class_name, clamp_confidence, decode_jpeg, run_detection
from app.stats import SessionStats
from app.tracker import SimpleTracker


def test_decode_jpeg_round_trip() -> None:
    import cv2
    import numpy as np

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
    assert response.json()["status"] == "ok"
    assert response.json()["version"] == "2.0.0"


def test_run_detection_filters_by_class(monkeypatch: pytest.MonkeyPatch) -> None:
    import numpy as np

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
    all_detections = run_detection(frame, class_filter=None)
    filtered = run_detection(frame, class_filter=["bicycle"])
    assert len(all_detections["detections"]) == 1
    assert filtered["detections"] == []


def test_tracker_assigns_stable_ids() -> None:
    tracker = SimpleTracker()
    first = tracker.assign(
        [
            {
                "label": "person",
                "confidence": 0.9,
                "box": {"x": 10, "y": 10, "width": 40, "height": 60},
            }
        ]
    )
    second = tracker.assign(
        [
            {
                "label": "person",
                "confidence": 0.88,
                "box": {"x": 12, "y": 11, "width": 40, "height": 60},
            }
        ]
    )
    assert first[0]["track_id"] == second[0]["track_id"]


def test_tracker_ttl_survives_one_unmatched_frame() -> None:
    tracker = SimpleTracker(ttl_frames=8)
    box = {"x": 10, "y": 10, "width": 40, "height": 60}
    first = tracker.assign(
        [{"label": "person", "confidence": 0.9, "box": box}]
    )
    tracker.assign([])
    again = tracker.assign(
        [{"label": "person", "confidence": 0.88, "box": box}]
    )
    assert first[0]["track_id"] == again[0]["track_id"]


def test_tracker_builds_motion_trails() -> None:
    tracker = SimpleTracker(trail_length=4)
    first = tracker.assign(
        [
            {
                "label": "person",
                "confidence": 0.9,
                "box": {"x": 10, "y": 10, "width": 40, "height": 60},
            }
        ]
    )
    second = tracker.assign(
        [
            {
                "label": "person",
                "confidence": 0.88,
                "box": {"x": 20, "y": 15, "width": 40, "height": 60},
            }
        ]
    )
    assert len(first[0]["trail"]) == 1
    assert len(second[0]["trail"]) == 2
    assert second[0]["trail"][-1]["x"] == 40.0


def test_batch_detect_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_detect(frame_bytes, confidence=None, class_filter=None, tracker=None):
        return {
            "detections": [{"label": "person", "confidence": 0.9, "box": {"x": 1, "y": 2, "width": 3, "height": 4}}],
            "frame_width": 32,
            "frame_height": 48,
            "class_counts": {"person": 1},
        }

    monkeypatch.setattr("app.main.detect_objects", fake_detect)
    client = TestClient(main.app)
    response = client.post(
        "/api/detect/batch",
        files=[
            ("images", ("a.jpg", b"fake-a", "image/jpeg")),
            ("images", ("b.jpg", b"fake-b", "image/jpeg")),
        ],
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert len(payload["results"]) == 2


def test_tracker_trail_payload_shape() -> None:
    tracker = SimpleTracker(trail_length=3)
    assigned = tracker.assign(
        [
            {
                "label": "car",
                "confidence": 0.8,
                "box": {"x": 4, "y": 4, "width": 20, "height": 12},
            }
        ]
    )
    assert assigned[0]["trail"][0]["x"] == 14.0
    assert assigned[0]["trail"][0]["y"] == 10.0


def test_session_stats_endpoint() -> None:
    client = TestClient(main.app)
    response = client.get("/api/stats")
    assert response.status_code == 200
    payload = response.json()
    assert "frames_processed" in payload
    assert "detections_total" in payload


def test_session_stats_accumulates() -> None:
    stats = SessionStats()
    stats.record_frame([{"label": "person"}], latency_ms=12.5)
    stats.record_frame([{"label": "bicycle"}], latency_ms=8.0)
    payload = stats.as_dict()
    assert payload["frames_processed"] == 2
    assert payload["detections_total"] == 2
    assert payload["classes_seen"] == ["bicycle", "person"]
    assert payload["roi_alerts"] == 0


def test_record_roi_alert_increments_session() -> None:
    stats = SessionStats()
    stats.record_roi_alert()
    stats.record_roi_alert()
    assert stats.as_dict()["roi_alerts"] == 2


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


def test_websocket_config_ack_is_not_detections() -> None:
    client = TestClient(main.app)

    with client.websocket_connect(
        "/ws/detect",
        headers={"origin": "http://127.0.0.1:8000"},
    ) as websocket:
        websocket.send_json(
            {"type": "config", "confidence": 1.5, "classes": ["person"]}
        )
        message = websocket.receive_json()

    assert message["type"] == "config_ack"
    assert message["ok"] is True
    assert "detections" not in message
    assert message["confidence"] == 0.95
    assert message["classes"] == ["person"]


def test_websocket_roi_alert_increments_session() -> None:
    client = TestClient(main.app)

    with client.websocket_connect(
        "/ws/detect",
        headers={"origin": "http://127.0.0.1:8000"},
    ) as websocket:
        websocket.send_json({"type": "roi_alert"})
        message = websocket.receive_json()

    assert message["type"] == "roi_alert_ack"
    assert message["roi_alerts"] == 1


def test_detect_rejects_empty_image() -> None:
    client = TestClient(main.app)
    response = client.post(
        "/api/detect",
        files=[("image", ("empty.jpg", b"", "image/jpeg"))],
    )
    assert response.status_code == 400
    assert "Empty" in response.json()["detail"]


def test_detect_rejects_non_image_content_type() -> None:
    client = TestClient(main.app)
    response = client.post(
        "/api/detect",
        files=[("image", ("notes.txt", b"hello", "text/plain"))],
    )
    assert response.status_code == 400


def test_detect_rejects_oversized_image(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 4)
    client = TestClient(main.app)
    response = client.post(
        "/api/detect",
        files=[("image", ("a.jpg", b"12345", "image/jpeg"))],
    )
    assert response.status_code == 400


def test_clamp_confidence_bounds() -> None:
    assert clamp_confidence(0.0) == 0.05
    assert clamp_confidence(1.5) == 0.95
    assert clamp_confidence(0.4) == 0.4


def test_index_served_from_repo_root() -> None:
    client = TestClient(main.app)
    response = client.get("/")
    assert response.status_code == 200
    assert "Realtime Detection" in response.text
    assert "static/app.js" in response.text
    assert "unpkg.com/lucide" not in response.text
