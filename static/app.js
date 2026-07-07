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

    state.detections = payload.detections ?? [];
    recordHistory(payload);
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
  setConnectionStatus("Offline");
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

  for (const detection of state.detections) {
    const box = detection.box;
    const x = box.x * xScale;
    const y = box.y * yScale;
    const boxWidth = box.width * xScale;
    const boxHeight = box.height * yScale;
    const color = colorForLabel(detection.label);

    context.lineWidth = Math.max(2, Math.min(width, height) * 0.004);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.strokeRect(x, y, boxWidth, boxHeight);

    if (state.showLabels) {
      const label = `${detection.label} ${Math.round(detection.confidence * 100)}%`;
      context.font = "700 14px system-ui, sans-serif";
      const metrics = context.measureText(label);
      const labelHeight = 24;
      const labelWidth = metrics.width + 16;
      const labelY = y > labelHeight + 4 ? y - labelHeight - 4 : y + 4;

      context.fillRect(x, labelY, labelWidth, labelHeight);
      context.fillStyle = "#071111";
      context.fillText(label, x + 8, labelY + 16);
    }
  }

  requestAnimationFrame(drawOverlay);
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
});

elements.classFilter.addEventListener("change", () => {
  state.selectedClasses = selectedClasses();
  sendDetectionConfig();
});

elements.snapshotButton.addEventListener("click", captureSnapshot);
elements.clearHistoryButton.addEventListener("click", () => {
  state.history = [];
  renderHistory();
});

window.addEventListener("beforeunload", stopCamera);
window.addEventListener("load", () => {
  loadModelMetadata();
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

drawOverlay();
