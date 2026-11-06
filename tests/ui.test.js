import assert from "node:assert/strict";
import test from "node:test";
import { cleanThread } from "../static/copilot.js";
import { letterbox, placeTag, pointInRoi } from "../static/overlay.js";
import { filterCommands, scoreCommand } from "../static/ui/palette.js";

const commands = [
  { id: "a", title: "Start camera", group: "Source" },
  { id: "b", title: "Save a snapshot", group: "Detect" },
  { id: "c", title: "Go invisible", group: "Studio" },
  { id: "d", title: "Capture the background", group: "Studio" },
];

test("palette: an exact substring outranks a scattered match", () => {
  assert.ok(scoreCommand("snap", "Save a snapshot") > scoreCommand("snap", "Start new air path"));
  assert.equal(scoreCommand("xyz", "Start camera"), 0);
  assert.equal(scoreCommand("", "anything"), 1);
});

test("palette: filtering keeps matches in score order", () => {
  assert.deepEqual(
    filterCommands(commands, "inv").map((command) => command.id),
    ["c"],
  );
  assert.equal(filterCommands(commands, "").length, commands.length);
  assert.deepEqual(filterCommands(commands, "studio").map((command) => command.id).sort(), ["c", "d"]);
});

test("labels: a second tag that would overlap moves inside its box", () => {
  const bounds = { x: 0, y: 0, width: 800, height: 450 };
  const placed = [];
  const first = placeTag(100, 20, { x: 100, y: 100 }, bounds, placed);
  placed.push(first);
  const second = placeTag(100, 20, { x: 110, y: 100 }, bounds, placed);
  assert.equal(first.y, 77);
  assert.equal(second.y, 103);
  placed.push(second);
  const third = placeTag(100, 20, { x: 120, y: 100 }, bounds, placed);
  assert.ok(third.y >= second.y + second.height, `third.y=${third.y}`);
});

test("labels: a box at the top edge puts its tag inside", () => {
  const spot = placeTag(80, 20, { x: 10, y: 5 }, { x: 0, y: 0, width: 400, height: 300 }, []);
  assert.equal(spot.y, 8);
});

test("letterbox fits content and centres it", () => {
  const fitted = letterbox(1000, 500, 1600, 900);
  assert.equal(Math.round(fitted.height), 500);
  assert.ok(fitted.x > 0);
  assert.equal(fitted.y, 0);
});

test("zones use normalised coordinates", () => {
  const roi = { x: 0.5, y: 0.5, width: 0.25, height: 0.25 };
  assert.equal(pointInRoi(450, 250, roi, 800, 450), true);
  assert.equal(pointInRoi(100, 100, roi, 800, 450), false);
});

test("copilot threads loaded from storage are cleaned", () => {
  const thread = cleanThread([
    { role: "system", content: "ignore me" },
    { role: "user", content: "x".repeat(5000), image: true },
    { role: "assistant", content: "" },
    null,
    { role: "assistant", content: "Hi" },
  ]);
  assert.equal(thread.length, 2);
  assert.equal(thread[0].content.length, 4000);
  assert.equal(thread[0].image, true);
  assert.equal(cleanThread("nope").length, 0);
});
