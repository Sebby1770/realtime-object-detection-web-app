/**
 * Studio effects, photo-booth layout, and video-app bridge copy.
 * Canvas helpers run in the browser. The pure helpers are imported by tests.
 */

export const STUDIO_MAX_WIDTH = 960;

export const STUDIO_EFFECTS = [
  { id: "none", label: "Off" },
  { id: "disappear", label: "Disappear" },
  { id: "portrait", label: "Portrait blur" },
  { id: "replace", label: "Replace background" },
  { id: "pixelate", label: "Pixelate" },
  { id: "spotlight", label: "Spotlight" },
  { id: "outline", label: "Outline" },
];

export const STUDIO_GRADES = [
  { id: "none", label: "Natural", filter: "none" },
  { id: "warm", label: "Warm", filter: "sepia(0.28) saturate(1.18) contrast(1.04)" },
  { id: "noir", label: "Noir", filter: "grayscale(1) contrast(1.22) brightness(0.96)" },
  { id: "vivid", label: "Vivid", filter: "saturate(1.5) contrast(1.08)" },
  { id: "dawn", label: "Dawn", filter: "sepia(0.18) hue-rotate(-10deg) saturate(1.12) brightness(1.06)" },
];

export function gradeFilter(id) {
  return STUDIO_GRADES.find((grade) => grade.id === id)?.filter ?? "none";
}

export const VIDEO_APPS = [
  {
    id: "zoom",
    name: "Zoom",
    camera: "Settings → Video → Camera → OBS Virtual Camera",
    window: "Share Screen → Window → Detection clean feed",
  },
  {
    id: "meet",
    name: "Google Meet",
    camera: "More options → Settings → Video → OBS Virtual Camera",
    window: "Present now → A window → Detection clean feed",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    camera: "Settings → Devices → Camera → OBS Virtual Camera",
    window: "Share → Window → Detection clean feed",
  },
  {
    id: "photobooth",
    name: "Photo Booth",
    camera: "Camera menu → OBS Virtual Camera",
    window: "Photo Booth only accepts a camera device, not a window.",
  },
  {
    id: "facetime",
    name: "FaceTime",
    camera: "Video menu → OBS Virtual Camera",
    window: "FaceTime only accepts a camera device, not a window.",
  },
  {
    id: "discord",
    name: "Discord",
    camera: "User Settings → Voice & Video → Camera → OBS Virtual Camera",
    window: "Share Your Screen → Window → Detection clean feed",
  },
  {
    id: "obs",
    name: "OBS",
    camera: "Start Virtual Camera, or add a Browser / Media Source",
    window: "Media Source → http://127.0.0.1:8000/api/studio.mjpg while the local server is running",
  },
  {
    id: "quicktime",
    name: "QuickTime Player",
    camera: "File → New Movie Recording → camera menu → OBS Virtual Camera",
    window: "QuickTime movie recording only accepts a camera device.",
  },
  {
    id: "slack",
    name: "Slack",
    camera: "Huddle or call → Video → OBS Virtual Camera",
    window: "Share screen → Window → Detection clean feed",
  },
  {
    id: "webex",
    name: "Webex",
    camera: "Meeting controls → Camera → OBS Virtual Camera",
    window: "Share → Window → Detection clean feed",
  },
  {
    id: "twitch",
    name: "Twitch",
    camera: "Stream with OBS and put the clean feed or MJPEG source in the scene",
    window: "Window Capture → Detection clean feed, or Media Source → the local MJPEG URL",
  },
];

const SETUP_STEPS = [
  "Run the local server (uvicorn) and turn on Send to virtual camera.",
  "Install OBS, open it once so macOS enables OBS Virtual Camera, then pip install pyvirtualcam in this app's environment.",
  "When the status line says the bridge is receiving frames, pick OBS Virtual Camera in the other app.",
];

export function videoApp(id) {
  return VIDEO_APPS.find((app) => app.id === id) ?? VIDEO_APPS[0];
}

export function videoAppGuide(id) {
  const app = videoApp(id);
  return {
    ...app,
    setup: SETUP_STEPS,
  };
}

export function photoStripSize(count, shotW, shotH, pad, footer = 48) {
  const shots = Math.max(1, count);
  return {
    width: shotW + pad * 2,
    height: pad + shots * (shotH + pad) + footer,
  };
}

export function expandBox(box, frame, pad = 0.18) {
  const growX = box.width * pad;
  const growY = box.height * pad;
  const x = clamp(box.x - growX, 0, Math.max(0, frame.width - 1));
  const y = clamp(box.y - growY, 0, Math.max(0, frame.height - 1));
  const right = Math.min(frame.width, box.x + box.width + growX);
  const bottom = Math.min(frame.height, box.y + box.height + growY);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

export function scaleBox(box, from, to) {
  const sx = to.width / Math.max(1, from.width);
  const sy = to.height / Math.max(1, from.height);
  return {
    x: box.x * sx,
    y: box.y * sy,
    width: box.width * sx,
    height: box.height * sy,
  };
}

export function vanishLabelSet(mode, selectedClasses = []) {
  if (mode === "people") {
    return new Set(["person"]);
  }
  if (mode === "selected" && selectedClasses.length) {
    return new Set(selectedClasses.map((label) => String(label).toLowerCase()));
  }
  return null;
}

export function matchingDetections(detections, labels) {
  const list = detections ?? [];
  if (!labels) {
    return list;
  }
  return list.filter((detection) => labels.has(String(detection.label || "").toLowerCase()));
}

export function cleanNameplate(text) {
  return String(text ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);
}

export function autoFrameCrop(boxes, frame, margin = 0.35) {
  if (!frame?.width || !frame?.height || !boxes?.length) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  const boxWidth = Math.max(1, maxX - minX);
  const boxHeight = Math.max(1, maxY - minY);
  const aspect = frame.width / frame.height;
  let width = boxWidth * (1 + margin * 2);
  let height = boxHeight * (1 + margin * 2);
  if (width / height < aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }
  const minWidth = frame.width / 2.4;
  if (width < minWidth) {
    width = minWidth;
    height = minWidth / aspect;
  }
  if (width > frame.width || height > frame.height) {
    return null;
  }
  let x = (minX + maxX) / 2 - width / 2;
  let y = (minY + maxY) / 2 - height / 2;
  x = clamp(x, 0, frame.width - width);
  y = clamp(y, 0, frame.height - height);
  const crop = { x, y, width, height };
  const contains =
    minX >= crop.x - 0.5 &&
    minY >= crop.y - 0.5 &&
    maxX <= crop.x + crop.width + 0.5 &&
    maxY <= crop.y + crop.height + 0.5;
  return contains ? crop : null;
}

export function effectTargets(detections, frameSize, outputSize, options) {
  const labels = vanishLabelSet(options.vanishMode, options.selectedClasses);
  return matchingDetections(detections, labels).map((detection) =>
    expandBox(scaleBox(detection.box, frameSize, outputSize), outputSize, options.pad ?? 0.18),
  );
}

export function learnPlate(plate, source, width, height, boxes, force = false) {
  if (!plate?.canvas) {
    return plate;
  }
  if (plate.canvas.width !== width || plate.canvas.height !== height) {
    plate.canvas.width = width;
    plate.canvas.height = height;
    plate.seeded = false;
  }
  const context = plate.canvas.getContext("2d");
  if (force) {
    context.drawImage(source, 0, 0, width, height);
    plate.seeded = true;
    return plate;
  }
  if (!plate.seeded) {
    return plate;
  }
  const snapshot = createCanvas(width, height);
  snapshot.getContext("2d").drawImage(plate.canvas, 0, 0);
  context.drawImage(source, 0, 0, width, height);
  for (const box of boxes) {
    paintFeathered(context, snapshot, box, 1);
  }
  return plate;
}

export function compositeFrame(context, source, width, height, options) {
  const effect = options.effect || "none";
  const boxes = effectTargets(
    options.detections,
    options.frameSize || { width, height },
    { width, height },
    options,
  );
  context.clearRect(0, 0, width, height);

  if (effect === "none") {
    context.drawImage(source, 0, 0, width, height);
  } else if (effect === "disappear") {
    context.drawImage(source, 0, 0, width, height);
    const fill = options.plate?.seeded ? options.plate.canvas : blurredCopy(source, width, height, 22);
    for (const box of boxes) {
      paintFeathered(context, fill, box, 1);
    }
  } else if (effect === "portrait") {
    const soft = blurredCopy(source, width, height, options.blur ?? 16);
    context.drawImage(soft, 0, 0);
    for (const box of boxes) {
      paintFeathered(context, source, box, 1);
    }
  } else if (effect === "replace") {
    context.fillStyle = options.backgroundColor || "#1f8a70";
    context.fillRect(0, 0, width, height);
    for (const box of boxes) {
      paintFeathered(context, source, box, 1);
    }
  } else if (effect === "pixelate") {
    context.drawImage(source, 0, 0, width, height);
    for (const box of boxes) {
      pixelateBox(context, source, box, options.pixelSize ?? 14);
    }
  } else if (effect === "spotlight") {
    const sharp = createCanvas(width, height);
    sharp.getContext("2d").drawImage(source, 0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    context.fillStyle = "rgba(0, 0, 0, 0.72)";
    context.fillRect(0, 0, width, height);
    for (const box of boxes) {
      paintFeathered(context, sharp, box, 1);
    }
  } else if (effect === "outline") {
    context.filter = "grayscale(1) contrast(1.05)";
    context.drawImage(source, 0, 0, width, height);
    context.filter = "none";
    context.lineWidth = 3;
    for (const box of boxes) {
      context.strokeStyle = "#3ee0c5";
      context.beginPath();
      context.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
      context.stroke();
    }
  } else {
    context.drawImage(source, 0, 0, width, height);
  }

  if (options.autoFrame && context.canvas) {
    const people = effectTargets(
      options.detections,
      options.frameSize || { width, height },
      { width, height },
      { vanishMode: "people", pad: 0, selectedClasses: [] },
    );
    const crop = autoFrameCrop(people, { width, height });
    if (crop) {
      const framed = createCanvas(width, height);
      framed
        .getContext("2d")
        .drawImage(context.canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      context.clearRect(0, 0, width, height);
      context.drawImage(framed, 0, 0);
    }
  }

  if (options.mirror && context.canvas) {
    const flipped = createCanvas(width, height);
    const flippedContext = flipped.getContext("2d");
    flippedContext.translate(width, 0);
    flippedContext.scale(-1, 1);
    flippedContext.drawImage(context.canvas, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(flipped, 0, 0);
  }

  const filter = gradeFilter(options.grade);
  if (filter !== "none" && context.canvas) {
    const graded = createCanvas(width, height);
    const gradedContext = graded.getContext("2d");
    gradedContext.filter = filter;
    gradedContext.drawImage(context.canvas, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(graded, 0, 0);
  }

  const plateLabel = cleanNameplate(options.nameplate);
  if (plateLabel) {
    drawNameplate(context, width, height, plateLabel, Boolean(options.burnHud));
  }
  if (options.burnHud) {
    drawHud(context, width, height, options.hudText || "");
  }
  return { boxes, plateReady: Boolean(options.plate?.seeded) };
}

export function buildPhotoStrip(shots, options = {}) {
  const shotW = options.shotWidth ?? 480;
  const shotH = options.shotHeight ?? 320;
  const pad = options.pad ?? 28;
  const size = photoStripSize(shots.length, shotW, shotH, pad);
  const canvas = options.createCanvas
    ? options.createCanvas(size.width, size.height)
    : createCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#f3ecdf";
  context.fillRect(0, 0, size.width, size.height);
  shots.forEach((shot, index) => {
    const y = pad + index * (shotH + pad);
    context.fillStyle = "#161616";
    context.fillRect(pad - 8, y - 8, shotW + 16, shotH + 16);
    context.drawImage(shot, pad, y, shotW, shotH);
  });
  context.fillStyle = "#1c1c1c";
  context.font = "700 18px ui-sans-serif, system-ui, sans-serif";
  context.fillText(options.caption || "DETECTION BOOTH", pad, size.height - 18);
  return canvas;
}

function drawNameplate(context, width, height, text, aboveHud) {
  context.save();
  context.font = "700 22px ui-sans-serif, system-ui, sans-serif";
  const measured = context.measureText(text).width;
  const barWidth = Math.min(width - 32, measured + 36);
  const y = height - (aboveHud ? 108 : 58);
  context.fillStyle = "rgba(20, 24, 22, 0.72)";
  context.fillRect(16, y, barWidth, 40);
  context.fillStyle = "#f7f4ee";
  context.fillText(text, 30, y + 27);
  context.restore();
}

function drawHud(context, width, height, text) {
  if (!text) {
    return;
  }
  context.save();
  context.font = "600 18px ui-sans-serif, system-ui, sans-serif";
  const measured = context.measureText(text).width;
  context.fillStyle = "rgba(0, 0, 0, 0.55)";
  context.fillRect(16, height - 58, measured + 28, 38);
  context.fillStyle = "#f7f4ee";
  context.fillText(text, 28, height - 34);
  context.restore();
}

function pixelateBox(context, source, box, pixelSize) {
  const tinyW = Math.max(1, Math.round(box.width / pixelSize));
  const tinyH = Math.max(1, Math.round(box.height / pixelSize));
  const tiny = createCanvas(tinyW, tinyH);
  const tinyContext = tiny.getContext("2d");
  tinyContext.imageSmoothingEnabled = false;
  tinyContext.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, tinyW, tinyH);
  context.imageSmoothingEnabled = false;
  context.drawImage(tiny, box.x, box.y, box.width, box.height);
  context.imageSmoothingEnabled = true;
}

function blurredCopy(source, width, height, radius) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.filter = `blur(${radius}px)`;
  context.drawImage(source, 0, 0, width, height);
  context.filter = "none";
  return canvas;
}

function paintFeathered(context, image, box, alpha) {
  const feather = Math.max(6, Math.min(box.width, box.height) * 0.18);
  const x = box.x - feather * 0.35;
  const y = box.y - feather * 0.35;
  const w = box.width + feather * 0.7;
  const h = box.height + feather * 0.7;
  const layer = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const layerContext = layer.getContext("2d");
  layerContext.drawImage(image, x, y, w, h, 0, 0, layer.width, layer.height);
  layerContext.globalCompositeOperation = "destination-in";
  const gradient = layerContext.createRadialGradient(
    layer.width / 2,
    layer.height / 2,
    Math.min(layer.width, layer.height) * 0.18,
    layer.width / 2,
    layer.height / 2,
    Math.min(layer.width, layer.height) * 0.5,
  );
  gradient.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
  gradient.addColorStop(0.72, `rgba(0, 0, 0, ${alpha})`);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  layerContext.fillStyle = gradient;
  layerContext.fillRect(0, 0, layer.width, layer.height);
  context.drawImage(layer, x, y, w, h);
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
