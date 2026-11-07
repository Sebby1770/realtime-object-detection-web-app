/** Short confirmations and errors at the bottom of the window. */

export function createToaster(container, { max = 3 } = {}) {
  function dismiss(toast) {
    if (!toast.isConnected || toast.classList.contains("is-leaving")) {
      return;
    }
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }

  function show(message, { tone = "info", timeout = 3200 } = {}) {
    if (!container || !message) {
      return null;
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.tone = tone;
    toast.textContent = message;
    toast.addEventListener("click", () => dismiss(toast));
    container.append(toast);
    const toasts = [...container.querySelectorAll(".toast:not(.is-leaving)")];
    for (const extra of toasts.slice(0, Math.max(0, toasts.length - max))) {
      dismiss(extra);
    }
    if (timeout > 0) {
      window.setTimeout(() => dismiss(toast), tone === "error" ? Math.max(timeout, 5200) : timeout);
    }
    return toast;
  }

  return {
    show,
    ok: (message, options) => show(message, { ...options, tone: "ok" }),
    error: (message, options) => show(message, { ...options, tone: "error" }),
  };
}
