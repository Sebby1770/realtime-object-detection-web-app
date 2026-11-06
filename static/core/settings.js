/**
 * Settings that survive a reload. Everything read back from storage goes
 * through `sanitizeSettings`, so a hand-edited or stale value can never put
 * the app in a state the controls cannot show.
 *
 * Pure module: storage is injected, so the Node tests can exercise it.
 */

import { cleanNameplate } from "../studio.js";

export const SETTINGS_KEY = "object-detection-settings";
export const THEME_KEY = "object-detection-theme";
export const SETTINGS_VERSION = 3;

export const ENGINE_IDS = ["server", "efficientdet-lite2", "efficientdet-lite0", "cocossd-lite"];
export const EFFECT_IDS = ["none", "disappear", "portrait", "replace", "pixelate", "spotlight", "outline"];
export const GRADE_IDS = ["none", "warm", "noir", "vivid", "dawn"];
export const VANISH_IDS = ["people", "selected", "all"];
export const TAB_IDS = ["detect", "studio", "zones", "session", "copilot"];
export const THEMES = ["system", "dark", "light"];

export const DEFAULTS = Object.freeze({
  version: SETTINGS_VERSION,
  engine: "auto",
  confidence: 0.35,
  targetFps: 8,
  processingWidth: 640,
  selectedClasses: [],
  showLabels: true,
  cornerBoxes: false,
  showTrails: true,
  glide: true,
  ghostMode: false,
  ghostOpacity: 0.28,
  showHeatmap: true,
  privacyMode: false,
  privacyBlur: 14,
  alertSound: true,
  spatialAudio: true,
  sonify: false,
  studioEffect: "none",
  useMask: true,
  vanishMode: "people",
  studioPad: 0.18,
  backgroundColor: "#2f6f5e",
  grade: "none",
  mirror: false,
  autoFrame: false,
  nameplate: "",
  burnHud: false,
  videoApp: "zoom",
  tab: "detect",
});

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeSettings(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULTS, selectedClasses: [] };
  out.engine = input.engine === "auto" ? "auto" : oneOf(input.engine, ENGINE_IDS, DEFAULTS.engine);
  out.confidence = Math.round(clampNumber(input.confidence, 0.05, 0.95, DEFAULTS.confidence) * 100) / 100;
  out.targetFps = Math.round(clampNumber(input.targetFps, 1, 15, DEFAULTS.targetFps));
  out.processingWidth = Math.round(clampNumber(input.processingWidth, 320, 1280, DEFAULTS.processingWidth) / 80) * 80;
  if (Array.isArray(input.selectedClasses)) {
    const unique = new Set();
    for (const label of input.selectedClasses) {
      if (typeof label === "string" && label.trim() && label.length <= 40) {
        unique.add(label.trim());
      }
      if (unique.size >= 80) {
        break;
      }
    }
    out.selectedClasses = [...unique];
  }
  for (const key of [
    "showLabels",
    "cornerBoxes",
    "showTrails",
    "glide",
    "ghostMode",
    "showHeatmap",
    "privacyMode",
    "alertSound",
    "spatialAudio",
    "sonify",
    "useMask",
    "mirror",
    "autoFrame",
    "burnHud",
  ]) {
    out[key] = bool(input[key], DEFAULTS[key]);
  }
  out.ghostOpacity = Math.round(clampNumber(input.ghostOpacity, 0.08, 0.55, DEFAULTS.ghostOpacity) * 100) / 100;
  out.privacyBlur = Math.round(clampNumber(input.privacyBlur, 6, 28, DEFAULTS.privacyBlur));
  out.studioEffect = oneOf(input.studioEffect, EFFECT_IDS, DEFAULTS.studioEffect);
  out.vanishMode = oneOf(input.vanishMode, VANISH_IDS, DEFAULTS.vanishMode);
  out.studioPad = Math.round(clampNumber(input.studioPad, 0, 0.45, DEFAULTS.studioPad) * 100) / 100;
  out.backgroundColor = /^#[0-9a-f]{6}$/i.test(String(input.backgroundColor || ""))
    ? String(input.backgroundColor).toLowerCase()
    : DEFAULTS.backgroundColor;
  out.grade = oneOf(input.grade, GRADE_IDS, DEFAULTS.grade);
  out.nameplate = typeof input.nameplate === "string" ? cleanNameplate(input.nameplate) : "";
  out.videoApp = typeof input.videoApp === "string" && /^[a-z]{2,16}$/.test(input.videoApp) ? input.videoApp : DEFAULTS.videoApp;
  out.tab = oneOf(input.tab, TAB_IDS, DEFAULTS.tab);
  return out;
}

function safeGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(storage) {
  const text = safeGet(storage, SETTINGS_KEY);
  if (!text) {
    return sanitizeSettings({});
  }
  try {
    return sanitizeSettings(JSON.parse(text));
  } catch {
    return sanitizeSettings({});
  }
}

export function saveSettings(storage, settings) {
  return safeSet(storage, SETTINGS_KEY, JSON.stringify({ ...sanitizeSettings(settings), version: SETTINGS_VERSION }));
}

/** v2 stored "light" or "dark"; v3 adds "system", the default. */
export function loadTheme(storage) {
  const value = safeGet(storage, THEME_KEY);
  return THEMES.includes(value) ? value : "system";
}

export function saveTheme(storage, theme) {
  return safeSet(storage, THEME_KEY, THEMES.includes(theme) ? theme : "system");
}

export function nextTheme(theme) {
  const index = THEMES.indexOf(theme);
  return THEMES[(index + 1) % THEMES.length];
}
