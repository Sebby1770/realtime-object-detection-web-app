import assert from "node:assert/strict";
import test from "node:test";
import { SimpleTracker, iou } from "../static/tracker.js";

test("iou is 1 for identical boxes", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(iou(box, box), 1);
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
  const next = tracker.assign([
    { label: "car", confidence: 0.8, box: { x: 1, y: 1, width: 4, height: 4 } },
  ]);
  assert.equal(next[0].track_id, 1);
});
