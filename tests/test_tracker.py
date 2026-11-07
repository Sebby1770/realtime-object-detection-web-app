import json
from pathlib import Path

import pytest

from app.tracker import SimpleTracker, _iou

FIXTURE = Path(__file__).parent / "fixtures" / "tracker_cases.json"
CASES = json.loads(FIXTURE.read_text())["cases"]


def _det(label: str, x: float, y: float, w: float = 40, h: float = 40) -> dict:
    return {"label": label, "confidence": 0.9, "box": {"x": x, "y": y, "width": w, "height": h}}


def test_fixture_has_the_required_cases() -> None:
    names = {case["name"] for case in CASES}
    assert len(CASES) >= 4
    assert any("crossing" in name for name in names)
    assert any("velocity" in name for name in names)
    assert any("dropout" in name for name in names)
    assert any("tie-break" in name for name in names)


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_tracker_matches_shared_fixture(case: dict) -> None:
    tracker = SimpleTracker(**case["options"])
    actual = [[item["track_id"] for item in tracker.assign(frame)] for frame in case["frames"]]
    assert actual == case["expected_track_ids"]


def test_greedy_matching_prefers_the_best_iou_not_detection_order() -> None:
    tracker = SimpleTracker()
    first = tracker.assign([_det("person", 0, 0), _det("person", 30, 0)])
    assert [item["track_id"] for item in first] == [1, 2]
    # Detection 0 overlaps track 1 best (0.54) but detection 1 overlaps it even
    # more (0.90). Order-greedy matching would orphan detection 1; best-IoU
    # greedy gives track 1 to detection 1 and track 2 (0.38) to detection 0.
    second = tracker.assign([_det("person", 12, 0), _det("person", 2, 0)])
    assert [item["track_id"] for item in second] == [2, 1]


def test_velocity_prediction_keeps_a_fast_mover() -> None:
    case = next(case for case in CASES if "velocity" in case["name"])
    frames = case["frames"]
    last, previous = frames[-1][0]["box"], frames[-2][0]["box"]
    assert _iou(previous, last) < case["options"]["iou_threshold"]
    tracker = SimpleTracker(**case["options"])
    outputs = [tracker.assign(frame) for frame in frames]
    assert {item[0]["track_id"] for item in outputs} == {1}
    assert outputs[-1][0]["velocity"]["x"] > 20
    assert outputs[-1][0]["hits"] == len(frames)


def test_track_expires_after_ttl_frames() -> None:
    tracker = SimpleTracker(ttl_frames=2)
    first = tracker.assign([_det("dog", 10, 10)])
    tracker.assign([])
    tracker.assign([])
    again = tracker.assign([_det("dog", 10, 10)])
    assert first[0]["track_id"] == 1
    assert again[0]["track_id"] == 2


def test_reset_restarts_ids() -> None:
    tracker = SimpleTracker()
    tracker.assign([_det("cup", 0, 0), _det("cup", 200, 0)])
    tracker.reset()
    assert tracker.assign([_det("cup", 0, 0)])[0]["track_id"] == 1


def test_output_keeps_detection_order_and_payload_fields() -> None:
    tracker = SimpleTracker()
    output = tracker.assign([_det("cup", 0, 0), _det("laptop", 100, 0)])
    assert [item["label"] for item in output] == ["cup", "laptop"]
    assert output[0]["velocity"] == {"x": 0.0, "y": 0.0}
    assert output[0]["hits"] == 1
    assert output[0]["trail"] == [{"x": 20.0, "y": 20.0}]
