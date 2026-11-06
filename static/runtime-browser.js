/**
 * In-browser runtime: runs whichever browser engine is active, keeps the JS
 * tracker and session numbers, and returns the same detection JSON the
 * FastAPI server sends, so every downstream view treats them alike.
 */

import { SimpleTracker } from "./tracker.js";

export const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
  "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush",
];

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
};

export function createBrowserSession() {
  const tracker = new SimpleTracker();
  let stats = blankStats();

  function blankStats() {
    return { frames_processed: 0, detections_total: 0, classes_seen: new Set(), roi_alerts: 0, latency: [] };
  }

  function snapshot() {
    const samples = stats.latency;
    const average = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
    return {
      frames_processed: stats.frames_processed,
      detections_total: stats.detections_total,
      classes_seen: [...stats.classes_seen].sort(),
      roi_alerts: stats.roi_alerts,
      average_latency_ms: round(average, 1),
    };
  }

  /** `track: false` for one-off stills so a batch does not invent motion between unrelated photos. */
  async function detect(engine, source, { confidence = 0.35, classes = [], track = true } = {}) {
    const started = performance.now();
    const raw = await engine.detect(source, { confidence });
    const wanted = Array.isArray(classes) && classes.length ? new Set(classes) : null;
    const mapped = [];
    for (const item of raw) {
      if (item.confidence < confidence || (wanted && !wanted.has(item.label))) {
        continue;
      }
      mapped.push({
        label: item.label,
        confidence: round(item.confidence, 4),
        box: {
          x: round(item.box.x, 2),
          y: round(item.box.y, 2),
          width: round(Math.max(0, item.box.width), 2),
          height: round(Math.max(0, item.box.height), 2),
        },
      });
    }
    const detections = track ? tracker.assign(mapped) : mapped;
    const classCounts = {};
    for (const detection of detections) {
      classCounts[detection.label] = (classCounts[detection.label] || 0) + 1;
    }
    const latencyMs = round(performance.now() - started, 1);
    stats.frames_processed += 1;
    stats.detections_total += detections.length;
    for (const detection of detections) {
      stats.classes_seen.add(detection.label);
    }
    stats.latency = [...stats.latency, latencyMs].slice(-100);
    return {
      type: "detections",
      frame_width: source.videoWidth || source.naturalWidth || source.width || 1,
      frame_height: source.videoHeight || source.naturalHeight || source.height || 1,
      confidence_threshold: round(confidence, 4),
      class_counts: classCounts,
      detections,
      latency_ms: latencyMs,
      inference_ms: latencyMs,
      session: snapshot(),
    };
  }

  return {
    detect,
    snapshot,
    recordRoiAlert() {
      stats.roi_alerts += 1;
      return stats.roi_alerts;
    },
    resetTracks() {
      tracker.reset();
    },
    reset() {
      stats = blankStats();
      tracker.reset();
    },
  };
}
