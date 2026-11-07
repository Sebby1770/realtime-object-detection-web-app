/**
 * Label colours drawn from the ColorChecker Classic chart that photographers
 * and colourists shoot to calibrate a camera. The chromatic patches are lifted
 * a little so a 2px outline still reads on dark or busy video.
 *
 * Pure module: no DOM access, imported by the Node tests.
 */

export const CHECKER_PATCHES = [
  { name: "Bluish green", chart: "#67bdaa", hex: "#67bdaa" },
  { name: "Orange", chart: "#d67e2c", hex: "#f08c35" },
  { name: "Blue flower", chart: "#8580b1", hex: "#a39fd6" },
  { name: "Yellow green", chart: "#9dbc40", hex: "#a9cc45" },
  { name: "Moderate red", chart: "#c15a63", hex: "#e0737c" },
  { name: "Cyan", chart: "#0885a1", hex: "#22a9c9" },
  { name: "Orange yellow", chart: "#e0a32e", hex: "#f0b23a" },
  { name: "Purple", chart: "#5e3c6c", hex: "#a97bbd" },
  { name: "Green", chart: "#469449", hex: "#5cbf60" },
  { name: "Magenta", chart: "#bb5695", hex: "#da6db1" },
  { name: "Blue sky", chart: "#627a9d", hex: "#7f9cc7" },
  { name: "Yellow", chart: "#e7c71f", hex: "#ecd040" },
  { name: "Red", chart: "#af363c", hex: "#e2544f" },
  { name: "Purplish blue", chart: "#505ba6", hex: "#7d88d9" },
  { name: "Foliage", chart: "#576c43", hex: "#8fae6a" },
];

/** Common classes keep the same patch everywhere, so a cup is always the same colour. */
const FIXED = {
  person: 0,
  car: 1,
  laptop: 2,
  "potted plant": 3,
  dog: 4,
  cat: 9,
  cup: 6,
  bottle: 5,
  keyboard: 10,
  mouse: 13,
  "cell phone": 7,
  book: 14,
  chair: 8,
  bicycle: 12,
  "traffic light": 11,
};

export function hashLabel(label) {
  let hash = 0;
  const text = String(label || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function patchForLabel(label) {
  const key = String(label || "").toLowerCase();
  const index = Object.hasOwn(FIXED, key) ? FIXED[key] : hashLabel(key) % CHECKER_PATCHES.length;
  return CHECKER_PATCHES[index];
}

export function colorForLabel(label) {
  return patchForLabel(label).hex;
}

export function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value.padEnd(6, "0");
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

export function alphaColor(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink for text set on a label tag: whichever of near-black or white reads better. */
export function inkFor(hex) {
  const dark = "#111418";
  const light = "#ffffff";
  return contrastRatio(hex, dark) >= contrastRatio(hex, light) ? dark : light;
}
