from __future__ import annotations

from typing import Any


def _iou(left: dict[str, float], right: dict[str, float]) -> float:
    left_right = min(left["x"] + left["width"], right["x"] + right["width"])
    left_bottom = min(left["y"] + left["height"], right["y"] + right["height"])
    overlap_width = max(0.0, left_right - max(left["x"], right["x"]))
    overlap_height = max(0.0, left_bottom - max(left["y"], right["y"]))
    overlap = overlap_width * overlap_height
    if overlap <= 0:
        return 0.0
    left_area = left["width"] * left["height"]
    right_area = right["width"] * right["height"]
    union = left_area + right_area - overlap
    return overlap / union if union > 0 else 0.0


class SimpleTracker:
    def __init__(self, *, iou_threshold: float = 0.35, trail_length: int = 12) -> None:
        self.iou_threshold = iou_threshold
        self.trail_length = trail_length
        self._next_id = 1
        self._tracks: dict[int, dict[str, Any]] = {}

    def assign(self, detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        assigned: list[dict[str, Any]] = []
        used_tracks: set[int] = set()

        for detection in detections:
            best_id = None
            best_score = 0.0
            for track_id, track in self._tracks.items():
                if track_id in used_tracks:
                    continue
                if track["label"] != detection["label"]:
                    continue
                score = _iou(track["box"], detection["box"])
                if score > best_score:
                    best_score = score
                    best_id = track_id

            if best_id is not None and best_score >= self.iou_threshold:
                track_id = best_id
            else:
                track_id = self._next_id
                self._next_id += 1

            used_tracks.add(track_id)
            box = detection["box"]
            center = (
                box["x"] + box["width"] / 2,
                box["y"] + box["height"] / 2,
            )
            prior_trail = self._tracks.get(track_id, {}).get("trail", [])
            trail = [*prior_trail, center][-self.trail_length :]
            self._tracks[track_id] = {
                "label": detection["label"],
                "box": box,
                "trail": trail,
            }
            enriched = dict(detection)
            enriched["track_id"] = track_id
            enriched["trail"] = [
                {"x": point[0], "y": point[1]}
                for point in trail
            ]
            assigned.append(enriched)

        stale = [track_id for track_id in self._tracks if track_id not in used_tracks]
        for track_id in stale:
            self._tracks.pop(track_id, None)
        return assigned