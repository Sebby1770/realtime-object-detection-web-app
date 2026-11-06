/** WebSocket client for the local FastAPI + YOLOv8 server. */

const CLOSE_REASONS = {
  1008: "The server refused this page's origin. Add it to WS_ALLOWED_ORIGINS.",
  1013: "The server is busy with other tabs. Close one and try again.",
};

function websocketUrl() {
  const url = new URL("ws/detect", document.baseURI);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function createServerRuntime(handlers = {}) {
  let socket = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer = null;
  let awaitingFrame = false;
  let sentAt = 0;
  let watchdog = null;

  function clearReconnect() {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function settle() {
    awaitingFrame = false;
    if (watchdog) {
      window.clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function connect() {
    closedByUser = false;
    clearReconnect();
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    socket = new WebSocket(websocketUrl());
    socket.binaryType = "arraybuffer";
    handlers.onStatus?.("connecting");

    socket.addEventListener("open", () => {
      attempt = 0;
      settle();
      handlers.onStatus?.("open");
      handlers.onOpen?.();
    });

    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (payload.type === "detections") {
        payload.rtt_ms = Math.round((performance.now() - sentAt) * 10) / 10;
        settle();
        handlers.onDetections?.(payload);
        return;
      }
      if (payload.type === "throttled" || payload.type === "dropped") {
        settle();
        return;
      }
      if (payload.type === "error") {
        settle();
        handlers.onError?.(payload.message || "The server could not process that frame.", payload.code || "");
        return;
      }
      if (payload.type === "roi_alert_ack") {
        handlers.onRoiAck?.(payload);
      }
    });

    socket.addEventListener("close", (event) => {
      settle();
      if (closedByUser) {
        handlers.onStatus?.("closed");
        return;
      }
      const reason = CLOSE_REASONS[event.code];
      if (reason) {
        handlers.onError?.(reason, `close_${event.code}`);
      }
      handlers.onStatus?.("reconnecting");
      const delay = Math.min(8000, 400 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    });
  }

  return {
    connect,
    disconnect() {
      closedByUser = true;
      clearReconnect();
      if (socket) {
        socket.close();
        socket = null;
      }
      settle();
      handlers.onStatus?.("closed");
    },
    sendConfig(config) {
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(JSON.stringify({ type: "config", confidence: config.confidence, classes: config.classes }));
    },
    sendRoiAlert() {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "roi_alert" }));
      }
    },
    sendFrame(buffer) {
      if (socket?.readyState !== WebSocket.OPEN || awaitingFrame) {
        return false;
      }
      awaitingFrame = true;
      sentAt = performance.now();
      socket.send(buffer);
      // A lost reply must not stall the loop forever.
      watchdog = window.setTimeout(settle, 4000);
      return true;
    },
    get busy() {
      return awaitingFrame;
    },
    get isOpen() {
      return socket?.readyState === WebSocket.OPEN;
    },
  };
}
