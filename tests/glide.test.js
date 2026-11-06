import assert from "node:assert/strict";
import test from "node:test";
import { createGlide, easeFactor } from "../static/glide.js";

const frame = { width: 640, height: 360 };
const person = (x, id = 1) => ({ label: "person", confidence: 0.9, track_id: id, box: { x, y: 50, width: 80, height: 200 } });

test("a new track appears at its position instead of sliding in", () => {
  const glide = createGlide();
  glide.update([person(100)], frame, 0);
  const [item] = glide.step(16);
  assert.equal(item.box.x, 100);
  assert.equal(item.alpha, 1);
});

test("a moving track eases toward its new position", () => {
  const glide = createGlide({ halfLifeMs: 70 });
  glide.update([person(100)], frame, 0);
  glide.step(0);
  glide.update([person(140)], frame, 100);
  const halfway = glide.step(70)[0].box.x;
  assert.ok(halfway > 100 && halfway < 140, `x=${halfway}`);
  let x = halfway;
  for (let t = 86; t < 1200; t += 16) {
    x = glide.step(t)[0].box.x;
  }
  assert.ok(Math.abs(x - 140) < 0.5, `x=${x}`);
});

test("snap mode jumps straight to the target (reduced motion)", () => {
  const glide = createGlide();
  glide.update([person(100)], frame, 0);
  glide.step(0);
  glide.update([person(300)], frame, 10);
  assert.equal(glide.step(20, { snap: true })[0].box.x, 300);
});

test("a box that drops out fades and is then removed", () => {
  const glide = createGlide({ fadeMs: 200 });
  glide.update([person(100)], frame, 0);
  glide.step(0);
  glide.update([], frame, 100);
  const fading = glide.step(200);
  assert.equal(fading.length, 1);
  assert.ok(fading[0].leaving);
  assert.ok(fading[0].alpha < 1 && fading[0].alpha > 0);
  assert.equal(glide.step(400).length, 0);
});

test("a long jump snaps rather than gliding across the picture", () => {
  const glide = createGlide({ maxJump: 0.3 });
  glide.update([person(10)], frame, 0);
  glide.step(0);
  glide.update([person(560)], frame, 50);
  assert.equal(glide.step(60)[0].box.x, 560);
});

test("a new frame size resets every track", () => {
  const glide = createGlide();
  glide.update([person(100)], frame, 0);
  glide.update([person(100, 7)], { width: 1280, height: 720 }, 10);
  assert.equal(glide.size, 1);
});

test("easeFactor is 0 for no time, half at one half-life, 1 when disabled", () => {
  assert.equal(easeFactor(0, 70), 0);
  assert.ok(Math.abs(easeFactor(70, 70) - 0.5) < 1e-9);
  assert.equal(easeFactor(10, 0), 1);
});
