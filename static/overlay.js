const PALETTE = [
  "#38d6c6",
  "#ff6f59",
  "#f5c84b",
  "#7bd88f",
  "#c084fc",
  "#7dd3fc",
  "#f472b6",
  "#fb923c",
];

export const ROI_COLORS = [
  "rgba(245, 200, 75, 0.95)",
  "rgba(56, 214, 198, 0.95)",
  "rgba(255, 111, 89, 0.95)",
];

const PRIVACY_LABELS = new Set(["person"]);

export function colorForLabel(label) {
  let hash = 0;
  const text = String(label || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function alphaColor(hex, opacity) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function letterbox(containerWidth, containerHeight, contentWidth, contentHeight) {
  if (contentWidth <= 0 || contentHeight <= 0) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight, scale: 1 };
  }
  const scale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight);
  const width = contentWidth * scale;
  const height = contentHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
    scale,
  };
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
  const right = left + roi.width * frameWidth;
  const bottom = top + roi.height * frameHeight;
  return x >= left && x <= right && y >= top && y <= bottom;
}

export function pointerToNormalized(event, stageEl, frameSize) {
  const rect = stageEl.getBoundingClientRect();
  const fitted = letterbox(rect.width, rect.height, frameSize.width || 1, frameSize.height || 1);
  const x = (event.clientX - rect.left - fitted.x) / Math.max(1, fitted.width);
  const y = (event.clientY - rect.top - fitted.y) / Math.max(1, fitted.height);
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

export function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    chartBg: styles.getPropertyValue("--chart-bg").trim() || "#101012",
    teal: styles.getPropertyValue("--teal").trim() || "#38d6c6",
    green: styles.getPropertyValue("--green").trim() || "#7bd88f",
    muted: styles.getPropertyValue("--muted").trim() || "#a9a49a",
    line: styles.getPropertyValue("--line").trim() || "#303037",
  };
}

function resizeCanvas(canvas, stageEl) {
  const rect = stageEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function drawCornerBox(context, x, y, width, height, color) {
  const arm = Math.min(width, height) * 0.22;
  context.strokeStyle = color;
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

function drawDetection(context, detection, fitted, options, alpha, source) {
  const mapped = mapBox(detection.box, fitted);
  const color = colorForLabel(detection.label);
  context.globalAlpha = alpha;

  if (options.privacyMode && PRIVACY_LABELS.has(detection.label)) {
    context.save();
    context.beginPath();
    context.rect(mapped.x, mapped.y, mapped.width, mapped.height);
    context.clip();
    context.filter = `blur(${options.privacyBlur}px)`;
    if (source) {
      context.drawImage(source, fitted.x, fitted.y, fitted.width, fitted.height);
    } else {
      context.fillStyle = "rgba(7, 17, 17, 0.75)";
      context.fillRect(mapped.x, mapped.y, mapped.width, mapped.height);
    }
    context.restore();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.strokeRect(mapped.x, mapped.y, mapped.width, mapped.height);
    context.globalAlpha = 1;
    return;
  }

  if (options.showTrails && detection.trail?.length > 1) {
    context.strokeStyle = alphaColor(color, 0.55);
    context.lineWidth = 2;
    context.beginPath();
    detection.trail.forEach((point, index) => {
      const px = fitted.x + point.x * fitted.scale;
      const py = fitted.y + point.y * fitted.scale;
      if (index === 0) {
        context.moveTo(px, py);
      } else {
        context.lineTo(px, py);
      }
    });
    context.stroke();
  }

  context.lineWidth = Math.max(2, Math.min(fitted.width, fitted.height) * 0.004);
  context.strokeStyle = color;
  context.fillStyle = color;
  if (options.cornerBoxes) {
    drawCornerBox(context, mapped.x, mapped.y, mapped.width, mapped.height, color);
  } else {
    context.strokeRect(mapped.x, mapped.y, mapped.width, mapped.height);
  }

  if (options.showLabels) {
    const track = detection.track_id ? `#${detection.track_id} ` : "";
    const label = `${track}${detection.label} ${Math.round(detection.confidence * 100)}%`;
    context.font = "700 13px ui-sans-serif, system-ui, sans-serif";
    const metrics = context.measureText(label);
    const labelHeight = 22;
    const labelWidth = metrics.width + 14;
    const labelY = mapped.y > labelHeight + 4 ? mapped.y - labelHeight - 4 : mapped.y + 4;
    context.fillRect(mapped.x, labelY, labelWidth, labelHeight);
    context.fillStyle = "#071111";
    context.fillText(label, mapped.x + 7, labelY + 15);
  }
  context.globalAlpha = 1;
}

export function drawOverlay({
  overlay,
  stage,
  detections,
  ghosts,
  rois,
  roiPreview,
  frameSize,
  options,
  source,
}) {
  const { context, width, height } = resizeCanvas(overlay, stage);
  context.clearRect(0, 0, width, height);
  const fitted = letterbox(width, height, frameSize.width || 1, frameSize.height || 1);

  const zones = roiPreview ? [...rois, roiPreview] : rois;
  zones.forEach((roi, index) => {
    const roiX = fitted.x + roi.x * fitted.width;
    const roiY = fitted.y + roi.y * fitted.height;
    const roiW = roi.width * fitted.width;
    const roiH = roi.height * fitted.height;
    context.strokeStyle = ROI_COLORS[index % ROI_COLORS.length];
    context.setLineDash([8, 6]);
    context.strokeRect(roiX, roiY, roiW, roiH);
    context.setLineDash([]);
    context.fillStyle = ROI_COLORS[index % ROI_COLORS.length];
    context.font = "700 12px ui-sans-serif, system-ui, sans-serif";
    context.fillText(index === rois.length ? "New" : `Z${index + 1}`, roiX + 6, roiY + 16);
  });

  if (options.ghostMode && ghosts?.length) {
    ghosts.forEach((detection) => {
      drawDetection(context, detection, fitted, options, options.ghostOpacity, source);
    });
  }
  detections.forEach((detection) => {
    drawDetection(context, detection, fitted, options, 1, source);
  });

  return { width, height, fitted };
}

export function drawHeatmap(canvas, stage, cells, frameSize, enabled) {
  const { context, width, height } = resizeCanvas(canvas, stage);
  context.clearRect(0, 0, width, height);
  if (!enabled) {
    return;
  }
  const fitted = letterbox(width, height, frameSize.width || 1, frameSize.height || 1);
  const cellWidth = fitted.width / 16;
  const cellHeight = fitted.height / 9;
  cells.forEach((value, index) => {
    if (!value || value < 0.03) {
      return;
    }
    const x = fitted.x + (index % 16) * cellWidth;
    const y = fitted.y + Math.floor(index / 16) * cellHeight;
    context.fillStyle = `rgba(56, 214, 198, ${value * 0.55})`;
    context.fillRect(x, y, cellWidth, cellHeight);
  });
}

export function updateHeatmap(cells, detections, frameSize) {
  const width = Math.max(1, frameSize.width || 1);
  const height = Math.max(1, frameSize.height || 1);
  for (const detection of detections) {
    const box = detection.box;
    const centerX = Math.min(15, Math.max(0, Math.floor(((box.x + box.width / 2) / width) * 16)));
    const centerY = Math.min(8, Math.max(0, Math.floor(((box.y + box.height / 2) / height) * 9)));
    const index = centerY * 16 + centerX;
    cells[index] = Math.min(1, (cells[index] || 0) + 0.22);
  }
  for (let index = 0; index < cells.length; index += 1) {
    cells[index] = (cells[index] || 0) * 0.96;
  }
}

export function drawLatencyChart(canvas, samples) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const colors = themeColors();
  context.clearRect(0, 0, width, height);
  context.fillStyle = colors.chartBg;
  context.fillRect(0, 0, width, height);
  if (!samples.length) {
    return;
  }
  const max = Math.max(...samples, 1);
  context.strokeStyle = colors.teal;
  context.lineWidth = 2;
  context.beginPath();
  samples.forEach((sample, index) => {
    const x = (index / Math.max(1, samples.length - 1)) * (width - 8) + 4;
    const y = height - 6 - (sample / max) * (height - 12);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
}

export function drawDensityChart(canvas, samples) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const colors = themeColors();
  context.clearRect(0, 0, width, height);
  context.fillStyle = colors.chartBg;
  context.fillRect(0, 0, width, height);
  if (!samples.length) {
    return;
  }
  const max = Math.max(...samples, 1);
  context.fillStyle = colors.green;
  samples.forEach((sample, index) => {
    const barWidth = (width - 8) / samples.length;
    const x = 4 + index * barWidth;
    const barHeight = (sample / max) * (height - 8);
    context.fillRect(x, height - 4 - barHeight, Math.max(2, barWidth - 2), barHeight);
  });
}

export function drawProximityRadar(canvas, detections, frameSize) {
  const context = canvas.getContext("2d");
  const size = canvas.width;
  const center = size / 2;
  const radius = size * 0.42;
  const colors = themeColors();
  context.clearRect(0, 0, size, size);
  context.fillStyle = colors.chartBg;
  context.fillRect(0, 0, size, size);
  context.strokeStyle = "rgba(56, 214, 198, 0.28)";
  for (let ring = 1; ring <= 3; ring += 1) {
    context.beginPath();
    context.arc(center, center, (radius * ring) / 3, 0, Math.PI * 2);
    context.stroke();
  }
  detections.forEach((detection) => {
    const box = detection.box;
    const x = center + ((box.x + box.width / 2) / Math.max(1, frameSize.width) - 0.5) * radius * 2;
    const y = center + ((box.y + box.height / 2) / Math.max(1, frameSize.height) - 0.5) * radius * 2;
    context.fillStyle = colorForLabel(detection.label);
    context.beginPath();
    context.arc(x, y, 4 + detection.confidence * 4, 0, Math.PI * 2);
    context.fill();
  });
}

export function snapshotComposite(source, overlay, width, height, fitted) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#050506";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (source && fitted) {
    context.drawImage(source, fitted.x, fitted.y, fitted.width, fitted.height);
  } else if (source) {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  context.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  return canvas;
}
