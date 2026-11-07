import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULTS,
  SETTINGS_KEY,
  THEME_KEY,
  loadSettings,
  loadTheme,
  nextTheme,
  sanitizeSettings,
  saveSettings,
} from "../static/core/settings.js";

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

test("defaults come back for missing or broken storage", () => {
  assert.deepEqual(loadSettings(memoryStorage()), sanitizeSettings({}));
  assert.deepEqual(loadSettings(memoryStorage({ [SETTINGS_KEY]: "{not json" })), sanitizeSettings({}));
  assert.deepEqual(loadSettings(null), sanitizeSettings({}));
  assert.equal(sanitizeSettings({}).engine, "auto");
});

test("numbers are clamped and rounded to what the controls can show", () => {
  const out = sanitizeSettings({ confidence: 4, targetFps: 99, processingWidth: 333, privacyBlur: -3, studioPad: 0.999 });
  assert.equal(out.confidence, 0.95);
  assert.equal(out.targetFps, 15);
  assert.equal(out.processingWidth, 320);
  assert.equal(out.privacyBlur, 6);
  assert.equal(out.studioPad, 0.45);
  assert.equal(sanitizeSettings({ confidence: "abc" }).confidence, DEFAULTS.confidence);
});

test("unknown enum values fall back instead of breaking the UI", () => {
  const out = sanitizeSettings({ engine: "skynet", studioEffect: "laser", grade: "sepia", vanishMode: "ghosts", tab: "admin" });
  assert.equal(out.engine, "auto");
  assert.equal(out.studioEffect, "none");
  assert.equal(out.grade, "none");
  assert.equal(out.vanishMode, "people");
  assert.equal(out.tab, "detect");
});

test("a v2 settings blob migrates: known keys survive, junk is dropped", () => {
  const v2 = {
    confidence: 0.5,
    targetFps: 6,
    processingWidth: 640,
    showLabels: false,
    selectedClasses: ["person", "cup", 42, "", "x".repeat(60)],
    studioEffect: "disappear",
    backgroundColor: "#1F8A70",
    nameplate: "  Alex\nRiver ",
    ghostMode: true,
    somethingOld: true,
  };
  const out = loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify(v2) }));
  assert.equal(out.confidence, 0.5);
  assert.equal(out.showLabels, false);
  assert.deepEqual(out.selectedClasses, ["person", "cup"]);
  assert.equal(out.studioEffect, "disappear");
  assert.equal(out.backgroundColor, "#1f8a70");
  assert.equal(out.nameplate, "Alex River");
  assert.equal(out.ghostMode, true);
  assert.equal("somethingOld" in out, false);
});

test("save then load round-trips and stamps the version", () => {
  const storage = memoryStorage();
  saveSettings(storage, { ...DEFAULTS, confidence: 0.6, mirror: true });
  const raw = JSON.parse(storage.getItem(SETTINGS_KEY));
  assert.equal(raw.version, 3);
  const back = loadSettings(storage);
  assert.equal(back.confidence, 0.6);
  assert.equal(back.mirror, true);
});

test("themes default to system and cycle system, dark, light", () => {
  assert.equal(loadTheme(memoryStorage()), "system");
  assert.equal(loadTheme(memoryStorage({ [THEME_KEY]: "light" })), "light");
  assert.equal(loadTheme(memoryStorage({ [THEME_KEY]: "neon" })), "system");
  assert.equal(nextTheme("system"), "dark");
  assert.equal(nextTheme("dark"), "light");
  assert.equal(nextTheme("light"), "system");
});

test("a storage that throws does not take the app down", () => {
  const hostile = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  assert.deepEqual(loadSettings(hostile), sanitizeSettings({}));
  assert.equal(saveSettings(hostile, DEFAULTS), false);
});
