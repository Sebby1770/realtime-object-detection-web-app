const elements = {
  video: document.querySelector("#video"),
  overlay: document.querySelector("#overlay"),
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
  classFilter: document.querySelector("#classFilter"),
  snapshotButton: document.querySelector("#snapshotButton"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  historyList: document.querySelector("#historyList"),
  historyCount: document.querySelector("#historyCount"),
  modelName: document.querySelector("#modelName"),
  heatmap: document.querySelector("#heatmap"),
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
};

const state = {
  stream: null,
  socket: null,
  demoCanvas: null,
  demoTimer: null,
  demoMode: false,
  running: false,
  inFlight: false,
  targetFps: Number(elements.fpsRange.value),
  processingWidth: Number(elements.widthRange.value),
  showLabels: true,
  detections: [],
  frameSize: { width: 1, height: 1 },
  sentFrames: 0,
  fpsStartedAt: performance.now(),
  confidence: Number(elements.confidenceRange.value),
  selectedClasses: [],
  history: [],
  modelClasses: [],
  classCounts: {},
  latencySamples: [],
  showHeatmap: true,
  heatmapCells: [],
  cornerBoxes: false,
  showTrails: true,
  alertSound: true,
  paused: false,
  rois: [],
  roiDrawing: false,
  roiStart: null,
  maxRois: 3,
  privacyMode: false,
  sonify: false,
  ghostMode: true,
  spatialAudio: true,
  privacyBlur: 14,
  ghostOpacity: 0.28,
  sonifyChord: true,
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

const palette = [
  "#38d6c6",
  "#ff6f59",
  "#f5c84b",
  "#7bd88f",
  "#c084fc",
  "#7dd3fc",
  "#f472b6",
  "#fb923c",
];

function alphaColor(hex, opacity) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function colorForLabel(label) {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

function setConnectionStatus(label, online = false) {
  elements.connectionStatus.classList.toggle("online", online);
  elements.connectionStatus.querySelector("span:last-child").textContent = label;
}

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/detect`;
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
    }, 2500);
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

  context.fillStyle = "rgba(245, 241, 232, 0.9)";
  context.font = "700 34px system-ui, sans-serif";
  context.fillText("Demo video feed", 42, 66);
  context.font = "500 20px system-ui, sans-serif";
  context.fillText("Camera fallback is active", 42, 98);
}

function stopDemoStream() {
  if (state.demoTimer) {
    window.clearInterval(state.demoTimer);
    state.demoTimer = null;
  }

  if (state.demoCanvas) {
    state.demoCanvas.remove();
    state.demoCanvas = null;
  }

  state.demoMode = false;
  elements.video.style.display = "";
}

function createDemoStream() {
  stopDemoStream();

  const canvas = document.createElement("canvas");
  canvas.className = "demo-feed";
  canvas.width = 960;
  canvas.height = 540;
  canvas.setAttribute("aria-label", "Demo video feed");
  elements.videoStage.insertBefore(canvas, elements.overlay);
  elements.video.style.display = "none";

  drawDemoFrame(canvas);
  state.demoTimer = window.setInterval(() => drawDemoFrame(canvas), 1000 / 12);
  state.demoCanvas = canvas;
  state.demoMode = true;
  elements.lastUpdated.textContent = "Demo stream active";

  if (typeof canvas.captureStream === "function") {
    return canvas.captureStream(12);
  }

  return null;
}

function connectSocket() {
  if (state.socket?.readyState === WebSocket.OPEN) {
    return;
  }

  state.socket = new WebSocket(socketUrl());
  state.socket.binaryType = "arraybuffer";
  setConnectionStatus("Connecting");

  state.socket.addEventListener("open", () => {
    setConnectionStatus("Live", true);
    sendDetectionConfig();
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
    state.inFlight = false;

    const payload = JSON.parse(event.data);
    if (payload.type === "error" || payload.type === "dropped") {
      elements.lastUpdated.textContent = payload.message;
      return;
    }

    if (state.ghostMode && state.detections.length) {
      state.ghostDetections = state.detections.map((item) => ({
        ...item,
        box: { ...item.box },
      }));
    }
    state.detections = payload.detections ?? [];
    state.classCounts = payload.class_counts ?? {};
    sonifyDetections(state.detections);
    recordDensity(state.detections.length);
    recordHistory(payload);
    updateHeatmap(payload.detections ?? []);
    recordLatency(payload.latency_ms);
    renderClassChips();
    updateSessionStats(payload.session);
    checkRoiAlerts(state.detections);
    state.frameSize = {
      width: payload.frame_width || 1,
      height: payload.frame_height || 1,
    };
    elements.objectCount.textContent = String(state.detections.length);
    elements.latency.textContent = `${payload.latency_ms ?? "--"} ms`;
    elements.lastUpdated.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    renderDetectionList();
  });
}

async function startCamera() {
  if (state.running) {
    return;
  }

  stopDemoStream();

  const camera = await requestCameraStream();
  state.stream = camera.stream || createDemoStream();

  if (state.stream) {
    elements.video.srcObject = state.stream;
    await elements.video.play().catch(() => {});
  }

  const sourceWidth = state.demoMode
    ? state.demoCanvas.width
    : elements.video.videoWidth || 1280;
  const sourceHeight = state.demoMode
    ? state.demoCanvas.height
    : elements.video.videoHeight || 720;
  const ratio = `${sourceWidth} / ${sourceHeight}`;
  elements.videoStage.style.aspectRatio = ratio;

  state.running = true;
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
  }

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
  stopDemoStream();

  elements.video.srcObject = null;
  state.detections = [];
  renderDetectionList();
  elements.objectCount.textContent = "0";
  elements.latency.textContent = "--";
  elements.streamFps.textContent = "--";
  elements.lastUpdated.textContent = "Idle";
  elements.emptyState.classList.remove("hidden");
  elements.startCameraSide.disabled = false;
  elements.stopCamera.disabled = true;
  elements.snapshotButton.disabled = true;
  elements.clearHistoryButton.disabled = true;
  elements.exportHistoryButton.disabled = true;
  elements.roiDrawButton.disabled = true;
  elements.roiClearButton.disabled = true;
  elements.pauseButton.disabled = true;
  state.paused = false;
  elements.pauseButton.textContent = "Pause";
  setConnectionStatus("Offline");
}

function updateSessionStats(session) {
  if (!session) return;
  state.session = session;
  elements.sessionFrames.textContent = String(session.frames_processed ?? 0);
  elements.sessionDetections.textContent = String(session.detections_total ?? 0);
  elements.sessionClasses.textContent = String(session.classes_seen?.length ?? 0);
  elements.roiAlerts.textContent = String(state.session.roi_alerts ?? 0);
}

function pointInRoi(x, y, roi, frameWidth, frameHeight) {
  const left = roi.x * frameWidth;
  const top = roi.y * frameHeight;
  const right = left + roi.width * frameWidth;
  const bottom = top + roi.height * frameHeight;
  return x >= left && x <= right && y >= top && y <= bottom;
}

const ROI_COLORS = ["rgba(245, 200, 75, 0.9)", "rgba(56, 214, 198, 0.9)", "rgba(255, 111, 89, 0.9)"];
const SONIFY_NOTES = {
  person: 261.63,
  bicycle: 293.66,
  car: 329.63,
  dog: 349.23,
  cat: 392.0,
  default: 440.0,
};
const PRIVACY_LABELS = new Set(["person"]);

function noteForLabel(label) {
  return SONIFY_NOTES[label] ?? SONIFY_NOTES.default;
}

function playSpatialPing(detection) {
  if (!state.spatialAudio) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const panner = context.createStereoPanner();
  const gain = context.createGain();
  const centerX = detection.box.x + detection.box.width / 2;
  const pan = (centerX / Math.max(1, state.frameSize.width)) * 2 - 1;
  oscillator.frequency.value = noteForLabel(detection.label);
  gain.gain.value = 0.03;
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  oscillator.connect(gain);
  gain.connect(panner);
  panner.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.08);
  oscillator.onended = () => context.close();
}

function sonifyDetections(detections) {
  if (!state.sonify || !detections.length) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.02;
  master.connect(context.destination);
  const voices = state.sonifyChord
    ? detections.slice(0, 3)
    : detections.slice(0, 1);
  voices.forEach((detection, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = index === 0 ? "triangle" : "sine";
    oscillator.frequency.value = noteForLabel(detection.label) * (1 + index * 0.04);
    gain.gain.value = 0.9 / voices.length;
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(context.currentTime + index * 0.03);
    oscillator.stop(context.currentTime + 0.12 + index * 0.03);
    oscillator.onended = () => {
      if (index === voices.length - 1) context.close();
    };
  });
}

function recordDensity(count) {
  state.densitySamples = [...state.densitySamples, count].slice(-24);
  const average = state.densitySamples.reduce((sum, item) => sum + item, 0) / state.densitySamples.length;
  elements.densityAvg.textContent = `${average.toFixed(1)} avg`;
  drawDensityChart();
}

function drawDensityChart() {
  const canvas = elements.densityChart;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#101012";
  context.fillRect(0, 0, width, height);
  if (!state.densitySamples.length) return;
  const max = Math.max(...state.densitySamples, 1);
  context.fillStyle = "#7bd88f";
  state.densitySamples.forEach((sample, index) => {
    const barWidth = (width - 8) / state.densitySamples.length;
    const x = 4 + index * barWidth;
    const barHeight = (sample / max) * (height - 8);
    context.fillRect(x, height - 4 - barHeight, Math.max(2, barWidth - 2), barHeight);
  });
}

function drawProximityRadar() {
  const canvas = elements.proximityRadar;
  const context = canvas.getContext("2d");
  const size = canvas.width;
  const center = size / 2;
  const radius = size * 0.42;
  context.clearRect(0, 0, size, size);
  context.fillStyle = "#101012";
  context.fillRect(0, 0, size, size);
  context.strokeStyle = "rgba(56, 214, 198, 0.25)";
  for (let ring = 1; ring <= 3; ring += 1) {
    context.beginPath();
    context.arc(center, center, (radius * ring) / 3, 0, Math.PI * 2);
    context.stroke();
  }
  state.detections.forEach((detection) => {
    const box = detection.box;
    const x = center + ((box.x + box.width / 2) / state.frameSize.width - 0.5) * radius * 2;
    const y = center + ((box.y + box.height / 2) / state.frameSize.height - 0.5) * radius * 2;
    context.fillStyle = colorForLabel(detection.label);
    context.beginPath();
    context.arc(x, y, 4 + detection.confidence * 4, 0, Math.PI * 2);
    context.fill();
  });
  elements.radarCount.textContent = `${state.detections.length} blips`;
}

function exportFilmstripGallery() {
  if (!state.filmstrip.length) return;
  const cards = state.filmstrip
    .map(
      (clip) => `
        <figure style="margin:0;border:1px solid #303037;border-radius:8px;overflow:hidden;">
          <img src="${clip.dataUrl}" alt="${clip.label}" style="width:100%;display:block;">
          <figcaption style="padding:8px;font:12px sans-serif;color:#a9a49a;">${clip.stamp} · ${clip.label}</figcaption>
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
  const { width, height } = resizeOverlay();
  const source = state.demoMode ? state.demoCanvas : elements.video;
  if (!source) return;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0, width, height);
  context.drawImage(elements.overlay, 0, 0, width, height);
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

function playAlertTone() {
  if (!state.alertSound) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);
  oscillator.onended = () => context.close();
}

function checkRoiAlerts(detections) {
  if (!state.rois.length) return;
  for (const detection of detections) {
    const box = detection.box;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    for (let index = 0; index < state.rois.length; index += 1) {
      const roi = state.rois[index];
      if (pointInRoi(centerX, centerY, roi, state.frameSize.width, state.frameSize.height)) {
        state.session.roi_alerts += 1;
        elements.roiAlerts.textContent = String(state.session.roi_alerts);
        elements.roiStatus.textContent = `Alert: ${detection.label} entered zone ${index + 1}`;
        playAlertTone();
        playSpatialPing(detection);
        captureFilmstripFrame(detection.label);
        return;
      }
    }
  }
}

function togglePause() {
  state.paused = !state.paused;
  elements.pauseButton.textContent = state.paused ? "Resume" : "Pause";
  elements.lastUpdated.textContent = state.paused ? "Detection paused" : "Running";
}

function applyTheme(light) {
  document.documentElement.dataset.theme = light ? "light" : "dark";
  elements.themeToggle.checked = light;
  localStorage.setItem("object-detection-theme", light ? "light" : "dark");
}

function loadTheme() {
  const saved = localStorage.getItem("object-detection-theme");
  applyTheme(saved === "light");
}

function drawCornerBox(context, x, y, width, height, color) {
  const arm = Math.min(width, height) * 0.22;
  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(x, y + arm);
  context.lineTo(x, y);
  context.lineTo(x + arm, y);
  context.moveTo(x + width - arm, y);
  context.lineTo(x + width, y);
  context.lineTo(x + width, y + arm);
  context.moveTo(x + width, y + height - arm);
  context.lineTo(x + width, y + height);
  context.lineTo(x + width - arm, y + height);
  context.moveTo(x + arm, y + height);
  context.lineTo(x, y + height);
  context.lineTo(x, y + height - arm);
  context.stroke();
}

async function detectUploadedImages(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;

  if (files.length === 1) {
    const form = new FormData();
    form.append("image", files[0]);
    elements.uploadDetectStatus.textContent = "Detecting...";
    try {
      const response = await fetch(`/api/detect?confidence=${state.confidence}`, {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      applyDetectionPayload(payload);
      elements.uploadDetectStatus.textContent = `Detected ${state.detections.length} object(s) in ${files[0].name}.`;
    } catch {
      elements.uploadDetectStatus.textContent = "Upload detection failed.";
    }
    return;
  }

  const form = new FormData();
  files.forEach((file) => form.append("images", file));
  elements.uploadDetectStatus.textContent = `Detecting ${files.length} images...`;
  try {
    const response = await fetch(`/api/detect/batch?confidence=${state.confidence}`, {
      method: "POST",
      body: form,
    });
    const payload = await response.json();
    const results = payload.results ?? [];
    const total = results.reduce((sum, item) => sum + (item.detections?.length ?? 0), 0);
    if (results[0]) {
      applyDetectionPayload(results[0]);
    }
    elements.uploadDetectStatus.textContent = `Batch complete: ${total} detections across ${results.length} image(s).`;
  } catch {
    elements.uploadDetectStatus.textContent = "Batch upload detection failed.";
  }
}

function applyDetectionPayload(payload) {
  state.detections = payload.detections ?? [];
  state.frameSize = {
    width: payload.frame_width || 1,
    height: payload.frame_height || 1,
  };
  state.classCounts = payload.class_counts ?? {};
  renderClassChips();
  renderDetectionList();
  elements.objectCount.textContent = String(state.detections.length);
}

function recordLatency(value) {
  if (typeof value !== "number") return;
  state.latencySamples = [...state.latencySamples, value].slice(-24);
  const average = state.latencySamples.reduce((sum, item) => sum + item, 0) / state.latencySamples.length;
  elements.latencyAvg.textContent = `${Math.round(average)} ms avg`;
  drawLatencyChart();
}

function drawLatencyChart() {
  const canvas = elements.latencyChart;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#101012";
  context.fillRect(0, 0, width, height);
  if (!state.latencySamples.length) return;
  const max = Math.max(...state.latencySamples, 1);
  context.strokeStyle = "#38d6c6";
  context.lineWidth = 2;
  context.beginPath();
  state.latencySamples.forEach((sample, index) => {
    const x = (index / Math.max(1, state.latencySamples.length - 1)) * (width - 8) + 4;
    const y = height - 6 - (sample / max) * (height - 12);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function renderClassChips() {
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

function updateHeatmap(detections) {
  if (!state.showHeatmap) return;
  const grid = state.heatmapCells;
  for (const detection of detections) {
    const box = detection.box;
    const centerX = Math.min(15, Math.max(0, Math.floor(((box.x + box.width / 2) / state.frameSize.width) * 16)));
    const centerY = Math.min(8, Math.max(0, Math.floor(((box.y + box.height / 2) / state.frameSize.height) * 9)));
    const index = centerY * 16 + centerX;
    grid[index] = Math.min(1, (grid[index] || 0) + 0.22);
  }
  for (let index = 0; index < grid.length; index += 1) {
    grid[index] = (grid[index] || 0) * 0.96;
  }
}

function drawHeatmap() {
  const rect = elements.videoStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (elements.heatmap.width !== width || elements.heatmap.height !== height) {
    elements.heatmap.width = width;
    elements.heatmap.height = height;
  }
  const context = elements.heatmap.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  if (!state.showHeatmap) return;
  const cellWidth = rect.width / 16;
  const cellHeight = rect.height / 9;
  state.heatmapCells.forEach((value, index) => {
    if (!value || value < 0.03) return;
    const x = (index % 16) * cellWidth;
    const y = Math.floor(index / 16) * cellHeight;
    context.fillStyle = `rgba(56, 214, 198, ${value * 0.55})`;
    context.fillRect(x, y, cellWidth, cellHeight);
  });
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
    "object-detection-settings",
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
    }),
  );
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("object-detection-settings") || "{}");
    if (saved.confidence != null) {
      state.confidence = saved.confidence;
      elements.confidenceRange.value = String(saved.confidence);
      elements.confidenceValue.textContent = `${Math.round(saved.confidence * 100)}%`;
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
  } catch {
    // ignore invalid saved settings
  }
}

function sendDetectionConfig() {
  if (state.socket?.readyState !== WebSocket.OPEN) return;
  state.socket.send(
    JSON.stringify({
      type: "config",
      confidence: state.confidence,
      classes: state.selectedClasses,
    }),
  );
}

function selectedClasses() {
  return Array.from(elements.classFilter.selectedOptions).map((option) => option.value);
}

function populateClassFilter(classes) {
  state.modelClasses = classes;
  elements.classFilter.replaceChildren(
    ...classes.map((label) => {
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      option.selected = state.selectedClasses.includes(label);
      return option;
    }),
  );
}

async function loadModelMetadata() {
  try {
    const response = await fetch("/api/model");
    const payload = await response.json();
    elements.modelName.textContent = payload.model || "YOLOv8n";
    populateClassFilter(payload.classes || []);
  } catch {
    elements.modelName.textContent = "YOLOv8n";
  }
}

function recordHistory(payload) {
  if (!payload.detections?.length) return;
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
  const { context, width, height } = resizeOverlay();
  const source = state.demoMode ? state.demoCanvas : elements.video;
  if (!source) return;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const snapshotContext = canvas.getContext("2d");
  snapshotContext.drawImage(source, 0, 0, width, height);
  snapshotContext.drawImage(elements.overlay, 0, 0, width, height);

  const link = document.createElement("a");
  link.download = `detection-snapshot-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function captureLoop() {
  if (!state.running) {
    return;
  }

  const delay = 1000 / state.targetFps;
  window.setTimeout(captureLoop, delay);

  if (
    state.paused ||
    state.inFlight ||
    state.socket?.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  if (!state.demoMode && elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  const source = state.demoMode ? state.demoCanvas : elements.video;
  const sourceWidth = state.demoMode ? source.width : source.videoWidth;
  const sourceHeight = state.demoMode ? source.height : source.videoHeight;
  const width = Math.min(state.processingWidth, sourceWidth);
  const height = Math.round(width * (sourceHeight / sourceWidth));
  const canvas = elements.captureCanvas;

  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);

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
    elements.streamFps.textContent = `${Math.round((state.sentFrames * 1000) / elapsed)} fps`;
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

function drawOverlay() {
  const { context, width, height } = resizeOverlay();
  context.clearRect(0, 0, width, height);

  const xScale = width / state.frameSize.width;
  const yScale = height / state.frameSize.height;

  state.rois.forEach((roi, index) => {
    const roiX = roi.x * width;
    const roiY = roi.y * height;
    const roiW = roi.width * width;
    const roiH = roi.height * height;
    context.strokeStyle = ROI_COLORS[index % ROI_COLORS.length];
    context.setLineDash([8, 6]);
    context.strokeRect(roiX, roiY, roiW, roiH);
    context.setLineDash([]);
    context.fillStyle = ROI_COLORS[index % ROI_COLORS.length];
    context.font = "700 12px system-ui, sans-serif";
    context.fillText(`Z${index + 1}`, roiX + 6, roiY + 16);
  });

  const drawDetection = (detection, alpha = 1) => {
    const box = detection.box;
    const x = box.x * xScale;
    const y = box.y * yScale;
    const boxWidth = box.width * xScale;
    const boxHeight = box.height * yScale;
    const color = colorForLabel(detection.label);
    context.globalAlpha = alpha;

    if (state.privacyMode && PRIVACY_LABELS.has(detection.label)) {
      context.save();
      context.beginPath();
      context.rect(x, y, boxWidth, boxHeight);
      context.clip();
      context.filter = `blur(${state.privacyBlur}px)`;
      const source = state.demoMode ? state.demoCanvas : elements.video;
      if (source) {
        context.drawImage(source, 0, 0, width, height);
      } else {
        context.fillStyle = "rgba(7, 17, 17, 0.75)";
        context.fillRect(x, y, boxWidth, boxHeight);
      }
      context.restore();
      context.globalAlpha = alpha;
      context.strokeStyle = color;
      context.strokeRect(x, y, boxWidth, boxHeight);
      context.globalAlpha = 1;
      return;
    }

    if (state.showTrails && detection.trail?.length > 1) {
      context.strokeStyle = alphaColor(color, 0.55);
      context.lineWidth = 2;
      context.beginPath();
      detection.trail.forEach((point, index) => {
        const px = point.x * xScale;
        const py = point.y * yScale;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.stroke();
    }

    context.lineWidth = Math.max(2, Math.min(width, height) * 0.004);
    context.strokeStyle = color;
    context.fillStyle = color;
    if (state.cornerBoxes) {
      drawCornerBox(context, x, y, boxWidth, boxHeight, color);
    } else {
      context.strokeRect(x, y, boxWidth, boxHeight);
    }

    if (state.showLabels) {
      const track = detection.track_id ? `#${detection.track_id} ` : "";
      const label = `${track}${detection.label} ${Math.round(detection.confidence * 100)}%`;
      context.font = "700 14px system-ui, sans-serif";
      const metrics = context.measureText(label);
      const labelHeight = 24;
      const labelWidth = metrics.width + 16;
      const labelY = y > labelHeight + 4 ? y - labelHeight - 4 : y + 4;

      context.fillRect(x, labelY, labelWidth, labelHeight);
      context.fillStyle = "#071111";
      context.fillText(label, x + 8, labelY + 16);
    }
    context.globalAlpha = 1;
  };

  if (state.ghostMode) {
    state.ghostDetections.forEach((detection) => drawDetection(detection, state.ghostOpacity));
  }
  state.detections.forEach((detection) => drawDetection(detection, 1));
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
      label.textContent = detection.label;
      confidence.className = "confidence";
      confidence.textContent = `${Math.round(detection.confidence * 100)}%`;

      row.append(swatch, label, confidence);
      return row;
    });

  elements.detectionList.replaceChildren(...rows);
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
  state.confidence = Number(event.target.value);
  elements.confidenceValue.textContent = `${Math.round(state.confidence * 100)}%`;
  sendDetectionConfig();
  saveSettings();
});

elements.classFilter.addEventListener("change", () => {
  state.selectedClasses = selectedClasses();
  sendDetectionConfig();
  saveSettings();
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
  if (state.rois.length >= state.maxRois) {
    elements.roiStatus.textContent = `Maximum ${state.maxRois} zones reached.`;
    return;
  }
  state.roiDrawing = true;
  elements.roiStatus.textContent = "Click and drag on the video to add a zone.";
});

elements.roiClearButton.addEventListener("click", () => {
  state.rois = [];
  state.roiDrawing = false;
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

elements.overlay.addEventListener("pointerdown", (event) => {
  if (!state.roiDrawing) return;
  const rect = elements.videoStage.getBoundingClientRect();
  state.roiStart = {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
});

elements.overlay.addEventListener("pointerup", (event) => {
  if (!state.roiDrawing || !state.roiStart) return;
  const rect = elements.videoStage.getBoundingClientRect();
  const endX = (event.clientX - rect.left) / rect.width;
  const endY = (event.clientY - rect.top) / rect.height;
  if (state.rois.length < state.maxRois) {
    state.rois.push({
      x: Math.min(state.roiStart.x, endX),
      y: Math.min(state.roiStart.y, endY),
      width: Math.abs(endX - state.roiStart.x),
      height: Math.abs(endY - state.roiStart.y),
    });
  }
  state.roiDrawing = false;
  state.roiStart = null;
  elements.roiStatus.textContent = `${state.rois.length} zone(s) armed.`;
});

elements.fpsRange.addEventListener("change", saveSettings);
elements.widthRange.addEventListener("change", saveSettings);
elements.labelToggle.addEventListener("change", saveSettings);

elements.snapshotButton.addEventListener("click", captureSnapshot);
elements.exportHistoryButton.addEventListener("click", exportHistory);
elements.clearHistoryButton.addEventListener("click", () => {
  state.history = [];
  renderHistory();
});

window.addEventListener("beforeunload", stopCamera);
window.addEventListener("load", () => {
  state.heatmapCells = Array.from({ length: 16 * 9 }, () => 0);
  loadTheme();
  loadSettings();
  loadModelMetadata();
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function renderStage() {
  drawOverlay();
  drawHeatmap();
  drawProximityRadar();
  requestAnimationFrame(renderStage);
}

renderStage();
