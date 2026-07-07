from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SessionStats:
    frames_processed: int = 0
    detections_total: int = 0
    classes_seen: set[str] = field(default_factory=set)
    roi_alerts: int = 0
    latency_samples: list[float] = field(default_factory=list)

    def record_frame(self, detections: list[dict], latency_ms: float | None = None) -> None:
        self.frames_processed += 1
        self.detections_total += len(detections)
        for detection in detections:
            self.classes_seen.add(str(detection.get("label", "")))
        if latency_ms is not None:
            self.latency_samples.append(float(latency_ms))
            self.latency_samples = self.latency_samples[-100:]

    def record_roi_alert(self) -> None:
        self.roi_alerts += 1

    def as_dict(self) -> dict[str, float | int | list[str]]:
        average_latency = 0.0
        if self.latency_samples:
            average_latency = round(
                sum(self.latency_samples) / len(self.latency_samples),
                1,
            )
        return {
            "frames_processed": self.frames_processed,
            "detections_total": self.detections_total,
            "classes_seen": sorted(label for label in self.classes_seen if label),
            "roi_alerts": self.roi_alerts,
            "average_latency_ms": average_latency,
        }