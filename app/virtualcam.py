"""Latest-frame bridge for a virtual camera and an MJPEG studio feed.

Photo Booth, Zoom, FaceTime, Meet, Teams, Discord, and QuickTime can select
OBS Virtual Camera once ``pyvirtualcam`` is installed and OBS has registered
its camera extension. Without that package the bridge still keeps the latest
JPEG so ``/api/studio.mjpg`` and the clean-feed window keep working.
"""

from __future__ import annotations

import threading
import time


class StudioBridge:
    def __init__(self) -> None:
        self.latest: bytes | None = None
        self.frames = 0
        self.error: str | None = None
        self.backend = _probe_backend()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    def reset(self) -> None:
        with self._lock:
            self.latest = None
            self.frames = 0
            self.error = None

    def push(self, jpeg: bytes) -> None:
        with self._lock:
            self.latest = jpeg
            self.frames += 1
        if self.backend:
            self._ensure_thread()

    def snapshot(self) -> bytes | None:
        with self._lock:
            return self.latest

    def status(self) -> dict[str, object]:
        with self._lock:
            frames = self.frames
            error = self.error
        return {
            "available": self.backend == "pyvirtualcam" and error is None,
            "backend": self.backend or "buffer",
            "receiving": frames > 0,
            "frames": frames,
            "device_hint": "OBS Virtual Camera" if self.backend == "pyvirtualcam" else None,
            "mjpeg_path": "/api/studio.mjpg",
            "error": error,
        }

    def _ensure_thread(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._pump, name="studio-virtualcam", daemon=True)
        self._thread.start()

    def _pump(self) -> None:
        try:
            import cv2
            import numpy as np
            import pyvirtualcam
        except Exception as exc:  # pragma: no cover - optional dependency
            with self._lock:
                self.error = f"Virtual camera backend unavailable: {exc}"
            return

        camera = None
        try:
            while True:
                frame = self.snapshot()
                if not frame:
                    time.sleep(0.05)
                    continue
                image = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    time.sleep(0.05)
                    continue
                rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                height, width = rgb.shape[:2]
                if camera is None or camera.width != width or camera.height != height:
                    if camera is not None:
                        camera.close()
                    camera = pyvirtualcam.Camera(
                        width=width,
                        height=height,
                        fps=20,
                        fmt=pyvirtualcam.PixelFormat.RGB,
                    )
                camera.send(rgb)
                camera.sleep_until_next_frame()
        except Exception as exc:  # pragma: no cover - needs a real camera extension
            with self._lock:
                self.error = str(exc)
        finally:
            if camera is not None:
                camera.close()


def _probe_backend() -> str | None:
    try:
        import pyvirtualcam  # noqa: F401
    except Exception:
        return None
    return "pyvirtualcam"
