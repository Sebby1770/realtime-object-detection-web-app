/**
 * The clean feed window: the studio picture and nothing else, for sharing in
 * a call. The label disappears once frames arrive so it is never in the
 * shared picture; moving the mouse shows it again for a moment.
 */

const canvas = document.querySelector("#out");
const context = canvas.getContext("2d");
const label = document.querySelector("#label");
const labelText = document.querySelector("#labelText");
let lastFrameAt = 0;
let hideTimer = null;

function showLabel(text, { live = false, linger = 2400 } = {}) {
  labelText.textContent = text;
  label.dataset.live = live ? "true" : "false";
  label.dataset.hidden = "false";
  document.body.classList.remove("is-idle");
  window.clearTimeout(hideTimer);
  if (linger > 0) {
    hideTimer = window.setTimeout(() => {
      label.dataset.hidden = "true";
      document.body.classList.add("is-idle");
    }, linger);
  }
}

if (!("BroadcastChannel" in window)) {
  showLabel("This browser cannot receive the studio picture.", { linger: 0 });
} else {
  const channel = new BroadcastChannel("detection-studio");
  channel.onmessage = async (event) => {
    const blob = event.data;
    if (!(blob instanceof Blob)) {
      return;
    }
    const bitmap = await createImageBitmap(blob);
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    if (!lastFrameAt) {
      showLabel("On air. Share this window in your call.", { live: true });
    }
    lastFrameAt = performance.now();
  };
}

window.setInterval(() => {
  if (lastFrameAt && performance.now() - lastFrameAt > 2500) {
    lastFrameAt = 0;
    showLabel("The studio stopped sending. Is the main tab still open?", { linger: 0 });
  }
}, 1000);

window.addEventListener("mousemove", () => {
  if (lastFrameAt) {
    showLabel("On air. Double-click for full screen.", { live: true });
  }
});

window.addEventListener("dblclick", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.documentElement.requestFullscreen?.();
  }
});

showLabel("Waiting for the studio picture", { linger: 0 });
