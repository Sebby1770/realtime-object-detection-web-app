import json

import pytest

from app.protocol import (
    MAX_FRAME_BYTES,
    ClientConfig,
    ProtocolError,
    enrich_payload,
    parse_control_message,
    validate_frame_bytes,
    watchlist_alerts,
)


def test_frame_too_large_rejected() -> None:
    with pytest.raises(ProtocolError, match="too large") as exc_info:
        validate_frame_bytes(b"x" * (MAX_FRAME_BYTES + 1))
    assert exc_info.value.code == "frame_too_large"


def test_empty_frame_rejected() -> None:
    with pytest.raises(ProtocolError, match="Empty frame") as exc_info:
        validate_frame_bytes(b"")
    assert exc_info.value.code == "empty_frame"


def test_valid_frame_passes() -> None:
    validate_frame_bytes(b"jpeg-bytes")


def test_parse_config_message() -> None:
    raw = json.dumps(
        {
            "type": "config",
            "confidence": 0.55,
            "imgsz": 320,
            "allowed_labels": ["person", "cup", "person"],
            "watchlist": ["laptop"],
        }
    )
    updates = parse_control_message(raw)
    assert updates["confidence"] == 0.55
    assert updates["imgsz"] == 320
    assert updates["allowed_labels"] == ["person", "cup"]
    assert updates["watchlist"] == ["laptop"]


def test_parse_config_allows_clearing_filters() -> None:
    updates = parse_control_message('{"type":"config","allowed_labels":null}')
    assert updates["allowed_labels"] is None


def test_parse_config_rejects_bad_confidence() -> None:
    with pytest.raises(ProtocolError, match="confidence"):
        parse_control_message('{"type":"config","confidence":1.5}')


def test_parse_config_rejects_unknown_type() -> None:
    with pytest.raises(ProtocolError, match="Unknown message type"):
        parse_control_message('{"type":"ping"}')


def test_parse_config_rejects_invalid_json() -> None:
    with pytest.raises(ProtocolError, match="not valid JSON"):
        parse_control_message("not-json")


def test_client_config_apply_update() -> None:
    config = ClientConfig()
    config.apply_update(
        {
            "confidence": 0.7,
            "watchlist": ["person"],
            "allowed_labels": ["cup"],
        }
    )
    assert config.confidence == 0.7
    assert config.watchlist == ["person"]
    assert config.allowed_labels == ["cup"]


def test_watchlist_alert_included_for_mock_label() -> None:
    detections = [
        {"label": "person", "confidence": 0.92, "box": {"x": 1, "y": 1, "width": 2, "height": 2}},
        {"label": "cup", "confidence": 0.81, "box": {"x": 3, "y": 3, "width": 2, "height": 2}},
    ]
    alerts = watchlist_alerts(detections, ["person"])
    assert len(alerts) == 1
    assert alerts[0]["label"] == "person"

    payload = enrich_payload(
        {"type": "detections", "detections": detections},
        frame_id=4,
        latency_ms=12.34,
        inference_ms=9.87,
        watchlist=["PERSON"],
    )
    assert payload["frame_id"] == 4
    assert payload["counts"] == {"person": 1, "cup": 1}
    assert payload["alerts"][0]["label"] == "person"
    assert payload["latency_ms"] == 12.3
    assert payload["inference_ms"] == 9.9
