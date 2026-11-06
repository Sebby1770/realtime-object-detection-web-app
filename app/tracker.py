"""IoU tracker with constant-velocity prediction.

The algorithm is mirrored exactly by the browser runtime; both are checked
against tests/fixtures/tracker_cases.json, so change them together.
"""

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


def _center(box: dict[str, float]) -> tuple[float, float]:
    return (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


class SimpleTracker:
    def __init__(
        self,
        *,
        iou_threshold: float = 0.3,
        trail_length: int = 16,
        ttl_frames: int = 8,
        velocity_smoothing: float = 0.5,
    ) -> None:
        self.iou_threshold = iou_threshold
        self.trail_length = trail_length
        self.ttl_frames = ttl_frames
        self.velocity_smoothing = velocity_smoothing
        self._next_id = 1
        self._tracks: dict[int, dict[str, Any]] = {}

    def reset(self) -> None:
        self._tracks.clear()
        self._next_id = 1

    def _predicted_box(self, track: dict[str, Any]) -> dict[str, float]:
        steps = track["missed"] + 1
        box = track["box"]
        return {
            "x": box["x"] + track["vx"] * steps,
            "y": box["y"] + track["vy"] * steps,
            "width": box["width"],
            "height": box["height"],
        }

    def assign(self, detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        predictions = {track_id: self._predicted_box(track) for track_id, track in self._tracks.items()}
        pairs: list[tuple[float, int, int]] = []
        for track_id, track in self._tracks.items():
            for index, detection in enumerate(detections):
                if track["label"] != detection["label"]:
                    continue
                score = _iou(predictions[track_id], detection["box"])
                if score >= self.iou_threshold:
                    pairs.append((score, track_id, index))
        pairs.sort(key=lambda pair: (-pair[0], pair[1], pair[2]))

        matches: dict[int, int] = {}
        matched_tracks: set[int] = set()
        for _score, track_id, index in pairs:
            if track_id in matched_tracks or index in matches:
                continue
            matches[index] = track_id
            matched_tracks.add(track_id)

        smoothing = self.velocity_smoothing
        touched: set[int] = set()
        assigned: list[dict[str, Any]] = []
        for index, detection in enumerate(detections):
            box = detection["box"]
            cx, cy = _center(box)
            if index in matches:
                track_id = matches[index]
                track = self._tracks[track_id]
                steps = track["missed"] + 1
                last_x, last_y = track["trail"][-1]
                dx = (cx - last_x) / steps
                dy = (cy - last_y) / steps
                track["vx"] = smoothing * track["vx"] + (1 - smoothing) * dx
                track["vy"] = smoothing * track["vy"] + (1 - smoothing) * dy
            else:
                track_id = self._next_id
                self._next_id += 1
                track = {
                    "label": detection["label"],
                    "box": box,
                    "trail": [],
                    "missed": 0,
                    "vx": 0.0,
                    "vy": 0.0,
                    "hits": 0,
                }
                self._tracks[track_id] = track
            track["trail"] = [*track["trail"], (cx, cy)][-self.trail_length :]
            track["box"] = box
            track["missed"] = 0
            track["hits"] += 1
            touched.add(track_id)

            enriched = dict(detection)
            enriched["track_id"] = track_id
            enriched["trail"] = [{"x": x, "y": y} for x, y in track["trail"]]
            enriched["velocity"] = {"x": round(track["vx"], 2), "y": round(track["vy"], 2)}
            enriched["hits"] = track["hits"]
            assigned.append(enriched)

        stale: list[int] = []
        for track_id, track in self._tracks.items():
            if track_id in touched:
                continue
            track["missed"] += 1
            if track["missed"] >= self.ttl_frames:
                stale.append(track_id)
        for track_id in stale:
            del self._tracks[track_id]
        return assigned
