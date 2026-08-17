"""In-memory process stats for the detection service."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


class ProcessStats:
    """Process-wide counters. Not shared across workers."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.frames_processed = 0
        self._latency_sum = 0.0
        self.last_error: str | None = None
        self.started_at = datetime.now(timezone.utc).isoformat()

    def record_success(self, latency_ms: float) -> None:
        self.frames_processed += 1
        self._latency_sum += float(latency_ms)

    def record_error(self, message: str) -> None:
        self.last_error = message

    @property
    def avg_latency_ms(self) -> float:
        if self.frames_processed <= 0:
            return 0.0
        return round(self._latency_sum / self.frames_processed, 2)

    def as_dict(self) -> dict[str, Any]:
        return {
            "frames_processed": self.frames_processed,
            "avg_latency_ms": self.avg_latency_ms,
            "last_error": self.last_error,
            "started_at": self.started_at,
        }


stats = ProcessStats()
