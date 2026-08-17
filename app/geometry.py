"""Client-equivalent box and ROI helpers (keep in sync with static/detect-utils.js)."""

from __future__ import annotations

from typing import Any, Mapping, Sequence


def box_center(box: Mapping[str, Any] | None) -> tuple[float, float]:
    """Return the center of a `{x, y, width, height}` box."""
    payload = box or {}
    x = float(payload.get("x") or 0)
    y = float(payload.get("y") or 0)
    width = float(payload.get("width") or 0)
    height = float(payload.get("height") or 0)
    return (x + width / 2, y + height / 2)


def _xy(point: Sequence[Any] | Mapping[str, Any]) -> tuple[float, float]:
    if isinstance(point, Mapping):
        return (float(point.get("x") or 0), float(point.get("y") or 0))
    return (float(point[0]), float(point[1]))


def point_in_rect(
    point: Sequence[Any] | Mapping[str, Any],
    rect: Mapping[str, Any] | None,
) -> bool:
    """Inclusive axis-aligned hit test for a `{x, y, width, height}` rect."""
    if not rect:
        return False
    x, y = _xy(point)
    left = float(rect.get("x") or 0)
    top = float(rect.get("y") or 0)
    width = float(rect.get("width") or 0)
    height = float(rect.get("height") or 0)
    right = left + width
    bottom = top + height
    lo_x, hi_x = (left, right) if left <= right else (right, left)
    lo_y, hi_y = (top, bottom) if top <= bottom else (bottom, top)
    return lo_x <= x <= hi_x and lo_y <= y <= hi_y


def filter_detections_by_roi(
    detections: Sequence[Mapping[str, Any]] | None,
    roi: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    """Keep detections whose box center lies inside `roi`. No roi → all."""
    items = [dict(item) for item in detections or []]
    if not roi:
        return items
    kept: list[dict[str, Any]] = []
    for detection in items:
        box = detection.get("box") or {}
        if point_in_rect(box_center(box), roi):
            kept.append(detection)
    return kept
