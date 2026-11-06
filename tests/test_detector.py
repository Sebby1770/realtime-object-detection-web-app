import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import app
from app import main
from app.detector import MockModel, ModelUnavailable, _class_name, clamp_confidence, decode_jpeg, run_detection
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

    with pytest.raises(WebSocketDisconnect):
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
    payload = response.json()
    assert payload["version"] == app.__version__ == "3.0.0"
    assert main.APP_VERSION == app.__version__
    assert set(payload["model"]) == {"name", "loaded", "mock", "error", "warmup_ms"}
    assert payload["features"]["copilot"] is True
    assert payload["features"]["copilot_streaming"] is True
    assert isinstance(payload["features"]["virtualcam"], bool)
    assert payload["max_connections"] == main.MAX_WS_CONNECTIONS


def test_virtualcam_bridge_accepts_jpeg_frames() -> None:
    main.studio_bridge.reset()
    client = TestClient(main.app)
    status_response = client.get("/api/virtualcam/status")
    assert status_response.status_code == 200
    body = status_response.json()
    assert body["mjpeg_path"] == "/api/studio.mjpg"
    assert body["frames"] == 0

    posted = client.post(
        "/api/virtualcam/frame",
        content=b"\xff\xd8\xff\xd9",
        headers={"content-type": "image/jpeg"},
    )
    assert posted.status_code == 200
    assert posted.json()["frames"] == 1
    assert posted.json()["receiving"] is True

    rejected = client.post("/api/virtualcam/frame", content=b"not-a-jpeg")
    assert rejected.status_code == 400


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
    assert "Go invisible" in response.text
    assert "Copilot" in response.text
    assert "ChatGPT" in response.text
    assert "Claude" in response.text
    assert 'data-provider="grok"' in response.text
    assert "Scene diary" in response.text
    assert 'data-look="call"' in response.text
    assert "static/app.js" in response.text
    assert "unpkg.com/lucide" not in response.text


def test_index_shell_contract() -> None:
    """The v3 shell: CSP, self-hosted font, version-stamped assets, tabs, and no inline script."""
    import re

    from app import __version__

    html = TestClient(main.app).get("/").text
    assert 'http-equiv="Content-Security-Policy"' in html
    assert "object-src 'none'" in html
    assert "static/fonts/saira-latin.woff2" in html
    assert "fonts.googleapis.com" not in html
    assert f"static/app.js?v={__version__}" in html
    assert f"static/styles.css?v={__version__}" in html
    for tab in ("detect", "studio", "zones", "session", "copilot"):
        assert f'id="tab-{tab}"' in html
        assert f'id="panel-{tab}"' in html
    assert 'id="paletteDialog"' in html
    assert re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html) is None, "inline scripts would break the CSP"


def test_version_is_the_same_everywhere() -> None:
    import json
    import re
    import tomllib
    from pathlib import Path

    from app import __version__

    root = Path(__file__).resolve().parent.parent
    assert json.loads((root / "package.json").read_text())["version"] == __version__
    assert tomllib.loads((root / "pyproject.toml").read_text())["project"]["version"] == __version__
    assert f'const VERSION = "{__version__}"' in (root / "static" / "app.js").read_text()
    assert set(re.findall(r"\?v=([0-9.]+)", (root / "index.html").read_text())) == {__version__}
    assert f"## {__version__}" in (root / "CHANGELOG.md").read_text()


def test_model_endpoint_returns_503_when_model_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def unavailable():
        raise ModelUnavailable("Ultralytics is not installed.")

    monkeypatch.setattr("app.detector.load_model", unavailable)
    client = TestClient(main.app)
    response = client.get("/api/model")
    assert response.status_code == 503
    assert response.json()["detail"] == "Ultralytics is not installed."


def test_load_model_uses_mock_when_flag_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import detector

    monkeypatch.setenv("YOLO_MOCK", "Yes")
    detector.load_model.cache_clear()
    try:
        assert isinstance(detector.load_model(), MockModel)
    finally:
        detector.load_model.cache_clear()


def test_mock_model_runs_through_run_detection(monkeypatch: pytest.MonkeyPatch) -> None:
    import numpy as np

    model = MockModel()
    monkeypatch.setattr("app.detector.load_model", lambda: model)
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    payload = run_detection(frame, confidence=0.3)
    assert [item["label"] for item in payload["detections"]] == ["person", "laptop", "cup"]
    assert [item["confidence"] for item in payload["detections"]] == [0.91, 0.84, 0.72]
    assert isinstance(payload["inference_ms"], float)
    assert payload["class_counts"] == {"person": 1, "laptop": 1, "cup": 1}
    for item in payload["detections"]:
        box = item["box"]
        assert 0 <= box["x"] and box["x"] + box["width"] <= 640
        assert 0 <= box["y"] and box["y"] + box["height"] <= 360

    later = [run_detection(frame, confidence=0.3)["detections"][0]["box"]["x"] for _ in range(10)]
    assert len(set(later)) > 1, "the mock person should sway"
    assert len(MockModel.names) == 80
    assert MockModel.names[0] == "person" and MockModel.names[79] == "toothbrush"

    strict = run_detection(frame, confidence=0.8)
    assert [item["label"] for item in strict["detections"]] == ["person", "laptop"]


def test_model_info_reports_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.detector.load_model", lambda: MockModel())
    response = TestClient(main.app).get("/api/model")
    assert response.status_code == 200
    assert response.json()["mock"] is True
    assert len(response.json()["classes"]) == 80


def test_warmup_records_errors_without_raising(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import detector

    def unavailable():
        raise ModelUnavailable("no weights here")

    monkeypatch.setattr("app.detector.load_model", unavailable)
    detector.warmup()
    assert detector.model_status()["error"] == "no weights here"

    monkeypatch.setattr("app.detector.load_model", lambda: MockModel())
    detector.warmup()
    status = detector.model_status()
    assert status["loaded"] is True
    assert status["mock"] is True
    assert status["error"] is None
    assert isinstance(status["warmup_ms"], float)


def test_batch_reports_skipped_images(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_detect(frame_bytes, confidence=None, class_filter=None, tracker=None):
        return {"detections": [], "frame_width": 1, "frame_height": 1, "class_counts": {}}

    monkeypatch.setattr("app.main.detect_objects", fake_detect)
    monkeypatch.setattr(main, "MAX_BATCH_IMAGES", 2)
    client = TestClient(main.app)
    response = client.post(
        "/api/detect/batch",
        files=[("images", (f"{index}.jpg", b"fake", "image/jpeg")) for index in range(5)],
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert payload["skipped"] == 3


def _fake_ws_detect(calls: list[int]):
    async def fake_detect(frame_bytes, confidence=None, class_filter=None, tracker=None):
        calls.append(len(frame_bytes))
        return {
            "type": "detections",
            "frame_width": 4,
            "frame_height": 4,
            "inference_ms": 1.5,
            "class_counts": {"cup": 1},
            "detections": [{"label": "cup", "confidence": 0.8, "box": {"x": 0, "y": 0, "width": 2, "height": 2}}],
        }

    return fake_detect


def test_websocket_throttles_fast_frames(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr("app.main.detect_objects", _fake_ws_detect(calls))
    monkeypatch.setattr(main, "MIN_FRAME_INTERVAL_SECONDS", 60)
    client = TestClient(main.app)
    with client.websocket_connect("/ws/detect", headers={"origin": "http://127.0.0.1:8000"}) as websocket:
        websocket.send_bytes(b"frame-1")
        first = websocket.receive_json()
        websocket.send_bytes(b"frame-2")
        second = websocket.receive_json()
    assert first["type"] == "detections"
    assert second == {"type": "throttled", "message": "Frame rate is too high."}
    assert len(calls) == 1


def test_websocket_payload_has_frame_id_and_timings(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr("app.main.detect_objects", _fake_ws_detect(calls))
    monkeypatch.setattr(main, "MIN_FRAME_INTERVAL_SECONDS", 0)
    client = TestClient(main.app)
    with client.websocket_connect("/ws/detect", headers={"origin": "http://127.0.0.1:8000"}) as websocket:
        websocket.send_bytes(b"frame-1")
        first = websocket.receive_json()
        websocket.send_bytes(b"frame-2")
        second = websocket.receive_json()
    assert (first["frame_id"], second["frame_id"]) == (1, 2)
    assert first["inference_ms"] == 1.5
    assert isinstance(first["latency_ms"], float)
    assert second["session"]["frames_processed"] == 2


def test_websocket_reports_model_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    async def unavailable(frame_bytes, confidence=None, class_filter=None, tracker=None):
        raise ModelUnavailable("Ultralytics is not installed.")

    monkeypatch.setattr("app.main.detect_objects", unavailable)
    monkeypatch.setattr(main, "MIN_FRAME_INTERVAL_SECONDS", 0)
    client = TestClient(main.app)
    with client.websocket_connect("/ws/detect", headers={"origin": "http://127.0.0.1:8000"}) as websocket:
        websocket.send_bytes(b"frame-1")
        message = websocket.receive_json()
    assert message == {"type": "error", "code": "model_unavailable", "message": "Ultralytics is not installed."}
