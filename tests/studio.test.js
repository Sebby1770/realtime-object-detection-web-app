import assert from "node:assert/strict";
import test from "node:test";
import {
  VIDEO_APPS,
  effectTargets,
  expandBox,
  autoFrameCrop,
  cleanNameplate,
  gradeFilter,
  photoStripSize,
  scaleBox,
  vanishLabelSet,
  videoAppGuide,
} from "../static/studio.js";

test("photo strip grows with each shot and keeps a footer", () => {
  const one = photoStripSize(1, 100, 50, 10, 20);
  const four = photoStripSize(4, 100, 50, 10, 20);
  assert.equal(one.width, 120);
  assert.equal(one.height, 10 + 60 + 20);
  assert.equal(four.height - one.height, 3 * 60);
});

test("expandBox stays inside the frame", () => {
  const box = expandBox({ x: 0, y: 10, width: 40, height: 40 }, { width: 100, height: 80 }, 0.5);
  assert.equal(box.x, 0);
  assert.ok(box.x + box.width <= 100);
  assert.ok(box.y + box.height <= 80);
  assert.ok(box.width > 40);
});

test("effect targets scale detection boxes onto the studio frame", () => {
  const boxes = effectTargets(
    [{ label: "person", box: { x: 10, y: 10, width: 20, height: 40 } }],
    { width: 100, height: 100 },
    { width: 200, height: 200 },
    { vanishMode: "people", pad: 0 },
  );
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].width, 40);
  assert.equal(boxes[0].height, 80);
});

test("scaleBox maps centers proportionally", () => {
  const scaled = scaleBox({ x: 5, y: 5, width: 10, height: 10 }, { width: 10, height: 20 }, { width: 20, height: 10 });
  assert.equal(scaled.x, 10);
  assert.equal(scaled.y, 2.5);
  assert.equal(scaled.width, 20);
  assert.equal(scaled.height, 5);
});

test("people mode ignores other classes and selected mode uses the filter", () => {
  const people = vanishLabelSet("people");
  assert.equal(people.has("person"), true);
  assert.equal(people.has("cup"), false);
  const selected = vanishLabelSet("selected", ["Cup", "book"]);
  assert.equal(selected.has("cup"), true);
  assert.equal(vanishLabelSet("all"), null);
});

test("color grades are named filters and unknown grades stay natural", () => {
  assert.equal(gradeFilter("none"), "none");
  assert.match(gradeFilter("warm"), /sepia/);
  assert.match(gradeFilter("noir"), /grayscale/);
  assert.equal(gradeFilter("missing"), "none");
});

test("auto frame keeps the subject inside a same-shape crop", () => {
  const crop = autoFrameCrop([{ x: 10, y: 20, width: 30, height: 40 }], { width: 200, height: 100 });
  assert.ok(crop);
  assert.ok(Math.abs(crop.width / crop.height - 2) < 0.02);
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.width <= 200.01);
  assert.ok(crop.y + crop.height <= 100.01);
  assert.ok(crop.x <= 10 && crop.y <= 20);
  assert.ok(crop.x + crop.width >= 40);
  assert.ok(crop.y + crop.height >= 60);
  assert.equal(autoFrameCrop([{ x: 0, y: 0, width: 200, height: 100 }], { width: 200, height: 100 }), null);
  assert.equal(autoFrameCrop([], { width: 200, height: 100 }), null);
});

test("name plates stay on one line and cap at 42 characters", () => {
  assert.equal(cleanNameplate("  Alex   River  "), "Alex River");
  assert.equal(cleanNameplate("a\nb"), "a b");
  assert.equal(cleanNameplate("x".repeat(80)).length, 42);
  assert.equal(cleanNameplate(""), "");
});

test("video bridge covers the camera and conferencing apps", () => {
  const ids = VIDEO_APPS.map((app) => app.id);
  for (const id of ["zoom", "meet", "teams", "photobooth", "facetime", "discord", "obs", "quicktime", "slack", "webex", "twitch"]) {
    assert.ok(ids.includes(id), id);
    const guide = videoAppGuide(id);
    assert.ok(guide.camera.length > 0);
    assert.ok(guide.setup.length >= 2);
  }
});
