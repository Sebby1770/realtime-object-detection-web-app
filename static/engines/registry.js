/** The engines the Detect panel offers, in the order it lists them. */

import { createCocoSsdEngine } from "./cocossd.js";
import { createMediaPipeDetector } from "./mediapipe.js";

export const SERVER_ENGINE = {
  id: "server",
  kind: "server",
  label: "YOLOv8 on this computer",
  short: "YOLOv8",
  description: "The most accurate. Frames go to the local server, not the internet.",
  tags: ["Local server"],
};

/** Used when a MediaPipe engine cannot start in this browser. */
export const FALLBACK_ENGINE_ID = "cocossd-lite";

const BROWSER_ENGINES = [
  createMediaPipeDetector({
    id: "efficientdet-lite2",
    label: "EfficientDet-Lite2",
    short: "EfficientDet-Lite2",
    description: "The sharpest in the browser: finds phones, books and fruit the others miss. About 26 MB the first time.",
    tags: ["In browser", "GPU"],
  }),
  createMediaPipeDetector({
    id: "efficientdet-lite0",
    label: "EfficientDet-Lite0",
    short: "EfficientDet-Lite0",
    description: "Sharp and quick. Shares its download with the studio's person mask. About 21 MB the first time.",
    tags: ["In browser", "GPU"],
  }),
  createCocoSsdEngine({
    id: "cocossd-lite",
    base: "lite_mobilenet_v2",
    label: "COCO-SSD Lite",
    short: "COCO-SSD Lite",
    description: "TensorFlow.js, for browsers where MediaPipe will not start. Misses small objects more often. About 19 MB.",
    tags: ["In browser"],
  }),
];

export const ENGINES = [SERVER_ENGINE, ...BROWSER_ENGINES];

export function engineById(id) {
  return ENGINES.find((engine) => engine.id === id) || null;
}

/** Without a YOLOv8 server the page starts on EfficientDet-Lite0. */
export function defaultEngineId(serverAvailable) {
  return serverAvailable ? "server" : "efficientdet-lite0";
}
