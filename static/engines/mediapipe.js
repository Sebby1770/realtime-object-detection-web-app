/**
 * MediaPipe Tasks Vision: EfficientDet object detection and the selfie
 * segmenter that gives the studio a real person outline. One WASM fileset is
 * shared by every task. GPU first, CPU if the GPU delegate will not start.
 */

export const TASKS_VERSION = "1.1.1";
const BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_ROOT = "https://storage.googleapis.com/mediapipe-models";

export const DETECTOR_MODELS = {
  "efficientdet-lite0": `${MODEL_ROOT}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
  "efficientdet-lite2": `${MODEL_ROOT}/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite`,
};
export const SEGMENTER_MODEL = `${MODEL_ROOT}/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite`;

let visionPromise = null;

function vision(onStatus) {
  if (!visionPromise) {
    visionPromise = (async () => {
      onStatus?.("Downloading MediaPipe");
      const module = await import(/* webpackIgnore: true */ BUNDLE_URL);
      onStatus?.("Starting MediaPipe");
      const fileset = await module.FilesetResolver.forVisionTasks(WASM_URL);
      return { module, fileset };
    })().catch((error) => {
      visionPromise = null;
      throw error;
    });
  }
  return visionPromise;
}

async function withDelegate(create) {
  try {
    return { task: await create("GPU"), delegate: "GPU" };
  } catch {
    return { task: await create("CPU"), delegate: "CPU" };
  }
}

/** Monotonic timestamps: MediaPipe VIDEO mode rejects a clock that goes backwards. */
function makeClock() {
  let last = 0;
  return () => {
    const now = Math.max(last + 1, Math.round(performance.now()));
    last = now;
    return now;
  };
}

export function createMediaPipeDetector({ id, label, short, description, tags }) {
  let detector = null;
  let loading = null;
  let delegate = "";
  const clock = makeClock();
  return {
    id,
    kind: "browser",
    label,
    short,
    description,
    tags,
    get ready() {
      return Boolean(detector);
    },
    get delegate() {
      return delegate;
    },
    async load(onStatus) {
      if (detector) {
        return detector;
      }
      if (!loading) {
        loading = (async () => {
          const { module, fileset } = await vision(onStatus);
          onStatus?.(`Downloading ${short}`);
          const result = await withDelegate((device) =>
            module.ObjectDetector.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: DETECTOR_MODELS[id], delegate: device },
              runningMode: "VIDEO",
              scoreThreshold: 0.1,
              maxResults: 40,
            }),
          );
          detector = result.task;
          delegate = result.delegate;
          return detector;
        })().catch((error) => {
          loading = null;
          throw error;
        });
      }
      return loading;
    },
    async detect(source, { confidence = 0.35 } = {}) {
      if (!detector) {
        await this.load();
      }
      const result = detector.detectForVideo(source, clock());
      const out = [];
      for (const item of result?.detections || []) {
        const category = item.categories?.[0];
        const score = Number(category?.score) || 0;
        if (score < confidence) {
          continue;
        }
        const box = item.boundingBox || {};
        out.push({
          label: String(category?.categoryName || category?.displayName || "object"),
          confidence: score,
          box: { x: box.originX || 0, y: box.originY || 0, width: box.width || 0, height: box.height || 0 },
        });
      }
      return out;
    },
  };
}

/**
 * Person segmentation for the studio. `segment()` returns a soft alpha mask
 * canvas at model resolution; callers scale it up with smoothing on.
 */
export function createPersonSegmenter() {
  let segmenter = null;
  let loading = null;
  let failed = null;
  let previous = null;
  let maskCanvas = null;
  let imageData = null;
  let delegate = "";
  const clock = makeClock();

  async function load(onStatus) {
    if (segmenter) {
      return segmenter;
    }
    if (failed) {
      throw failed;
    }
    if (!loading) {
      loading = (async () => {
        const { module, fileset } = await vision(onStatus);
        onStatus?.("Downloading the person mask");
        const result = await withDelegate((device) =>
          module.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate: device },
            runningMode: "VIDEO",
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          }),
        );
        segmenter = result.task;
        delegate = result.delegate;
        return segmenter;
      })().catch((error) => {
        loading = null;
        failed = error;
        window.setTimeout(() => {
          failed = null;
        }, 15000);
        throw error;
      });
    }
    return loading;
  }

  function segment(source) {
    if (!segmenter) {
      return null;
    }
    let result;
    try {
      result = segmenter.segmentForVideo(source, clock());
    } catch {
      return null;
    }
    const masks = result?.confidenceMasks || [];
    const mask = masks.length > 1 ? masks[masks.length - 1] : masks[0];
    if (!mask) {
      result?.close?.();
      return null;
    }
    const width = mask.width;
    const height = mask.height;
    const values = mask.getAsFloat32Array();
    if (!maskCanvas || maskCanvas.width !== width || maskCanvas.height !== height) {
      maskCanvas = document.createElement("canvas");
      maskCanvas.width = width;
      maskCanvas.height = height;
      imageData = new ImageData(width, height);
      previous = new Float32Array(width * height);
    }
    const pixels = imageData.data;
    for (let index = 0; index < values.length; index += 1) {
      // Temporal smoothing keeps hair and shoulders from shimmering.
      const value = previous[index] * 0.35 + values[index] * 0.65;
      previous[index] = value;
      const alpha = Math.min(1, Math.max(0, (value - 0.18) / 0.42));
      const offset = index * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
    maskCanvas.getContext("2d").putImageData(imageData, 0, 0);
    result.close?.();
    return maskCanvas;
  }

  /**
   * Mean person confidence inside a box given in `frame` pixels. The selfie
   * model is tuned for people near the camera; a far-off pedestrian scores
   * low, and the caller falls back to box-based effects for them.
   */
  function coverage(box, frame) {
    if (!previous || !maskCanvas || !frame?.width || !frame?.height) {
      return 0;
    }
    const width = maskCanvas.width;
    const height = maskCanvas.height;
    const x0 = Math.max(0, Math.floor((box.x / frame.width) * width));
    const y0 = Math.max(0, Math.floor((box.y / frame.height) * height));
    const x1 = Math.min(width, Math.ceil(((box.x + box.width) / frame.width) * width));
    const y1 = Math.min(height, Math.ceil(((box.y + box.height) / frame.height) * height));
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        sum += previous[y * width + x];
        count += 1;
      }
    }
    return count ? sum / count : 0;
  }

  /** Coverage in horizontal bands, top to bottom: a mask that misses the head scores low in band 0. */
  function coverageBands(box, frame, bands = 3) {
    const out = [];
    for (let band = 0; band < bands; band += 1) {
      out.push(
        coverage(
          { x: box.x, y: box.y + (box.height * band) / bands, width: box.width, height: box.height / bands },
          frame,
        ),
      );
    }
    return out;
  }

  return {
    load,
    segment,
    coverage,
    coverageBands,
    get ready() {
      return Boolean(segmenter);
    },
    get delegate() {
      return delegate;
    },
  };
}
