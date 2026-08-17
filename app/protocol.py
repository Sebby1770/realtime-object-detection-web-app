"""WebSocket control-plane parsing and detection payload helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


MAX_FRAME_BYTES = 2_500_000
MIN_CONFIDENCE = 0.0
MAX_CONFIDENCE = 1.0
MIN_IMGSZ = 160
MAX_IMGSZ = 1280


class ProtocolError(ValueError):
    def __init__(self, message: str, code: str = "protocol_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass
class ClientConfig:
    confidence: float = 0.35
    imgsz: int = 640
    allowed_labels: list[str] | None = None
    watchlist: list[str] = field(default_factory=list)

    def apply_update(self, updates: dict[str, Any]) -> None:
        if "confidence" in updates:
            self.confidence = float(updates["confidence"])
        if "imgsz" in updates:
            self.imgsz = int(updates["imgsz"])
        if "allowed_labels" in updates:
            labels = updates["allowed_labels"]
            self.allowed_labels = None if labels is None else list(labels)
        if "watchlist" in updates:
            self.watchlist = list(updates["watchlist"])

    def snapshot(self) -> ClientConfig:
        return ClientConfig(
            confidence=self.confidence,
            imgsz=self.imgsz,
            allowed_labels=(
                None if self.allowed_labels is None else list(self.allowed_labels)
            ),
            watchlist=list(self.watchlist),
        )

    def as_public_dict(self) -> dict[str, Any]:
        return {
            "confidence": self.confidence,
            "imgsz": self.imgsz,
            "allowed_labels": self.allowed_labels,
            "watchlist": list(self.watchlist),
        }


def validate_frame_bytes(frame_bytes: bytes) -> None:
    if not frame_bytes:
        raise ProtocolError("Empty frame received", "empty_frame")
    if len(frame_bytes) > MAX_FRAME_BYTES:
        raise ProtocolError(
            f"Frame too large ({len(frame_bytes)} bytes; max {MAX_FRAME_BYTES})",
            "frame_too_large",
        )


def parse_control_message(raw: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProtocolError("Control message is not valid JSON", "invalid_json") from exc

    if not isinstance(payload, dict):
        raise ProtocolError("Control message must be an object", "invalid_json")

    msg_type = payload.get("type")
    if msg_type != "config":
        raise ProtocolError(f"Unknown message type: {msg_type}", "unknown_type")

    return parse_config_payload(payload)


def parse_config_payload(payload: dict[str, Any]) -> dict[str, Any]:
    updates: dict[str, Any] = {}

    if "confidence" in payload and payload["confidence"] is not None:
        try:
            confidence = float(payload["confidence"])
        except (TypeError, ValueError) as exc:
            raise ProtocolError("confidence must be a number", "bad_confidence") from exc
        if confidence < MIN_CONFIDENCE or confidence > MAX_CONFIDENCE:
            raise ProtocolError(
                "confidence must be between 0 and 1",
                "bad_confidence",
            )
        updates["confidence"] = confidence

    if "imgsz" in payload and payload["imgsz"] is not None:
        try:
            imgsz = int(payload["imgsz"])
        except (TypeError, ValueError) as exc:
            raise ProtocolError("imgsz must be an integer", "bad_imgsz") from exc
        if imgsz < MIN_IMGSZ or imgsz > MAX_IMGSZ:
            raise ProtocolError(
                f"imgsz must be between {MIN_IMGSZ} and {MAX_IMGSZ}",
                "bad_imgsz",
            )
        updates["imgsz"] = imgsz

    if "allowed_labels" in payload:
        updates["allowed_labels"] = _parse_label_list(
            payload["allowed_labels"],
            field_name="allowed_labels",
            allow_none=True,
        )

    if "watchlist" in payload:
        labels = _parse_label_list(
            payload["watchlist"],
            field_name="watchlist",
            allow_none=False,
        )
        updates["watchlist"] = labels or []

    return updates


def _parse_label_list(
    value: Any,
    *,
    field_name: str,
    allow_none: bool,
) -> list[str] | None:
    if value is None:
        if allow_none:
            return None
        raise ProtocolError(f"{field_name} must be an array", f"bad_{field_name}")
    if not isinstance(value, list):
        raise ProtocolError(f"{field_name} must be an array", f"bad_{field_name}")
    labels: list[str] = []
    seen: set[str] = set()
    for item in value:
        label = str(item).strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        labels.append(label)
    return labels


def count_labels(detections: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for detection in detections:
        label = str(detection.get("label", "unknown"))
        counts[label] = counts.get(label, 0) + 1
    return counts


def watchlist_alerts(
    detections: list[dict[str, Any]],
    watchlist: list[str] | None,
) -> list[dict[str, Any]]:
    if not watchlist:
        return []
    watched = {label.lower() for label in watchlist}
    return [
        detection
        for detection in detections
        if str(detection.get("label", "")).lower() in watched
    ]


def enrich_payload(
    payload: dict[str, Any],
    *,
    frame_id: int,
    latency_ms: float,
    inference_ms: float,
    watchlist: list[str] | None,
) -> dict[str, Any]:
    detections = list(payload.get("detections") or [])
    payload["frame_id"] = frame_id
    payload["latency_ms"] = round(float(latency_ms), 1)
    payload["inference_ms"] = round(float(inference_ms), 1)
    payload["counts"] = count_labels(detections)
    payload["alerts"] = watchlist_alerts(detections, watchlist)
    return payload
