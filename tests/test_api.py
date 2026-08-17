from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app import __version__
from app.coco import COCO_CLASSES
from app.main import app
from app.protocol import MAX_FRAME_BYTES
from app.stats import stats


def test_health_endpoint() -> None:
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["mock"] is True
    assert body["model"] == "mock"
    assert body["version"] == __version__ == "2.0.0"


def test_config_and_classes_endpoints() -> None:
    with TestClient(app) as client:
        config = client.get("/api/config").json()
        classes = client.get("/api/classes").json()

    assert config["model"] == "mock"
    assert config["mock"] is True
    assert config["confidence"] == 0.35
    assert config["imgsz"] == 640
    assert config["class_names"] == list(COCO_CLASSES)
    assert len(config["class_names"]) == 80
    assert classes["classes"] == list(COCO_CLASSES)


def test_index_serves_console() -> None:
    with TestClient(app) as client:
        response = client.get("/")
    assert response.status_code == 200
    assert "detection-console" in response.text or "Object Detection" in response.text


def test_stats_increment_after_mock_detect(jpeg_bytes: bytes) -> None:
    with TestClient(app) as client:
        before = client.get("/api/stats").json()
        assert before["frames_processed"] == 0
        assert before["started_at"]

        with client.websocket_connect("/ws/detect") as socket:
            socket.send_bytes(jpeg_bytes)
            payload = socket.receive_json()

        after = client.get("/api/stats").json()

    assert payload["type"] == "detections"
    assert payload["frame_id"] == 1
    assert "latency_ms" in payload
    assert "inference_ms" in payload
    assert payload["counts"]["person"] == 1
    assert after["frames_processed"] == before["frames_processed"] + 1
    assert after["avg_latency_ms"] >= 0


def test_websocket_watchlist_alert(jpeg_bytes: bytes) -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/detect") as socket:
            socket.send_text(json.dumps({"type": "config", "watchlist": ["person"]}))
            ack = socket.receive_json()
            assert ack["type"] == "config_ack"
            assert ack["config"]["watchlist"] == ["person"]

            socket.send_bytes(jpeg_bytes)
            payload = socket.receive_json()

    assert payload["type"] == "detections"
    assert any(item["label"] == "person" for item in payload["alerts"])
    assert payload["counts"]["person"] == 1


def test_websocket_rejects_oversized_frame() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/detect") as socket:
            socket.send_bytes(b"x" * (MAX_FRAME_BYTES + 1))
            payload = socket.receive_json()

    assert payload["type"] == "error"
    assert payload["code"] == "frame_too_large"


def test_websocket_config_then_filter(jpeg_bytes: bytes) -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/detect") as socket:
            socket.send_text(
                json.dumps(
                    {
                        "type": "config",
                        "confidence": 0.5,
                        "allowed_labels": ["laptop"],
                    }
                )
            )
            assert socket.receive_json()["type"] == "config_ack"
            socket.send_bytes(jpeg_bytes)
            payload = socket.receive_json()

    labels = [item["label"] for item in payload["detections"]]
    assert labels == ["laptop"]
    assert payload["counts"] == {"laptop": 1}


def test_stats_records_last_error() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/detect") as socket:
            socket.send_bytes(b"")
            payload = socket.receive_json()
        body = client.get("/api/stats").json()

    assert payload["type"] == "error"
    assert body["last_error"]
    assert stats.last_error
