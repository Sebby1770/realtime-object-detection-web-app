# Real-Time Object Detection Web App

Dual-runtime vision console: a live webcam (or demo) feed, boxes on a canvas, class counts, ROI alerts, privacy cloak, a studio that can make you disappear, photo booth strips, and a bridge into Zoom, Photo Booth, FaceTime, Meet, Teams, Discord, OBS, and QuickTime.

- **Local:** FastAPI + WebSocket JPEGs + YOLOv8n (OpenCV decode).
- **GitHub Pages / no backend:** TensorFlow.js coco-ssd (`lite_mobilenet_v2`) in the browser. Frames never leave the tab.

Both runtimes emit the same detection JSON, so overlay, heatmap, radar, ROI, sonification, filmstrip, and history keep working either way.

Live Pages demo: [https://Sebby1770.github.io/realtime-object-detection-web-app/](https://Sebby1770.github.io/realtime-object-detection-web-app/)

On Pages, click **Desk**, **Kitchen**, or **Street** if you do not want to grant camera access. Those stills contain COCO objects the in-browser model can actually see. Geometric demo video is now an explicit **Synthetic demo** control for pipeline testing.

## Features

- Auto runtime: `GET health` → YOLOv8 server; otherwise COCO-SSD in-browser. Manual toggle on the Model panel.
- `object-fit: contain` letterbox mapping so boxes are not stretched.
- Searchable class chips, collapsible control groups, video-first layout.
- Multi-ROI zones with edge-triggered alerts (enter + 1.2s cooldown).
- Privacy cloak: on-device in browser mode; in server mode it is labeled overlay-only and person boxes are blurred on the capture canvas before JPEG encode.
- Demo-feed fallback with a visible **Demo feed** badge (8s camera timeout).
- Keyboard: `Space` pause, `S` snapshot, `Esc` cancel ROI draw.
- Light theme that actually restyles the page background.
- Studio effects on the outgoing picture: Invisible (people removed), portrait blur, background replace, pixelate, spotlight, and outline. Color grades (warm, noir, vivid, dawn) tint that same picture. Mirror (`M`) flips it for a call, auto frame zooms toward people, and a name plate is burned in as readable text. `D` toggles invisible, `B` captures a background plate, `P` runs the photo booth.
- Home screen with sample scenes and a **Go invisible** button.
- Copilot beside the picture. Pick **Grok**, **ChatGPT**, or **Claude**, paste that provider's API key, and ask. Listen uses the browser speech recognizer. "Include detection labels" sends class counts, not the camera frame. Replies stay in the panel and are not burned into the clean feed or virtual camera. GitHub Pages can still run detection on-device; the copilot call needs the local server. Keys are not written into the repo.
- Photo booth: countdown, four-shot strip, PNG download.
- Clean-feed window for screen share, WebM recording, and a local virtual-camera bridge (`OBS Virtual Camera` via `pyvirtualcam`) plus an MJPEG URL for OBS.

## Stack

| Path | Stack |
|---|---|
| Frontend | HTML, CSS, Canvas, ES modules (`static/*.js`) |
| Server runtime | FastAPI, WebSockets, OpenCV, Ultralytics YOLOv8 |
| Browser runtime | TensorFlow.js 4.22 + coco-ssd 2.2.3 (jsDelivr, lazy-loaded) |
| Default models | `yolov8n.pt` locally · coco-ssd `lite_mobilenet_v2` on Pages |

## Run locally (YOLOv8)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

### Use it as your camera

Disappear and the other studio effects are burned into the picture those apps see.

1. Start the camera, choose **Disappear** (or Portrait blur / Replace background), step out, and press **Capture plate**.
2. Press **Clean feed** and share that window in Zoom, Meet, Teams, or Discord.
3. For Photo Booth, FaceTime, QuickTime, and the camera picker in Zoom, install [OBS](https://obsproject.com/) once, then:

```bash
pip install -r requirements-virtualcam.txt
```

Turn on **Send to virtual camera** and choose **OBS Virtual Camera** in the other app. The Studio panel lists the exact menu for Zoom, Google Meet, Teams, Photo Booth, FaceTime, Discord, OBS, QuickTime, Slack, Webex, and Twitch.

OBS can also open `http://127.0.0.1:8000/api/studio.mjpg` as a media source while this server is running. GitHub Pages still runs detection on-device, including Disappear and the photo booth; the virtual camera and MJPEG URL exist only on the local server.

The first inference may take a moment while Ultralytics downloads the YOLOv8 nano weights. Do not commit `*.pt` files.

## GitHub Pages (in-browser)

Pages serves `index.html` + `static/` from the repo root. There is no Python, OpenCV, or WebSocket on `github.io`. The UI probes `health`, fails closed, and loads coco-ssd. Camera frames stay in the tab.

## Configuration

Environment variables:

```bash
YOLO_MODEL=yolov8n.pt
YOLO_CONFIDENCE=0.35
YOLO_IMAGE_SIZE=640
WS_ALLOWED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
MAX_FRAME_BYTES=524288
MAX_UPLOAD_BYTES=8388608
MIN_FRAME_INTERVAL_SECONDS=0.08
MAX_WS_CONNECTIONS=4
```

`WS_ALLOWED_ORIGINS` is the WebSocket (and CORS) allowlist. Default is localhost only. To allow a GitHub Pages origin against a self-hosted API, add `https://Sebby1770.github.io` — the Pages UI still will not send frames unless it is talking to that API host.

Example:

```bash
YOLO_CONFIDENCE=0.5 uvicorn app.main:app --reload
```

## Privacy

- **Browser / Pages:** inference is on-device. Frames are not uploaded.
- **Server / YOLOv8:** JPEG frames go to the local FastAPI process. Privacy cloak blurs people on the overlay and on the capture canvas before encode; it is not a guarantee the model never sees a person.
- Webcam access needs a secure origin (`localhost` / `127.0.0.1` count).

## Development checks

```bash
pip install -r requirements-dev.txt
pytest
npm run test:js
```

CI installs FastAPI/OpenCV/pytest only — not Ultralytics or Torch. YOLO is mocked. Tests must not download weights.

## License

MIT © 2026 Sebastian Forbes
