import { SimpleTracker } from "./tracker.js";

export const COCO_CLASSES = [
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "airplane",
  "bus",
  "train",
  "truck",
  "boat",
  "traffic light",
  "fire hydrant",
  "stop sign",
  "parking meter",
  "bench",
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
  "backpack",
  "umbrella",
  "handbag",
  "tie",
  "suitcase",
  "frisbee",
  "skis",
  "snowboard",
  "sports ball",
  "kite",
  "baseball bat",
  "baseball glove",
  "skateboard",
  "surfboard",
  "tennis racket",
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
  "chair",
  "couch",
  "potted plant",
  "bed",
  "dining table",
  "toilet",
  "tv",
  "laptop",
  "mouse",
  "remote",
  "keyboard",
  "cell phone",
  "microwave",
  "oven",
  "toaster",
  "sink",
  "refrigerator",
  "book",
  "clock",
  "vase",
  "scissors",
  "teddy bear",
  "hair drier",
  "toothbrush",
];

const TFJS_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const COCO_SSD_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";

let model = null;
let loadPromise = null;
const tracker = new SimpleTracker();
const session = {
  frames_processed: 0,
  detections_total: 0,
  classes_seen: new Set(),
  roi_alerts: 0,
  latency_samples: [],
};

function loadScript(src) {
  const existing = document.querySelector(`script[data-detector-src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === "true") {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.detectorSrc = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
    document.head.append(script);
  });
}

function recordFrame(detections, latencyMs) {
  session.frames_processed += 1;
  session.detections_total += detections.length;
  for (const detection of detections) {
    if (detection.label) {
      session.classes_seen.add(detection.label);
    }
  }
  if (typeof latencyMs === "number") {
    session.latency_samples.push(latencyMs);
    session.latency_samples = session.latency_samples.slice(-100);
  }
}

export function getBrowserSession() {
  const average = session.latency_samples.length
    ? Math.round((session.latency_samples.reduce((sum, value) => sum + value, 0) / session.latency_samples.length) * 10) / 10
    : 0;
  return {
    frames_processed: session.frames_processed,
    detections_total: session.detections_total,
    classes_seen: [...session.classes_seen].sort(),
    roi_alerts: session.roi_alerts,
    average_latency_ms: average,
  };
}

export function recordBrowserRoiAlert() {
  session.roi_alerts += 1;
  return session.roi_alerts;
}

export function resetBrowserSession() {
  session.frames_processed = 0;
  session.detections_total = 0;
  session.classes_seen = new Set();
  session.roi_alerts = 0;
  session.latency_samples = [];
  tracker.reset();
}

export async function loadBrowserModel(onStatus) {
  if (model) {
    return model;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      onStatus?.("Loading TensorFlow.js…");
      await loadScript(TFJS_URL);
      onStatus?.("Loading COCO-SSD…");
      await loadScript(COCO_SSD_URL);
      if (!window.cocoSsd?.load) {
        throw new Error("coco-ssd failed to initialize");
      }
      onStatus?.("Warming lite_mobilenet_v2…");
      model = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
      return model;
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

export async function detectBrowser(source, { confidence = 0.35, classes = [] } = {}) {
  const started = performance.now();
  const loaded = await loadBrowserModel();
  const raw = await loaded.detect(source);
  const frameWidth = source.videoWidth || source.width || 1;
  const frameHeight = source.videoHeight || source.height || 1;
  const selected = Array.isArray(classes) ? classes : [];
  const mapped = [];
  for (const item of raw) {
    const score = Number(item.score) || 0;
    if (score < confidence) {
      continue;
    }
    const label = String(item.class || "");
    if (selected.length && !selected.includes(label)) {
      continue;
    }
    const bbox = item.bbox || [0, 0, 0, 0];
    mapped.push({
      label,
      confidence: Math.round(score * 10000) / 10000,
      box: {
        x: Math.round(Number(bbox[0]) * 100) / 100,
        y: Math.round(Number(bbox[1]) * 100) / 100,
        width: Math.round(Number(bbox[2]) * 100) / 100,
        height: Math.round(Number(bbox[3]) * 100) / 100,
      },
    });
  }
  const detections = tracker.assign(mapped);
  const classCounts = {};
  for (const detection of detections) {
    classCounts[detection.label] = (classCounts[detection.label] || 0) + 1;
  }
  const latencyMs = Math.round((performance.now() - started) * 10) / 10;
  recordFrame(detections, latencyMs);
  return {
    type: "detections",
    frame_width: frameWidth,
    frame_height: frameHeight,
    confidence_threshold: Math.round(confidence * 10000) / 10000,
    class_counts: classCounts,
    detections,
    latency_ms: latencyMs,
    session: getBrowserSession(),
  };
}

export function isBrowserModelReady() {
  return Boolean(model);
}
