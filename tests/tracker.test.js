import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SimpleTracker, iou } from "../static/tracker.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/tracker_cases.json", import.meta.url), "utf8"));

test("iou is 1 for identical boxes and 0 for disjoint ones", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(iou(box, box), 1);
  assert.equal(iou(box, { x: 20, y: 20, width: 5, height: 5 }), 0);
});

test("tracker keeps an id across one unmatched frame", () => {
  const tracker = new SimpleTracker({ ttlFrames: 8 });
  const box = { x: 10, y: 10, width: 40, height: 60 };
  const first = tracker.assign([{ label: "person", confidence: 0.9, box }]);
  tracker.assign([]);
  const again = tracker.assign([{ label: "person", confidence: 0.88, box }]);
  assert.equal(first[0].track_id, again[0].track_id);
});

test("tracker reset starts ids over", () => {
  const tracker = new SimpleTracker();
  tracker.assign([{ label: "car", confidence: 0.8, box: { x: 1, y: 1, width: 4, height: 4 } }]);
  tracker.reset();
  const next = tracker.assign([{ label: "car", confidence: 0.8, box: { x: 1, y: 1, width: 4, height: 4 } }]);
  assert.equal(next[0].track_id, 1);
});

test("assigned detections carry trail, velocity and hits", () => {
  const tracker = new SimpleTracker();
  tracker.assign([{ label: "person", confidence: 0.9, box: { x: 10, y: 10, width: 40, height: 60 } }]);
  const [moved] = tracker.assign([{ label: "person", confidence: 0.9, box: { x: 20, y: 10, width: 40, height: 60 } }]);
  assert.equal(moved.track_id, 1);
  assert.equal(moved.hits, 2);
  assert.deepEqual(moved.trail.at(-1), { x: 40, y: 40 });
  assert.equal(moved.velocity.x, 5);
  assert.equal(moved.velocity.y, 0);
});

for (const scenario of fixture.cases) {
  test(`JS tracker matches app/tracker.py: ${scenario.name}`, () => {
    const options = scenario.options;
    const tracker = new SimpleTracker({
      iouThreshold: options.iou_threshold,
      trailLength: options.trail_length,
      ttlFrames: options.ttl_frames,
      velocitySmoothing: options.velocity_smoothing,
    });
    const ids = scenario.frames.map((frame) => tracker.assign(frame).map((item) => item.track_id));
    assert.deepEqual(ids, scenario.expected_track_ids);
  });
}
