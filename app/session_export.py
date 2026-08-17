"""Session event formatters (keep in sync with static/detect-utils.js)."""

from __future__ import annotations

import csv
import io
from typing import Any, Mapping, Sequence


CSV_HEADER = ["timestamp", "frame_id", "label", "confidence", "x", "y", "w", "h"]


def events_to_csv(events: Sequence[Mapping[str, Any]] | None) -> str:
    """Flatten compact session events into a one-row-per-detection CSV."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_HEADER)
    for event in events or []:
        timestamp = event.get("t", "")
        frame_id = event.get("frame_id", "")
        for detection in event.get("detections") or []:
            box = detection.get("box") or {}
            writer.writerow(
                [
                    timestamp,
                    frame_id,
                    detection.get("label", ""),
                    detection.get("confidence", ""),
                    box.get("x", ""),
                    box.get("y", ""),
                    box.get("width", ""),
                    box.get("height", ""),
                ]
            )
    return buffer.getvalue()
