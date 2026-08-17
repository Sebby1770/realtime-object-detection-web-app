# Real-Time Object Detection Web App

v2 command-center for webcam object detection: FastAPI, WebSockets, OpenCV, and YOLOv8 when weights are present. Without Ultralytics or a `.pt` file the backend serves a deterministic mock detector so CI and CPU laptops still run.

## Features

- Browser capture via `getUserMedia`, JPEG frames over a persistent WebSocket.
- YOLOv8 inference when `ultralytics` and local weights are available; otherwise `MockDetector` (person / cup / laptop).
- Live confidence, image size, class filter, and watchlist per connection — no process restart.
- Detection JSON keeps `box: {x, y, width, height}` and adds `frame_id`, `latency_ms`, `inference_ms`, `counts`, and `alerts`.
- Dense console UI: connection + model + mock badges, overlay HUD, class chips, session histogram, latency sparkline, snapshot strip.
- Keyboard: <kbd>Space</kbd> start/stop, <kbd>S</kbd> snapshot, <kbd>L</kbd> labels, <kbd>M</kbd> mute, <kbd>?</kbd> shortcuts.
- Frames are processed in memory only. Snapshots live in `localStorage` on the client.

## Privacy

Webcam frames are **not stored on the server**. They are decoded, inferred, and discarded. Snapshots are captured in the browser (video + overlay → PNG) and the last ~12 data URLs stay in `localStorage`. There is no `POST /api/snapshot` upload path on purpose.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript, Canvas, WebSocket
- Backend: FastAPI, OpenCV, optional Ultralytics YOLOv8
- Model: `yolov8n.pt` when present, otherwise mock COCO labels

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
# optional real YOLO:
# pip install -e ".[app]"
YOLO_MOCK=1 uvicorn app.main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

`requirements.txt` stays in sync with the full app extra (including `ultralytics`). Tests never import Ultralytics and never download weights.

## Docker

CPU image, mock detector by default, port 8000:

```bash
docker compose up --build
```

Or:

```bash
docker build -t detect-v2 .
docker run --rm -p 8000:8000 -e YOLO_MOCK=1 detect-v2
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `YOLO_MOCK` | unset (`1` in Docker/CI) | Force the deterministic mock detector |
| `YOLO_MODEL` | `yolov8n.pt` | Local weight path used when mock is off |
| `YOLO_CONFIDENCE` | `0.35` | Default confidence for new sockets |
| `YOLO_IMAGE_SIZE` | `640` | Default `imgsz` for new sockets |
| `YOLO_DOWNLOAD` | unset | Set to `1` to let Ultralytics fetch missing weights |

If `YOLO_MOCK` is unset, the app still uses the mock path when Ultralytics is not installed or the weight file is not on disk. Set `YOLO_DOWNLOAD=1` only if you want the original first-run download behavior.

## HTTP + WebSocket

- `GET /health` → `{status, model, mock, version}`
- `GET /api/config` → model, default confidence, image size, class names
- `GET /api/stats` → in-memory `frames_processed`, `avg_latency_ms`, `last_error`, `started_at`
- `GET /api/classes` → `{classes: [...]}` (COCO 80 in mock mode)
- `WS /ws/detect` — binary JPEG in; JSON detections out. Text control: `{type:"config", confidence, imgsz, allowed_labels, watchlist}`. Oversized frames (>2.5 MB) return `{type:"error", code:"frame_too_large"}`. If inference is already running for that socket the server replies `{type:"busy"}`.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Start / stop camera |
| S | Snapshot (video + boxes, PNG) |
| L | Toggle labels |
| M | Mute alert beep |
| ? | Shortcuts overlay |

Watchlist hits flash the stage and beep unless muted or `prefers-reduced-motion` is set.

## Tests and CI

```bash
YOLO_MOCK=1 pip install -e ".[dev]"
pytest
```

GitHub Actions runs Python 3.11 and 3.12 with `pip install -e ".[dev]"` and `YOLO_MOCK=1`. Tests must stay green without `yolov8n.pt`.
