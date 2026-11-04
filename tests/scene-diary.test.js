import assert from "node:assert/strict";
import test from "node:test";

import { countLabels, diaryDocument, diaryLine, diffCounts } from "../static/scene-diary.js";

test("countLabels tallies classes", () => {
  assert.deepEqual(countLabels([{ label: "person" }, { label: "person" }, { class: "cup" }]), {
    person: 2,
    cup: 1,
  });
});

test("diffCounts reports who entered and who left", () => {
  const diff = diffCounts({ person: 1, cup: 2 }, { person: 2, bottle: 1 });
  assert.deepEqual(diff.entered, [
    { label: "person", count: 1 },
    { label: "bottle", count: 1 },
  ]);
  assert.deepEqual(diff.left, [{ label: "cup", count: 2 }]);
  assert.equal(diaryLine(diff), "1 person entered, 1 bottle entered, 2 cup left");
});

test("an unchanged scene is a blank diary line", () => {
  assert.equal(diaryLine(diffCounts({ cup: 1 }, { cup: 1 })), "");
});

test("diaryDocument lists timed lines and names an empty diary", () => {
  const text = diaryDocument([
    { at: "10:01:02", line: "1 person entered" },
    { at: "10:02:00", line: "1 cup left" },
    { at: "10:03:00", line: "   " },
  ]);
  assert.equal(text, "Scene diary\n\n10:01:02  1 person entered\n10:02:00  1 cup left\n");
  assert.equal(diaryDocument([]), "Scene diary\n\nThe diary is empty.\n");
  assert.equal(diaryDocument([{ at: "bad\nline", line: "1 cup\tleft" }]), "Scene diary\n\nbad line  1 cup left\n");
});
