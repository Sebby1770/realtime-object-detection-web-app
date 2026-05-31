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
};

const state = {
  stream: null,
  socket: null,
  running: false,
  inFlight: false,
  targetFps: Number(elements.fpsRange.value),
  processingWidth: Number(elements.widthRange.value),
  showLabels: true,
  detections: [],
  frameSize: { width: 1, height: 1 },
  sentFrames: 0,
  fpsStartedAt: performance.now(),
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

function connectSocket() {
  if (state.socket?.readyState === WebSocket.OPEN) {
    return;
  }

  state.socket = new WebSocket(socketUrl());
  state.socket.binaryType = "arraybuffer";
  setConnectionStatus("Connecting");

  state.socket.addEventListener("open", () => {
    setConnectionStatus("Live", true);
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
    if (payload.type === "error") {
      elements.lastUpdated.textContent = payload.message;
      return;
    }

    state.detections = payload.detections ?? [];
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

  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  elements.video.srcObject = state.stream;
  await elements.video.play();

  const ratio = `${elements.video.videoWidth} / ${elements.video.videoHeight}`;
  elements.videoStage.style.aspectRatio = ratio;

  state.running = true;
  elements.emptyState.classList.add("hidden");
  elements.startCameraSide.disabled = true;
  elements.stopCamera.disabled = false;

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
  elements.streamFps.textContent = "--";
  elements.lastUpdated.textContent = "Idle";
  elements.emptyState.classList.remove("hidden");
  elements.startCameraSide.disabled = false;
  elements.stopCamera.disabled = true;
  setConnectionStatus("Offline");
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

window.addEventListener("beforeunload", stopCamera);
window.addEventListener("load", () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

drawOverlay();
