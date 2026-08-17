const { colorForLabel, formatCounts } = window.DetectUtils;

const SNAPSHOT_KEY = "rod-v2-snapshots";
const PREFS_KEY = "rod-v2-prefs";
const MAX_SNAPSHOTS = 12;
const MAX_STORE_CHARS = 1_600_000;
const MAX_LATENCIES = 40;

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
  retryCamera: document.querySelector("#retryCamera"),
  stopCamera: document.querySelector("#stopCamera"),
  facingBtn: document.querySelector("#facingBtn"),
  facingLabel: document.querySelector("#facingLabel"),
  snapshotBtn: document.querySelector("#snapshotBtn"),
  connectionStatus: document.querySelector("#connectionStatus"),
  modelBadge: document.querySelector("#modelBadge"),
  mockBadge: document.querySelector("#mockBadge"),
  muteBtn: document.querySelector("#muteBtn"),
  helpBtn: document.querySelector("#helpBtn"),
  fpsRange: document.querySelector("#fpsRange"),
  fpsValue: document.querySelector("#fpsValue"),
  widthRange: document.querySelector("#widthRange"),
  widthValue: document.querySelector("#widthValue"),
  confidenceRange: document.querySelector("#confidenceRange"),
  confidenceValue: document.querySelector("#confidenceValue"),
  imgszSelect: document.querySelector("#imgszSelect"),
  labelToggle: document.querySelector("#labelToggle"),
  objectCount: document.querySelector("#objectCount"),
  latency: document.querySelector("#latency"),
  inferMs: document.querySelector("#inferMs"),
  streamFps: document.querySelector("#streamFps"),
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
};

const state = {
  stream: null,
  socket: null,
  running: false,
  inFlight: false,
  targetFps: Number(elements.fpsRange.value),
  processingWidth: Number(elements.widthRange.value),
  confidence: Number(elements.confidenceRange.value),
  imgsz: Number(elements.imgszSelect.value),
  showLabels: true,
  muted: false,
  facingMode: "environment",
  canFlipCamera: false,
  detections: [],
  frameSize: { width: 1, height: 1 },
  sentFrames: 0,
  fpsStartedAt: performance.now(),
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
};

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
    state.detections = payload.detections ?? [];
    state.frameSize = {
      width: payload.frame_width || 1,
      height: payload.frame_height || 1,
    };
    const count = state.detections.length;
    elements.objectCount.textContent = String(count);
    elements.latency.textContent = `${payload.latency_ms ?? "--"} ms`;
    elements.inferMs.textContent = `${payload.inference_ms ?? "--"} ms`;
    elements.hudObjects.textContent = `${count} obj`;
    elements.hudLatency.textContent = `${payload.latency_ms ?? "--"} ms`;
    elements.countsLine.textContent = formatCounts(payload.counts || {});
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
    accumulateHistogram(payload.counts || {});
    handleAlerts(payload.alerts || []);
    renderDetectionList();
  });
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

  state.running = true;
  showStage("live");
  elements.startCameraSide.disabled = true;
  elements.stopCamera.disabled = false;
  elements.snapshotBtn.disabled = false;
  await refreshCameraOptions();
  connectSocket();
  captureLoop();
}

function stopCamera() {
  state.running = false;
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
  state.detections = [];
  renderDetectionList();
  elements.objectCount.textContent = "0";
  elements.latency.textContent = "--";
  elements.inferMs.textContent = "--";
  elements.streamFps.textContent = "--";
  elements.countsLine.textContent = "none";
  elements.lastUpdated.textContent = "Idle";
  elements.startCameraSide.disabled = false;
  elements.stopCamera.disabled = true;
  elements.snapshotBtn.disabled = true;
  setConnectionStatus("Offline");
  showStage("empty");
}

async function toggleFacing() {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  elements.facingLabel.textContent = state.facingMode === "user" ? "Front" : "Rear";
  savePrefs();
  if (!state.running) {
    return;
  }
  const wasRunning = true;
  stopCamera();
  if (wasRunning) {
    await startCamera();
  }
}

function captureLoop() {
  if (!state.running) {
    return;
  }

  const delay = 1000 / state.targetFps;
  window.setTimeout(captureLoop, delay);

  if (
    state.inFlight ||
    state.socket?.readyState !== WebSocket.OPEN ||
    elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }

  const sourceWidth = elements.video.videoWidth;
  const sourceHeight = elements.video.videoHeight;
  if (!sourceWidth || !sourceHeight) {
    return;
  }
  const width = Math.min(state.processingWidth, sourceWidth);
  const height = Math.round(width * (sourceHeight / sourceWidth));
  const canvas = elements.captureCanvas;

  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(elements.video, 0, 0, width, height);

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
    0.72,
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
  }
}

function drawOverlay() {
  const { context, width, height } = resizeOverlay();
  context.clearRect(0, 0, width, height);
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
  if (!state.running || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }
  const width = elements.video.videoWidth;
  const height = elements.video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(elements.video, 0, 0, width, height);
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
  elements.stopCamera.addEventListener("click", stopCamera);
  elements.facingBtn.addEventListener("click", () => {
    toggleFacing().catch((error) => {
      showCameraError("other", error.message);
    });
  });
  elements.snapshotBtn.addEventListener("click", captureSnapshot);
  elements.helpBtn.addEventListener("click", toggleShortcuts);
  elements.muteBtn.addEventListener("click", () => setMuted(!state.muted));

  elements.fpsRange.addEventListener("input", (event) => {
    state.targetFps = Number(event.target.value);
    elements.fpsValue.textContent = `${state.targetFps} fps`;
  });
  elements.widthRange.addEventListener("input", (event) => {
    state.processingWidth = Number(event.target.value);
    elements.widthValue.textContent = `${state.processingWidth} px`;
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
