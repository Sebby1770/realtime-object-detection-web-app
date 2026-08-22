const CLOSE_REASONS = {
  1008: "Connection rejected: origin is not allowed.",
  1013: "Server is busy. Try again later.",
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

  function clearReconnect() {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
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
    handlers.onStatus?.("Connecting", false);

    socket.addEventListener("open", () => {
      attempt = 0;
      awaitingFrame = false;
      handlers.onStatus?.("Live", true);
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
        awaitingFrame = false;
        handlers.onDetections?.(payload);
        return;
      }
      if (payload.type === "error" || payload.type === "dropped") {
        awaitingFrame = false;
        handlers.onNotice?.(payload.message || payload.type);
        return;
      }
      if (payload.type === "config_ack") {
        handlers.onNotice?.("Model config applied");
        return;
      }
      if (payload.type === "roi_alert_ack") {
        handlers.onRoiAck?.(payload);
      }
    });

    socket.addEventListener("close", (event) => {
      awaitingFrame = false;
      const reason = CLOSE_REASONS[event.code];
      if (closedByUser) {
        handlers.onStatus?.("Offline", false);
        return;
      }
      if (reason) {
        handlers.onNotice?.(reason);
        handlers.onStatus?.(reason, false);
      } else {
        handlers.onStatus?.("Reconnecting", false);
      }
      const delay = Math.min(8000, 400 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    });

    socket.addEventListener("error", () => {
      handlers.onStatus?.("Socket error", false);
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
      awaitingFrame = false;
      handlers.onStatus?.("Offline", false);
    },
    sendConfig(config) {
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: "config",
          confidence: config.confidence,
          classes: config.classes,
        }),
      );
    },
    sendRoiAlert() {
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(JSON.stringify({ type: "roi_alert" }));
    },
    sendFrame(buffer) {
      if (socket?.readyState !== WebSocket.OPEN || awaitingFrame) {
        return false;
      }
      awaitingFrame = true;
      socket.send(buffer);
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
