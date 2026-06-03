# Real-Time Object Detection Web App

A browser-based webcam object detector powered by FastAPI, WebSockets, OpenCV, and a pre-trained YOLOv8 model.

## Features

- Captures webcam video in the browser with `getUserMedia`.
- Draws each frame onto an offscreen Canvas and sends JPEG frames over a persistent WebSocket.
- Runs YOLOv8 inference on the Python backend with OpenCV frame decoding.
- Streams detections back as JSON and renders scaled bounding boxes over the live video feed.
- Includes controls for processing frame rate, processing width, and label visibility.

## Stack

- Frontend: HTML, CSS, JavaScript, Canvas API, WebSocket API
- Backend: FastAPI, OpenCV, Ultralytics YOLOv8
- Model: `yolov8n.pt` by default

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

The first inference may take a moment while Ultralytics downloads the YOLOv8 nano weights.

## Configuration

Environment variables:

```bash
YOLO_MODEL=yolov8n.pt
YOLO_CONFIDENCE=0.35
YOLO_IMAGE_SIZE=640
WS_ALLOWED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
MAX_FRAME_BYTES=524288
MIN_FRAME_INTERVAL_SECONDS=0.08
MAX_WS_CONNECTIONS=4
```

Example:

```bash
YOLO_CONFIDENCE=0.5 uvicorn app.main:app --reload
```

## Notes

- Webcam access requires a secure origin. `localhost` and `127.0.0.1` are treated as secure by modern browsers.
- If the browser blocks or does not expose camera access, the app falls back to a local demo video stream so the WebSocket and inference pipeline can still be exercised.
- The WebSocket rejects untrusted origins, oversized frames, excessive frame rates, and too many concurrent clients.
- For smoother realtime performance on CPU, lower the processing width or frame rate in the sidebar.
- For stronger accuracy, set `YOLO_MODEL` to a larger YOLOv8 model such as `yolov8s.pt`, understanding that latency will increase.

## Development checks

```bash
pip install -r requirements-dev.txt
pytest
```
