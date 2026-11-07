/**
 * Studio effects, photo-booth layout, and video-app bridge copy.
 *
 * Effects run on the outgoing picture. With a person mask from the
 * segmenter they follow the body outline; without one they fall back to
 * feathered detection boxes. Canvas helpers run in the browser; the pure
 * helpers at the top are imported by the Node tests.
 */

export const STUDIO_MAX_WIDTH = 960;

export const STUDIO_EFFECTS = [
  { id: "none", label: "Off" },
  { id: "disappear", label: "Invisible" },
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

/** Effects that can use a person mask when the targets are people. */
export const MASK_EFFECTS = new Set(["disappear", "portrait", "replace", "pixelate", "spotlight", "outline"]);

/** Frames of mask-guided learning before the plate counts as ready. */
export const PLATE_LEARN_FRAMES = 75;

export function gradeFilter(id) {
  return STUDIO_GRADES.find((grade) => grade.id === id)?.filter ?? "none";
}

export const VIDEO_APPS = [
  { id: "zoom", name: "Zoom", camera: "Settings → Video → Camera → OBS Virtual Camera", window: "Share Screen → Window → Detection clean feed" },
  { id: "meet", name: "Google Meet", camera: "More options → Settings → Video → OBS Virtual Camera", window: "Present now → A window → Detection clean feed" },
  { id: "teams", name: "Microsoft Teams", camera: "Settings → Devices → Camera → OBS Virtual Camera", window: "Share → Window → Detection clean feed" },
  { id: "photobooth", name: "Photo Booth", camera: "Camera menu → OBS Virtual Camera", window: "Photo Booth only accepts a camera device, not a window." },
  { id: "facetime", name: "FaceTime", camera: "Video menu → OBS Virtual Camera", window: "FaceTime only accepts a camera device, not a window." },
  { id: "discord", name: "Discord", camera: "User Settings → Voice & Video → Camera → OBS Virtual Camera", window: "Share Your Screen → Window → Detection clean feed" },
  { id: "obs", name: "OBS", camera: "Start Virtual Camera, or add a Browser / Media Source", window: "Media Source → http://127.0.0.1:8000/api/studio.mjpg while the local server is running" },
  { id: "quicktime", name: "QuickTime Player", camera: "File → New Movie Recording → camera menu → OBS Virtual Camera", window: "QuickTime movie recording only accepts a camera device." },
  { id: "slack", name: "Slack", camera: "Huddle or call → Video → OBS Virtual Camera", window: "Share screen → Window → Detection clean feed" },
  { id: "webex", name: "Webex", camera: "Meeting controls → Camera → OBS Virtual Camera", window: "Share → Window → Detection clean feed" },
  { id: "twitch", name: "Twitch", camera: "Stream with OBS and put the clean feed or MJPEG source in the scene", window: "Window Capture → Detection clean feed, or Media Source → the local MJPEG URL" },
];

const SETUP_STEPS = [
  "Run the local server (python -m app) and turn on Send to virtual camera.",
  "Install OBS, open it once so macOS enables OBS Virtual Camera, then pip install -r requirements-virtualcam.txt.",
  "When the status line says frames are arriving, pick OBS Virtual Camera in the other app.",
];

export function videoApp(id) {
  return VIDEO_APPS.find((app) => app.id === id) ?? VIDEO_APPS[0];
}

export function videoAppGuide(id) {
  return { ...videoApp(id), setup: SETUP_STEPS };
}

export function photoStripSize(count, shotW, shotH, pad, footer = 48) {
  const shots = Math.max(1, count);
  return { width: shotW + pad * 2, height: pad + shots * (shotH + pad) + footer };
}

export function expandBox(box, frame, pad = 0.18) {
  const growX = box.width * pad;
  const growY = box.height * pad;
  const x = clamp(box.x - growX, 0, Math.max(0, frame.width - 1));
  const y = clamp(box.y - growY, 0, Math.max(0, frame.height - 1));
  const right = Math.min(frame.width, box.x + box.width + growX);
  const bottom = Math.min(frame.height, box.y + box.height + growY);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function scaleBox(box, from, to) {
  const sx = to.width / Math.max(1, from.width);
  const sy = to.height / Math.max(1, from.height);
  return { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy };
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
    minX >= crop.x - 0.5 && minY >= crop.y - 0.5 && maxX <= crop.x + crop.width + 0.5 && maxY <= crop.y + crop.height + 0.5;
  return contains ? crop : null;
}

/** Smooth the crop so auto frame drifts instead of snapping between detections. */
export function easeCrop(previous, next, amount = 0.18) {
  if (!next) {
    return null;
  }
  if (!previous) {
    return { ...next };
  }
  const mix = (a, b) => a + (b - a) * amount;
  return { x: mix(previous.x, next.x), y: mix(previous.y, next.y), width: mix(previous.width, next.width), height: mix(previous.height, next.height) };
}

export function effectTargets(detections, frameSize, outputSize, options) {
  const labels = vanishLabelSet(options.vanishMode, options.selectedClasses);
  return matchingDetections(detections, labels).map((detection) =>
    expandBox(scaleBox(detection.box, frameSize, outputSize), outputSize, options.pad ?? 0.18),
  );
}

/** True when the effect runs through the mask compositor (a person mask or a box mask). */
export function usesMask(options) {
  return Boolean(options?.mask) && MASK_EFFECTS.has(options.effect);
}

/**
 * Is a segmentation mask good enough to trust for these people? Each person
 * box is split into bands top to bottom; every band must be reasonably
 * covered, otherwise (a far pedestrian, a side-on cyclist) the caller uses
 * a box mask instead. Pure: takes the band scores.
 */
export function maskTrusted(bandsPerPerson, { minBand = 0.18, minMean = 0.3 } = {}) {
  return bandsPerPerson.every((bands) => {
    if (!bands.length) {
      return true;
    }
    const mean = bands.reduce((sum, value) => sum + value, 0) / bands.length;
    return Math.min(...bands) >= minBand && mean >= minMean;
  });
}

/**
 * A soft mask drawn from boxes, for classes the segmenter does not know and
 * people it cannot see well. Quarter resolution; feathered edges.
 */
export function boxMask(boxes, width, height, key = "box-mask") {
  const maskW = Math.max(16, Math.round(width / 4));
  const maskH = Math.max(9, Math.round(height / 4));
  const canvas = scratch(key, maskW, maskH);
  const context = canvas.getContext("2d");
  const sx = maskW / Math.max(1, width);
  const sy = maskH / Math.max(1, height);
  context.fillStyle = "#000";
  for (const box of boxes) {
    const w = box.width * sx;
    const hgt = box.height * sy;
    const feather = Math.max(1, Math.min(w, hgt) * 0.12);
    context.filter = `blur(${feather.toFixed(1)}px)`;
    const radius = Math.min(w, hgt) * 0.3;
    context.beginPath();
    if (typeof context.roundRect === "function") {
      context.roundRect(box.x * sx + feather, box.y * sy + feather, Math.max(1, w - feather * 2), Math.max(1, hgt - feather * 2), radius);
    } else {
      context.rect(box.x * sx + feather, box.y * sy + feather, Math.max(1, w - feather * 2), Math.max(1, hgt - feather * 2));
    }
    context.fill();
  }
  context.filter = "none";
  return canvas;
}

// ---------------------------------------------------------------- canvas ---

const pool = new Map();

function scratch(key, width, height) {
  let canvas = pool.get(key);
  if (!canvas) {
    canvas = createCanvas(width, height);
    pool.set(key, canvas);
  }
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const context = canvas.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.filter = "none";
  context.clearRect(0, 0, w, h);
  return canvas;
}

/** `image` kept only inside the mask (or outside it, with `invert`). */
function masked(key, image, mask, width, height, invert = false) {
  const layer = scratch(key, width, height);
  const context = layer.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  context.globalCompositeOperation = invert ? "destination-out" : "destination-in";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(mask, 0, 0, width, height);
  context.globalCompositeOperation = "source-over";
  return layer;
}

/** Grow the mask by a few pixels so no rim of the person survives the vanish. */
function dilate(mask, rings = 2) {
  const grown = scratch("mask-dilated", mask.width, mask.height);
  const context = grown.getContext("2d");
  context.drawImage(mask, 0, 0);
  for (let ring = 1; ring <= rings; ring += 1) {
    for (const [dx, dy] of [[ring, 0], [-ring, 0], [0, ring], [0, -ring]]) {
      context.drawImage(mask, dx, dy);
    }
  }
  return grown;
}

let averageProbe = null;

/**
 * Cheap inpainting, push-pull style: the background-only picture is shrunk
 * to a coarse grid whose holes are filled by repeatedly blurring it under
 * itself, then finer levels are laid on top. The hole ends fully opaque and
 * takes the room's colours, so no ghost of the person shows through.
 */
function roomFill(source, mask, width, height) {
  const quarterW = Math.max(16, Math.round(width / 4));
  const quarterH = Math.max(9, Math.round(height / 4));
  const background = masked("fill-bg", source, mask, quarterW, quarterH, true);

  const coarseW = Math.max(8, Math.round(width / 16));
  const coarseH = Math.max(5, Math.round(height / 16));
  const coarse = scratch("fill-coarse", coarseW, coarseH);
  const coarseContext = coarse.getContext("2d");
  coarseContext.imageSmoothingEnabled = true;
  coarseContext.drawImage(background, 0, 0, coarseW, coarseH);
  coarseContext.globalCompositeOperation = "destination-over";
  coarseContext.filter = "blur(2px)";
  for (let pass = 0; pass < 6; pass += 1) {
    coarseContext.drawImage(coarse, 0, 0);
  }
  coarseContext.filter = "none";
  // Whatever is still empty takes the room's average colour.
  if (!averageProbe) {
    averageProbe = createCanvas(1, 1);
  }
  const probe = averageProbe.getContext("2d", { willReadFrequently: true });
  probe.clearRect(0, 0, 1, 1);
  probe.drawImage(background, 0, 0, 1, 1);
  let average = [128, 128, 128];
  try {
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    if (a > 0) {
      average = [r, g, b];
    }
  } catch {
    // A tainted source cannot be read back; grey is a fine last resort.
  }
  coarseContext.fillStyle = `rgb(${average[0]}, ${average[1]}, ${average[2]})`;
  coarseContext.fillRect(0, 0, coarseW, coarseH);
  coarseContext.globalCompositeOperation = "source-over";

  const fill = scratch("fill", quarterW, quarterH);
  const context = fill.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.drawImage(coarse, 0, 0, quarterW, quarterH);
  context.filter = "blur(3px)";
  context.drawImage(background, 0, 0);
  context.filter = "none";
  context.drawImage(background, 0, 0);

  const full = scratch("fill-full", width, height);
  const fullContext = full.getContext("2d");
  fullContext.imageSmoothingEnabled = true;
  fullContext.drawImage(fill, 0, 0, width, height);
  return full;
}

export function learnPlate(plate, source, width, height, boxes, force = false, mask = null) {
  if (!plate?.canvas) {
    return plate;
  }
  if (plate.canvas.width !== width || plate.canvas.height !== height) {
    plate.canvas.width = width;
    plate.canvas.height = height;
    plate.seeded = false;
    plate.learned = 0;
    plate.known = null;
  }
  const context = plate.canvas.getContext("2d");
  if (force) {
    context.globalCompositeOperation = "source-over";
    context.drawImage(source, 0, 0, width, height);
    plate.seeded = true;
    plate.captured = true;
    plate.learned = PLATE_LEARN_FRAMES;
    if (plate.known) {
      const knownContext = plate.known.getContext("2d");
      knownContext.fillStyle = "#000";
      knownContext.fillRect(0, 0, width, height);
    }
    return plate;
  }
  if (mask) {
    // Mask-guided learning: refresh every pixel the person is not covering.
    // The target boxes are always protected too, so a weak or empty mask
    // (a GPU warm-up frame, a far-off person) can never teach the plate
    // what the person looks like.
    if (!plate.known || plate.known.width !== width || plate.known.height !== height) {
      plate.known = createCanvas(width, height);
    }
    const protect = scratch("learn-protect", mask.width, mask.height);
    const protectContext = protect.getContext("2d");
    protectContext.drawImage(mask, 0, 0);
    if (boxes?.length) {
      protectContext.drawImage(boxMask(boxes, width, height, "learn-boxes"), 0, 0, mask.width, mask.height);
    }
    const background = masked("learn-bg", source, protect, width, height, true);
    context.drawImage(background, 0, 0);
    const knownContext = plate.known.getContext("2d");
    knownContext.drawImage(masked("learn-known", solid("#000", width, height), protect, width, height, true), 0, 0);
    plate.seeded = true;
    plate.learned = Math.min(PLATE_LEARN_FRAMES, (plate.learned || 0) + 1);
    return plate;
  }
  if (!plate.seeded) {
    return plate;
  }
  const snapshot = scratch("learn-snapshot", width, height);
  snapshot.getContext("2d").drawImage(plate.canvas, 0, 0);
  context.drawImage(source, 0, 0, width, height);
  for (const box of boxes) {
    paintFeathered(context, snapshot, box, 1);
  }
  return plate;
}

export function plateReady(plate) {
  return Boolean(plate?.seeded && (plate.captured || !plate.known || (plate.learned || 0) >= PLATE_LEARN_FRAMES));
}

function solid(color, width, height) {
  const canvas = scratch(`solid-${color}`, width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas;
}

function vanishFill(source, mask, width, height, plate) {
  const hole = scratch("hole", width, height);
  const context = hole.getContext("2d");
  context.drawImage(roomFill(source, mask, width, height), 0, 0);
  if (plate?.seeded) {
    if (plate.known && !plate.captured) {
      context.drawImage(masked("hole-known", plate.canvas, plate.known, width, height), 0, 0);
    } else {
      context.drawImage(plate.canvas, 0, 0, width, height);
    }
  }
  return hole;
}

function compositeWithMask(context, source, width, height, options) {
  const effect = options.effect;
  const mask = options.mask;
  if (effect === "disappear") {
    const grown = dilate(mask, 2);
    context.drawImage(source, 0, 0, width, height);
    context.drawImage(masked("person", vanishFill(source, grown, width, height, options.plate), grown, width, height), 0, 0);
  } else if (effect === "portrait") {
    context.drawImage(blurredCopy(source, width, height, options.blur ?? 14), 0, 0);
    context.drawImage(masked("person", source, mask, width, height), 0, 0);
  } else if (effect === "replace") {
    context.fillStyle = options.backgroundColor || "#2f6f5e";
    context.fillRect(0, 0, width, height);
    context.drawImage(masked("person", source, mask, width, height), 0, 0);
  } else if (effect === "pixelate") {
    context.drawImage(source, 0, 0, width, height);
    const size = options.pixelSize ?? 14;
    const tinyW = Math.max(1, Math.round(width / size));
    const tinyH = Math.max(1, Math.round(height / size));
    const tiny = scratch("pixel-tiny", tinyW, tinyH);
    tiny.getContext("2d").drawImage(source, 0, 0, tinyW, tinyH);
    const blocky = scratch("pixel-full", width, height);
    const blockyContext = blocky.getContext("2d");
    blockyContext.imageSmoothingEnabled = false;
    blockyContext.drawImage(tiny, 0, 0, width, height);
    context.drawImage(masked("person", blocky, mask, width, height), 0, 0);
  } else if (effect === "spotlight") {
    context.drawImage(source, 0, 0, width, height);
    context.fillStyle = "rgba(0, 0, 0, 0.72)";
    context.fillRect(0, 0, width, height);
    context.drawImage(masked("person", source, mask, width, height), 0, 0);
  } else if (effect === "outline") {
    context.filter = "grayscale(1) contrast(1.05) brightness(0.9)";
    context.drawImage(source, 0, 0, width, height);
    context.filter = "none";
    const glow = masked("glow", solid("#67bdaa", width, height), mask, width, height);
    context.save();
    context.filter = "blur(10px)";
    context.globalAlpha = 0.9;
    context.drawImage(glow, 0, 0);
    context.restore();
    context.drawImage(masked("person", source, mask, width, height), 0, 0);
  }
}

function compositeWithBoxes(context, source, width, height, options, boxes) {
  const effect = options.effect;
  if (effect === "disappear") {
    context.drawImage(source, 0, 0, width, height);
    const fill = options.plate?.seeded ? options.plate.canvas : blurredCopy(source, width, height, 22);
    for (const box of boxes) {
      paintFeathered(context, fill, box, 1);
    }
  } else if (effect === "portrait") {
    context.drawImage(blurredCopy(source, width, height, options.blur ?? 16), 0, 0);
    for (const box of boxes) {
      paintFeathered(context, source, box, 1);
    }
  } else if (effect === "replace") {
    context.fillStyle = options.backgroundColor || "#2f6f5e";
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
    const sharp = scratch("spot-sharp", width, height);
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
      context.strokeStyle = "#67bdaa";
      context.beginPath();
      context.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
      context.stroke();
    }
  } else {
    context.drawImage(source, 0, 0, width, height);
  }
}

export function compositeFrame(context, source, width, height, options) {
  const effect = options.effect || "none";
  const boxes = effectTargets(options.detections, options.frameSize || { width, height }, { width, height }, options);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, width, height);

  const maskPath = effect !== "none" && usesMask(options);
  const personMasked = maskPath && options.maskKind === "person";
  if (effect === "none") {
    context.drawImage(source, 0, 0, width, height);
  } else if (maskPath) {
    compositeWithMask(context, source, width, height, options);
  } else {
    compositeWithBoxes(context, source, width, height, options, boxes);
  }

  let crop = null;
  if (options.autoFrame && context.canvas) {
    const people = effectTargets(options.detections, options.frameSize || { width, height }, { width, height }, {
      vanishMode: "people",
      pad: 0,
      selectedClasses: [],
    });
    crop = easeCrop(options.previousCrop, autoFrameCrop(people, { width, height }));
    if (crop) {
      const framed = scratch("framed", width, height);
      framed.getContext("2d").drawImage(context.canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      context.clearRect(0, 0, width, height);
      context.drawImage(framed, 0, 0);
    }
  }

  if (options.mirror && context.canvas) {
    const flipped = scratch("flipped", width, height);
    const flippedContext = flipped.getContext("2d");
    flippedContext.translate(width, 0);
    flippedContext.scale(-1, 1);
    flippedContext.drawImage(context.canvas, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(flipped, 0, 0);
  }

  const filter = gradeFilter(options.grade);
  if (filter !== "none" && context.canvas) {
    const graded = scratch("graded", width, height);
    const gradedContext = graded.getContext("2d");
    gradedContext.filter = filter;
    gradedContext.drawImage(context.canvas, 0, 0);
    gradedContext.filter = "none";
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
  context.restore();
  return { boxes, plateReady: plateReady(options.plate), masked: personMasked, crop };
}

export function buildPhotoStrip(shots, options = {}) {
  const shotW = options.shotWidth ?? 480;
  const shotH = options.shotHeight ?? 270;
  const pad = options.pad ?? 28;
  const size = photoStripSize(shots.length, shotW, shotH, pad, 56);
  const canvas = options.createCanvas ? options.createCanvas(size.width, size.height) : createCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#f2f1ee";
  context.fillRect(0, 0, size.width, size.height);
  shots.forEach((shot, index) => {
    const y = pad + index * (shotH + pad);
    context.fillStyle = "#16181c";
    context.fillRect(pad - 6, y - 6, shotW + 12, shotH + 12);
    const scale = Math.max(shotW / (shot.width || shotW), shotH / (shot.height || shotH));
    const sw = shotW / scale;
    const sh = shotH / scale;
    const sx = ((shot.width || shotW) - sw) / 2;
    const sy = ((shot.height || shotH) - sh) / 2;
    context.drawImage(shot, sx, sy, sw, sh, pad, y, shotW, shotH);
  });
  context.fillStyle = "#16181c";
  context.font = '650 18px "Saira", ui-sans-serif, system-ui, sans-serif';
  context.fillText(options.caption || "Photo booth", pad, size.height - 22);
  return canvas;
}

function drawNameplate(context, width, height, text, aboveHud) {
  context.save();
  const size = Math.max(16, Math.round(width / 40));
  context.font = `650 ${size}px "Saira", ui-sans-serif, system-ui, sans-serif`;
  const measured = context.measureText(text).width;
  const barHeight = size * 1.9;
  const barWidth = Math.min(width - 32, measured + size * 1.6);
  const y = height - (aboveHud ? barHeight * 2 + 24 : barHeight + 18);
  context.fillStyle = "rgba(16, 18, 22, 0.78)";
  context.fillRect(16, y, barWidth, barHeight);
  context.fillStyle = "#67bdaa";
  context.fillRect(16, y, 4, barHeight);
  context.fillStyle = "#f5f6f7";
  context.textBaseline = "middle";
  context.fillText(text, 16 + size * 0.8, y + barHeight / 2 + 1);
  context.restore();
}

function drawHud(context, width, height, text) {
  if (!text) {
    return;
  }
  context.save();
  const size = Math.max(14, Math.round(width / 52));
  context.font = `600 ${size}px "Saira", ui-sans-serif, system-ui, sans-serif`;
  const measured = context.measureText(text).width;
  const barHeight = size * 1.9;
  context.fillStyle = "rgba(0, 0, 0, 0.55)";
  context.fillRect(16, height - barHeight - 18, measured + size * 1.4, barHeight);
  context.fillStyle = "#f5f6f7";
  context.textBaseline = "middle";
  context.fillText(text, 16 + size * 0.7, height - 18 - barHeight / 2 + 1);
  context.restore();
}

function pixelateBox(context, source, box, pixelSize) {
  const tinyW = Math.max(1, Math.round(box.width / pixelSize));
  const tinyH = Math.max(1, Math.round(box.height / pixelSize));
  const tiny = scratch("pixel-box", tinyW, tinyH);
  const tinyContext = tiny.getContext("2d");
  tinyContext.imageSmoothingEnabled = false;
  const scaleX = (source.videoWidth || source.width) / (context.canvas?.width || 1);
  const scaleY = (source.videoHeight || source.height) / (context.canvas?.height || 1);
  tinyContext.drawImage(source, box.x * scaleX, box.y * scaleY, box.width * scaleX, box.height * scaleY, 0, 0, tinyW, tinyH);
  context.imageSmoothingEnabled = false;
  context.drawImage(tiny, box.x, box.y, box.width, box.height);
  context.imageSmoothingEnabled = true;
}

function blurredCopy(source, width, height, radius) {
  // Blur at half size: a quarter of the pixels for the same look.
  const halfW = Math.max(1, Math.round(width / 2));
  const halfH = Math.max(1, Math.round(height / 2));
  const half = scratch("blur-half", halfW, halfH);
  const halfContext = half.getContext("2d");
  halfContext.filter = `blur(${Math.max(1, radius / 2)}px)`;
  halfContext.drawImage(source, 0, 0, halfW, halfH);
  halfContext.filter = "none";
  const canvas = scratch("blur-full", width, height);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.drawImage(half, 0, 0, width, height);
  return canvas;
}

function paintFeathered(context, image, box, alpha) {
  const feather = Math.max(6, Math.min(box.width, box.height) * 0.18);
  const x = box.x - feather * 0.35;
  const y = box.y - feather * 0.35;
  const w = box.width + feather * 0.7;
  const h = box.height + feather * 0.7;
  const layer = scratch("feather", w, h);
  const layerContext = layer.getContext("2d");
  const imageW = image.videoWidth || image.width;
  const imageH = image.videoHeight || image.height;
  const scaleX = imageW / (context.canvas?.width || imageW || 1);
  const scaleY = imageH / (context.canvas?.height || imageH || 1);
  layerContext.drawImage(image, x * scaleX, y * scaleY, w * scaleX, h * scaleY, 0, 0, layer.width, layer.height);
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
  layerContext.globalCompositeOperation = "source-over";
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
