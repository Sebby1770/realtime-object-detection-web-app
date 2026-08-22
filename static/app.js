import {
  detectBrowser,
  COCO_CLASSES,
  getBrowserSession,
  isBrowserModelReady,
  loadBrowserModel,
  recordBrowserRoiAlert,
  resetBrowserSession,
} from "./runtime-browser.js";
import { createServerRuntime } from "./runtime-server.js";
import {
  colorForLabel,
  drawDensityChart,
  drawHeatmap,
  drawLatencyChart,
  drawOverlay,
  drawProximityRadar,
  letterbox,
  pointInRoi,
  pointerToNormalized,
  snapshotComposite,
  updateHeatmap,
} from "./overlay.js";
import {
  playAlertTone,
  playSpatialPing,
  prefersReducedMotion,
  resumeAudio,
  sonifyDetections,
} from "./audio.js";

const APP_VERSION = "2.0.0";
const ROI_COOLDOWN_MS = 1200;
const CAMERA_TIMEOUT_MS = 8000;
const MAX_ROIS = 3;
const SETTINGS_KEY = "object-detection-settings";
const THEME_KEY = "object-detection-theme";
const PRIVACY_LABELS = new Set(["person"]);

const elements = {
  video: document.querySelector("#video"),
  overlay: document.querySelector("#overlay"),
  heatmap: document.querySelector("#heatmap"),
  captureCanvas: document.querySelector("#captureCanvas"),
  videoStage: document.querySelector("#videoStage"),
  emptyState: document.querySelector("#emptyState"),
  startCamera: document.querySelector("#startCamera"),
  startCameraSide: document.querySelector("#startCameraSide"),
  stopCamera: document.querySelector("#stopCamera"),
  connectionStatus: document.querySelector("#connectionStatus"),
  fpsRange: document.querySelector("#fpsRange"),
  fpsValue: document.querySelector("#fpsValue"),
  widthRange: document.querySelector("#widthRange"),
  widthValue: document.querySelector("#widthValue"),
  labelToggle: document.querySelector("#labelToggle"),
  objectCount: document.querySelector("#objectCount"),
  latency: document.querySelector("#latency"),
  streamFps: document.querySelector("#streamFps"),
  detectionList: document.querySelector("#detectionList"),
  lastUpdated: document.querySelector("#lastUpdated"),
  confidenceRange: document.querySelector("#confidenceRange"),
  confidenceValue: document.querySelector("#confidenceValue"),
  classSearch: document.querySelector("#classSearch"),
  classChipList: document.querySelector("#classChipList"),
  snapshotButton: document.querySelector("#snapshotButton"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  historyList: document.querySelector("#historyList"),
  historyCount: document.querySelector("#historyCount"),
  modelName: document.querySelector("#modelName"),
  heatmapToggle: document.querySelector("#heatmapToggle"),
  classChips: document.querySelector("#classChips"),
  latencyChart: document.querySelector("#latencyChart"),
  latencyAvg: document.querySelector("#latencyAvg"),
  exportHistoryButton: document.querySelector("#exportHistoryButton"),
  cornerBoxToggle: document.querySelector("#cornerBoxToggle"),
  uploadDetect: document.querySelector("#uploadDetect"),
  uploadDetectStatus: document.querySelector("#uploadDetectStatus"),
  roiDrawButton: document.querySelector("#roiDrawButton"),
  roiClearButton: document.querySelector("#roiClearButton"),
  roiStatus: document.querySelector("#roiStatus"),
  pauseButton: document.querySelector("#pauseButton"),
  trailToggle: document.querySelector("#trailToggle"),
  alertSoundToggle: document.querySelector("#alertSoundToggle"),
  themeToggle: document.querySelector("#themeToggle"),
  privacyToggle: document.querySelector("#privacyToggle"),
  privacyNote: document.querySelector("#privacyNote"),
  sonifyToggle: document.querySelector("#sonifyToggle"),
  ghostToggle: document.querySelector("#ghostToggle"),
  spatialAudioToggle: document.querySelector("#spatialAudioToggle"),
  alertFilmstrip: document.querySelector("#alertFilmstrip"),
  filmstripCount: document.querySelector("#filmstripCount"),
  exportFilmstrip: document.querySelector("#exportFilmstrip"),
  densityChart: document.querySelector("#densityChart"),
  densityAvg: document.querySelector("#densityAvg"),
  proximityRadar: document.querySelector("#proximityRadar"),
  radarCount: document.querySelector("#radarCount"),
  privacyBlurRange: document.querySelector("#privacyBlurRange"),
  privacyBlurValue: document.querySelector("#privacyBlurValue"),
  ghostOpacityRange: document.querySelector("#ghostOpacityRange"),
  ghostOpacityValue: document.querySelector("#ghostOpacityValue"),
  sessionFrames: document.querySelector("#sessionFrames"),
  sessionDetections: document.querySelector("#sessionDetections"),
  sessionClasses: document.querySelector("#sessionClasses"),
  roiAlerts: document.querySelector("#roiAlerts"),
  modeServer: document.querySelector("#modeServer"),
  modeBrowser: document.querySelector("#modeBrowser"),
  modeChip: document.querySelector("#modeChip"),
  demoBadge: document.querySelector("#demoBadge"),
  hudStats: document.querySelector("#hudStats"),
  hudState: document.querySelector("#hudState"),
  eyebrow: document.querySelector("#eyebrow"),
};

const state = {
  mode: "browser",
  serverAvailable: false,
  stream: null,
  demoCanvas: null,
  demoTimer: null,
  demoMode: false,
  stillCanvas: null,
  stillMode: false,
  stillDirty: false,
  running: false,
  inFlight: false,
  targetFps: Number(elements.fpsRange.value),
  processingWidth: Number(elements.widthRange.value),
  showLabels: true,
  detections: [],
  frameSize: { width: 640, height: 360 },
  sentFrames: 0,
  fpsStartedAt: performance.now(),
  confidence: Number(elements.confidenceRange.value),
  selectedClasses: [],
  classQuery: "",
  history: [],
  modelClasses: [...COCO_CLASSES],
  classCounts: {},
  latencySamples: [],
  showHeatmap: true,
  heatmapCells: Array.from({ length: 16 * 9 }, () => 0),
  cornerBoxes: false,
  showTrails: true,
  alertSound: true,
  paused: false,
  rois: [],
  roiDrawing: false,
  roiStart: null,
  roiPreview: null,
  roiOccupied: [],
  roiCooldown: [],
  privacyMode: false,
  sonify: false,
  ghostMode: true,
  spatialAudio: true,
  privacyBlur: 14,
  ghostOpacity: 0.28,
  ghostDetections: [],
  filmstrip: [],
  densitySamples: [],
  session: {
    frames_processed: 0,
    detections_total: 0,
    classes_seen: [],
    roi_alerts: 0,
  },
};

let serverRuntime = null;
let lastFitted = null;

function apiUrl(path) {
  return new URL(path, document.baseURI).toString();
}

function clampConfidence(value) {
  return Math.min(0.95, Math.max(0.05, Number(value) || 0.35));
}

function reducedMotion() {
  return prefersReducedMotion();
}

function setConnectionStatus(label, online = false) {
  elements.connectionStatus.classList.toggle("online", Boolean(online));
  elements.connectionStatus.querySelector("[data-status-label]").textContent = label;
}

function modeLabel(mode = state.mode) {
  return mode === "server" ? "YOLOv8 · server" : "COCO-SSD · in-browser";
}

function updateModeUi() {
  const server = state.mode === "server";
  elements.modeServer.setAttribute("aria-pressed", server ? "true" : "false");
  elements.modeBrowser.setAttribute("aria-pressed", server ? "false" : "true");
  elements.modeChip.textContent = modeLabel();
  elements.eyebrow.textContent = server ? "Local YOLOv8 console" : "On-device vision console";
  elements.modelName.textContent = server ? "YOLOv8n" : "coco-ssd";
  elements.privacyNote.textContent = server
    ? "Overlay only — frames still go to the local model. Person boxes are blurred on the capture canvas before JPEG encode."
    : "On-device, frames stay in this tab.";
  if (elements.hudState && !state.running) {
    elements.hudState.textContent = "Idle";
  }
}

function setDrawing(active) {
  state.roiDrawing = active;
  elements.videoStage.classList.toggle("is-drawing", active);
  elements.overlay.classList.toggle("is-drawing", active);
  if (!active) {
    state.roiStart = null;
    state.roiPreview = null;
  }
}

function currentSource() {
  if (state.stillCanvas) {
    return state.stillCanvas;
  }
  if (state.demoMode) {
    return state.demoCanvas;
  }
  return elements.video;
}

function sourceSize(source) {
  return {
    width: source?.videoWidth || source?.width || state.frameSize.width,
    height: source?.videoHeight || source?.height || state.frameSize.height,
  };
}

function syncStageAspect(width, height) {
  if (width > 0 && height > 0) {
    elements.videoStage.style.aspectRatio = `${width} / ${height}`;
  }
}

function setDemoBadge(visible) {
  elements.demoBadge.classList.toggle("hidden", !visible);
  if (visible) {
    elements.hudState.textContent = "Demo";
  }
}

async function requestCameraStream() {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    return { stream: null, reason: "camera API unavailable" };
  }

  let timedOut = false;
  const request = mediaDevices
    .getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    })
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
    return {
      stream,
      reason: stream ? "" : "camera permission timed out",
    };
  } catch (error) {
    return {
      stream: null,
      reason: error?.message || "camera unavailable",
    };
  }
}

function drawDemoFrame(canvas) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const now = performance.now() / 1000;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#071111");
  gradient.addColorStop(0.55, "#102724");
  gradient.addColorStop(1, "#201313");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const orbX = width * (0.5 + Math.sin(now * 0.8) * 0.22);
  const orbY = height * (0.45 + Math.cos(now * 0.7) * 0.18);
  context.fillStyle = "#38d6c6";
  context.beginPath();
  context.arc(orbX, orbY, 56, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ff6f59";
  context.fillRect(width * 0.18, height * 0.58, 170, 108);
  context.fillStyle = "#f5c84b";
  context.fillRect(width * 0.68, height * 0.22, 120, 150);

  context.fillStyle = "rgba(245, 241, 232, 0.92)";
  context.font = "700 32px ui-sans-serif, system-ui, sans-serif";
  context.fillText("Demo video feed", 42, 66);
  context.font = "500 18px ui-sans-serif, system-ui, sans-serif";
  context.fillText("Camera fallback is active", 42, 98);
}

function clearStageMedia() {
  if (state.demoTimer) {
    window.clearInterval(state.demoTimer);
    state.demoTimer = null;
  }
  if (state.demoCanvas) {
    state.demoCanvas.remove();
    state.demoCanvas = null;
  }
  if (state.stillCanvas) {
    state.stillCanvas.remove();
    state.stillCanvas = null;
  }
  state.demoMode = false;
  state.stillMode = false;
  state.stillDirty = false;
  elements.video.style.display = "";
  setDemoBadge(false);
}

function createDemoStream() {
  clearStageMedia();
  const canvas = document.createElement("canvas");
  canvas.className = "demo-feed";
  canvas.width = 960;
  canvas.height = 540;
  canvas.setAttribute("aria-label", "Demo video feed");
  elements.videoStage.insertBefore(canvas, elements.heatmap);
  elements.video.style.display = "none";
  drawDemoFrame(canvas);
  state.demoTimer = window.setInterval(() => drawDemoFrame(canvas), 1000 / 12);
  state.demoCanvas = canvas;
  state.demoMode = true;
  setDemoBadge(true);
  elements.lastUpdated.textContent = "Demo stream active";
  if (typeof canvas.captureStream === "function") {
    return canvas.captureStream(12);
  }
  return null;
}

function showStillImage(image) {
  clearStageMedia();
  const canvas = document.createElement("canvas");
  canvas.className = "still-frame";
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  canvas.setAttribute("aria-label", "Uploaded still image");
  elements.videoStage.insertBefore(canvas, elements.heatmap);
  elements.video.style.display = "none";
  state.stillCanvas = canvas;
  state.stillMode = true;
  state.stillDirty = true;
  state.frameSize = { width: canvas.width, height: canvas.height };
  syncStageAspect(canvas.width, canvas.height);
  elements.emptyState.classList.add("hidden");
  elements.snapshotButton.disabled = false;
  elements.clearHistoryButton.disabled = false;
  elements.exportHistoryButton.disabled = false;
  elements.roiDrawButton.disabled = false;
  elements.roiClearButton.disabled = false;
  elements.pauseButton.disabled = false;
  setDemoBadge(false);
  elements.hudState.textContent = "Still";
}

function cloakPersons(canvas, detections, frameSize) {
  if (!state.privacyMode || state.mode !== "server" || !detections?.length) {
    return;
  }
  const context = canvas.getContext("2d");
  const scaleX = canvas.width / Math.max(1, frameSize.width);
  const scaleY = canvas.height / Math.max(1, frameSize.height);
  const radius = Math.max(6, state.privacyBlur);
  for (const detection of detections) {
    if (!PRIVACY_LABELS.has(detection.label)) {
      continue;
    }
    const x = Math.max(0, detection.box.x * scaleX);
    const y = Math.max(0, detection.box.y * scaleY);
    const width = Math.max(1, detection.box.width * scaleX);
    const height = Math.max(1, detection.box.height * scaleY);
    const tmp = document.createElement("canvas");
    tmp.width = Math.max(1, Math.round(width));
    tmp.height = Math.max(1, Math.round(height));
    const tmpContext = tmp.getContext("2d");
    tmpContext.filter = `blur(${radius}px)`;
    tmpContext.drawImage(canvas, x, y, width, height, 0, 0, tmp.width, tmp.height);
    context.drawImage(tmp, x, y, width, height);
  }
}

function grabFrame() {
  const source = currentSource();
  if (!source) {
    return null;
  }
  const size = sourceSize(source);
  if (!size.width || !size.height) {
    return null;
  }
  if (!state.demoMode && !state.stillMode && elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }
  const width = Math.min(state.processingWidth, size.width);
  const height = Math.round(width * (size.height / size.width));
  const canvas = elements.captureCanvas;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0, width, height);
  cloakPersons(canvas, state.detections, state.frameSize);
  return canvas;
}

function applyDetections(payload) {
  if (!payload || payload.type !== "detections") {
    return;
  }
  if (state.ghostMode && !reducedMotion() && state.detections.length) {
    state.ghostDetections = state.detections.map((item) => ({
      ...item,
      box: { ...item.box },
    }));
  } else {
    state.ghostDetections = [];
  }
  state.detections = payload.detections ?? [];
  state.classCounts = payload.class_counts ?? {};
  state.frameSize = {
    width: payload.frame_width || 1,
    height: payload.frame_height || 1,
  };
  if (!reducedMotion()) {
    sonifyDetections(state.detections, { enabled: state.sonify, chord: true });
  }
  recordDensity(state.detections.length);
  recordHistory(payload);
  updateHeatmap(state.heatmapCells, state.detections, state.frameSize);
  recordLatency(payload.latency_ms);
  renderClassCounts();
  updateSessionStats(payload.session);
  checkRoiAlerts(state.detections);
  elements.objectCount.textContent = String(state.detections.length);
  elements.latency.textContent = `${payload.latency_ms ?? "--"} ms`;
  elements.lastUpdated.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (elements.hudStats) {
    elements.hudStats.textContent = `${state.detections.length} obj · ${payload.latency_ms ?? "--"} ms`;
  }
  renderDetectionList();
}

function ensureServerRuntime() {
  if (serverRuntime) {
    return serverRuntime;
  }
  serverRuntime = createServerRuntime({
    onStatus: setConnectionStatus,
    onOpen() {
      sendDetectionConfig();
    },
    onNotice(message) {
      elements.lastUpdated.textContent = message;
    },
    onDetections: applyDetections,
    onRoiAck(payload) {
      if (typeof payload.roi_alerts === "number") {
        state.session.roi_alerts = payload.roi_alerts;
        elements.roiAlerts.textContent = String(payload.roi_alerts);
      }
    },
  });
  return serverRuntime;
}

function sendDetectionConfig() {
  if (state.mode !== "server") {
    return;
  }
  ensureServerRuntime().sendConfig({
    confidence: state.confidence,
    classes: state.selectedClasses,
  });
}

async function probeHealth() {
  try {
    const response = await fetch(apiUrl("health"), { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    return payload.status === "ok";
  } catch {
    return false;
  }
}

async function loadModelMetadata() {
  if (state.mode === "browser") {
    elements.modelName.textContent = "coco-ssd";
    state.modelClasses = [...COCO_CLASSES];
    renderClassChipPicker();
    return;
  }
  try {
    const response = await fetch(apiUrl("api/model"), { cache: "no-store" });
    const payload = await response.json();
    elements.modelName.textContent = payload.model || "YOLOv8n";
    state.modelClasses = payload.classes?.length ? payload.classes : [...COCO_CLASSES];
  } catch {
    elements.modelName.textContent = "YOLOv8n";
    state.modelClasses = [...COCO_CLASSES];
  }
  renderClassChipPicker();
}

async function setMode(nextMode, { user = false } = {}) {
  if (nextMode !== "server" && nextMode !== "browser") {
    return;
  }
  if (nextMode === "server" && !state.serverAvailable && user) {
    elements.lastUpdated.textContent = "No FastAPI server at this origin.";
  }
  const changed = state.mode !== nextMode;
  state.mode = nextMode;
  updateModeUi();
  if (!changed && !user) {
    await loadModelMetadata();
    return;
  }
  if (serverRuntime && nextMode !== "server") {
    serverRuntime.disconnect();
  }
  await loadModelMetadata();
  if (state.running) {
    if (nextMode === "server") {
      ensureServerRuntime().connect();
      setConnectionStatus("Connecting", false);
    } else {
      setConnectionStatus("On-device", true);
      try {
        await loadBrowserModel((message) => {
          elements.lastUpdated.textContent = message;
        });
        elements.lastUpdated.textContent = "COCO-SSD ready";
      } catch (error) {
        elements.lastUpdated.textContent = error.message || "Failed to load COCO-SSD";
      }
    }
  } else if (nextMode === "browser") {
    setConnectionStatus("On-device", false);
  } else {
    setConnectionStatus(state.serverAvailable ? "Ready" : "Offline", false);
  }
}

async function startCamera() {
  if (state.running) {
    return;
  }
  await resumeAudio();
  clearStageMedia();

  const camera = await requestCameraStream();
  state.stream = camera.stream || createDemoStream();
  if (camera.stream) {
    elements.video.srcObject = state.stream;
    await elements.video.play().catch(() => {});
    setDemoBadge(false);
  }

  const source = currentSource();
  const size = sourceSize(source);
  syncStageAspect(size.width, size.height);

  state.running = true;
  state.paused = false;
  elements.pauseButton.textContent = "Pause";
  elements.emptyState.classList.add("hidden");
  elements.startCameraSide.disabled = true;
  elements.stopCamera.disabled = false;
  elements.snapshotButton.disabled = false;
  elements.clearHistoryButton.disabled = false;
  elements.exportHistoryButton.disabled = false;
  elements.roiDrawButton.disabled = false;
  elements.roiClearButton.disabled = false;
  elements.pauseButton.disabled = false;
  if (!state.demoMode) {
    elements.lastUpdated.textContent = "Camera connected";
    elements.hudState.textContent = "Live";
  }

  if (state.mode === "server") {
    ensureServerRuntime().connect();
  } else {
    setConnectionStatus("On-device", true);
    try {
      await loadBrowserModel((message) => {
        elements.lastUpdated.textContent = message;
      });
      elements.lastUpdated.textContent = state.demoMode ? "Demo stream active" : "COCO-SSD ready";
    } catch (error) {
      elements.lastUpdated.textContent = error.message || "Failed to load COCO-SSD";
    }
  }
  captureLoop();
}

function stopCamera() {
  state.running = false;
  state.inFlight = false;
  state.paused = false;
  setDrawing(false);
  if (serverRuntime) {
    serverRuntime.disconnect();
  }
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  elements.video.srcObject = null;
  clearStageMedia();
  resetBrowserSession();
  state.detections = [];
  state.ghostDetections = [];
  renderDetectionList();
  elements.objectCount.textContent = "0";
  elements.latency.textContent = "--";
  elements.streamFps.textContent = "--";
  elements.lastUpdated.textContent = "Idle";
  elements.hudState.textContent = "Idle";
  if (elements.hudStats) {
    elements.hudStats.textContent = "0 obj · -- ms";
  }
  elements.emptyState.classList.remove("hidden");
  elements.startCameraSide.disabled = false;
  elements.stopCamera.disabled = true;
  elements.snapshotButton.disabled = true;
  elements.clearHistoryButton.disabled = true;
  elements.exportHistoryButton.disabled = true;
  elements.roiDrawButton.disabled = true;
  elements.roiClearButton.disabled = true;
  elements.pauseButton.disabled = true;
  elements.pauseButton.textContent = "Pause";
  if (state.mode === "browser") {
    setConnectionStatus("On-device", false);
  } else {
    setConnectionStatus("Offline", false);
  }
}

function updateSessionStats(session) {
  if (!session) {
    return;
  }
  const roiAlerts = Math.max(state.session.roi_alerts || 0, session.roi_alerts || 0);
  state.session = { ...session, roi_alerts: roiAlerts };
  elements.sessionFrames.textContent = String(session.frames_processed ?? 0);
  elements.sessionDetections.textContent = String(session.detections_total ?? 0);
  elements.sessionClasses.textContent = String(session.classes_seen?.length ?? 0);
  elements.roiAlerts.textContent = String(state.session.roi_alerts ?? 0);
}

function recordRoiAlert(detection, zoneIndex) {
  state.session.roi_alerts = (state.session.roi_alerts || 0) + 1;
  elements.roiAlerts.textContent = String(state.session.roi_alerts);
  elements.roiStatus.textContent = `Alert: ${detection.label} entered zone ${zoneIndex + 1}`;
  if (!reducedMotion()) {
    if (state.alertSound) {
      playAlertTone();
    }
    playSpatialPing(detection, state.frameSize.width, { enabled: state.spatialAudio });
  }
  captureFilmstripFrame(detection.label);
  if (state.mode === "server") {
    ensureServerRuntime().sendRoiAlert();
  } else {
    recordBrowserRoiAlert();
    const session = getBrowserSession();
    state.session.roi_alerts = session.roi_alerts;
    elements.roiAlerts.textContent = String(session.roi_alerts);
  }
}

function checkRoiAlerts(detections) {
  if (!state.rois.length) {
    return;
  }
  const now = performance.now();
  const occupied = state.rois.map(() => []);
  for (const detection of detections) {
    const box = detection.box;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    state.rois.forEach((roi, index) => {
      if (pointInRoi(centerX, centerY, roi, state.frameSize.width, state.frameSize.height)) {
        occupied[index].push(detection);
      }
    });
  }
  occupied.forEach((inside, index) => {
    const wasInside = Boolean(state.roiOccupied[index]);
    const isInside = inside.length > 0;
    const lastAlert = state.roiCooldown[index] || 0;
    if (isInside && !wasInside && now - lastAlert >= ROI_COOLDOWN_MS) {
      state.roiCooldown[index] = now;
      recordRoiAlert(inside[0], index);
    }
    state.roiOccupied[index] = isInside;
  });
}

function togglePause() {
  if (!state.running && !state.stillMode) {
    return;
  }
  state.paused = !state.paused;
  elements.pauseButton.textContent = state.paused ? "Resume" : "Pause";
  elements.lastUpdated.textContent = state.paused ? "Detection paused" : "Running";
  elements.hudState.textContent = state.paused ? "Paused" : state.demoMode ? "Demo" : state.stillMode ? "Still" : "Live";
}

function applyTheme(light) {
  document.documentElement.dataset.theme = light ? "light" : "dark";
  elements.themeToggle.checked = light;
  localStorage.setItem(THEME_KEY, light ? "light" : "dark");
}

function loadTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) === "light");
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    image.src = url;
  });
}

async function rerunStillDetection() {
  if (!state.stillCanvas || state.paused) {
    return;
  }
  if (state.mode === "browser") {
    try {
      const payload = await detectBrowser(state.stillCanvas, {
        confidence: state.confidence,
        classes: state.selectedClasses,
      });
      applyDetections(payload);
      state.stillDirty = false;
    } catch (error) {
      elements.lastUpdated.textContent = error.message || "On-device detection failed";
    }
    return;
  }
  await new Promise((resolve) => {
    state.stillCanvas.toBlob(async (blob) => {
      try {
        if (!blob) {
          return;
        }
        const form = new FormData();
        form.append("image", blob, "still.jpg");
        const response = await fetch(apiUrl(`api/detect?confidence=${state.confidence}`), {
          method: "POST",
          body: form,
        });
        const payload = await response.json();
        if (response.ok) {
          applyDetections(payload);
          state.stillDirty = false;
        } else {
          elements.lastUpdated.textContent = payload.detail || "Still-image detection failed.";
        }
      } finally {
        resolve();
      }
    }, "image/jpeg", 0.92);
  });
}

async function detectUploadedImages(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) {
    return;
  }
  await resumeAudio();
  const first = files[0];
  try {
    const image = await fileToImage(first);
    showStillImage(image);
  } catch {
    elements.uploadDetectStatus.textContent = "Could not display the uploaded image.";
    return;
  }

  if (state.mode === "browser") {
    elements.uploadDetectStatus.textContent = files.length === 1 ? "Detecting on-device…" : `Detecting ${files.length} images on-device…`;
    try {
      await loadBrowserModel();
      let total = 0;
      let firstPayload = null;
      for (const file of files) {
        const image = file === first ? state.stillCanvas : await fileToImage(file);
        const payload = await detectBrowser(image, {
          confidence: state.confidence,
          classes: state.selectedClasses,
        });
        total += payload.detections.length;
        if (!firstPayload) {
          firstPayload = payload;
        }
      }
      if (firstPayload) {
        applyDetections(firstPayload);
      }
      elements.uploadDetectStatus.textContent =
        files.length === 1
          ? `Detected ${state.detections.length} object(s) in ${first.name}.`
          : `Batch complete: ${total} detections across ${files.length} image(s).`;
      state.stillDirty = false;
    } catch {
      elements.uploadDetectStatus.textContent = "On-device upload detection failed.";
    }
    return;
  }

  if (files.length === 1) {
    const form = new FormData();
    form.append("image", files[0]);
    elements.uploadDetectStatus.textContent = "Detecting…";
    try {
      const response = await fetch(apiUrl(`api/detect?confidence=${state.confidence}`), {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) {
        elements.uploadDetectStatus.textContent = payload.detail || "Upload detection failed.";
        return;
      }
      applyDetections(payload);
      elements.uploadDetectStatus.textContent = `Detected ${state.detections.length} object(s) in ${files[0].name}.`;
    } catch {
      elements.uploadDetectStatus.textContent = "Upload detection failed.";
    }
    return;
  }

  const form = new FormData();
  files.forEach((file) => form.append("images", file));
  elements.uploadDetectStatus.textContent = `Detecting ${files.length} images…`;
  try {
    const response = await fetch(apiUrl(`api/detect/batch?confidence=${state.confidence}`), {
      method: "POST",
      body: form,
    });
    const payload = await response.json();
    if (!response.ok) {
      elements.uploadDetectStatus.textContent = payload.detail || "Batch upload detection failed.";
      return;
    }
    const results = payload.results ?? [];
    const total = results.reduce((sum, item) => sum + (item.detections?.length ?? 0), 0);
    if (results[0]) {
      applyDetections(results[0]);
    }
    elements.uploadDetectStatus.textContent = `Batch complete: ${total} detections across ${results.length} image(s).`;
  } catch {
    elements.uploadDetectStatus.textContent = "Batch upload detection failed.";
  }
}

function recordLatency(value) {
  if (typeof value !== "number") {
    return;
  }
  state.latencySamples = [...state.latencySamples, value].slice(-24);
  const average = state.latencySamples.reduce((sum, item) => sum + item, 0) / state.latencySamples.length;
  elements.latencyAvg.textContent = `${Math.round(average)} ms avg`;
  drawLatencyChart(elements.latencyChart, state.latencySamples);
}

function recordDensity(count) {
  state.densitySamples = [...state.densitySamples, count].slice(-24);
  const average = state.densitySamples.reduce((sum, item) => sum + item, 0) / state.densitySamples.length;
  elements.densityAvg.textContent = `${average.toFixed(1)} avg`;
  drawDensityChart(elements.densityChart, state.densitySamples);
}

function renderClassCounts() {
  const entries = Object.entries(state.classCounts).sort((a, b) => b[1] - a[1]);
  elements.classChips.replaceChildren(
    ...entries.map(([label, count]) => {
      const chip = document.createElement("span");
      chip.className = "class-chip";
      chip.style.borderColor = colorForLabel(label);
      chip.textContent = `${label} ${count}`;
      return chip;
    }),
  );
}

function renderClassChipPicker() {
  const query = state.classQuery.trim().toLowerCase();
  const classes = state.modelClasses.filter((label) => !query || label.toLowerCase().includes(query));
  const selected = new Set(state.selectedClasses);
  const chips = classes.map((label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "class-chip-toggle";
    button.textContent = label;
    button.setAttribute("aria-pressed", selected.has(label) ? "true" : "false");
    button.addEventListener("click", () => {
      if (selected.has(label)) {
        state.selectedClasses = state.selectedClasses.filter((item) => item !== label);
      } else {
        state.selectedClasses = [...state.selectedClasses, label];
      }
      sendDetectionConfig();
      saveSettings();
      renderClassChipPicker();
      if (state.stillMode) {
        state.stillDirty = true;
        rerunStillDetection();
      }
    });
    return button;
  });
  elements.classChipList.replaceChildren(...chips);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function exportFilmstripGallery() {
  if (!state.filmstrip.length) {
    return;
  }
  const cards = state.filmstrip
    .map(
      (clip) => `
        <figure style="margin:0;border:1px solid #303037;border-radius:8px;overflow:hidden;">
          <img src="${clip.dataUrl}" alt="${escapeHtml(clip.label)}" style="width:100%;display:block;">
          <figcaption style="padding:8px;font:12px sans-serif;color:#a9a49a;">${escapeHtml(clip.stamp)} · ${escapeHtml(clip.label)}</figcaption>
        </figure>
      `,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ROI Alert Gallery</title></head><body style="background:#0b0b0d;color:#f5f1e8;font-family:sans-serif;padding:24px;"><h1>ROI Alert Gallery</h1><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">${cards}</div></body></html>`;
  const link = document.createElement("a");
  link.download = `roi-gallery-${Date.now()}.html`;
  link.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  link.click();
  URL.revokeObjectURL(link.href);
}

function captureFilmstripFrame(label) {
  const source = currentSource();
  if (!source || !lastFitted) {
    return;
  }
  const rect = elements.videoStage.getBoundingClientRect();
  const canvas = snapshotComposite(source, elements.overlay, rect.width, rect.height, lastFitted);
  const entry = {
    label,
    dataUrl: canvas.toDataURL("image/jpeg", 0.65),
    stamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
  state.filmstrip = [entry, ...state.filmstrip].slice(0, 8);
  renderFilmstrip();
}

function renderFilmstrip() {
  elements.filmstripCount.textContent = `${state.filmstrip.length} clips`;
  elements.exportFilmstrip.disabled = state.filmstrip.length === 0;
  elements.alertFilmstrip.replaceChildren(
    ...state.filmstrip.map((clip) => {
      const card = document.createElement("figure");
      card.className = "filmstrip-card";
      const image = document.createElement("img");
      image.src = clip.dataUrl;
      image.alt = `ROI alert ${clip.label}`;
      const caption = document.createElement("figcaption");
      caption.textContent = `${clip.stamp} · ${clip.label}`;
      card.append(image, caption);
      return card;
    }),
  );
}

function exportHistory() {
  const blob = new Blob([JSON.stringify(state.history, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.download = `detection-history-${Date.now()}.json`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      confidence: state.confidence,
      targetFps: state.targetFps,
      processingWidth: state.processingWidth,
      showLabels: state.showLabels,
      showHeatmap: state.showHeatmap,
      selectedClasses: state.selectedClasses,
      showTrails: state.showTrails,
      alertSound: state.alertSound,
      privacyMode: state.privacyMode,
      sonify: state.sonify,
      ghostMode: state.ghostMode,
      spatialAudio: state.spatialAudio,
      privacyBlur: state.privacyBlur,
      ghostOpacity: state.ghostOpacity,
      cornerBoxes: state.cornerBoxes,
    }),
  );
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (saved.confidence != null) {
      state.confidence = clampConfidence(saved.confidence);
      elements.confidenceRange.value = String(state.confidence);
      elements.confidenceValue.textContent = `${Math.round(state.confidence * 100)}%`;
    }
    if (saved.targetFps != null) {
      state.targetFps = saved.targetFps;
      elements.fpsRange.value = String(saved.targetFps);
      elements.fpsValue.textContent = `${saved.targetFps} fps`;
    }
    if (saved.processingWidth != null) {
      state.processingWidth = saved.processingWidth;
      elements.widthRange.value = String(saved.processingWidth);
      elements.widthValue.textContent = `${saved.processingWidth} px`;
    }
    if (saved.showLabels != null) {
      state.showLabels = saved.showLabels;
      elements.labelToggle.checked = saved.showLabels;
    }
    if (saved.showHeatmap != null) {
      state.showHeatmap = saved.showHeatmap;
      elements.heatmapToggle.checked = saved.showHeatmap;
    }
    if (saved.selectedClasses?.length) {
      state.selectedClasses = saved.selectedClasses;
    }
    if (saved.showTrails != null) {
      state.showTrails = saved.showTrails;
      elements.trailToggle.checked = saved.showTrails;
    }
    if (saved.alertSound != null) {
      state.alertSound = saved.alertSound;
      elements.alertSoundToggle.checked = saved.alertSound;
    }
    if (saved.privacyMode != null) {
      state.privacyMode = saved.privacyMode;
      elements.privacyToggle.checked = saved.privacyMode;
    }
    if (saved.sonify != null) {
      state.sonify = saved.sonify;
      elements.sonifyToggle.checked = saved.sonify;
    }
    if (saved.ghostMode != null) {
      state.ghostMode = saved.ghostMode;
      elements.ghostToggle.checked = saved.ghostMode;
    }
    if (saved.spatialAudio != null) {
      state.spatialAudio = saved.spatialAudio;
      elements.spatialAudioToggle.checked = saved.spatialAudio;
    }
    if (saved.privacyBlur != null) {
      state.privacyBlur = saved.privacyBlur;
      elements.privacyBlurRange.value = String(saved.privacyBlur);
      elements.privacyBlurValue.textContent = `${saved.privacyBlur}px`;
    }
    if (saved.ghostOpacity != null) {
      state.ghostOpacity = saved.ghostOpacity;
      elements.ghostOpacityRange.value = String(saved.ghostOpacity);
      elements.ghostOpacityValue.textContent = `${Math.round(saved.ghostOpacity * 100)}%`;
    }
    if (saved.cornerBoxes != null) {
      state.cornerBoxes = saved.cornerBoxes;
      elements.cornerBoxToggle.checked = saved.cornerBoxes;
    }
  } catch {
    // ignore invalid saved settings
  }
}

function recordHistory(payload) {
  if (!payload.detections?.length) {
    return;
  }
  const stamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const labels = payload.detections.map((item) => item.label).join(", ");
  state.history = [{ stamp, labels, count: payload.detections.length }, ...state.history].slice(0, 12);
  renderHistory();
}

function renderHistory() {
  elements.historyCount.textContent = `${state.history.length} events`;
  elements.historyList.replaceChildren(
    ...state.history.map((entry) => {
      const row = document.createElement("li");
      const time = document.createElement("span");
      const detail = document.createElement("span");
      time.className = "history-time";
      time.textContent = entry.stamp;
      detail.className = "history-detail";
      detail.textContent = `${entry.count} objects · ${entry.labels}`;
      row.append(time, detail);
      return row;
    }),
  );
}

function captureSnapshot() {
  const source = currentSource();
  if (!source) {
    return;
  }
  const rect = elements.videoStage.getBoundingClientRect();
  const fitted =
    lastFitted ||
    letterbox(rect.width, rect.height, state.frameSize.width || 1, state.frameSize.height || 1);
  const canvas = snapshotComposite(source, elements.overlay, rect.width, rect.height, fitted);
  const link = document.createElement("a");
  link.download = `detection-snapshot-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function trackClientFps() {
  state.sentFrames += 1;
  const elapsed = performance.now() - state.fpsStartedAt;
  if (elapsed >= 1000) {
    elements.streamFps.textContent = `${Math.round((state.sentFrames * 1000) / elapsed)} fps`;
    state.sentFrames = 0;
    state.fpsStartedAt = performance.now();
  }
}

function captureLoop() {
  if (!state.running) {
    return;
  }
  const delay = 1000 / Math.max(1, state.targetFps);
  window.setTimeout(captureLoop, delay);

  if (state.paused || state.inFlight) {
    return;
  }

  const canvas = grabFrame();
  if (!canvas) {
    return;
  }

  if (state.mode === "server") {
    const runtime = ensureServerRuntime();
    if (!runtime.isOpen || runtime.busy) {
      return;
    }
    state.inFlight = true;
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          state.inFlight = false;
          return;
        }
        const sent = runtime.sendFrame(await blob.arrayBuffer());
        state.inFlight = false;
        if (sent) {
          trackClientFps();
        }
      },
      "image/jpeg",
      0.72,
    );
    return;
  }

  if (!isBrowserModelReady()) {
    return;
  }
  state.inFlight = true;
  detectBrowser(canvas, {
    confidence: state.confidence,
    classes: state.selectedClasses,
  })
    .then((payload) => {
      applyDetections(payload);
      trackClientFps();
    })
    .catch((error) => {
      elements.lastUpdated.textContent = error.message || "On-device detection failed";
    })
    .finally(() => {
      state.inFlight = false;
    });
}

function renderDetectionList() {
  const rows = state.detections
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .map((detection) => {
      const row = document.createElement("li");
      const swatch = document.createElement("span");
      const label = document.createElement("span");
      const confidence = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = colorForLabel(detection.label);
      label.className = "detection-label";
      label.textContent = detection.track_id ? `#${detection.track_id} ${detection.label}` : detection.label;
      confidence.className = "confidence";
      confidence.textContent = `${Math.round(detection.confidence * 100)}%`;
      row.append(swatch, label, confidence);
      return row;
    });
  elements.detectionList.replaceChildren(...rows);
}

function overlayOptions() {
  return {
    showLabels: state.showLabels,
    showTrails: state.showTrails && !reducedMotion(),
    cornerBoxes: state.cornerBoxes,
    privacyMode: state.privacyMode,
    privacyBlur: state.privacyBlur,
    ghostMode: state.ghostMode && !reducedMotion(),
    ghostOpacity: state.ghostOpacity,
  };
}

function renderStage() {
  const drawn = drawOverlay({
    overlay: elements.overlay,
    stage: elements.videoStage,
    detections: state.detections,
    ghosts: state.ghostDetections,
    rois: state.rois,
    roiPreview: state.roiPreview,
    frameSize: state.frameSize,
    options: overlayOptions(),
    source: currentSource(),
  });
  lastFitted = drawn.fitted;
  drawHeatmap(elements.heatmap, elements.videoStage, state.heatmapCells, state.frameSize, state.showHeatmap);
  drawProximityRadar(elements.proximityRadar, state.detections, state.frameSize);
  elements.radarCount.textContent = `${state.detections.length} blips`;
  requestAnimationFrame(renderStage);
}

function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
}

elements.startCamera.addEventListener("click", () => {
  startCamera().catch((error) => {
    elements.lastUpdated.textContent = error.message;
  });
});
elements.startCameraSide.addEventListener("click", () => {
  startCamera().catch((error) => {
    elements.lastUpdated.textContent = error.message;
  });
});
elements.stopCamera.addEventListener("click", stopCamera);

elements.fpsRange.addEventListener("input", (event) => {
  state.targetFps = Number(event.target.value);
  elements.fpsValue.textContent = `${state.targetFps} fps`;
});
elements.widthRange.addEventListener("input", (event) => {
  state.processingWidth = Number(event.target.value);
  elements.widthValue.textContent = `${state.processingWidth} px`;
});
elements.labelToggle.addEventListener("change", (event) => {
  state.showLabels = event.target.checked;
});
elements.confidenceRange.addEventListener("input", (event) => {
  state.confidence = clampConfidence(event.target.value);
  elements.confidenceValue.textContent = `${Math.round(state.confidence * 100)}%`;
  sendDetectionConfig();
  saveSettings();
  if (state.stillMode) {
    state.stillDirty = true;
    rerunStillDetection();
  }
});
elements.classSearch.addEventListener("input", (event) => {
  state.classQuery = event.target.value;
  renderClassChipPicker();
});
elements.heatmapToggle.addEventListener("change", (event) => {
  state.showHeatmap = event.target.checked;
  saveSettings();
});
elements.cornerBoxToggle.addEventListener("change", (event) => {
  state.cornerBoxes = event.target.checked;
  saveSettings();
});
elements.uploadDetect.addEventListener("change", (event) => {
  detectUploadedImages(event.target.files);
});
elements.roiDrawButton.addEventListener("click", () => {
  if (state.rois.length >= MAX_ROIS) {
    elements.roiStatus.textContent = `Maximum ${MAX_ROIS} zones reached.`;
    return;
  }
  setDrawing(true);
  elements.roiStatus.textContent = "Click and drag on the video to add a zone. Esc cancels.";
});
elements.roiClearButton.addEventListener("click", () => {
  state.rois = [];
  state.roiOccupied = [];
  state.roiCooldown = [];
  setDrawing(false);
  elements.roiStatus.textContent = "No ROI zones set (max 3).";
});
elements.pauseButton.addEventListener("click", togglePause);
elements.trailToggle.addEventListener("change", (event) => {
  state.showTrails = event.target.checked;
  saveSettings();
});
elements.alertSoundToggle.addEventListener("change", (event) => {
  state.alertSound = event.target.checked;
  saveSettings();
});
elements.themeToggle.addEventListener("change", (event) => {
  applyTheme(event.target.checked);
});
elements.privacyToggle.addEventListener("change", (event) => {
  state.privacyMode = event.target.checked;
  saveSettings();
});
elements.sonifyToggle.addEventListener("change", (event) => {
  state.sonify = event.target.checked;
  saveSettings();
});
elements.ghostToggle.addEventListener("change", (event) => {
  state.ghostMode = event.target.checked;
  saveSettings();
});
elements.spatialAudioToggle.addEventListener("change", (event) => {
  state.spatialAudio = event.target.checked;
  saveSettings();
});
elements.privacyBlurRange.addEventListener("input", (event) => {
  state.privacyBlur = Number(event.target.value);
  elements.privacyBlurValue.textContent = `${state.privacyBlur}px`;
  saveSettings();
});
elements.ghostOpacityRange.addEventListener("input", (event) => {
  state.ghostOpacity = Number(event.target.value);
  elements.ghostOpacityValue.textContent = `${Math.round(state.ghostOpacity * 100)}%`;
  saveSettings();
});
elements.exportFilmstrip.addEventListener("click", exportFilmstripGallery);
elements.snapshotButton.addEventListener("click", captureSnapshot);
elements.exportHistoryButton.addEventListener("click", exportHistory);
elements.clearHistoryButton.addEventListener("click", () => {
  state.history = [];
  renderHistory();
});
elements.modeServer.addEventListener("click", () => {
  setMode("server", { user: true });
});
elements.modeBrowser.addEventListener("click", () => {
  setMode("browser", { user: true });
});

elements.videoStage.addEventListener("pointerdown", (event) => {
  if (!state.roiDrawing || event.target.closest("button")) {
    return;
  }
  event.preventDefault();
  state.roiStart = pointerToNormalized(event, elements.videoStage, state.frameSize);
  state.roiPreview = { x: state.roiStart.x, y: state.roiStart.y, width: 0, height: 0 };
  elements.videoStage.setPointerCapture(event.pointerId);
});
elements.videoStage.addEventListener("pointermove", (event) => {
  if (!state.roiDrawing || !state.roiStart) {
    return;
  }
  const current = pointerToNormalized(event, elements.videoStage, state.frameSize);
  state.roiPreview = {
    x: Math.min(state.roiStart.x, current.x),
    y: Math.min(state.roiStart.y, current.y),
    width: Math.abs(current.x - state.roiStart.x),
    height: Math.abs(current.y - state.roiStart.y),
  };
});
elements.videoStage.addEventListener("pointerup", (event) => {
  if (!state.roiDrawing || !state.roiStart) {
    return;
  }
  const end = pointerToNormalized(event, elements.videoStage, state.frameSize);
  const roi = {
    x: Math.min(state.roiStart.x, end.x),
    y: Math.min(state.roiStart.y, end.y),
    width: Math.abs(end.x - state.roiStart.x),
    height: Math.abs(end.y - state.roiStart.y),
  };
  if (roi.width > 0.02 && roi.height > 0.02 && state.rois.length < MAX_ROIS) {
    state.rois.push(roi);
    state.roiOccupied[state.rois.length - 1] = false;
    state.roiCooldown[state.rois.length - 1] = 0;
    elements.roiStatus.textContent = `${state.rois.length} zone(s) armed.`;
  }
  setDrawing(false);
});

elements.fpsRange.addEventListener("change", saveSettings);
elements.widthRange.addEventListener("change", saveSettings);
elements.labelToggle.addEventListener("change", saveSettings);

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    captureSnapshot();
  } else if (event.key === "Escape") {
    setDrawing(false);
    elements.roiStatus.textContent = state.rois.length
      ? `${state.rois.length} zone(s) armed.`
      : "No ROI zones set (max 3).";
  }
});

window.addEventListener("pointerdown", () => {
  resumeAudio();
}, { once: true });

window.addEventListener("beforeunload", stopCamera);

async function boot() {
  loadTheme();
  loadSettings();
  state.serverAvailable = await probeHealth();
  await setMode(state.serverAvailable ? "server" : "browser");
  if (state.mode === "browser") {
    setConnectionStatus("On-device", false);
  } else {
    setConnectionStatus("Ready", false);
  }
  elements.lastUpdated.textContent = `v${APP_VERSION} ready`;
}

boot();
renderStage();
