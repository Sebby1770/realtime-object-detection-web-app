/**
 * Realtime Detection 3.0 — orchestrates sources, engines, the detection loop,
 * the monitor, the studio, and the inspector panels.
 */

import { playAlertTone, playSpatialPing, resumeAudio, sonifyDetections } from "./audio.js";
import { colorForLabel } from "./colors.js";
import { createCopilot } from "./copilot.js";
import {
  $,
  $$,
  clockTime,
  downloadBlob,
  downloadUrl,
  fileStamp,
  fileToImage,
  h,
  isTypingTarget,
  loadImage,
  plural,
  prefersReducedMotion,
  wait,
} from "./core/dom.js";
import { loadSettings, loadTheme, nextTheme, saveSettings, saveTheme } from "./core/settings.js";
import { createPersonSegmenter } from "./engines/mediapipe.js";
import { ENGINES, FALLBACK_ENGINE_ID, SERVER_ENGINE, defaultEngineId, engineById } from "./engines/registry.js";
import { createGlide } from "./glide.js";
import {
  ROI_COLORS,
  drawBars,
  drawHeatmap,
  drawOverlay,
  drawRadar,
  drawSparkline,
  letterbox,
  pointInRoi,
  pointerToNormalized,
  snapshotComposite,
  updateHeatmap,
} from "./overlay.js";
import { COCO_CLASSES, createBrowserSession } from "./runtime-browser.js";
import { createServerRuntime } from "./runtime-server.js";
import { countLabels, diaryDocument, diaryLine, diffCounts } from "./scene-diary.js";
import {
  MASK_EFFECTS,
  STUDIO_MAX_WIDTH,
  VIDEO_APPS,
  boxMask,
  buildPhotoStrip,
  cleanNameplate,
  compositeFrame,
  effectTargets,
  learnPlate,
  maskTrusted,
  videoAppGuide,
} from "./studio.js";
import { createCommandPalette, renderShortcutSheet } from "./ui/palette.js";
import { createTabs } from "./ui/tabs.js";
import { createToaster } from "./ui/toast.js";

const VERSION = "3.0.0";
const CAMERA_TIMEOUT_MS = 8000;
const ROI_COOLDOWN_MS = 1200;
const MAX_ROIS = 3;
const MAX_IMAGE_BYTES = 1_500_000;

const SAMPLE_SCENES = {
  desk: { src: "static/samples/desk.jpg", label: "Desk sample" },
  kitchen: { src: "static/samples/kitchen.jpg", label: "Kitchen sample" },
  street: { src: "static/samples/street.jpg", label: "Street sample" },
};

const CLASS_PRESETS = {
  all: [],
  people: ["person"],
  vehicles: ["bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat"],
  kitchen: ["bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake"],
};

const LOOKS = {
  plain: { effect: "none", grade: "none", mirror: false, note: "Plain: the outgoing picture is untouched." },
  call: { effect: "disappear", grade: "none", mirror: false, vanishMode: "people", note: "Call: people leave the outgoing picture." },
  booth: { effect: "portrait", grade: "warm", note: "Booth: a warm portrait with a soft background." },
};

// ------------------------------------------------------------------ setup ---

const ids = [
  "tallyLamp", "osdEngine", "osdSource", "osdFps", "osdLatency", "osdObjects", "engineButton", "paletteButton",
  "themeButton", "themeLabel", "helpButton", "monitor", "tallyTag", "monitorTitle", "monitorMeta", "videoStage",
  "video", "studioCanvas", "heatmap", "overlay", "boothCountdown", "modelOverlay", "modelOverlayStatus", "emptyState",
  "slateLead", "demoBadge", "hudState", "invisibleChip", "maskChip", "hudStats", "cameraToggle", "cameraToggleLabel",
  "pauseButton", "pauseLabel", "snapshotButton", "uploadDetect", "zoneButton", "fullscreenButton", "classChips",
  "nowEmpty", "diaryLatest", "engineList", "engineNote", "confidenceRange", "confidenceValue", "fpsRange", "fpsValue",
  "widthRange", "widthValue", "classSearch", "classChipList", "classNote", "labelToggle", "cornerBoxToggle",
  "trailToggle", "glideToggle", "ghostToggle", "ghostOpacityRange", "ghostOpacityValue", "heatmapToggle",
  "privacyToggle", "privacyBlurRange", "privacyBlurValue", "privacyNote", "uploadDetectStatus", "studioNote",
  "maskToggle", "maskNote", "vanishMode", "padRange", "padValue", "backgroundColor", "plateNote", "gradeSelect",
  "mirrorToggle", "autoFrameToggle", "nameplateInput", "burnHudToggle", "photoBoothButton", "boothPreview",
  "downloadBooth", "cleanFeedButton", "recordButton", "virtualCamToggle", "virtualCamStatus", "videoAppSelect",
  "videoAppGuide", "roiDrawButton", "roiClearButton", "roiStatus", "zoneList", "alertSoundToggle",
  "spatialAudioToggle", "sonifyToggle", "filmstripCount", "alertFilmstrip", "exportFilmstrip", "sessionFrames",
  "sessionDetections", "sessionClasses", "roiAlerts", "latencyAvg", "latencyChart", "densityAvg", "densityChart",
  "radarCount", "proximityRadar", "diaryCount", "diaryEmpty", "diaryList", "lastUpdated", "detectionList",
  "historyCount", "historyList", "exportHistoryButton", "clearHistoryButton", "copilotModel", "copilotModels",
  "copilotKey", "copilotUseScene", "copilotAttachFrame", "copilotPrivacy", "copilotThread", "copilotInput",
  "copilotListen", "copilotAsk", "copilotStatus", "paletteDialog", "paletteInput", "paletteList", "helpDialog",
  "shortcutList", "toasts", "srSummary", "captureCanvas",
];
const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
els.stage = els.videoStage;
els.providerButtons = $$("[data-provider]");
els.providerGroup = $(".provider-switch");

const storage = (() => {
  try {
    const probe = "__rtd_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
})();

let settings = loadSettings(storage);
const toast = createToaster(els.toasts);
const browserSession = createBrowserSession();
const glide = createGlide();
const segmenter = createPersonSegmenter();
let serverRuntime = null;

const state = {
  serverAvailable: false,
  yoloStatus: "unknown",
  yoloError: "",
  engineId: "efficientdet-lite0",
  engineLoading: false,
  source: null,
  stream: null,
  demoTimer: null,
  loopTimer: null,
  paused: false,
  inFlight: false,
  detections: [],
  ghosts: [],
  frameSize: { width: 640, height: 360 },
  classCounts: {},
  latency: [],
  density: [],
  fpsFrames: 0,
  fpsStartedAt: performance.now(),
  fps: 0,
  heat: Array.from({ length: 16 * 9 }, () => 0),
  rois: [],
  roiDrawing: false,
  roiStart: null,
  roiPreview: null,
  roiOccupied: [],
  roiCooldown: [],
  zoneCounts: [],
  zoneAlerts: [],
  history: [],
  filmstrip: [],
  diary: [],
  diaryCounts: {},
  diaryReady: false,
  diaryLast: "",
  session: { frames_processed: 0, detections_total: 0, classes_seen: [], roi_alerts: 0 },
  plate: null,
  capturePlate: false,
  emptyPlateFrames: 0,
  crop: null,
  mask: null,
  maskAt: 0,
  maskStatus: "idle",
  cleanFeedWindow: null,
  studioChannel: null,
  cleanFeedSentAt: 0,
  virtualCamOn: false,
  virtualCamBusy: false,
  virtualCamSentAt: 0,
  recorder: null,
  recordChunks: [],
  boothRunning: false,
  boothStrip: null,
  lastFitted: null,
  srText: "",
  srAt: 0,
  tally: "off",
};

const apiUrl = (path) => new URL(path, document.baseURI).toString();
const reducedMotion = () => prefersReducedMotion();
const activeEngine = () => (state.engineId === "server" ? SERVER_ENGINE : engineById(state.engineId));
const isLive = () => Boolean(state.source && state.source.kind !== "still");

function persist() {
  saveSettings(storage, settings);
}

function update(patch) {
  settings = { ...settings, ...patch };
  persist();
}

// ----------------------------------------------------------------- theme ---

let currentTheme = "system";

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  const names = { system: "match system", dark: "dark", light: "light" };
  els.themeLabel.textContent = `Theme: ${names[theme]}`;
  els.themeButton.title = `Theme: ${names[theme]}`;
}

function cycleTheme() {
  const theme = nextTheme(currentTheme);
  saveTheme(storage, theme);
  applyTheme(theme);
  toast.show(`Theme: ${theme === "system" ? "match system" : theme}`);
}

// --------------------------------------------------------------- engines ---

function yoloAvailable() {
  return state.serverAvailable && state.yoloStatus !== "error";
}

function resolveEngine(id) {
  if (id === "server") {
    return yoloAvailable() ? "server" : defaultEngineId(false);
  }
  if (id && id !== "auto" && engineById(id)) {
    return id;
  }
  return defaultEngineId(yoloAvailable());
}

function renderEngineList() {
  els.engineList.replaceChildren(
    ...ENGINES.map((engine) => {
      const disabled = engine.id === "server" && !yoloAvailable();
      const tags = [...(engine.tags || [])];
      let description = engine.description;
      if (engine.id === "server") {
        if (!state.serverAvailable) {
          description = "Run python -m app on this computer, then open 127.0.0.1:8000.";
          tags.push("Not running");
        } else if (state.yoloStatus === "error") {
          description = state.yoloError || "The server is running but YOLOv8 could not load.";
          tags.push("Unavailable");
        } else if (state.yoloStatus === "mock") {
          tags.push("Simulated");
        }
      }
      const input = h("input", {
        type: "radio",
        name: "engine",
        value: engine.id,
        checked: state.engineId === engine.id,
        disabled,
        onChange: () => selectEngine(engine.id, { user: true }),
      });
      return h(
        "label",
        { class: "engine" },
        input,
        h("span", { class: "engine-name" }, engine.label, ...tags.map((tag) => h("span", { class: "engine-tag" }, tag))),
        h("span", { class: "engine-desc" }, description),
      );
    }),
  );
}

function updateEngineUi() {
  const engine = activeEngine();
  const server = state.engineId === "server";
  els.osdEngine.textContent = engine?.short || "None";
  els.engineNote.textContent = server
    ? "Frames go to the YOLOv8 server on this computer. Nothing leaves the machine."
    : "Detection runs in this tab. Frames are never uploaded.";
  els.privacyNote.textContent = server
    ? "With YOLOv8, people are also blurred in the frame before it is sent to the local server."
    : "On-device: frames stay in this tab.";
  els.slateLead.textContent = server
    ? "Start your camera or open a sample scene. YOLOv8 runs on the local server, so frames stay on this computer."
    : "Start your camera or open a sample scene. Objects are found on this device, and frames stay in this tab.";
  for (const input of $$('input[name="engine"]')) {
    input.checked = input.value === state.engineId;
  }
}

function setLoading(message) {
  els.modelOverlay.hidden = !message;
  if (message) {
    els.modelOverlayStatus.textContent = message;
  }
}

const engineLoads = new Map();

/** Load the active browser engine once, however many callers ask at the same moment. */
function ensureEngine() {
  const engine = activeEngine();
  if (!engine || engine.kind === "server" || engine.ready) {
    return Promise.resolve(engine);
  }
  if (engineLoads.has(engine.id)) {
    return engineLoads.get(engine.id);
  }
  state.engineLoading = true;
  setLoading(`Loading ${engine.short}`);
  const load = engine
    .load((message) => setLoading(message))
    .then(() => {
      toast.ok(`${engine.short} is ready`);
      return engine;
    })
    .catch((error) => {
      const fallback = engineById(FALLBACK_ENGINE_ID);
      if (engine.id !== fallback.id && state.engineId === engine.id) {
        toast.error(`${engine.short} could not start here (${error.message || "load failed"}). Using ${fallback.short}.`);
        state.engineId = fallback.id;
        updateEngineUi();
        engineLoads.delete(engine.id);
        return ensureEngine();
      }
      toast.error(error.message || "The model could not load. Check the connection and try again.");
      throw error;
    })
    .finally(() => {
      engineLoads.delete(engine.id);
      state.engineLoading = engineLoads.size > 0;
      if (!state.engineLoading) {
        setLoading("");
      }
    });
  engineLoads.set(engine.id, load);
  return load;
}

async function selectEngine(id, { user = false } = {}) {
  if (id === "server" && !yoloAvailable()) {
    toast.error(state.serverAvailable ? state.yoloError || "YOLOv8 is not available on this server." : "No local server here. Run python -m app to use YOLOv8.");
    updateEngineUi();
    return;
  }
  const previous = state.engineId;
  state.engineId = resolveEngine(id);
  if (user) {
    update({ engine: state.engineId });
  }
  updateEngineUi();
  if (previous !== state.engineId) {
    browserSession.resetTracks();
    glide.reset();
  }
  if (state.engineId === "server") {
    if (state.source) {
      ensureServerRuntime().connect();
    }
  } else {
    serverRuntime?.disconnect();
    if (state.source) {
      await ensureEngine().catch(() => {});
    }
  }
  if (state.source?.kind === "still") {
    runStill();
  }
}

// ---------------------------------------------------------------- server ---

function ensureServerRuntime() {
  if (serverRuntime) {
    return serverRuntime;
  }
  serverRuntime = createServerRuntime({
    onStatus(status) {
      if (status === "open") {
        sendDetectionConfig();
      }
      if (status === "reconnecting" && state.source) {
        els.hudState.textContent = "Reconnecting";
      }
    },
    onDetections: applyDetections,
    onError(message, code) {
      if (code === "model_unavailable") {
        state.yoloStatus = "error";
        state.yoloError = message;
        renderEngineList();
        toast.error(message);
        selectEngine(defaultEngineId(false));
        return;
      }
      els.lastUpdated.textContent = message;
      if (code.startsWith("close_")) {
        toast.error(message);
      }
    },
    onRoiAck(payload) {
      if (typeof payload.roi_alerts === "number") {
        state.session.roi_alerts = payload.roi_alerts;
        els.roiAlerts.textContent = String(payload.roi_alerts);
      }
    },
  });
  return serverRuntime;
}

function sendDetectionConfig() {
  if (state.engineId === "server") {
    ensureServerRuntime().sendConfig({ confidence: settings.confidence, classes: settings.selectedClasses });
  }
}

async function probeHealth() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(apiUrl("health"), { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return payload?.status === "ok" ? payload : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

// --------------------------------------------------------------- sources ---

function currentSource() {
  return state.source?.element || null;
}

function sourceSize(source) {
  return {
    width: source?.videoWidth || source?.naturalWidth || source?.width || state.frameSize.width,
    height: source?.videoHeight || source?.naturalHeight || source?.height || state.frameSize.height,
  };
}

function setStageRatio(width, height) {
  if (width > 0 && height > 0) {
    els.stage.style.setProperty("--stage-ratio", `${width} / ${height}`);
  }
}

function clearStageMedia() {
  window.clearInterval(state.demoTimer);
  state.demoTimer = null;
  for (const node of $$(".still-frame, .demo-feed", els.stage)) {
    node.remove();
  }
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  els.video.srcObject = null;
  els.video.hidden = false;
  els.demoBadge.hidden = true;
}

function resetSourceState() {
  state.detections = [];
  state.ghosts = [];
  state.classCounts = {};
  state.roiOccupied = state.rois.map(() => false);
  state.zoneCounts = state.rois.map(() => 0);
  state.mask = null;
  state.crop = null;
  // The plate belongs to one source, and nothing is learned before that source has detections.
  state.plate = null;
  state.detectionsReady = false;
  state.maskMissed = false;
  glide.reset();
  browserSession.resetTracks();
  // A new source starts a fresh diary baseline instead of logging everything as "left".
  state.diaryReady = false;
  state.diaryCounts = {};
  renderClassChips();
  renderDetectionList();
  updateStudioChips();
}

function attachSource(source) {
  clearTimeout(state.loopTimer);
  state.source = source;
  state.paused = false;
  state.inFlight = false;
  resetSourceState();
  els.emptyState.hidden = true;
  const size = sourceSize(source.element);
  setStageRatio(size.width, size.height);
  state.frameSize = { width: size.width, height: size.height };
  syncTransport();
  els.monitorTitle.textContent = source.label;
  els.osdSource.textContent = source.short || source.label;
  els.hudState.textContent = source.kind === "camera" ? "Live" : source.kind === "synthetic" ? "Synthetic" : "Still";
  els.demoBadge.hidden = source.kind !== "synthetic";
  updateStudioChips();
  updateTally();
}

function detachSource() {
  clearTimeout(state.loopTimer);
  serverRuntime?.disconnect();
  clearStageMedia();
  state.source = null;
  state.paused = false;
  resetSourceState();
  els.emptyState.hidden = false;
  els.monitorTitle.textContent = "No source";
  els.monitorMeta.textContent = "";
  els.osdSource.textContent = "None";
  els.osdFps.textContent = "0 fps";
  els.osdLatency.textContent = "0 ms";
  els.osdObjects.textContent = "0";
  els.hudState.textContent = "Idle";
  els.hudStats.textContent = "0 objects";
  setRoiDrawing(false);
  syncTransport();
  updateTally();
}

async function requestCameraStream() {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    return { stream: null, reason: "This browser cannot use a camera here. Camera access needs https or localhost." };
  }
  let timedOut = false;
  const request = mediaDevices
    .getUserMedia({ audio: false, video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } } })
    .then((stream) => {
      if (timedOut) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }
      return stream;
    });
  const timeout = new Promise((resolve) => {
    window.setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, CAMERA_TIMEOUT_MS);
  });
  try {
    const stream = await Promise.race([request, timeout]);
    return { stream, reason: stream ? "" : "The camera did not answer within 8 seconds." };
  } catch (error) {
    const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    return {
      stream: null,
      reason: blocked
        ? "Camera access is blocked. Allow it from the address bar to go live."
        : error?.name === "NotFoundError"
          ? "No camera was found."
          : error?.message || "The camera could not start.",
    };
  }
}

async function startCamera() {
  if (state.source?.kind === "camera") {
    return;
  }
  resumeAudio();
  els.cameraToggle.disabled = true;
  els.cameraToggleLabel.textContent = "Starting camera";
  const camera = await requestCameraStream();
  els.cameraToggle.disabled = false;
  if (!camera.stream) {
    syncTransport();
    toast.error(`${camera.reason} Showing the desk sample instead.`);
    await loadSample("desk");
    return;
  }
  clearStageMedia();
  state.stream = camera.stream;
  els.video.srcObject = camera.stream;
  await els.video.play().catch(() => {});
  if (!els.video.videoWidth) {
    await new Promise((resolve) => {
      els.video.addEventListener("loadedmetadata", resolve, { once: true });
      window.setTimeout(resolve, 1500);
    });
  }
  const trackLabel = camera.stream.getVideoTracks()[0]?.label || "Camera";
  attachSource({ kind: "camera", element: els.video, label: trackLabel, short: "Camera" });
  await startDetection();
}

function startSynthetic() {
  clearStageMedia();
  const canvas = document.createElement("canvas");
  canvas.className = "demo-feed";
  canvas.width = 960;
  canvas.height = 540;
  canvas.setAttribute("aria-label", "Synthetic test feed");
  els.stage.insertBefore(canvas, els.heatmap);
  els.video.hidden = true;
  const draw = () => drawSyntheticFrame(canvas);
  draw();
  state.demoTimer = window.setInterval(draw, 1000 / 24);
  attachSource({ kind: "synthetic", element: canvas, label: "Synthetic test feed", short: "Synthetic" });
  startDetection();
}

function drawSyntheticFrame(canvas) {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const t = performance.now() / 1000;
  const bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
  bars.forEach((color, index) => {
    context.fillStyle = color;
    context.fillRect((index * width) / bars.length, 0, width / bars.length + 1, height * 0.7);
  });
  context.fillStyle = "#121418";
  context.fillRect(0, height * 0.7, width, height * 0.3);
  const x = width * (0.5 + Math.sin(t * 0.9) * 0.32);
  context.fillStyle = "#f5f6f7";
  context.beginPath();
  context.arc(x, height * 0.85, 26, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f5f6f7";
  context.font = '650 26px "Saira", ui-sans-serif, sans-serif';
  context.fillText("Synthetic test feed", 28, height * 0.7 + 44);
  context.font = '500 16px "Saira", ui-sans-serif, sans-serif';
  context.fillText("For checking the pipeline. The models see no real objects here.", 28, height * 0.7 + 72);
}

function showStill(image, label, short) {
  clearStageMedia();
  const canvas = document.createElement("canvas");
  canvas.className = "still-frame";
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  els.stage.insertBefore(canvas, els.heatmap);
  els.video.hidden = true;
  attachSource({ kind: "still", element: canvas, label, short });
}

async function loadSample(id) {
  const scene = SAMPLE_SCENES[id];
  if (!scene) {
    return;
  }
  resumeAudio();
  try {
    const image = await loadImage(scene.src);
    showStill(image, scene.label, scene.label.replace(" sample", ""));
    await runStill();
    els.uploadDetectStatus.textContent = `${scene.label}: ${plural(state.detections.length, "object")}.`;
  } catch (error) {
    toast.error(error.message || "That sample could not load.");
  }
}

async function openImages(fileList) {
  const files = [...(fileList || [])].filter((file) => file && file.type.startsWith("image/"));
  if (!files.length) {
    toast.error("Choose an image file: JPEG, PNG, WebP or GIF.");
    return;
  }
  const [first, ...rest] = files;
  try {
    showStill(await fileToImage(first), first.name, "Image");
  } catch (error) {
    toast.error(error.message);
    return;
  }
  await runStill();
  if (!rest.length) {
    els.uploadDetectStatus.textContent = `${first.name}: ${plural(state.detections.length, "object")}.`;
    return;
  }
  els.uploadDetectStatus.textContent = `Checking ${files.length} images…`;
  let total = state.detections.length;
  try {
    if (state.engineId === "server") {
      const form = new FormData();
      rest.forEach((file) => form.append("images", file));
      const response = await fetch(apiUrl(`api/detect/batch?confidence=${settings.confidence}`), { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "The batch was rejected.");
      }
      total += (payload.results || []).reduce((sum, item) => sum + (item.detections?.length || 0), 0);
    } else {
      const engine = await ensureEngine();
      for (const file of rest) {
        const image = await fileToImage(file);
        const payload = await browserSession.detect(engine, image, {
          confidence: settings.confidence,
          classes: settings.selectedClasses,
          track: false,
        });
        total += payload.detections.length;
      }
    }
    els.uploadDetectStatus.textContent = `${files.length} images: ${plural(total, "object")} in all. The first is on the monitor.`;
  } catch (error) {
    els.uploadDetectStatus.textContent = error.message || "The batch could not be checked.";
    toast.error(els.uploadDetectStatus.textContent);
  }
}

// ------------------------------------------------------------- detection ---

function grabFrame() {
  const source = currentSource();
  if (!source) {
    return null;
  }
  const size = sourceSize(source);
  if (!size.width || !size.height) {
    return null;
  }
  if (source === els.video && els.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }
  const width = Math.min(settings.processingWidth, size.width);
  const height = Math.round(width * (size.height / size.width));
  const canvas = els.captureCanvas;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d", { willReadFrequently: false });
  context.drawImage(source, 0, 0, width, height);
  if (settings.privacyMode && state.engineId === "server") {
    cloakPeople(canvas, state.detections, state.frameSize);
  }
  return canvas;
}

function cloakPeople(canvas, detections, frameSize) {
  const context = canvas.getContext("2d");
  const sx = canvas.width / Math.max(1, frameSize.width);
  const sy = canvas.height / Math.max(1, frameSize.height);
  for (const detection of detections) {
    if (detection.label !== "person") {
      continue;
    }
    const x = Math.max(0, detection.box.x * sx);
    const y = Math.max(0, detection.box.y * sy);
    const w = Math.max(1, detection.box.width * sx);
    const hgt = Math.max(1, detection.box.height * sy);
    context.save();
    context.beginPath();
    context.rect(x, y, w, hgt);
    context.clip();
    context.filter = `blur(${settings.privacyBlur}px)`;
    context.drawImage(canvas, 0, 0);
    context.restore();
  }
}

async function startDetection() {
  if (state.engineId === "server") {
    ensureServerRuntime().connect();
  } else {
    try {
      await ensureEngine();
    } catch {
      return;
    }
  }
  scheduleTick(0);
}

function scheduleTick(delay) {
  clearTimeout(state.loopTimer);
  if (isLive()) {
    state.loopTimer = window.setTimeout(tick, delay);
  }
}

async function tick() {
  if (!isLive()) {
    return;
  }
  const started = performance.now();
  if (!state.paused && !state.inFlight && !state.engineLoading) {
    await detectOnce();
  }
  const spent = performance.now() - started;
  scheduleTick(Math.max(0, 1000 / settings.targetFps - spent));
}

async function detectOnce() {
  const canvas = grabFrame();
  if (!canvas) {
    return;
  }
  if (state.engineId === "server") {
    const runtime = ensureServerRuntime();
    if (!runtime.isOpen || runtime.busy) {
      return;
    }
    state.inFlight = true;
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
      if (blob && state.engineId === "server") {
        runtime.sendFrame(await blob.arrayBuffer());
      }
    } finally {
      state.inFlight = false;
    }
    return;
  }
  const engine = activeEngine();
  if (!engine?.ready) {
    return;
  }
  state.inFlight = true;
  try {
    const payload = await browserSession.detect(engine, canvas, {
      confidence: settings.confidence,
      classes: settings.selectedClasses,
    });
    if (state.source && engine.id === state.engineId) {
      applyDetections(payload);
    }
  } catch (error) {
    els.lastUpdated.textContent = error.message || "Detection failed on this frame.";
  } finally {
    state.inFlight = false;
  }
}

async function runStill() {
  const still = state.source?.kind === "still" ? state.source.element : null;
  if (!still) {
    return;
  }
  browserSession.resetTracks();
  glide.reset();
  if (state.engineId === "server") {
    const blob = await new Promise((resolve) => still.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) {
      return;
    }
    const form = new FormData();
    form.append("image", blob, "still.jpg");
    try {
      const started = performance.now();
      const response = await fetch(apiUrl(`api/detect?confidence=${settings.confidence}`), { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "The server could not check that image.");
      }
      payload.rtt_ms = Math.round((performance.now() - started) * 10) / 10;
      const wanted = settings.selectedClasses.length ? new Set(settings.selectedClasses) : null;
      if (wanted) {
        payload.detections = payload.detections.filter((item) => wanted.has(item.label));
        payload.class_counts = countLabels(payload.detections);
      }
      applyDetections(payload);
    } catch (error) {
      toast.error(error.message);
    }
    return;
  }
  try {
    const engine = await ensureEngine();
    const payload = await browserSession.detect(engine, still, {
      confidence: settings.confidence,
      classes: settings.selectedClasses,
    });
    if (state.source?.element === still) {
      applyDetections(payload);
    }
  } catch (error) {
    els.lastUpdated.textContent = error.message || "Detection failed.";
  }
}

function rerunIfStill() {
  if (state.source?.kind === "still") {
    runStill();
  }
}

function applyDetections(payload) {
  if (!payload || payload.type !== "detections" || !state.source) {
    return;
  }
  const now = performance.now();
  state.ghosts = settings.ghostMode ? state.detections.map((item) => ({ ...item, box: { ...item.box } })) : [];
  state.detections = payload.detections || [];
  state.detectionsReady = true;
  state.classCounts = payload.class_counts || countLabels(state.detections);
  state.frameSize = { width: payload.frame_width || 1, height: payload.frame_height || 1 };
  glide.update(state.detections, state.frameSize, now);
  noteSceneDiary(state.detections);
  if (settings.sonify) {
    sonifyDetections(state.detections, { enabled: true, chord: true });
  }
  state.density = [...state.density, state.detections.length].slice(-48);
  const latency = typeof payload.rtt_ms === "number" ? payload.rtt_ms : payload.latency_ms;
  if (typeof latency === "number") {
    state.latency = [...state.latency, latency].slice(-48);
  }
  updateHeatmap(state.heat, state.detections, state.frameSize);
  recordHistory(state.detections);
  updateSessionStats(payload.session);
  checkZones(state.detections);
  countFps();
  renderReadouts(latency);
  renderClassChips();
  renderDetectionList();
  renderCharts();
  announce();
}

function countFps() {
  state.fpsFrames += 1;
  const elapsed = performance.now() - state.fpsStartedAt;
  if (elapsed >= 1000) {
    state.fps = Math.round((state.fpsFrames * 1000) / elapsed);
    state.fpsFrames = 0;
    state.fpsStartedAt = performance.now();
  }
}

function renderReadouts(latency) {
  const average = state.latency.length ? state.latency.reduce((sum, value) => sum + value, 0) / state.latency.length : 0;
  els.osdFps.textContent = isLive() ? `${state.fps} fps` : "Still";
  els.osdLatency.textContent = `${Math.round(latency ?? average)} ms`;
  els.osdObjects.textContent = String(state.detections.length);
  els.hudStats.textContent = plural(state.detections.length, "object");
  els.monitorMeta.textContent = `${state.frameSize.width}×${state.frameSize.height}`;
  els.lastUpdated.textContent = clockTime();
  els.latencyAvg.textContent = `${Math.round(average)} ms avg`;
  const density = state.density.length ? state.density.reduce((sum, value) => sum + value, 0) / state.density.length : 0;
  els.densityAvg.textContent = `${density.toFixed(1)} avg`;
  els.radarCount.textContent = plural(state.detections.length, "object");
}

function renderCharts() {
  if (els.latencyChart.offsetParent === null) {
    return;
  }
  drawSparkline(els.latencyChart, state.latency);
  drawBars(els.densityChart, state.density);
  drawRadar(els.proximityRadar, state.detections, state.frameSize);
}

function announce() {
  const now = performance.now();
  const entries = Object.entries(state.classCounts).sort((a, b) => b[1] - a[1]);
  const text = entries.length ? `In frame: ${entries.map(([label, count]) => `${count} ${label}`).join(", ")}.` : "Nothing detected.";
  if (text !== state.srText && now - state.srAt > 4000) {
    state.srText = text;
    state.srAt = now;
    els.srSummary.textContent = text;
  }
}

function renderClassChips() {
  const entries = Object.entries(state.classCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  els.nowEmpty.hidden = entries.length > 0;
  if (!state.source) {
    els.nowEmpty.textContent = "Nothing in frame yet.";
  } else if (!entries.length) {
    els.nowEmpty.textContent = settings.selectedClasses.length ? "Nothing from the class filter in frame." : "Nothing detected in frame.";
  }
  els.classChips.replaceChildren(
    ...entries.map(([label, count]) =>
      h("span", { class: "class-chip", style: { "--swatch": colorForLabel(label) } }, h("i"), label, h("b", {}, String(count))),
    ),
  );
}

function renderDetectionList() {
  const rows = [...state.detections]
    .sort((a, b) => b.confidence - a.confidence)
    .map((detection) =>
      h(
        "li",
        { style: { "--swatch": colorForLabel(detection.label) } },
        h("i"),
        h("span", {}, detection.label, detection.track_id ? h("span", { class: "track" }, `  track ${detection.track_id}`) : null),
        h("span", { class: "confidence" }, `${Math.round(detection.confidence * 100)}%`),
      ),
    );
  els.detectionList.replaceChildren(...rows);
}

function recordHistory(detections) {
  if (!detections.length) {
    return;
  }
  const labels = Object.entries(countLabels(detections))
    .map(([label, count]) => (count > 1 ? `${count} ${label}` : label))
    .join(", ");
  if (state.history[0]?.labels === labels) {
    return;
  }
  state.history = [{ at: clockTime(), iso: new Date().toISOString(), labels, count: detections.length }, ...state.history].slice(0, 50);
  els.historyCount.textContent = String(state.history.length);
  els.historyList.replaceChildren(
    ...state.history.slice(0, 20).map((entry) => h("li", {}, h("time", {}, entry.at), h("span", {}, entry.labels))),
  );
  els.exportHistoryButton.disabled = false;
  els.clearHistoryButton.disabled = false;
}

function updateSessionStats(session) {
  if (!session) {
    return;
  }
  const roiAlerts = Math.max(state.session.roi_alerts || 0, session.roi_alerts || 0);
  state.session = { ...session, roi_alerts: roiAlerts };
  els.sessionFrames.textContent = String(session.frames_processed ?? 0);
  els.sessionDetections.textContent = String(session.detections_total ?? 0);
  els.sessionClasses.textContent = String(session.classes_seen?.length ?? 0);
  els.roiAlerts.textContent = String(roiAlerts);
}

// ------------------------------------------------------------ scene diary ---

function noteSceneDiary(detections) {
  const next = countLabels(detections);
  if (!state.diaryReady) {
    state.diaryCounts = next;
    state.diaryReady = true;
    return;
  }
  const line = diaryLine(diffCounts(state.diaryCounts, next));
  state.diaryCounts = next;
  if (!line || line === state.diaryLast) {
    return;
  }
  state.diaryLast = line;
  state.diary = [{ at: clockTime(), line }, ...state.diary].slice(0, 60);
  renderDiary();
}

function renderDiary() {
  els.diaryEmpty.hidden = state.diary.length > 0;
  els.diaryCount.textContent = String(state.diary.length);
  els.diaryList.replaceChildren(...state.diary.map((entry) => h("li", {}, h("time", {}, entry.at), h("span", {}, entry.line))));
  const latest = state.diary[0];
  els.diaryLatest.hidden = !latest;
  if (latest) {
    els.diaryLatest.textContent = `${latest.at}  ${latest.line}`;
  }
}

// ------------------------------------------------------------------ zones ---

function setRoiDrawing(active) {
  state.roiDrawing = active;
  els.stage.classList.toggle("is-drawing", active);
  els.zoneButton.setAttribute("aria-pressed", active ? "true" : "false");
  if (!active) {
    state.roiStart = null;
    state.roiPreview = null;
  }
}

function startZoneDraw() {
  if (!state.source) {
    toast.show("Start a source first, then draw on the monitor.");
    return;
  }
  if (state.rois.length >= MAX_ROIS) {
    toast.show(`Three zones is the limit. Clear one to draw another.`);
    return;
  }
  setRoiDrawing(true);
  els.roiStatus.textContent = "Drag on the monitor to draw the zone. Esc cancels.";
  toast.show("Drag on the monitor to draw a zone.");
}

function renderZones() {
  els.roiClearButton.disabled = state.rois.length === 0;
  els.zoneList.replaceChildren(
    ...state.rois.map((roi, index) =>
      h(
        "li",
        { style: { "--swatch": ROI_COLORS[index % ROI_COLORS.length] } },
        h("i"),
        h("span", {}, `Zone ${index + 1}`),
        h("span", { class: "zone-count num" }, `${state.zoneCounts[index] || 0} inside · ${state.zoneAlerts[index] || 0} alerts`),
        h("button", { type: "button", onClick: () => removeZone(index), "aria-label": `Remove zone ${index + 1}` }, "Remove"),
      ),
    ),
  );
  if (!state.rois.length && !state.roiDrawing) {
    els.roiStatus.textContent = state.source ? "No zones yet. Press Draw zone, then drag on the monitor." : "No zones yet. Start a source, then draw on the monitor.";
  } else if (state.rois.length) {
    els.roiStatus.textContent = `${plural(state.rois.length, "zone")} armed. A zone alerts when something new enters it.`;
  }
}

function removeZone(index) {
  state.rois.splice(index, 1);
  state.roiOccupied.splice(index, 1);
  state.roiCooldown.splice(index, 1);
  state.zoneCounts.splice(index, 1);
  state.zoneAlerts.splice(index, 1);
  renderZones();
}

function clearZones() {
  state.rois = [];
  state.roiOccupied = [];
  state.roiCooldown = [];
  state.zoneCounts = [];
  state.zoneAlerts = [];
  setRoiDrawing(false);
  renderZones();
}

function checkZones(detections) {
  if (!state.rois.length) {
    return;
  }
  const now = performance.now();
  const inside = state.rois.map(() => []);
  for (const detection of detections) {
    const box = detection.box;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    state.rois.forEach((roi, index) => {
      if (pointInRoi(cx, cy, roi, state.frameSize.width, state.frameSize.height)) {
        inside[index].push(detection);
      }
    });
  }
  let changed = false;
  inside.forEach((items, index) => {
    const was = Boolean(state.roiOccupied[index]);
    const is = items.length > 0;
    if ((state.zoneCounts[index] || 0) !== items.length) {
      changed = true;
    }
    state.zoneCounts[index] = items.length;
    if (is && !was && now - (state.roiCooldown[index] || 0) >= ROI_COOLDOWN_MS) {
      state.roiCooldown[index] = now;
      zoneAlert(items[0], index);
      changed = true;
    }
    state.roiOccupied[index] = is;
  });
  if (changed) {
    renderZones();
  }
}

function zoneAlert(detection, index) {
  state.zoneAlerts[index] = (state.zoneAlerts[index] || 0) + 1;
  state.session.roi_alerts = (state.session.roi_alerts || 0) + 1;
  els.roiAlerts.textContent = String(state.session.roi_alerts);
  toast.show(`${detection.label} entered zone ${index + 1}`);
  if (settings.alertSound) {
    playAlertTone();
  }
  if (settings.spatialAudio) {
    playSpatialPing(detection, state.frameSize.width, { enabled: true });
  }
  captureFilmstrip(`${detection.label} · zone ${index + 1}`);
  if (state.engineId === "server") {
    ensureServerRuntime().sendRoiAlert();
  } else {
    state.session.roi_alerts = browserSession.recordRoiAlert();
    els.roiAlerts.textContent = String(state.session.roi_alerts);
  }
}

function captureFilmstrip(label) {
  const source = currentSource();
  if (!source || !state.lastFitted) {
    return;
  }
  const rect = els.stage.getBoundingClientRect();
  const canvas = snapshotComposite(source, els.overlay, rect.width, rect.height, state.lastFitted);
  state.filmstrip = [{ label, at: clockTime(), url: canvas.toDataURL("image/jpeg", 0.7) }, ...state.filmstrip].slice(0, 8);
  els.filmstripCount.textContent = String(state.filmstrip.length);
  els.exportFilmstrip.disabled = false;
  els.alertFilmstrip.replaceChildren(
    ...state.filmstrip.map((clip) => h("figure", {}, h("img", { src: clip.url, alt: clip.label }), h("figcaption", {}, `${clip.at}  ${clip.label}`))),
  );
}

function exportGallery() {
  if (!state.filmstrip.length) {
    return;
  }
  const escape = (value) => String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  const cards = state.filmstrip
    .map((clip) => `<figure><img src="${clip.url}" alt="${escape(clip.label)}"><figcaption>${escape(clip.at)}  ${escape(clip.label)}</figcaption></figure>`)
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Zone alerts</title><style>body{margin:0;padding:24px;background:#1c1f24;color:#e8eaed;font-family:system-ui,sans-serif}h1{font-size:20px}div{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}figure{margin:0;border:1px solid #373c45;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:8px;font-size:13px;color:#a9b0b9}</style></head><body><h1>Zone alerts</h1><div>${cards}</div></body></html>`;
  downloadBlob(new Blob([html], { type: "text/html" }), `zone-alerts-${fileStamp()}.html`);
  toast.ok("Gallery saved");
}

// ------------------------------------------------------------------ studio ---

function studioOutputWanted() {
  return (
    settings.studioEffect !== "none" ||
    settings.grade !== "none" ||
    settings.mirror ||
    settings.autoFrame ||
    cleanNameplate(settings.nameplate) !== "" ||
    settings.burnHud ||
    state.virtualCamOn ||
    Boolean(state.cleanFeedWindow) ||
    Boolean(state.recorder) ||
    state.boothRunning
  );
}

function maskWanted() {
  return settings.useMask && MASK_EFFECTS.has(settings.studioEffect) && settings.vanishMode === "people" && Boolean(state.source);
}

function ensureMask() {
  if (!maskWanted() || segmenter.ready || state.maskStatus === "loading") {
    return;
  }
  if (state.maskStatus === "failed") {
    return;
  }
  state.maskStatus = "loading";
  updateStudioChips();
  segmenter
    .load()
    .then(() => {
      state.maskStatus = "ready";
      els.maskNote.textContent = `Person mask ready (${segmenter.delegate === "GPU" ? "GPU" : "CPU"}). Effects follow the body outline.`;
      updateStudioChips();
    })
    .catch(() => {
      state.maskStatus = "failed";
      els.maskNote.textContent = "The person mask could not load here, so effects use detection boxes.";
      els.maskNote.dataset.tone = "warn";
      toast.error("The person mask could not load, so the studio is using boxes.");
      updateStudioChips();
    });
}

function updateStudioChips() {
  const effect = settings.studioEffect;
  els.invisibleChip.hidden = effect !== "disappear" || !state.source;
  els.maskChip.hidden = !(maskWanted() && state.maskStatus === "ready" && studioOutputWanted());
  if (maskWanted() && state.maskStatus === "loading") {
    els.maskChip.hidden = false;
    els.maskChip.textContent = "Loading person mask";
  } else {
    els.maskChip.textContent = state.maskMissed ? "Boxes for far people" : "Person mask";
  }
}

function ensurePlate() {
  if (!state.plate) {
    state.plate = { canvas: document.createElement("canvas"), seeded: false, learned: 0, captured: false, known: null };
  }
  return state.plate;
}

function renderStudio(now) {
  const canvas = els.studioCanvas;
  const source = currentSource();
  const show = Boolean(source) && studioOutputWanted();
  canvas.hidden = !show;
  els.stage.classList.toggle("studio-live", show);
  if (!show) {
    return null;
  }
  const size = sourceSize(source);
  const width = Math.min(STUDIO_MAX_WIDTH, size.width || 640);
  const height = Math.max(1, Math.round(width * ((size.height || 360) / (size.width || 640))));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const frameSize = state.frameSize.width ? state.frameSize : { width, height };
  const plate = ensurePlate();
  const boxes = effectTargets(state.detections, frameSize, { width, height }, {
    pad: settings.studioPad,
    vanishMode: settings.vanishMode,
    selectedClasses: settings.selectedClasses,
  });
  let mask = null;
  let maskKind = "none";
  if (maskWanted()) {
    ensureMask();
    if (segmenter.ready) {
      const interval = state.source.kind === "still" ? 400 : 33;
      if (!state.mask || now - state.maskAt > interval) {
        state.mask = segmenter.segment(source) || state.mask;
        state.maskAt = now;
      }
      // A person the mask only half covers (far away, side-on) gets a box mask instead.
      const bands = state.detections
        .filter((item) => item.label === "person")
        .map((item) => segmenter.coverageBands(item.box, state.frameSize));
      const missed = !maskTrusted(bands);
      if (missed !== state.maskMissed) {
        state.maskMissed = missed;
        updateStudioChips();
      }
      if (state.mask && !missed) {
        mask = state.mask;
        maskKind = "person";
      }
    }
  }
  if (!mask && settings.studioEffect !== "none") {
    mask = boxMask(boxes, width, height);
    maskKind = "box";
  }
  if (state.capturePlate || (settings.studioEffect === "disappear" && state.detectionsReady)) {
    learnPlate(plate, source, width, height, boxes, state.capturePlate, state.capturePlate ? null : mask);
    if (state.capturePlate) {
      toast.ok("Background captured");
    }
    state.capturePlate = false;
  }
  const rendered = compositeFrame(canvas.getContext("2d"), source, width, height, {
    effect: settings.studioEffect,
    detections: state.detections,
    frameSize,
    plate,
    mask,
    maskKind,
    pad: settings.studioPad,
    vanishMode: settings.vanishMode,
    selectedClasses: settings.selectedClasses,
    backgroundColor: settings.backgroundColor,
    grade: settings.grade,
    mirror: settings.mirror,
    autoFrame: settings.autoFrame,
    previousCrop: state.crop,
    nameplate: settings.nameplate,
    burnHud: settings.burnHud,
    hudText: settings.burnHud ? plural(state.detections.length, "object") : "",
  });
  state.crop = rendered.crop;
  if (settings.studioEffect === "disappear") {
    els.invisibleChip.textContent = rendered.plateReady ? "Invisible" : "Learning the room";
    els.plateNote.textContent = rendered.plateReady
      ? "The room behind you is learned. Move around and it stays filled in."
      : "Learning the room as you move. Step aside for a moment, or capture the background, for a clean result.";
  }
  publishStudio(canvas, now);
  return canvas;
}

function publishStudio(canvas, now) {
  if (state.cleanFeedWindow && state.studioChannel && now - state.cleanFeedSentAt > 66) {
    state.cleanFeedSentAt = now;
    canvas.toBlob((blob) => {
      if (blob && state.studioChannel) {
        state.studioChannel.postMessage(blob);
      }
    }, "image/jpeg", 0.8);
  }
  if (!state.virtualCamOn || !state.serverAvailable || state.virtualCamBusy || now - state.virtualCamSentAt < 90) {
    return;
  }
  state.virtualCamSentAt = now;
  state.virtualCamBusy = true;
  canvas.toBlob(async (blob) => {
    try {
      if (!blob) {
        return;
      }
      const response = await fetch(apiUrl("api/virtualcam/frame"), { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "The bridge rejected the frame.");
      }
      els.virtualCamStatus.textContent = payload.available
        ? `OBS Virtual Camera is live (${payload.frames} frames). Pick it in the other app.`
        : `The bridge has ${payload.frames} frames but no camera device. Install OBS and pyvirtualcam. OBS can also read ${payload.mjpeg_path}.`;
    } catch (error) {
      els.virtualCamStatus.textContent = error.message || "The virtual camera bridge did not answer.";
    } finally {
      state.virtualCamBusy = false;
    }
  }, "image/jpeg", 0.82);
}

function markEffect(effect) {
  for (const button of $$("[data-effect]")) {
    button.setAttribute("aria-pressed", button.dataset.effect === effect ? "true" : "false");
  }
  updateStudioChips();
}

function markLook(name) {
  for (const button of $$("[data-look]")) {
    button.setAttribute("aria-pressed", button.dataset.look === name ? "true" : "false");
  }
}

function setEffect(effect, { quiet = false } = {}) {
  update({ studioEffect: effect });
  markEffect(effect);
  markLook("");
  if (effect === "disappear") {
    els.studioNote.textContent = "Invisible: people leave the outgoing picture. Capture the empty room once for the cleanest result.";
  } else if (effect === "none") {
    els.studioNote.textContent = "The studio changes the outgoing picture: the clean feed, recordings, and the virtual camera.";
  } else {
    els.studioNote.textContent = "The effect is in the clean feed, recordings, and the virtual camera. The monitor shows it too.";
  }
  ensureMask();
  if (!quiet) {
    const label = $(`[data-effect="${effect}"]`)?.textContent || effect;
    toast.show(effect === "none" ? "Effect off" : `Effect: ${label}`);
  }
}

function applyLook(name) {
  const look = LOOKS[name];
  if (!look) {
    return;
  }
  const patch = { grade: look.grade };
  if ("mirror" in look) {
    patch.mirror = look.mirror;
  }
  if (look.vanishMode) {
    patch.vanishMode = look.vanishMode;
  }
  update(patch);
  syncControls();
  setEffect(look.effect, { quiet: true });
  els.studioNote.textContent = look.note;
  markLook(name);
  toast.show(look.note);
}

function goInvisible() {
  update({ vanishMode: "people" });
  els.vanishMode.value = "people";
  setEffect("disappear", { quiet: true });
  tabs.select("studio");
  if (!state.source) {
    startCamera();
  }
  toast.show("Invisible is on. Step out of frame once so it can learn the room.");
}

function cloneFrame(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width || source.videoWidth || 640;
  canvas.height = source.height || source.videoHeight || 360;
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function photoBooth() {
  if (state.boothRunning) {
    return;
  }
  const source = currentSource();
  if (!source) {
    toast.show("Start the camera or open a sample before the photo booth.");
    return;
  }
  state.boothRunning = true;
  els.photoBoothButton.disabled = true;
  const fast = reducedMotion();
  for (const tick of fast ? ["1"] : ["3", "2", "1"]) {
    els.boothCountdown.textContent = tick;
    els.boothCountdown.hidden = false;
    await wait(fast ? 200 : 700);
  }
  const shots = [];
  for (let index = 0; index < 4; index += 1) {
    const live = els.studioCanvas.hidden ? currentSource() || source : els.studioCanvas;
    shots.push(cloneFrame(live));
    els.boothCountdown.textContent = `${index + 1}/4`;
    await wait(fast ? 120 : 520);
  }
  els.boothCountdown.hidden = true;
  state.boothStrip = buildPhotoStrip(shots, { caption: `Photo booth  ${new Date().toLocaleString()}` });
  els.boothPreview.src = state.boothStrip.toDataURL("image/png");
  els.boothPreview.hidden = false;
  els.downloadBooth.disabled = false;
  state.boothRunning = false;
  els.photoBoothButton.disabled = false;
  tabs.select("studio");
  toast.ok("Strip ready. Save it from the Studio panel.");
}

function downloadBooth() {
  if (state.boothStrip) {
    downloadUrl(state.boothStrip.toDataURL("image/png"), `photo-booth-${fileStamp()}.png`);
    toast.ok("Strip saved");
  }
}

function openCleanFeed() {
  if (state.cleanFeedWindow && !state.cleanFeedWindow.closed) {
    state.cleanFeedWindow.focus();
    return;
  }
  if (!state.studioChannel && "BroadcastChannel" in window) {
    state.studioChannel = new BroadcastChannel("detection-studio");
  }
  const popup = window.open("static/studio.html", "detection-clean-feed", "width=960,height=560");
  if (!popup) {
    toast.error("The browser blocked the window. Allow pop-ups for this page and try again.");
    return;
  }
  state.cleanFeedWindow = popup;
  els.cleanFeedButton.textContent = "Show clean feed";
  toast.ok("Clean feed open. Share that window in your call.");
  updateTally();
}

function toggleRecording() {
  if (state.recorder) {
    state.recorder.stop();
    return;
  }
  if (!state.source) {
    toast.show("Start a source before recording.");
    return;
  }
  const canvas = els.studioCanvas;
  if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
    toast.error("This browser cannot record the studio picture.");
    return;
  }
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  const mimeType = types.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
  const recorder = new MediaRecorder(canvas.captureStream(30), mimeType ? { mimeType } : undefined);
  state.recordChunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) {
      state.recordChunks.push(event.data);
    }
  };
  recorder.onstop = () => {
    const type = recorder.mimeType || "video/webm";
    const extension = type.includes("mp4") ? "mp4" : "webm";
    downloadBlob(new Blob(state.recordChunks, { type }), `studio-clip-${fileStamp()}.${extension}`);
    state.recorder = null;
    els.recordButton.textContent = "Record clip";
    els.recordButton.dataset.state = "";
    toast.ok("Clip saved");
    updateTally();
  };
  // The studio canvas must be drawing before the recorder starts.
  state.recorder = recorder;
  renderStudio(performance.now());
  recorder.start(1000);
  els.recordButton.textContent = "Stop recording";
  els.recordButton.dataset.state = "live";
  updateTally();
}

function setVirtualCam(on) {
  if (on && !state.serverAvailable) {
    els.virtualCamToggle.checked = false;
    toast.error("The virtual camera needs the local server. Run python -m app.");
    return;
  }
  state.virtualCamOn = on;
  els.virtualCamToggle.checked = on;
  els.virtualCamStatus.textContent = on ? "Sending the studio picture to the local bridge…" : "Virtual camera off.";
  updateTally();
}

function renderVideoAppGuide() {
  const guide = videoAppGuide(settings.videoApp);
  els.videoAppGuide.replaceChildren(
    h("strong", {}, guide.name),
    h("dl", {}, h("dt", {}, "As a camera"), h("dd", {}, guide.camera), h("dt", {}, "As a shared window"), h("dd", {}, guide.window)),
    h("ol", {}, ...guide.setup.map((step) => h("li", {}, step))),
  );
}

// ----------------------------------------------------------------- tally ---

function updateTally() {
  if (state.cleanFeedWindow?.closed) {
    state.cleanFeedWindow = null;
    els.cleanFeedButton.textContent = "Open clean feed";
  }
  const live = Boolean(state.source) && (Boolean(state.recorder) || Boolean(state.cleanFeedWindow) || (state.virtualCamOn && state.serverAvailable));
  const tally = live ? "live" : state.source ? "preview" : "off";
  if (tally === state.tally) {
    return;
  }
  state.tally = tally;
  els.tallyLamp.dataset.state = tally;
  els.monitor.dataset.tally = tally;
  els.tallyTag.textContent = tally === "live" ? "On air" : tally === "preview" ? "Preview" : "Idle";
}

// ------------------------------------------------------------- transport ---

function syncTransport() {
  const hasSource = Boolean(state.source);
  const camera = state.source?.kind === "camera";
  els.cameraToggleLabel.textContent = camera ? "Stop camera" : hasSource ? "Close source" : "Start camera";
  els.cameraToggle.dataset.state = camera ? "live" : "";
  els.pauseButton.disabled = !isLive();
  els.pauseLabel.textContent = state.paused ? "Resume" : "Pause";
  els.snapshotButton.disabled = !hasSource;
  els.zoneButton.disabled = !hasSource;
  els.roiDrawButton.disabled = !hasSource;
  renderZones();
}

function toggleCamera() {
  if (state.source) {
    const wasCamera = state.source.kind === "camera";
    detachSource();
    toast.show(wasCamera ? "Camera stopped" : "Source closed");
    return;
  }
  startCamera();
}

function togglePause() {
  if (!isLive()) {
    return;
  }
  state.paused = !state.paused;
  syncTransport();
  els.hudState.textContent = state.paused ? "Paused" : state.source.kind === "camera" ? "Live" : "Synthetic";
  toast.show(state.paused ? "Detection paused" : "Detection running");
}

function snapshot() {
  const source = currentSource();
  if (!source) {
    return;
  }
  const rect = els.stage.getBoundingClientRect();
  const fitted = state.lastFitted || letterbox(rect.width, rect.height, state.frameSize.width, state.frameSize.height);
  const picture = els.studioCanvas.hidden ? source : els.studioCanvas;
  const canvas = snapshotComposite(picture, els.overlay, rect.width, rect.height, fitted);
  downloadUrl(canvas.toDataURL("image/png"), `detection-snapshot-${fileStamp()}.png`);
  toast.ok("Snapshot saved");
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await els.stage.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  } catch {
    toast.error("Fullscreen is not available here.");
  }
}

function exportHistory() {
  const body = {
    exported_at: new Date().toISOString(),
    version: VERSION,
    engine: state.engineId,
    session: state.session,
    history: state.history,
    diary: state.diary,
  };
  downloadBlob(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }), `detection-history-${fileStamp()}.json`);
  toast.ok("History saved");
}

function clearHistory() {
  state.history = [];
  els.historyList.replaceChildren();
  els.historyCount.textContent = "0";
  els.exportHistoryButton.disabled = true;
  els.clearHistoryButton.disabled = true;
}

// ---------------------------------------------------------------- render ---

let lastFrameAt = 0;

function outputsActive() {
  return Boolean(state.source) && (Boolean(state.recorder) || Boolean(state.cleanFeedWindow) || state.virtualCamOn);
}

/**
 * Browsers stop animation frames for covered or hidden windows, which would
 * freeze the clean feed the moment you switch to the call. While an output
 * is running, a timer keeps the studio drawing (hidden tabs still throttle
 * timers, so keep the window visible).
 */
window.setInterval(() => {
  if (outputsActive() && performance.now() - lastFrameAt > 120) {
    renderFrame(performance.now());
  }
}, 40);

function renderLoop(now) {
  renderFrame(now);
  requestAnimationFrame(renderLoop);
}

function renderFrame(now) {
  lastFrameAt = performance.now();
  const source = currentSource();
  renderStudio(now);
  const snap = !settings.glide || reducedMotion() || state.source?.kind === "still";
  const items = glide.step(now, { snap });
  const drawn = drawOverlay({
    overlay: els.overlay,
    stage: els.stage,
    items,
    ghosts: state.ghosts,
    rois: state.rois,
    roiPreview: state.roiPreview,
    frameSize: state.frameSize,
    source: els.studioCanvas.hidden ? source : els.studioCanvas,
    live: Boolean(state.source),
    zoneCounts: state.zoneCounts,
    options: {
      showLabels: settings.showLabels,
      showTrails: settings.showTrails && !reducedMotion(),
      cornerBoxes: settings.cornerBoxes,
      privacyMode: settings.privacyMode,
      privacyBlur: settings.privacyBlur,
      ghostMode: settings.ghostMode,
      ghostOpacity: settings.ghostOpacity,
    },
  });
  state.lastFitted = drawn.fitted;
  drawHeatmap(els.heatmap, els.stage, state.heat, state.frameSize, settings.showHeatmap && Boolean(state.source));
  updateTally();
}

// --------------------------------------------------------------- controls ---

function renderClassPicker() {
  const query = els.classSearch.value.trim().toLowerCase();
  const selected = new Set(settings.selectedClasses);
  const classes = COCO_CLASSES.filter((label) => !query || label.includes(query));
  els.classChipList.replaceChildren(
    ...classes.map((label) =>
      h(
        "button",
        {
          type: "button",
          class: "class-toggle",
          "aria-pressed": selected.has(label) ? "true" : "false",
          style: { "--swatch": colorForLabel(label) },
          onClick: () => toggleClass(label),
        },
        h("i"),
        label,
      ),
    ),
  );
  els.classNote.textContent = settings.selectedClasses.length
    ? `Only ${settings.selectedClasses.length === 1 ? settings.selectedClasses[0] : `${settings.selectedClasses.length} classes`} will be detected.`
    : "No filter: every class is detected.";
  for (const button of $$("[data-preset]")) {
    const preset = CLASS_PRESETS[button.dataset.preset];
    const same = preset.length === settings.selectedClasses.length && preset.every((label) => selected.has(label));
    button.setAttribute("aria-pressed", same ? "true" : "false");
  }
}

function toggleClass(label) {
  const selected = new Set(settings.selectedClasses);
  if (selected.has(label)) {
    selected.delete(label);
  } else {
    selected.add(label);
  }
  update({ selectedClasses: [...selected] });
  renderClassPicker();
  sendDetectionConfig();
  rerunIfStill();
}

function applyPreset(name) {
  update({ selectedClasses: [...(CLASS_PRESETS[name] || [])] });
  renderClassPicker();
  sendDetectionConfig();
  rerunIfStill();
}

function syncControls() {
  els.confidenceRange.value = String(settings.confidence);
  els.confidenceValue.textContent = `${Math.round(settings.confidence * 100)}%`;
  els.fpsRange.value = String(settings.targetFps);
  els.fpsValue.textContent = String(settings.targetFps);
  els.widthRange.value = String(settings.processingWidth);
  els.widthValue.textContent = `${settings.processingWidth} px`;
  els.labelToggle.checked = settings.showLabels;
  els.cornerBoxToggle.checked = settings.cornerBoxes;
  els.trailToggle.checked = settings.showTrails;
  els.glideToggle.checked = settings.glide;
  els.ghostToggle.checked = settings.ghostMode;
  els.ghostOpacityRange.value = String(settings.ghostOpacity);
  els.ghostOpacityValue.textContent = `${Math.round(settings.ghostOpacity * 100)}%`;
  els.heatmapToggle.checked = settings.showHeatmap;
  els.privacyToggle.checked = settings.privacyMode;
  els.privacyBlurRange.value = String(settings.privacyBlur);
  els.privacyBlurValue.textContent = `${settings.privacyBlur} px`;
  els.alertSoundToggle.checked = settings.alertSound;
  els.spatialAudioToggle.checked = settings.spatialAudio;
  els.sonifyToggle.checked = settings.sonify;
  els.maskToggle.checked = settings.useMask;
  els.vanishMode.value = settings.vanishMode;
  els.padRange.value = String(settings.studioPad);
  els.padValue.textContent = `${Math.round(settings.studioPad * 100)}%`;
  els.backgroundColor.value = settings.backgroundColor;
  els.gradeSelect.value = settings.grade;
  els.mirrorToggle.checked = settings.mirror;
  els.autoFrameToggle.checked = settings.autoFrame;
  els.nameplateInput.value = settings.nameplate;
  els.burnHudToggle.checked = settings.burnHud;
  els.videoAppSelect.value = settings.videoApp;
  markEffect(settings.studioEffect);
}

function bindRange(input, key, format, { after } = {}) {
  input.addEventListener("input", () => {
    const value = Number(input.value);
    update({ [key]: value });
    format(value);
    after?.();
  });
}

function bindToggle(input, key, after) {
  input.addEventListener("change", () => {
    update({ [key]: input.checked });
    after?.(input.checked);
  });
}

function wireControls() {
  bindRange(els.confidenceRange, "confidence", (value) => {
    els.confidenceValue.textContent = `${Math.round(value * 100)}%`;
  }, { after: () => sendDetectionConfig() });
  els.confidenceRange.addEventListener("change", rerunIfStill);
  bindRange(els.fpsRange, "targetFps", (value) => {
    els.fpsValue.textContent = String(value);
  });
  bindRange(els.widthRange, "processingWidth", (value) => {
    els.widthValue.textContent = `${value} px`;
  });
  bindRange(els.ghostOpacityRange, "ghostOpacity", (value) => {
    els.ghostOpacityValue.textContent = `${Math.round(value * 100)}%`;
  });
  bindRange(els.privacyBlurRange, "privacyBlur", (value) => {
    els.privacyBlurValue.textContent = `${value} px`;
  });
  bindRange(els.padRange, "studioPad", (value) => {
    els.padValue.textContent = `${Math.round(value * 100)}%`;
  });
  bindToggle(els.labelToggle, "showLabels");
  bindToggle(els.cornerBoxToggle, "cornerBoxes");
  bindToggle(els.trailToggle, "showTrails");
  bindToggle(els.glideToggle, "glide");
  bindToggle(els.ghostToggle, "ghostMode");
  bindToggle(els.heatmapToggle, "showHeatmap");
  bindToggle(els.privacyToggle, "privacyMode");
  bindToggle(els.alertSoundToggle, "alertSound", (on) => on && resumeAudio());
  bindToggle(els.spatialAudioToggle, "spatialAudio", (on) => on && resumeAudio());
  bindToggle(els.sonifyToggle, "sonify", (on) => on && resumeAudio());
  bindToggle(els.maskToggle, "useMask", (on) => {
    if (on && state.maskStatus === "failed") {
      state.maskStatus = "idle";
      delete els.maskNote.dataset.tone;
    }
    state.mask = null;
    ensureMask();
    updateStudioChips();
  });
  bindToggle(els.mirrorToggle, "mirror", () => markLook(""));
  bindToggle(els.autoFrameToggle, "autoFrame");
  bindToggle(els.burnHudToggle, "burnHud");
  els.vanishMode.addEventListener("change", () => {
    update({ vanishMode: els.vanishMode.value });
    markLook("");
    updateStudioChips();
  });
  els.backgroundColor.addEventListener("input", () => update({ backgroundColor: els.backgroundColor.value }));
  els.gradeSelect.addEventListener("change", () => {
    update({ grade: els.gradeSelect.value });
    markLook("");
  });
  els.nameplateInput.addEventListener("input", () => update({ nameplate: cleanNameplate(els.nameplateInput.value) }));
  els.videoAppSelect.addEventListener("change", () => {
    update({ videoApp: els.videoAppSelect.value });
    renderVideoAppGuide();
  });
  els.virtualCamToggle.addEventListener("change", () => setVirtualCam(els.virtualCamToggle.checked));
  els.classSearch.addEventListener("input", renderClassPicker);
  els.uploadDetect.addEventListener("change", () => {
    openImages(els.uploadDetect.files);
    els.uploadDetect.value = "";
  });

  for (const button of $$("[data-sample]")) {
    button.addEventListener("click", () => loadSample(button.dataset.sample));
  }
  for (const button of $$("[data-preset]")) {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  }
  for (const button of $$("[data-effect]")) {
    button.addEventListener("click", () => setEffect(button.dataset.effect));
  }
  for (const button of $$("[data-look]")) {
    button.addEventListener("click", () => applyLook(button.dataset.look));
  }
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-action]");
    if (trigger && !trigger.disabled) {
      runAction(trigger.dataset.action);
    }
  });

  els.engineButton.addEventListener("click", () => {
    tabs.select("detect");
    els.engineList.querySelector("input:checked")?.focus();
  });
  els.paletteButton.addEventListener("click", () => palette.open());
  els.themeButton.addEventListener("click", cycleTheme);
  els.helpButton.addEventListener("click", openHelp);

  // Zone drawing on the monitor.
  els.stage.addEventListener("pointerdown", (event) => {
    if (!state.roiDrawing || event.button !== 0) {
      return;
    }
    event.preventDefault();
    state.roiStart = pointerToNormalized(event, els.stage, state.frameSize);
    state.roiPreview = { ...state.roiStart, width: 0, height: 0 };
    els.stage.setPointerCapture(event.pointerId);
  });
  els.stage.addEventListener("pointermove", (event) => {
    if (!state.roiDrawing || !state.roiStart) {
      return;
    }
    const point = pointerToNormalized(event, els.stage, state.frameSize);
    state.roiPreview = {
      x: Math.min(state.roiStart.x, point.x),
      y: Math.min(state.roiStart.y, point.y),
      width: Math.abs(point.x - state.roiStart.x),
      height: Math.abs(point.y - state.roiStart.y),
    };
  });
  els.stage.addEventListener("pointerup", (event) => {
    if (!state.roiDrawing || !state.roiStart) {
      return;
    }
    const end = pointerToNormalized(event, els.stage, state.frameSize);
    const roi = {
      x: Math.min(state.roiStart.x, end.x),
      y: Math.min(state.roiStart.y, end.y),
      width: Math.abs(end.x - state.roiStart.x),
      height: Math.abs(end.y - state.roiStart.y),
    };
    setRoiDrawing(false);
    if (roi.width > 0.02 && roi.height > 0.02 && state.rois.length < MAX_ROIS) {
      state.rois.push(roi);
      state.roiOccupied.push(false);
      state.roiCooldown.push(0);
      state.zoneCounts.push(0);
      state.zoneAlerts.push(0);
      toast.ok(`Zone ${state.rois.length} armed`);
      checkZones(state.detections);
    } else {
      toast.show("That zone was too small. Drag a larger area.");
    }
    renderZones();
  });

  window.addEventListener("pointerdown", () => resumeAudio(), { once: true });
  window.addEventListener("pagehide", () => {
    clearStageMedia();
    serverRuntime?.disconnect();
  });
}

// ------------------------------------------------------ commands + keys ---

const ACTIONS = {
  "camera.start": () => startCamera(),
  "camera.toggle": () => toggleCamera(),
  "detect.pause": () => togglePause(),
  "capture.snapshot": () => snapshot(),
  "view.fullscreen": () => toggleFullscreen(),
  "zones.draw": () => startZoneDraw(),
  "zones.clear": () => {
    clearZones();
    toast.show("Zones cleared");
  },
  "zones.exportGallery": () => exportGallery(),
  "source.synthetic": () => startSynthetic(),
  "studio.goInvisible": () => goInvisible(),
  "studio.capturePlate": () => {
    if (!state.source) {
      toast.show("Start a source first.");
      return;
    }
    if (!studioOutputWanted()) {
      setEffect("disappear", { quiet: true });
    }
    state.capturePlate = true;
  },
  "studio.photoBooth": () => photoBooth(),
  "studio.downloadBooth": () => downloadBooth(),
  "studio.cleanFeed": () => openCleanFeed(),
  "studio.record": () => toggleRecording(),
  "history.export": () => exportHistory(),
  "history.clear": () => clearHistory(),
  "diary.save": () => {
    downloadBlob(new Blob([diaryDocument(state.diary)], { type: "text/plain" }), `scene-diary-${fileStamp()}.txt`);
    toast.ok("Diary saved");
  },
  "diary.clear": () => {
    state.diary = [];
    state.diaryLast = "";
    renderDiary();
  },
  "diary.ask": () => {
    const latest = state.diary[0]?.line;
    if (!latest) {
      toast.show("The diary is empty until something enters or leaves the frame.");
      return;
    }
    tabs.select("copilot");
    copilot.fillFrom(`The scene diary says: "${latest}". What changed, and should I do anything?`);
  },
  "copilot.ask": () => copilot.ask(),
  "copilot.clear": () => copilot.clear(),
  "copilot.forgetKey": () => copilot.forgetKey(),
  "copilot.listen": () => copilot.listen(),
};

function runAction(id) {
  const action = ACTIONS[id];
  if (action) {
    Promise.resolve(action()).catch((error) => toast.error(error?.message || "That did not work."));
  }
}

function commandList() {
  const hasSource = () => Boolean(state.source);
  const commands = [
    { id: "camera.start", group: "Source", title: "Start camera", keys: [], enabled: () => state.source?.kind !== "camera" },
    { id: "camera.toggle", group: "Source", title: "Stop or close the source", enabled: hasSource },
    ...Object.entries(SAMPLE_SCENES).map(([id, scene]) => ({ id: `sample.${id}`, group: "Source", title: `Open the ${scene.label.toLowerCase()}`, run: () => loadSample(id) })),
    { id: "source.synthetic", group: "Source", title: "Synthetic test feed" },
    { id: "source.open", group: "Source", title: "Open image files", run: () => els.uploadDetect.click() },
    { id: "detect.pause", group: "Detect", title: "Pause or resume detection", keys: ["Space"], enabled: isLive },
    { id: "capture.snapshot", group: "Detect", title: "Save a snapshot", keys: ["S"], enabled: hasSource },
    ...ENGINES.map((engine) => ({
      id: `engine.${engine.id}`,
      group: "Engine",
      title: `Use ${engine.label}`,
      enabled: () => engine.id !== "server" || yoloAvailable(),
      run: () => selectEngine(engine.id, { user: true }),
    })),
    ...Object.keys(CLASS_PRESETS).map((name) => ({ id: `preset.${name}`, group: "Classes", title: `Detect ${name === "all" ? "every class" : name}`, run: () => applyPreset(name) })),
    { id: "studio.goInvisible", group: "Studio", title: "Go invisible", keys: ["D"] },
    ...["none", "portrait", "replace", "pixelate", "spotlight", "outline"].map((effect) => ({
      id: `effect.${effect}`,
      group: "Studio",
      title: effect === "none" ? "Turn the effect off" : `Effect: ${$(`[data-effect="${effect}"]`)?.textContent || effect}`,
      run: () => setEffect(effect),
    })),
    ...Object.keys(LOOKS).map((name) => ({ id: `look.${name}`, group: "Studio", title: `Look: ${name[0].toUpperCase()}${name.slice(1)}`, run: () => applyLook(name) })),
    { id: "studio.capturePlate", group: "Studio", title: "Capture the background", keys: ["B"], enabled: hasSource },
    { id: "studio.mirror", group: "Studio", title: "Mirror the picture", keys: ["M"], run: toggleMirror },
    { id: "studio.photoBooth", group: "Studio", title: "Take four photos", keys: ["P"], enabled: hasSource },
    { id: "studio.cleanFeed", group: "Studio", title: "Open the clean feed window" },
    { id: "studio.record", group: "Studio", title: "Start or stop recording", enabled: hasSource },
    { id: "studio.virtualcam", group: "Studio", title: "Send to the virtual camera", enabled: () => state.serverAvailable, run: () => setVirtualCam(!state.virtualCamOn) },
    { id: "zones.draw", group: "Zones", title: "Draw a zone", keys: ["Z"], enabled: hasSource },
    { id: "zones.clear", group: "Zones", title: "Clear all zones", enabled: () => state.rois.length > 0 },
    { id: "history.export", group: "Session", title: "Save history as JSON", enabled: () => state.history.length > 0 },
    { id: "diary.save", group: "Session", title: "Save the scene diary" },
    { id: "view.fullscreen", group: "View", title: "Fullscreen monitor", keys: ["F"] },
    { id: "view.theme", group: "View", title: "Change the theme", run: cycleTheme },
    { id: "view.help", group: "View", title: "Keyboard shortcuts", keys: ["?"], run: openHelp },
    ...["detect", "studio", "zones", "session", "copilot"].map((tab, index) => ({
      id: `tab.${tab}`,
      group: "Panels",
      title: `Show ${tab[0].toUpperCase()}${tab.slice(1)}`,
      keys: [String(index + 1)],
      run: () => tabs.select(tab),
    })),
    { id: "copilot.ask", group: "Copilot", title: "Ask the copilot", keys: ["⌘", "↩"] },
    { id: "copilot.clear", group: "Copilot", title: "Clear the copilot thread" },
  ];
  return commands.map((command) => ({ ...command, run: command.run || (() => runAction(command.id)) }));
}

function toggleMirror() {
  update({ mirror: !settings.mirror });
  els.mirrorToggle.checked = settings.mirror;
  markLook("");
  toast.show(settings.mirror ? "Mirror on" : "Mirror off");
}

function openHelp() {
  renderShortcutSheet(els.shortcutList, [
    { keys: ["⌘", "K"], title: "Command palette" },
    { keys: ["Space"], title: "Pause or resume detection" },
    { keys: ["S"], title: "Save a snapshot" },
    { keys: ["F"], title: "Fullscreen monitor" },
    { keys: ["Z"], title: "Draw a zone (Esc cancels)" },
    { keys: ["D"], title: "Invisible on or off" },
    { keys: ["B"], title: "Capture the background" },
    { keys: ["P"], title: "Photo booth" },
    { keys: ["M"], title: "Mirror the picture" },
    { keys: ["1", "–", "5"], title: "Switch panels" },
    { keys: ["⌘", "↩"], title: "Ask the copilot" },
    { keys: ["?"], title: "This sheet" },
  ]);
  if (!els.helpDialog.open) {
    els.helpDialog.showModal();
  }
}

function wireKeys() {
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.isOpen) {
        palette.close();
      } else {
        palette.open();
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target) || els.paletteDialog.open) {
      return;
    }
    const key = event.key;
    const tabKeys = { 1: "detect", 2: "studio", 3: "zones", 4: "session", 5: "copilot" };
    if (key === " " && event.target.closest?.("button, [role=tab], a, summary, label")) {
      return;
    }
    if (key === " ") {
      event.preventDefault();
      togglePause();
    } else if (key === "Escape") {
      if (state.roiDrawing) {
        setRoiDrawing(false);
        renderZones();
        toast.show("Zone drawing cancelled");
      }
    } else if (tabKeys[key]) {
      tabs.select(tabKeys[key]);
    } else if (key === "?") {
      event.preventDefault();
      openHelp();
    } else {
      const lower = key.toLowerCase();
      const map = {
        s: () => snapshot(),
        f: () => toggleFullscreen(),
        z: () => startZoneDraw(),
        d: () => setEffect(settings.studioEffect === "disappear" ? "none" : "disappear"),
        b: () => runAction("studio.capturePlate"),
        p: () => photoBooth(),
        m: () => toggleMirror(),
      };
      if (map[lower]) {
        event.preventDefault();
        map[lower]();
      }
    }
  });
}

// ------------------------------------------------------------------ boot ---

const tabs = createTabs($(".tabs"), {
  onChange(id) {
    update({ tab: id });
    if (id === "session") {
      requestAnimationFrame(renderCharts);
    }
    if (id === "copilot") {
      copilot.renderThread();
    }
  },
});

const palette = createCommandPalette({
  dialog: els.paletteDialog,
  input: els.paletteInput,
  list: els.paletteList,
  getCommands: commandList,
});

const copilot = createCopilot({
  els,
  storage,
  apiUrl,
  toast,
  serverAvailable: () => state.serverAvailable,
  getSceneSummary: () => {
    const entries = Object.entries(countLabels(state.detections));
    return entries.length ? entries.map(([label, count]) => `${count} ${label}`).join(", ") : "nothing detected";
  },
  getFrameDataUrl: () => {
    const picture = !els.studioCanvas.hidden ? els.studioCanvas : currentSource();
    if (!picture) {
      return null;
    }
    const size = sourceSize(picture);
    const width = Math.min(1024, size.width);
    const height = Math.round(width * (size.height / size.width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(picture, 0, 0, width, height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length * 0.75 < MAX_IMAGE_BYTES) {
        return url;
      }
    }
    return null;
  },
});

async function boot() {
  if (new URLSearchParams(location.search).has("debug")) {
    window.__rtd = { state, segmenter, glide, get settings() { return settings; } };
  }
  applyTheme(loadTheme(storage));
  els.videoAppSelect.replaceChildren(...VIDEO_APPS.map((app) => h("option", { value: app.id }, app.name)));
  syncControls();
  renderClassPicker();
  renderVideoAppGuide();
  renderZones();
  renderDiary();
  tabs.select(settings.tab, { silent: true });
  wireControls();
  wireKeys();
  updateTally();
  syncTransport();
  state.engineId = resolveEngine(settings.engine);
  renderEngineList();
  updateEngineUi();
  requestAnimationFrame(renderLoop);

  const health = await probeHealth();
  if (health) {
    state.serverAvailable = true;
    const model = health.model || {};
    state.yoloStatus = model.error ? "error" : model.mock ? "mock" : model.loaded ? "ready" : "loading";
    state.yoloError = model.error || "";
    if (!health.features?.virtualcam) {
      els.virtualCamStatus.textContent = "The local server is running. Install OBS and requirements-virtualcam.txt for a camera device; the MJPEG feed works now.";
    }
    copilot.loadCatalog();
  }
  state.engineId = resolveEngine(settings.engine);
  renderEngineList();
  updateEngineUi();
  copilot.renderThread();
  els.lastUpdated.textContent = `Ready, v${VERSION}`;

  // ?sample=desk|kitchen|street opens a sample straight away (shareable demo links).
  const sample = new URLSearchParams(location.search).get("sample");
  if (sample && SAMPLE_SCENES[sample]) {
    loadSample(sample);
  }
}

boot();
