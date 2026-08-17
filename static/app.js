const { colorForLabel, formatCounts, boxCenter, pointInRect, eventsToCsv } = window.DetectUtils;

const SNAPSHOT_KEY = "rod-v2-snapshots";
const PREFS_KEY = "rod-v2-prefs";
const MAX_SNAPSHOTS = 12;
const MAX_STORE_CHARS = 1_600_000;
const MAX_LATENCIES = 40;
const MAX_RECORD_EVENTS = 2000;
const MIN_JPEG_QUALITY = 0.4;
const MAX_JPEG_QUALITY = 0.95;
const DEFAULT_JPEG_QUALITY = 0.72;

const elements = {
  video: document.querySelector("#video"),
  overlay: document.querySelector("#overlay"),
  captureCanvas: document.querySelector("#captureCanvas"),
  videoStage: document.querySelector("#videoStage"),
  emptyState: document.querySelector("#emptyState"),
  errorState: document.querySelector("#errorState"),
  errorEyebrow: document.querySelector("#errorEyebrow"),
  errorTitle: document.querySelector("#errorTitle"),
  errorBody: document.querySelector("#errorBody"),
  startCamera: document.querySelector("#startCamera"),
  startCameraSide: document.querySelector("#startCameraSide"),
  startReel: document.querySelector("#startReel"),
  startReelSide: document.querySelector("#startReelSide"),
  startReelError: document.querySelector("#startReelError"),
  retryCamera: document.querySelector("#retryCamera"),
  stopCamera: document.querySelector("#stopCamera"),
  facingBtn: document.querySelector("#facingBtn"),
  facingLabel: document.querySelector("#facingLabel"),
  snapshotBtn: document.querySelector("#snapshotBtn"),
  recordBtn: document.querySelector("#recordBtn"),
  zoneBtn: document.querySelector("#zoneBtn"),
  clearZoneBtn: document.querySelector("#clearZoneBtn"),
  exportJsonBtn: document.querySelector("#exportJsonBtn"),
  exportCsvBtn: document.querySelector("#exportCsvBtn"),
  clearRecordBtn: document.querySelector("#clearRecordBtn"),
  recordHint: document.querySelector("#recordHint"),
  connectionStatus: document.querySelector("#connectionStatus"),
  modelBadge: document.querySelector("#modelBadge"),
  mockBadge: document.querySelector("#mockBadge"),
  muteBtn: document.querySelector("#muteBtn"),
  helpBtn: document.querySelector("#helpBtn"),
  fpsRange: document.querySelector("#fpsRange"),
  fpsValue: document.querySelector("#fpsValue"),
  widthRange: document.querySelector("#widthRange"),
  widthValue: document.querySelector("#widthValue"),
  qualityRange: document.querySelector("#qualityRange"),
  qualityValue: document.querySelector("#qualityValue"),
  confidenceRange: document.querySelector("#confidenceRange"),
  confidenceValue: document.querySelector("#confidenceValue"),
  imgszSelect: document.querySelector("#imgszSelect"),
  labelToggle: document.querySelector("#labelToggle"),
  objectCount: document.querySelector("#objectCount"),
  latency: document.querySelector("#latency"),
  inferMs: document.querySelector("#inferMs"),
  streamFps: document.querySelector("#streamFps"),
  busyCount: document.querySelector("#busyCount"),
  droppedCount: document.querySelector("#droppedCount"),
  detectionList: document.querySelector("#detectionList"),
  lastUpdated: document.querySelector("#lastUpdated"),
  countsLine: document.querySelector("#countsLine"),
  classSearch: document.querySelector("#classSearch"),
  classCloud: document.querySelector("#classCloud"),
  clearFilters: document.querySelector("#clearFilters"),
  watchCloud: document.querySelector("#watchCloud"),
  alertLog: document.querySelector("#alertLog"),
  sparkline: document.querySelector("#sparkline"),
  histogramList: document.querySelector("#histogramList"),
  histTotal: document.querySelector("#histTotal"),
  snapshotStrip: document.querySelector("#snapshotStrip"),
  shortcutsModal: document.querySelector("#shortcutsModal"),
  stageHud: document.querySelector("#stageHud"),
  hudObjects: document.querySelector("#hudObjects"),
  hudLatency: document.querySelector("#hudLatency"),
  hudFps: document.querySelector("#hudFps"),
  hudReel: document.querySelector("#hudReel"),
};

const state = {
  stream: null,
  socket: null,
  running: false,
  mode: "idle",
  inFlight: false,
  targetFps: Number(elements.fpsRange.value),
  processingWidth: Number(elements.widthRange.value),
  jpegQuality: DEFAULT_JPEG_QUALITY,
  confidence: Number(elements.confidenceRange.value),
  imgsz: Number(elements.imgszSelect.value),
  showLabels: true,
  muted: false,
  facingMode: "environment",
  canFlipCamera: false,
  rawDetections: [],
  detections: [],
  frameSize: { width: 1, height: 1 },
  sentFrames: 0,
  fpsStartedAt: performance.now(),
  busyFrames: 0,
  droppedFrames: 0,
  classes: [],
  classQuery: "",
  allowedLabels: new Set(),
  watchlist: new Set(),
  histogram: {},
  latencies: [],
  alerts: [],
  snapshots: [],
  configTimer: 0,
  audioCtx: null,
  drawingZone: false,
  zone: null,
  zoneDraft: null,
  recording: false,
  recordStartedAt: 0,
  recordEvents: [],
};

function clampQuality(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return DEFAULT_JPEG_QUALITY;
  }
  return Math.min(MAX_JPEG_QUALITY, Math.max(MIN_JPEG_QUALITY, next));
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      muted: state.muted,
      showLabels: state.showLabels,
      confidence: state.confidence,
      facingMode: state.facingMode,
      quality: state.jpegQuality,
      watchlist: [...state.watchlist],
    }),
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setConnectionStatus(label, online = false) {
  elements.connectionStatus.classList.toggle("online", online);
  elements.connectionStatus.querySelector("span:last-child").textContent = label;
}

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/detect`;
}

function sendConfig() {
  if (state.socket?.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(
    JSON.stringify({
      type: "config",
      confidence: state.confidence,
      imgsz: state.imgsz,
      allowed_labels: state.allowedLabels.size ? [...state.allowedLabels] : null,
      watchlist: [...state.watchlist],
    }),
  );
}

function scheduleConfig() {
  window.clearTimeout(state.configTimer);
  state.configTimer = window.setTimeout(sendConfig, 120);
}

function connectSocket() {
  if (state.socket?.readyState === WebSocket.OPEN) {
    sendConfig();
    return;
  }

  state.socket = new WebSocket(socketUrl());
  state.socket.binaryType = "arraybuffer";
  setConnectionStatus("Connecting");

  state.socket.addEventListener("open", () => {
    setConnectionStatus("Live", true);
    sendConfig();
  });

  state.socket.addEventListener("close", () => {
    state.inFlight = false;
    if (state.running) {
      setConnectionStatus("Reconnecting");
      window.setTimeout(connectSocket, 900);
    } else {
      setConnectionStatus("Offline");
    }
  });

  state.socket.addEventListener("error", () => {
    setConnectionStatus("Socket error");
  });

  state.socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "busy") {
      state.inFlight = false;
      state.busyFrames += 1;
      updateDropUi();
      return;
    }
    if (payload.type === "config_ack") {
      return;
    }
    if (payload.type === "error") {
      state.inFlight = false;
      elements.lastUpdated.textContent = payload.message;
      return;
    }

    state.inFlight = false;
    applyDetectionPayload(payload);
  });
}

function countLabels(detections) {
  const counts = {};
  for (const detection of detections) {
    const label = detection.label || "unknown";
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

function detectionsWithZone(detections) {
  if (!state.zone) {
    return detections.map((detection) => ({ ...detection, inZone: true }));
  }
  const frameWidth = state.frameSize.width || 1;
  const frameHeight = state.frameSize.height || 1;
  return detections.map((detection) => {
    const center = boxCenter(detection.box || {});
    const point = { x: center.x / frameWidth, y: center.y / frameHeight };
    return { ...detection, inZone: pointInRect(point, state.zone) };
  });
}

function applyCurrentDetections() {
  state.detections = detectionsWithZone(state.rawDetections);
  const visible = state.zone ? state.detections.filter((item) => item.inZone) : state.detections;
  elements.countsLine.textContent = formatCounts(countLabels(visible));
  updateCountReadout();
  renderDetectionList();
}

function applyDetectionPayload(payload) {
  state.rawDetections = payload.detections ?? [];
  state.frameSize = {
    width: payload.frame_width || 1,
    height: payload.frame_height || 1,
  };
  state.detections = detectionsWithZone(state.rawDetections);
  const visible = state.zone ? state.detections.filter((item) => item.inZone) : state.detections;
  const counts = countLabels(visible);
  const alerts = state.zone
    ? (payload.alerts || []).filter((alert) =>
        visible.some((item) => item.label === alert.label),
      )
    : payload.alerts || [];

  updateCountReadout();
  elements.latency.textContent = `${payload.latency_ms ?? "--"} ms`;
  elements.inferMs.textContent = `${payload.inference_ms ?? "--"} ms`;
  elements.hudLatency.textContent = `${payload.latency_ms ?? "--"} ms`;
  elements.countsLine.textContent = formatCounts(counts);
  elements.lastUpdated.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (typeof payload.latency_ms === "number") {
    state.latencies.push(payload.latency_ms);
    if (state.latencies.length > MAX_LATENCIES) {
      state.latencies.shift();
    }
    drawSparkline();
  }
  accumulateHistogram(counts);
  handleAlerts(alerts);
  renderDetectionList();
  recordEvent(payload, visible, counts, alerts);
}

function updateCountReadout() {
  const total = state.detections.length;
  const inZone = state.detections.filter((item) => item.inZone !== false).length;
  if (state.zone) {
    elements.objectCount.textContent = `${inZone} / ${total}`;
    elements.hudObjects.textContent = `${inZone}/${total} obj`;
  } else {
    elements.objectCount.textContent = String(total);
    elements.hudObjects.textContent = `${total} obj`;
  }
}

function updateDropUi() {
  elements.busyCount.textContent = String(state.busyFrames);
  elements.droppedCount.textContent = String(state.droppedFrames);
}

function showStage(mode) {
  elements.emptyState.classList.toggle("hidden", mode !== "empty");
  elements.errorState.classList.toggle("hidden", mode !== "error");
  elements.stageHud.hidden = mode !== "live";
}

function showCameraError(kind, detail) {
  if (kind === "permission") {
    elements.errorEyebrow.textContent = "Permission denied";
    elements.errorTitle.textContent = "Camera access is blocked";
    elements.errorBody.textContent =
      "Use the lock icon in the address bar → Site settings → Camera → Allow, then retry. HTTPS or localhost is required.";
  } else if (kind === "missing") {
    elements.errorEyebrow.textContent = "No camera";
    elements.errorTitle.textContent = "No video input found";
    elements.errorBody.textContent =
      "Connect a webcam or grant this page access to an existing camera, then try again.";
  } else {
    elements.errorEyebrow.textContent = "Camera error";
    elements.errorTitle.textContent = "Could not start the camera";
    elements.errorBody.textContent = detail || "An unexpected getUserMedia error occurred.";
  }
  showStage("error");
}

function setTransportButtons(running) {
  elements.startCameraSide.disabled = running;
  elements.startReelSide.disabled = running;
  elements.stopCamera.disabled = !running;
  elements.snapshotBtn.disabled = !running;
}

function resetLiveReadout() {
  state.rawDetections = [];
  state.detections = [];
  renderDetectionList();
  elements.objectCount.textContent = "0";
  elements.latency.textContent = "--";
  elements.inferMs.textContent = "--";
  elements.streamFps.textContent = "--";
  elements.hudObjects.textContent = "0 obj";
  elements.hudLatency.textContent = "-- ms";
  elements.hudFps.textContent = "-- fps";
  elements.countsLine.textContent = "none";
  elements.lastUpdated.textContent = "Idle";
}

async function refreshCameraOptions() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  state.canFlipCamera = cameras.length > 1;
  elements.facingBtn.hidden = !state.canFlipCamera;
  elements.facingLabel.textContent = state.facingMode === "user" ? "Front" : "Rear";
}

function beginLiveSession(mode) {
  state.mode = mode;
  state.running = true;
  state.inFlight = false;
  state.busyFrames = 0;
  state.droppedFrames = 0;
  state.sentFrames = 0;
  state.fpsStartedAt = performance.now();
  updateDropUi();
  showStage("live");
  elements.hudReel.classList.toggle("hidden", mode !== "reel");
  setTransportButtons(true);
  connectSocket();
  captureLoop();
}

async function startCamera() {
  if (state.running) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError("missing", "This browser does not expose a camera API.");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch (error) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      showCameraError("permission");
    } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      showCameraError("missing");
    } else {
      showCameraError("other", error.message);
    }
    throw error;
  }

  elements.video.srcObject = state.stream;
  await elements.video.play();

  if (elements.video.videoWidth && elements.video.videoHeight) {
    elements.videoStage.style.aspectRatio = `${elements.video.videoWidth} / ${elements.video.videoHeight}`;
  }

  await refreshCameraOptions();
  beginLiveSession("camera");
}

function startReel() {
  if (state.running) {
    return;
  }
  elements.videoStage.style.aspectRatio = "16 / 9";
  elements.facingBtn.hidden = true;
  beginLiveSession("reel");
}

function stopCamera() {
  state.running = false;
  state.mode = "idle";
  state.inFlight = false;

  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  elements.video.srcObject = null;
  elements.hudReel.classList.add("hidden");
  resetLiveReadout();
  setTransportButtons(false);
  setConnectionStatus("Offline");
  showStage("empty");
}

async function toggleFacing() {
  if (state.mode === "reel") {
    return;
  }
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  elements.facingLabel.textContent = state.facingMode === "user" ? "Front" : "Rear";
  savePrefs();
  if (!state.running) {
    return;
  }
  stopCamera();
  await startCamera();
}

function drawReelScene(canvas, width, height) {
  const context = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#0a0c10";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(255,255,255,0.045)";
  context.lineWidth = 1;
  for (let x = 32; x < width; x += 32) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }
  for (let y = 32; y < height; y += 32) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }

  const t = prefersReducedMotion() ? 0 : performance.now() / 1000;
  const actors = [
    { label: "person", color: "#38d6c6", x: 0.08, y: 0.12, w: 0.28, h: 0.78, dx: 0.03, dy: 0.02 },
    { label: "cup", color: "#f5c84b", x: 0.4, y: 0.48, w: 0.16, h: 0.22, dx: 0.05, dy: 0.04 },
    { label: "laptop", color: "#c084fc", x: 0.55, y: 0.4, w: 0.38, h: 0.42, dx: 0.02, dy: 0.03 },
  ];
  actors.forEach((actor, index) => {
    const shiftX = actor.dx * Math.sin(t * (0.7 + index * 0.2));
    const shiftY = actor.dy * Math.cos(t * (0.55 + index * 0.18));
    const x = (actor.x + shiftX) * width;
    const y = (actor.y + shiftY) * height;
    const boxWidth = actor.w * width;
    const boxHeight = actor.h * height;
    context.globalAlpha = 0.88;
    context.fillStyle = actor.color;
    context.fillRect(x, y, boxWidth, boxHeight);
    context.globalAlpha = 1;
    context.fillStyle = "#071111";
    context.font = `700 ${Math.max(12, Math.round(width * 0.028))}px system-ui, sans-serif`;
    context.fillText(actor.label, x + 8, y + 18);
  });
}

function captureLoop() {
  if (!state.running) {
    return;
  }

  const delay = 1000 / state.targetFps;
  window.setTimeout(captureLoop, delay);

  if (state.socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  if (state.inFlight) {
    state.droppedFrames += 1;
    updateDropUi();
    return;
  }

  const canvas = elements.captureCanvas;
  if (state.mode === "reel") {
    const width = state.processingWidth;
    const height = Math.max(1, Math.round((width * 9) / 16));
    drawReelScene(canvas, width, height);
  } else {
    if (elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    const sourceWidth = elements.video.videoWidth;
    const sourceHeight = elements.video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      return;
    }
    const width = Math.min(state.processingWidth, sourceWidth);
    const height = Math.round(width * (sourceHeight / sourceWidth));
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(elements.video, 0, 0, width, height);
  }

  state.inFlight = true;
  canvas.toBlob(
    async (blob) => {
      if (!blob || state.socket?.readyState !== WebSocket.OPEN) {
        state.inFlight = false;
        return;
      }
      state.socket.send(await blob.arrayBuffer());
      trackClientFps();
    },
    "image/jpeg",
    state.jpegQuality,
  );
}

function trackClientFps() {
  state.sentFrames += 1;
  const elapsed = performance.now() - state.fpsStartedAt;
  if (elapsed >= 1000) {
    const fps = Math.round((state.sentFrames * 1000) / elapsed);
    elements.streamFps.textContent = `${fps} fps`;
    elements.hudFps.textContent = `${fps} fps`;
    state.sentFrames = 0;
    state.fpsStartedAt = performance.now();
  }
}

function normalizeRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.width);
  const y = Math.min(rect.y, rect.y + rect.height);
  return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}

function overlayPoint(event) {
  const rect = elements.overlay.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: (event.clientX - rect.left) / width,
    y: (event.clientY - rect.top) / height,
  };
}

function setDrawingZone(next) {
  state.drawingZone = Boolean(next);
  if (!state.drawingZone) {
    state.zoneDraft = null;
  }
  elements.overlay.classList.toggle("interactive", state.drawingZone);
  elements.zoneBtn.setAttribute("aria-pressed", String(state.drawingZone));
}

function clearZone() {
  state.zone = null;
  state.zoneDraft = null;
  elements.clearZoneBtn.disabled = true;
  applyCurrentDetections();
}

function commitZoneDraft() {
  if (!state.zoneDraft) {
    return;
  }
  const rect = normalizeRect(state.zoneDraft);
  state.zoneDraft = null;
  if (rect.width < 0.02 || rect.height < 0.02) {
    return;
  }
  state.zone = rect;
  elements.clearZoneBtn.disabled = false;
  applyCurrentDetections();
}

function paintZone(context, viewWidth, viewHeight) {
  const source = state.zoneDraft ? normalizeRect(state.zoneDraft) : state.zone;
  if (!source || source.width <= 0 || source.height <= 0) {
    return;
  }
  const x = source.x * viewWidth;
  const y = source.y * viewHeight;
  const width = source.width * viewWidth;
  const height = source.height * viewHeight;
  context.save();
  context.fillStyle = "rgba(56, 214, 198, 0.08)";
  context.strokeStyle = "#38d6c6";
  context.lineWidth = 2;
  context.setLineDash([8, 5]);
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);
  context.restore();
}

function resizeOverlay() {
  const rect = elements.videoStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);

  if (elements.overlay.width !== width || elements.overlay.height !== height) {
    elements.overlay.width = width;
    elements.overlay.height = height;
  }

  const context = elements.overlay.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function paintDetections(context, viewWidth, viewHeight, frameWidth, frameHeight) {
  const xScale = viewWidth / frameWidth;
  const yScale = viewHeight / frameHeight;

  for (const detection of state.detections) {
    const box = detection.box;
    const x = box.x * xScale;
    const y = box.y * yScale;
    const boxWidth = box.width * xScale;
    const boxHeight = box.height * yScale;
    const color = colorForLabel(detection.label);
    const watched = state.watchlist.has(detection.label);
    const inZone = detection.inZone !== false;

    context.save();
    context.globalAlpha = inZone ? 1 : 0.28;
    if (!inZone) {
      context.setLineDash([5, 4]);
    }
    context.lineWidth = Math.max(2, Math.min(viewWidth, viewHeight) * 0.004);
    context.strokeStyle = watched ? "#ff6f59" : color;
    context.fillStyle = context.strokeStyle;
    context.strokeRect(x, y, boxWidth, boxHeight);

    if (state.showLabels) {
      const label = `${detection.label} ${Math.round(detection.confidence * 100)}%`;
      context.font = "700 13px system-ui, sans-serif";
      const metrics = context.measureText(label);
      const labelHeight = 22;
      const labelWidth = metrics.width + 14;
      const labelY = y > labelHeight + 4 ? y - labelHeight - 4 : y + 4;
      context.fillRect(x, labelY, labelWidth, labelHeight);
      context.fillStyle = "#071111";
      context.fillText(label, x + 7, labelY + 15);
    }
    context.restore();
  }
}

function drawOverlay() {
  const { context, width, height } = resizeOverlay();
  context.clearRect(0, 0, width, height);
  if (state.mode === "reel" && elements.captureCanvas.width) {
    context.drawImage(elements.captureCanvas, 0, 0, width, height);
  }
  paintZone(context, width, height);
  paintDetections(context, width, height, state.frameSize.width, state.frameSize.height);
  requestAnimationFrame(drawOverlay);
}

function renderDetectionList() {
  const rows = state.detections
    .slice()
    .sort((left, right) => right.confidence - left.confidence)
    .map((detection) => {
      const row = document.createElement("li");
      const swatch = document.createElement("span");
      const label = document.createElement("span");
      const confidence = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = colorForLabel(detection.label);
      label.className = "detection-label";
      label.textContent = detection.label;
      confidence.className = "confidence";
      confidence.textContent = `${Math.round(detection.confidence * 100)}%`;
      if (detection.inZone === false) {
        row.classList.add("dim");
      }
      row.append(swatch, label, confidence);
      return row;
    });
  elements.detectionList.replaceChildren(...rows);
}

function renderClassCloud() {
  const query = state.classQuery.trim().toLowerCase();
  const visible = state.classes.filter((name) => name.toLowerCase().includes(query));
  const nodes = visible.slice(0, 80).map((name) => {
    const chip = document.createElement("div");
    const pin = document.createElement("button");
    chip.className = "chip";
    if (state.allowedLabels.has(name)) {
      chip.classList.add("on");
    }
    if (state.watchlist.has(name)) {
      chip.classList.add("watch");
    }
    chip.type = "button";
    chip.innerHTML = `<span class="dot" style="background:${colorForLabel(name)}"></span><span></span>`;
    chip.querySelector("span:last-child").textContent = name;
    chip.addEventListener("click", () => {
      if (state.allowedLabels.has(name)) {
        state.allowedLabels.delete(name);
      } else {
        state.allowedLabels.add(name);
      }
      renderClassCloud();
      scheduleConfig();
    });
    pin.type = "button";
    pin.className = "pin";
    pin.title = "Toggle watchlist";
    pin.textContent = state.watchlist.has(name) ? "●" : "○";
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleWatch(name);
    });
    chip.append(pin);
    return chip;
  });
  elements.classCloud.replaceChildren(...nodes);
  renderWatchCloud();
}

function renderWatchCloud() {
  if (!state.watchlist.size) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Pin classes above to watch them.";
    elements.watchCloud.replaceChildren(empty);
    return;
  }
  const nodes = [...state.watchlist].map((name) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip watch";
    chip.textContent = name;
    chip.title = "Remove from watchlist";
    chip.addEventListener("click", () => toggleWatch(name));
    return chip;
  });
  elements.watchCloud.replaceChildren(...nodes);
}

function toggleWatch(name) {
  if (state.watchlist.has(name)) {
    state.watchlist.delete(name);
  } else {
    state.watchlist.add(name);
  }
  renderClassCloud();
  scheduleConfig();
  savePrefs();
}

function accumulateHistogram(counts) {
  let added = 0;
  for (const [label, value] of Object.entries(counts)) {
    const next = Number(value) || 0;
    state.histogram[label] = (state.histogram[label] || 0) + next;
    added += next;
  }
  if (added) {
    renderHistogram();
  }
}

function renderHistogram() {
  const entries = Object.entries(state.histogram).sort((left, right) => right[1] - left[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const max = entries[0]?.[1] || 1;
  elements.histTotal.textContent = String(total);
  const rows = entries.slice(0, 8).map(([label, value]) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const bar = document.createElement("div");
    const fill = document.createElement("span");
    const count = document.createElement("span");
    name.textContent = label;
    bar.className = "bar";
    fill.style.width = `${Math.max(6, (value / max) * 100)}%`;
    fill.style.background = colorForLabel(label);
    count.textContent = String(value);
    bar.append(fill);
    item.append(name, bar, count);
    return item;
  });
  elements.histogramList.replaceChildren(...rows);
}

function drawSparkline() {
  const canvas = elements.sparkline;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  const values = state.latencies;
  if (!values.length) {
    return;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  context.beginPath();
  context.strokeStyle = "#38d6c6";
  context.lineWidth = 2;
  values.forEach((value, index) => {
    const x = (index / Math.max(1, MAX_LATENCIES - 1)) * (width - 8) + 4;
    const y = height - 6 - ((value - min) / span) * (height - 12);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
}

function beep() {
  if (state.muted || prefersReducedMotion()) {
    return;
  }
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) {
    return;
  }
  state.audioCtx = state.audioCtx || new AudioContextImpl();
  const ctx = state.audioCtx;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
  oscillator.stop(ctx.currentTime + 0.13);
}

function handleAlerts(alerts) {
  if (!alerts.length) {
    return;
  }
  if (!prefersReducedMotion()) {
    elements.videoStage.classList.remove("alert-flash");
    void elements.videoStage.offsetWidth;
    elements.videoStage.classList.add("alert-flash");
    window.setTimeout(() => elements.videoStage.classList.remove("alert-flash"), 420);
  } else {
    elements.videoStage.classList.add("alert-flash");
    window.setTimeout(() => elements.videoStage.classList.remove("alert-flash"), 900);
  }
  beep();
  const stamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (const alert of alerts) {
    state.alerts.unshift({
      label: alert.label,
      confidence: alert.confidence,
      stamp,
    });
  }
  state.alerts = state.alerts.slice(0, 20);
  renderAlertLog();
}

function renderAlertLog() {
  if (!state.alerts.length) {
    const empty = document.createElement("li");
    empty.textContent = "Watchlist is quiet.";
    elements.alertLog.replaceChildren(empty);
    return;
  }
  const rows = state.alerts.map((item) => {
    const row = document.createElement("li");
    row.textContent = `${item.stamp} · ${item.label} ${Math.round((item.confidence || 0) * 100)}%`;
    return row;
  });
  elements.alertLog.replaceChildren(...rows);
}

function updateRecordUi() {
  const count = state.recordEvents.length;
  elements.recordHint.textContent = state.recording ? `REC · ${count}` : `${count} events`;
  elements.recordBtn.setAttribute("aria-pressed", String(state.recording));
  const label = elements.recordBtn.querySelector("span");
  if (label) {
    label.textContent = state.recording ? "Recording" : "Record";
  }
  elements.exportJsonBtn.disabled = count === 0;
  elements.exportCsvBtn.disabled = count === 0;
  elements.clearRecordBtn.disabled = count === 0 && !state.recording;
}

function toggleRecord() {
  state.recording = !state.recording;
  if (state.recording && (!state.recordStartedAt || state.recordEvents.length === 0)) {
    state.recordStartedAt = Date.now();
  }
  updateRecordUi();
}

function clearRecording() {
  state.recordEvents = [];
  state.recordStartedAt = state.recording ? Date.now() : 0;
  updateRecordUi();
}

function recordEvent(payload, detections, counts, alerts) {
  if (!state.recording) {
    return;
  }
  if (!state.recordStartedAt) {
    state.recordStartedAt = Date.now();
  }
  state.recordEvents.push({
    t: Math.round(Date.now() - state.recordStartedAt),
    frame_id: payload.frame_id ?? null,
    detections: detections.map((detection) => ({
      label: detection.label,
      confidence: detection.confidence,
      box: detection.box,
    })),
    counts,
    alerts: (alerts || []).map((alert) => ({
      label: alert.label,
      confidence: alert.confidence,
    })),
    latency_ms: payload.latency_ms ?? null,
  });
  if (state.recordEvents.length > MAX_RECORD_EVENTS) {
    state.recordEvents.splice(0, state.recordEvents.length - MAX_RECORD_EVENTS);
  }
  updateRecordUi();
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportRecording(kind) {
  if (!state.recordEvents.length) {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (kind === "json") {
    downloadText(
      JSON.stringify(state.recordEvents),
      `detect-session-${stamp}.json`,
      "application/json",
    );
    return;
  }
  downloadText(eventsToCsv(state.recordEvents), `detect-session-${stamp}.csv`, "text/csv");
}

function loadSnapshots() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
    state.snapshots = Array.isArray(parsed) ? parsed.slice(0, MAX_SNAPSHOTS) : [];
  } catch {
    state.snapshots = [];
  }
  renderSnapshots();
}

function persistSnapshots() {
  let payload = state.snapshots.slice(0, MAX_SNAPSHOTS);
  while (payload.length) {
    const raw = JSON.stringify(payload);
    if (raw.length <= MAX_STORE_CHARS) {
      localStorage.setItem(SNAPSHOT_KEY, raw);
      return;
    }
    payload = payload.slice(0, -1);
  }
  localStorage.removeItem(SNAPSHOT_KEY);
}

function renderSnapshots() {
  const figures = state.snapshots.map((item) => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    const download = document.createElement("button");
    image.src = item.dataUrl;
    image.alt = `Snapshot ${item.id}`;
    download.type = "button";
    download.textContent = "PNG";
    download.addEventListener("click", () => downloadDataUrl(item.dataUrl, `detect-${item.id}.png`));
    figure.append(image, download);
    return figure;
  });
  elements.snapshotStrip.replaceChildren(...figures);
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function captureSnapshot() {
  if (!state.running) {
    return;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  let width = 0;
  let height = 0;

  if (state.mode === "reel") {
    width = elements.captureCanvas.width;
    height = elements.captureCanvas.height;
    if (!width || !height) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    context.drawImage(elements.captureCanvas, 0, 0, width, height);
  } else {
    if (elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    width = elements.video.videoWidth;
    height = elements.video.videoHeight;
    canvas.width = width;
    canvas.height = height;
    context.drawImage(elements.video, 0, 0, width, height);
  }

  paintZone(context, width, height);
  paintDetections(context, width, height, state.frameSize.width, state.frameSize.height);
  const dataUrl = canvas.toDataURL("image/png");
  const record = { id: Date.now(), dataUrl };
  state.snapshots.unshift(record);
  state.snapshots = state.snapshots.slice(0, MAX_SNAPSHOTS);
  persistSnapshots();
  renderSnapshots();
}

function setMuted(next) {
  state.muted = next;
  elements.muteBtn.setAttribute("aria-pressed", String(next));
  elements.muteBtn.querySelector("span").textContent = next ? "Muted" : "Mute";
  savePrefs();
}

function setJpegQuality(value) {
  state.jpegQuality = clampQuality(value);
  elements.qualityRange.value = String(state.jpegQuality);
  elements.qualityValue.textContent = state.jpegQuality.toFixed(2);
  savePrefs();
}

function isTypingTarget(target) {
  return Boolean(target.closest("input, textarea, select, dialog"));
}

function onKeydown(event) {
  if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
    if (!isTypingTarget(event.target) || event.target === document.body) {
      event.preventDefault();
      toggleShortcuts();
    }
    return;
  }
  if (event.key === "Escape" && elements.shortcutsModal.open) {
    elements.shortcutsModal.close();
    return;
  }
  if (isTypingTarget(event.target)) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (state.running) {
      stopCamera();
    } else {
      startCamera().catch(() => {});
    }
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    captureSnapshot();
  } else if (key === "l") {
    elements.labelToggle.checked = !elements.labelToggle.checked;
    state.showLabels = elements.labelToggle.checked;
    savePrefs();
  } else if (key === "m") {
    setMuted(!state.muted);
  } else if (key === "r") {
    event.preventDefault();
    toggleRecord();
  } else if (key === "z") {
    event.preventDefault();
    setDrawingZone(!state.drawingZone);
  }
}

function toggleShortcuts() {
  if (elements.shortcutsModal.open) {
    elements.shortcutsModal.close();
  } else {
    elements.shortcutsModal.showModal();
  }
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function bootstrap() {
  const prefs = loadPrefs();
  if (Array.isArray(prefs.watchlist)) {
    state.watchlist = new Set(prefs.watchlist.filter((name) => typeof name === "string" && name));
  }
  if (typeof prefs.quality === "number") {
    state.jpegQuality = clampQuality(prefs.quality);
    elements.qualityRange.value = String(state.jpegQuality);
    elements.qualityValue.textContent = state.jpegQuality.toFixed(2);
  }
  if (typeof prefs.muted === "boolean") {
    setMuted(prefs.muted);
  }
  if (typeof prefs.showLabels === "boolean") {
    state.showLabels = prefs.showLabels;
    elements.labelToggle.checked = prefs.showLabels;
  }
  if (typeof prefs.confidence === "number") {
    state.confidence = prefs.confidence;
    elements.confidenceRange.value = String(prefs.confidence);
    elements.confidenceValue.textContent = prefs.confidence.toFixed(2);
  }
  if (prefs.facingMode === "user" || prefs.facingMode === "environment") {
    state.facingMode = prefs.facingMode;
    elements.facingLabel.textContent = state.facingMode === "user" ? "Front" : "Rear";
  }

  loadSnapshots();
  renderAlertLog();
  renderHistogram();
  drawSparkline();
  updateRecordUi();
  updateDropUi();

  try {
    const [health, config, classesPayload] = await Promise.all([
      fetch("/health").then((response) => response.json()),
      fetch("/api/config").then((response) => response.json()),
      fetch("/api/classes").then((response) => response.json()),
    ]);
    elements.modelBadge.textContent = health.model || config.model || "model —";
    elements.mockBadge.classList.toggle("hidden", !health.mock);
    if (typeof config.confidence === "number" && typeof prefs.confidence !== "number") {
      state.confidence = config.confidence;
      elements.confidenceRange.value = String(config.confidence);
      elements.confidenceValue.textContent = Number(config.confidence).toFixed(2);
    }
    if (config.imgsz) {
      elements.imgszSelect.value = String(config.imgsz);
      state.imgsz = Number(config.imgsz);
    }
    const classes = Array.isArray(classesPayload)
      ? classesPayload
      : classesPayload.classes || config.class_names || [];
    state.classes = classes;
    renderClassCloud();
  } catch {
    elements.modelBadge.textContent = "api offline";
    state.classes = ["person", "cup", "laptop", "cell phone", "bottle", "chair"];
    renderClassCloud();
  }

  refreshIcons();
}

function bindEvents() {
  const start = () => {
    startCamera().catch((error) => {
      elements.lastUpdated.textContent = error.message;
    });
  };

  elements.startCamera.addEventListener("click", start);
  elements.startCameraSide.addEventListener("click", start);
  elements.retryCamera.addEventListener("click", start);
  elements.startReel.addEventListener("click", startReel);
  elements.startReelSide.addEventListener("click", startReel);
  elements.startReelError.addEventListener("click", startReel);
  elements.stopCamera.addEventListener("click", stopCamera);
  elements.facingBtn.addEventListener("click", () => {
    toggleFacing().catch((error) => {
      showCameraError("other", error.message);
    });
  });
  elements.snapshotBtn.addEventListener("click", captureSnapshot);
  elements.recordBtn.addEventListener("click", toggleRecord);
  elements.zoneBtn.addEventListener("click", () => setDrawingZone(!state.drawingZone));
  elements.clearZoneBtn.addEventListener("click", clearZone);
  elements.exportJsonBtn.addEventListener("click", () => exportRecording("json"));
  elements.exportCsvBtn.addEventListener("click", () => exportRecording("csv"));
  elements.clearRecordBtn.addEventListener("click", clearRecording);
  elements.helpBtn.addEventListener("click", toggleShortcuts);
  elements.muteBtn.addEventListener("click", () => setMuted(!state.muted));

  elements.overlay.addEventListener("pointerdown", (event) => {
    if (!state.drawingZone) {
      return;
    }
    event.preventDefault();
    elements.overlay.setPointerCapture(event.pointerId);
    const point = overlayPoint(event);
    state.zoneDraft = { x: point.x, y: point.y, width: 0, height: 0 };
  });
  elements.overlay.addEventListener("pointermove", (event) => {
    if (!state.zoneDraft) {
      return;
    }
    const point = overlayPoint(event);
    state.zoneDraft.width = point.x - state.zoneDraft.x;
    state.zoneDraft.height = point.y - state.zoneDraft.y;
  });
  elements.overlay.addEventListener("pointerup", commitZoneDraft);
  elements.overlay.addEventListener("pointercancel", commitZoneDraft);

  elements.fpsRange.addEventListener("input", (event) => {
    state.targetFps = Number(event.target.value);
    elements.fpsValue.textContent = `${state.targetFps} fps`;
  });
  elements.widthRange.addEventListener("input", (event) => {
    state.processingWidth = Number(event.target.value);
    elements.widthValue.textContent = `${state.processingWidth} px`;
  });
  elements.qualityRange.addEventListener("input", (event) => {
    setJpegQuality(event.target.value);
  });
  elements.confidenceRange.addEventListener("input", (event) => {
    state.confidence = Number(event.target.value);
    elements.confidenceValue.textContent = state.confidence.toFixed(2);
    savePrefs();
    scheduleConfig();
  });
  elements.imgszSelect.addEventListener("change", (event) => {
    state.imgsz = Number(event.target.value);
    scheduleConfig();
  });
  elements.labelToggle.addEventListener("change", (event) => {
    state.showLabels = event.target.checked;
    savePrefs();
  });
  elements.classSearch.addEventListener("input", (event) => {
    state.classQuery = event.target.value;
    renderClassCloud();
  });
  elements.clearFilters.addEventListener("click", () => {
    state.allowedLabels.clear();
    renderClassCloud();
    scheduleConfig();
  });

  document.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", stopCamera);
}

bindEvents();
bootstrap();
drawOverlay();
