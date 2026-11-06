/** TensorFlow.js COCO-SSD, loaded from jsDelivr on first use. */

const TFJS_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const COCO_SSD_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";

const scripts = new Map();
const models = new Map();

export function loadScript(src) {
  if (scripts.has(src)) {
    return scripts.get(src);
  }
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      scripts.delete(src);
      script.remove();
      reject(new Error("Could not download the model code. Check the connection and try again."));
    });
    document.head.append(script);
  });
  scripts.set(src, promise);
  return promise;
}

async function loadModel(base, onStatus) {
  if (!models.has(base)) {
    const promise = (async () => {
      onStatus?.("Downloading TensorFlow.js");
      await loadScript(TFJS_URL);
      onStatus?.("Downloading COCO-SSD");
      await loadScript(COCO_SSD_URL);
      if (!window.cocoSsd?.load) {
        throw new Error("COCO-SSD did not start in this browser.");
      }
      try {
        await window.tf?.ready?.();
      } catch {
        // tf picks a working backend on its own.
      }
      onStatus?.(base === "lite_mobilenet_v2" ? "Warming up COCO-SSD Lite" : "Warming up COCO-SSD");
      return window.cocoSsd.load({ base });
    })().catch((error) => {
      models.delete(base);
      throw error;
    });
    models.set(base, promise);
  }
  return models.get(base);
}

export function createCocoSsdEngine({ id, base, label, short, description, tags }) {
  let model = null;
  return {
    id,
    kind: "browser",
    label,
    short,
    description,
    tags,
    get ready() {
      return Boolean(model);
    },
    async load(onStatus) {
      model = await loadModel(base, onStatus);
      return model;
    },
    async detect(source, { confidence = 0.35 } = {}) {
      if (!model) {
        await this.load();
      }
      const raw = await model.detect(source, 40, Math.max(0.05, confidence));
      return raw.map((item) => {
        const [x, y, width, height] = item.bbox || [0, 0, 0, 0];
        return { label: String(item.class || "object"), confidence: Number(item.score) || 0, box: { x, y, width, height } };
      });
    },
  };
}
