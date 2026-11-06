import assert from "node:assert/strict";
import test from "node:test";
import {
  MASK_EFFECTS,
  VIDEO_APPS,
  effectTargets,
  easeCrop,
  expandBox,
  autoFrameCrop,
  cleanNameplate,
  gradeFilter,
  maskTrusted,
  photoStripSize,
  plateReady,
  scaleBox,
  usesMask,
  vanishLabelSet,
  videoAppGuide,
} from "../static/studio.js";

test("a person mask is trusted only when every band of every person is covered", () => {
  assert.equal(maskTrusted([]), true);
  assert.equal(maskTrusted([[0.7, 0.8, 0.75]]), true);
  // A side-on cyclist: head and back missed by the selfie model.
  assert.equal(maskTrusted([[0.05, 0.65, 0.67]]), false);
  assert.equal(maskTrusted([[0.7, 0.8, 0.75], [0.1, 0.2, 0.15]]), false);
  assert.equal(maskTrusted([[0.2, 0.25, 0.3]]), false);
});

test("the mask compositor runs for every effect except off", () => {
  const mask = {};
  for (const effect of MASK_EFFECTS) {
    assert.equal(usesMask({ effect, mask }), true, effect);
  }
  assert.equal(usesMask({ effect: "none", mask }), false);
  assert.equal(usesMask({ effect: "disappear", mask: null }), false);
});

test("auto frame eases toward its target crop", () => {
  const next = { x: 100, y: 50, width: 400, height: 225 };
  assert.deepEqual(easeCrop(null, next), next);
  const eased = easeCrop({ x: 0, y: 0, width: 640, height: 360 }, next, 0.5);
  assert.equal(eased.x, 50);
  assert.equal(eased.width, 520);
  assert.equal(easeCrop(next, null), null);
});

test("a plate is ready when captured, or after enough mask-guided learning", () => {
  assert.equal(plateReady(null), false);
  assert.equal(plateReady({ seeded: true, captured: true, known: {}, learned: 0 }), true);
  assert.equal(plateReady({ seeded: true, captured: false, known: {}, learned: 10 }), false);
  assert.equal(plateReady({ seeded: true, captured: false, known: {}, learned: 400 }), true);
  assert.equal(plateReady({ seeded: true, captured: false, known: null }), true);
});

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
