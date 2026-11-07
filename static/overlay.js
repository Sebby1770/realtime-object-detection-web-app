/**
 * Monitor drawing: frame lines, zones, boxes with label tags, trails, the
 * heatmap, and the small charts in the Session panel. Canvas sizes follow
 * devicePixelRatio so lines stay crisp on Retina screens.
 */

import { alphaColor, colorForLabel, inkFor } from "./colors.js";

export { colorForLabel, alphaColor };

export const ROI_COLORS = ["#ecd040", "#22a9c9", "#da6db1"];
const PRIVACY_LABELS = new Set(["person"]);
const LABEL_FONT = '600 12.5px "Saira", ui-sans-serif, system-ui, sans-serif';

export function letterbox(containerWidth, containerHeight, contentWidth, contentHeight) {
  if (contentWidth <= 0 || contentHeight <= 0) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight, scale: 1 };
  }
  const scale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight);
  const width = contentWidth * scale;
  const height = contentHeight * scale;
  return { x: (containerWidth - width) / 2, y: (containerHeight - height) / 2, width, height, scale };
}

export function mapBox(box, fitted) {
  return {
    x: fitted.x + box.x * fitted.scale,
    y: fitted.y + box.y * fitted.scale,
    width: box.width * fitted.scale,
    height: box.height * fitted.scale,
  };
}

export function pointInRoi(x, y, roi, frameWidth, frameHeight) {
  const left = roi.x * frameWidth;
  const top = roi.y * frameHeight;
  return x >= left && x <= left + roi.width * frameWidth && y >= top && y <= top + roi.height * frameHeight;
}

export function pointerToNormalized(event, stageEl, frameSize) {
  const rect = stageEl.getBoundingClientRect();
  const fitted = letterbox(rect.width, rect.height, frameSize.width || 1, frameSize.height || 1);
  const x = (event.clientX - rect.left - fitted.x) / Math.max(1, fitted.width);
  const y = (event.clientY - rect.top - fitted.y) / Math.max(1, fitted.height);
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

export function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    line: read("--chart-line", "#67bdaa"),
    bar: read("--chart-bar", "#7f9cc7"),
    grid: read("--chart-grid", "rgba(232,234,237,0.08)"),
    ring: read("--chart-ring", "rgba(232,234,237,0.12)"),
    muted: read("--ink-3", "#7d858f"),
  };
}

function fitCanvas(canvas, width, height) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}

function stageCanvas(canvas, stage) {
  const rect = stage.getBoundingClientRect();
  return { context: fitCanvas(canvas, rect.width, rect.height), width: rect.width, height: rect.height };
}

function roundedRect(context, x, y, width, height, radius) {
  if (typeof context.roundRect === "function") {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  context.beginPath();
  context.rect(x, y, width, height);
}

function drawFrameLines(context, fitted) {
  const inset = Math.min(fitted.width, fitted.height) * 0.035;
  const arm = Math.min(fitted.width, fitted.height) * 0.05;
  const left = fitted.x + inset;
  const top = fitted.y + inset;
  const right = fitted.x + fitted.width - inset;
  const bottom = fitted.y + fitted.height - inset;
  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.5)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(left, top + arm);
  context.lineTo(left, top);
  context.lineTo(left + arm, top);
  context.moveTo(right - arm, top);
  context.lineTo(right, top);
  context.lineTo(right, top + arm);
  context.moveTo(right, bottom - arm);
  context.lineTo(right, bottom);
  context.lineTo(right - arm, bottom);
  context.moveTo(left + arm, bottom);
  context.lineTo(left, bottom);
  context.lineTo(left, bottom - arm);
  context.stroke();
  context.restore();
}

function drawCornerBox(context, x, y, width, height) {
  const arm = Math.max(6, Math.min(width, height) * 0.22);
  context.beginPath();
  context.moveTo(x, y + arm);
  context.lineTo(x, y);
  context.lineTo(x + arm, y);
  context.moveTo(x + width - arm, y);
  context.lineTo(x + width, y);
  context.lineTo(x + width, y + arm);
  context.moveTo(x + width, y + height - arm);
  context.lineTo(x + width, y + height);
  context.lineTo(x + width - arm, y + height);
  context.moveTo(x + arm, y + height);
  context.lineTo(x, y + height);
  context.lineTo(x, y + height - arm);
  context.stroke();
}

function drawTrail(context, detection, fitted, color, alpha) {
  const trail = detection.trail;
  if (!trail || trail.length < 2) {
    return;
  }
  context.save();
  context.lineWidth = 2;
  context.lineCap = "round";
  for (let index = 1; index < trail.length; index += 1) {
    const from = trail[index - 1];
    const to = trail[index];
    context.strokeStyle = alphaColor(color, (0.12 + (0.6 * index) / trail.length) * alpha);
    context.beginPath();
    context.moveTo(fitted.x + from.x * fitted.scale, fitted.y + from.y * fitted.scale);
    context.lineTo(fitted.x + to.x * fitted.scale, fitted.y + to.y * fitted.scale);
    context.stroke();
  }
  context.restore();
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Pick a spot for a label tag that does not cover one already drawn:
 * above the box, then just inside its top edge, then stacked under
 * whichever tag is in the way. Pure; exported for tests.
 */
export function placeTag(width, height, box, bounds, placed = []) {
  const clampLeft = (left) => Math.min(Math.max(bounds.x + 2, left), bounds.x + bounds.width - width - 2);
  const left = clampLeft(box.x - 1);
  const candidates = [];
  const above = box.y - height - 3;
  if (above >= bounds.y + 2) {
    candidates.push({ x: left, y: above, width, height });
  }
  candidates.push({ x: left, y: box.y + 3, width, height });
  for (const candidate of candidates) {
    if (!placed.some((rect) => overlaps(rect, candidate))) {
      return candidate;
    }
  }
  let spot = { ...candidates[candidates.length - 1] };
  for (let guard = 0; guard < 12; guard += 1) {
    const blocker = placed.find((rect) => overlaps(rect, spot));
    if (!blocker) {
      break;
    }
    spot = { ...spot, y: blocker.y + blocker.height + 2 };
  }
  spot.y = Math.min(spot.y, bounds.y + bounds.height - height - 2);
  return spot;
}

function drawTag(context, text, x, y, color, bounds, placed) {
  context.font = LABEL_FONT;
  if ("fontStretch" in context) {
    context.fontStretch = "semi-condensed";
  }
  const width = Math.ceil(context.measureText(text).width) + 12;
  const height = 20;
  const spot = placeTag(width, height, { x, y }, bounds, placed);
  placed?.push(spot);
  const left = spot.x;
  const top = spot.y;
  context.fillStyle = color;
  roundedRect(context, left, top, width, height, 4);
  context.fill();
  context.fillStyle = inkFor(color);
  context.textBaseline = "middle";
  context.fillText(text, left + 6, top + height / 2 + 0.5);
  if ("fontStretch" in context) {
    context.fontStretch = "normal";
  }
}

function drawDetection(context, detection, fitted, options, alpha, source, labelled) {
  const mapped = mapBox(detection.box, fitted);
  if (mapped.width < 1 || mapped.height < 1) {
    return;
  }
  const color = colorForLabel(detection.label);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, alpha));

  if (options.privacyMode && PRIVACY_LABELS.has(detection.label) && source) {
    context.save();
    context.beginPath();
    context.rect(mapped.x, mapped.y, mapped.width, mapped.height);
    context.clip();
    context.filter = `blur(${options.privacyBlur}px)`;
    try {
      context.drawImage(source, fitted.x, fitted.y, fitted.width, fitted.height);
    } catch {
      context.fillStyle = "rgba(13, 15, 18, 0.8)";
      context.fillRect(mapped.x, mapped.y, mapped.width, mapped.height);
    }
    context.restore();
  }

  if (options.showTrails && labelled) {
    drawTrail(context, detection, fitted, color, alpha);
  }

  context.strokeStyle = color;
  context.lineWidth = 2;
  if (options.cornerBoxes) {
    context.lineWidth = 2.5;
    drawCornerBox(context, mapped.x, mapped.y, mapped.width, mapped.height);
  } else {
    roundedRect(context, mapped.x, mapped.y, mapped.width, mapped.height, 3);
    context.stroke();
  }

  context.restore();
}

/** Labels go on in a second pass so no box outline is ever drawn across a label. */
function drawLabel(context, detection, fitted, alpha, placed) {
  const mapped = mapBox(detection.box, fitted);
  if (mapped.width < 1 || mapped.height < 1) {
    return;
  }
  const id = detection.track_id != null ? `${detection.track_id} ` : "";
  const text = `${id}${detection.label} ${Math.round(detection.confidence * 100)}%`;
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, alpha));
  drawTag(context, text, mapped.x, mapped.y, colorForLabel(detection.label), fitted, placed);
  context.restore();
}

function drawZones(context, fitted, zones, previewIndex, zoneCounts) {
  zones.forEach((roi, index) => {
    const x = fitted.x + roi.x * fitted.width;
    const y = fitted.y + roi.y * fitted.height;
    const width = roi.width * fitted.width;
    const height = roi.height * fitted.height;
    const color = ROI_COLORS[index % ROI_COLORS.length];
    const occupied = (zoneCounts?.[index] || 0) > 0;
    context.save();
    context.fillStyle = alphaColor(color, occupied ? 0.16 : 0.06);
    context.fillRect(x, y, width, height);
    context.strokeStyle = color;
    context.lineWidth = occupied ? 2.5 : 1.5;
    context.setLineDash(index === previewIndex ? [4, 4] : [9, 6]);
    context.strokeRect(x, y, width, height);
    context.setLineDash([]);
    const name = index === previewIndex ? "New zone" : `Zone ${index + 1}`;
    const text = occupied ? `${name}  ${zoneCounts[index]}` : name;
    context.font = LABEL_FONT;
    const tagWidth = context.measureText(text).width + 12;
    context.fillStyle = color;
    roundedRect(context, x, y, tagWidth, 20, [0, 0, 4, 0]);
    context.fill();
    context.fillStyle = inkFor(color);
    context.textBaseline = "middle";
    context.fillText(text, x + 6, y + 10.5);
    context.restore();
  });
}

export function drawOverlay({
  overlay,
  stage,
  items = [],
  ghosts = [],
  rois = [],
  roiPreview = null,
  frameSize,
  options = {},
  source = null,
  live = false,
  zoneCounts = [],
}) {
  const { context, width, height } = stageCanvas(overlay, stage);
  context.clearRect(0, 0, width, height);
  const fitted = letterbox(width, height, frameSize.width || 1, frameSize.height || 1);

  if (live && options.frameLines !== false) {
    drawFrameLines(context, fitted);
  }

  const zones = roiPreview ? [...rois, roiPreview] : rois;
  drawZones(context, fitted, zones, roiPreview ? rois.length : -1, zoneCounts);

  if (options.ghostMode) {
    for (const ghost of ghosts) {
      drawDetection(context, ghost, fitted, { ...options, privacyMode: false }, options.ghostOpacity ?? 0.28, null, false);
    }
  }
  for (const item of items) {
    drawDetection(context, item, fitted, options, item.alpha ?? 1, source, !item.leaving);
  }
  if (options.showLabels) {
    // Most confident first, so the strongest labels win the clearest spots.
    const placed = [];
    const ordered = items.filter((item) => !item.leaving).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    for (const item of ordered) {
      drawLabel(context, item, fitted, item.alpha ?? 1, placed);
    }
  }
  return { width, height, fitted };
}

const heatCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

export function drawHeatmap(canvas, stage, cells, frameSize, enabled, color = "#67bdaa") {
  const { context, width, height } = stageCanvas(canvas, stage);
  context.clearRect(0, 0, width, height);
  if (!enabled || !heatCanvas) {
    return;
  }
  let peak = 0;
  for (const value of cells) {
    peak = Math.max(peak, value || 0);
  }
  if (peak < 0.03) {
    return;
  }
  heatCanvas.width = 16;
  heatCanvas.height = 9;
  const heat = heatCanvas.getContext("2d");
  const pixels = heat.createImageData(16, 9);
  const rgb = color.startsWith("#") ? color : "#67bdaa";
  const r = parseInt(rgb.slice(1, 3), 16);
  const g = parseInt(rgb.slice(3, 5), 16);
  const b = parseInt(rgb.slice(5, 7), 16);
  cells.forEach((value, index) => {
    const offset = index * 4;
    pixels.data[offset] = r;
    pixels.data[offset + 1] = g;
    pixels.data[offset + 2] = b;
    pixels.data[offset + 3] = Math.round(Math.min(1, value || 0) * 120);
  });
  heat.putImageData(pixels, 0, 0);
  const fitted = letterbox(width, height, frameSize.width || 1, frameSize.height || 1);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(heatCanvas, fitted.x, fitted.y, fitted.width, fitted.height);
}

export function updateHeatmap(cells, detections, frameSize) {
  const width = Math.max(1, frameSize.width || 1);
  const height = Math.max(1, frameSize.height || 1);
  for (const detection of detections) {
    const box = detection.box;
    const column = Math.min(15, Math.max(0, Math.floor(((box.x + box.width / 2) / width) * 16)));
    const row = Math.min(8, Math.max(0, Math.floor(((box.y + box.height / 2) / height) * 9)));
    const index = row * 16 + column;
    cells[index] = Math.min(1, (cells[index] || 0) + 0.22);
  }
  for (let index = 0; index < cells.length; index += 1) {
    cells[index] = (cells[index] || 0) * 0.96;
  }
}

function chartContext(canvas) {
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  return { context: fitCanvas(canvas, width, height), width, height };
}

export function drawSparkline(canvas, samples) {
  if (!canvas.isConnected || canvas.offsetParent === null) {
    return;
  }
  const { context, width, height } = chartContext(canvas);
  const colors = themeColors();
  context.clearRect(0, 0, width, height);
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  for (const fraction of [0.33, 0.66]) {
    context.beginPath();
    context.moveTo(0, Math.round(height * fraction) + 0.5);
    context.lineTo(width, Math.round(height * fraction) + 0.5);
    context.stroke();
  }
  if (samples.length < 2) {
    return;
  }
  const max = Math.max(...samples, 1) * 1.15;
  const point = (sample, index) => [
    (index / (samples.length - 1)) * (width - 4) + 2,
    height - 3 - (sample / max) * (height - 8),
  ];
  context.beginPath();
  samples.forEach((sample, index) => {
    const [x, y] = point(sample, index);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = colors.line;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.stroke();
  context.lineTo(width - 2, height);
  context.lineTo(2, height);
  context.closePath();
  context.fillStyle = alphaColor(colors.line.startsWith("#") ? colors.line : "#67bdaa", 0.12);
  context.fill();
}

export function drawBars(canvas, samples) {
  if (!canvas.isConnected || canvas.offsetParent === null) {
    return;
  }
  const { context, width, height } = chartContext(canvas);
  const colors = themeColors();
  context.clearRect(0, 0, width, height);
  if (!samples.length) {
    return;
  }
  // Fixed slots, newest on the right, so one sample is one thin bar rather than a wall.
  const slots = 48;
  const max = Math.max(...samples, 1);
  const slot = width / slots;
  const offset = slots - Math.min(slots, samples.length);
  context.fillStyle = colors.bar;
  samples.slice(-slots).forEach((sample, index) => {
    const barHeight = Math.max(sample > 0 ? 2 : 0, (sample / max) * (height - 4));
    roundedRect(context, (offset + index) * slot + 1, height - barHeight, Math.max(2, slot - 2), barHeight, 2);
    context.fill();
  });
}

export function drawRadar(canvas, detections, frameSize) {
  if (!canvas.isConnected || canvas.offsetParent === null) {
    return;
  }
  const { context, width } = chartContext(canvas);
  const size = width;
  const center = size / 2;
  const radius = size * 0.44;
  const colors = themeColors();
  context.clearRect(0, 0, size, size);
  context.strokeStyle = colors.ring;
  context.lineWidth = 1;
  for (let ring = 1; ring <= 3; ring += 1) {
    context.beginPath();
    context.arc(center, center, (radius * ring) / 3, 0, Math.PI * 2);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(center - radius, center);
  context.lineTo(center + radius, center);
  context.moveTo(center, center - radius);
  context.lineTo(center, center + radius);
  context.stroke();
  for (const detection of detections) {
    const box = detection.box;
    const x = center + ((box.x + box.width / 2) / Math.max(1, frameSize.width) - 0.5) * radius * 2;
    const y = center + ((box.y + box.height / 2) / Math.max(1, frameSize.height) - 0.5) * radius * 2;
    context.fillStyle = colorForLabel(detection.label);
    context.beginPath();
    context.arc(x, y, 3.5 + detection.confidence * 3.5, 0, Math.PI * 2);
    context.fill();
  }
}

export function snapshotComposite(source, overlay, width, height, fitted) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#0d0f12";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (source && fitted) {
    context.drawImage(source, fitted.x, fitted.y, fitted.width, fitted.height);
  } else if (source) {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  context.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  return canvas;
}
