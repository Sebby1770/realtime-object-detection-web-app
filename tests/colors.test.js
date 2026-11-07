import assert from "node:assert/strict";
import test from "node:test";
import { CHECKER_PATCHES, colorForLabel, contrastRatio, hexToRgb, inkFor, patchForLabel } from "../static/colors.js";

test("every class colour comes from the ColorChecker set", () => {
  const hexes = new Set(CHECKER_PATCHES.map((patch) => patch.hex));
  for (const label of ["person", "cup", "zebra", "toothbrush", "unknown thing", ""]) {
    assert.ok(hexes.has(colorForLabel(label)), label);
  }
});

test("colours are stable and common classes keep their patch", () => {
  assert.equal(colorForLabel("person"), colorForLabel("Person"));
  assert.equal(patchForLabel("person").name, "Bluish green");
  assert.equal(patchForLabel("car").name, "Orange");
  assert.equal(colorForLabel("giraffe"), colorForLabel("giraffe"));
});

test("label ink always reads on its tag (WCAG AA for small text)", () => {
  for (const patch of CHECKER_PATCHES) {
    const ink = inkFor(patch.hex);
    assert.ok(contrastRatio(patch.hex, ink) >= 4.5, `${patch.name} ${patch.hex} with ${ink}`);
  }
});

test("hexToRgb handles short and long forms", () => {
  assert.deepEqual(hexToRgb("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb("#22a9c9"), { r: 34, g: 169, b: 201 });
});
