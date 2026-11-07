# Architecture (v3.0)

Realtime Detection is one page that runs in two places. GitHub Pages serves it as static files and detection runs in the tab. The local FastAPI server serves the same `index.html` and adds YOLOv8, the virtual camera bridge, and the copilot. There is no build step: the browser loads ES modules from `static/` directly.

```
                 ┌──────────────── browser tab ────────────────┐
 camera / still ─┤ capture canvas ─┬─► browser engine ──────────┤─► detection JSON ─► monitor, zones, session, diary
 synthetic feed  │                 │   (MediaPipe / TF.js)      │
                 │                 └─► WebSocket ───────────────┼──► FastAPI /ws/detect ─► YOLOv8 + tracker
                 │ studio canvas ◄── person mask / box mask     │
                 │      │                                       │
                 │      ├─► clean-feed window (BroadcastChannel)│
                 │      ├─► MediaRecorder (WebM / MP4)          │
                 │      └─► POST /api/virtualcam/frame ─────────┼──► pyvirtualcam / MJPEG
                 │ copilot panel ── POST /api/copilot/stream ───┼──► xAI / OpenAI / Anthropic (SSE relay)
                 └──────────────────────────────────────────────┘
```

## The detection JSON

Every engine produces the same payload, so nothing downstream knows or cares which one ran.

```json
{
  "type": "detections",
  "frame_width": 640,
  "frame_height": 360,
  "confidence_threshold": 0.35,
  "class_counts": { "person": 1, "cup": 1 },
  "detections": [
    {
      "label": "person",
      "confidence": 0.91,
      "box": { "x": 104.5, "y": 28.8, "width": 83.2, "height": 201.6 },
      "track_id": 1,
      "trail": [{ "x": 146.1, "y": 129.6 }],
      "velocity": { "x": 1.5, "y": 0 },
      "hits": 4
    }
  ],
  "latency_ms": 12.4,
  "inference_ms": 9.8,
  "frame_id": 41,
  "session": { "frames_processed": 41, "detections_total": 96, "classes_seen": ["cup", "person"], "roi_alerts": 0, "average_latency_ms": 11.9 }
}
```

`frame_id` is only sent by the server. The browser adds `rtt_ms`, the round trip it measured, to server payloads.

## Frontend modules (`static/`)

| Module | Job |
|---|---|
| `app.js` | Orchestrator: sources, the detection loop, the render loop, zones, studio wiring, session views, commands and shortcuts |
| `core/dom.js` | `h()` element builder (text nodes only, never `innerHTML`), downloads, time stamps |
| `core/settings.js` | Validated, versioned settings store. Migrates 2.x settings. Pure, with injected storage |
| `engines/registry.js` | The engine list, the default (EfficientDet-Lite0 without a server), and the fallback (COCO-SSD Lite) |
| `engines/mediapipe.js` | MediaPipe Tasks Vision: EfficientDet detectors and the selfie segmenter. GPU, then CPU. Band coverage for mask trust |
| `engines/cocossd.js` | TensorFlow.js COCO-SSD Lite |
| `runtime-browser.js` | Runs a browser engine and returns detection JSON, with the JS tracker and session numbers |
| `runtime-server.js` | WebSocket client: reconnect with backoff, a reply watchdog, and quiet handling of `throttled` |
| `tracker.js` | IoU tracker with constant-velocity prediction and global greedy matching, the same algorithm as `app/tracker.py` |
| `glide.js` | Eases boxes between detections and fades out boxes that leave. Pure |
| `overlay.js` | Monitor drawing: frame lines, zones, boxes, trails, collision-free label tags, the heatmap, and the Session charts |
| `colors.js` | ColorChecker class palette and contrast-checked label ink. Pure |
| `studio.js` | Effects through a mask compositor (person mask or box mask), room-fill inpainting, plate learning, photo strip, and app guides |
| `copilot.js`, `sse.js`, `markdown.js` | Copilot panel, SSE reader, and safe Markdown (parsed to an AST and built with text nodes) |
| `ui/tabs.js`, `ui/palette.js`, `ui/toast.js` | ARIA tabs, command palette and shortcut sheet, and toasts |
| `scene-diary.js`, `audio.js` | Arrival and departure lines; one shared AudioContext for chimes, panning, and notes |
| `studio.html`, `clean-feed.js`, `clean-feed.css` | The clean-feed window |

### Two loops

- **Detection loop** (`tick`): runs at the chosen detections per second. It draws the source into the capture canvas at the processing width, then either runs the browser engine or sends a JPEG over the WebSocket (one frame in flight at a time). Stills run once per change instead.
- **Render loop** (`renderFrame`): runs on `requestAnimationFrame`. It composites the studio picture, steps the glide, draws the overlay and heatmap, and updates the tally. While an output (clean feed, recording, or virtual camera) is running, a 40 ms timer takes over if animation frames stop, which browsers do for covered windows.

### Studio masks

`renderStudio` picks a mask each frame:

1. **Person mask**, when the effect targets people, the segmenter is ready, and every person box scores at least 0.18 coverage in each of three horizontal bands (mean at least 0.3). The selfie model is built for people near the camera; the band test catches far-off or side-on people whose head or back it misses.
2. **Box mask** otherwise: feathered rounded rectangles at quarter resolution.

Both go through the same compositor. Invisible fills the person region from the learned plate where the room has been seen, and elsewhere from a push-pull fill of the room's colours. The plate learns only outside the mask and the target boxes, and only after the current source has detections, so it never learns what the person looks like.

## Server (`app/`)

| Module | Job |
|---|---|
| `main.py` | Routes, lifespan warm-up, `TrustedHostMiddleware`, a pure-ASGI security-header middleware (it never buffers SSE or MJPEG), the WebSocket protocol, and copilot request limits |
| `detector.py` | YOLOv8 loading (`ModelUnavailable` with a clear message), `MockModel`, `model_status()`, `warmup()`, and `inference_ms` |
| `tracker.py` | The tracker, line for line with `static/tracker.js`. `tests/fixtures/tracker_cases.json` holds them to the same IDs |
| `copilot.py` | Provider-neutral raw HTTP: request shapes, image parts, model validation, SSE parsing for Chat Completions, Responses, and Messages, error mapping, and redaction |
| `virtualcam.py` | Latest-frame bridge for pyvirtualcam and the MJPEG feed |
| `__main__.py` | `python -m app [--host] [--port] [--reload] [--mock]` |

### WebSocket protocol

Client to server: binary JPEG frames; `{"type": "config", "confidence", "classes"}`; `{"type": "roi_alert"}`.

Server to client: `detections` (above), `config_ack`, `roi_alert_ack`, `throttled` (the client ignores it), `dropped`, and `error` (with `code: "model_unavailable"` when YOLO cannot load; the page switches to a browser engine).

### Copilot stream

`POST /api/copilot/stream` takes `{provider, apiKey, model?, messages, image?}`. It validates everything first, returning JSON 4xx on failure, then streams:

```
event: delta
data: {"text": "On the desk I can see "}

event: done
data: {"provider": "anthropic", "model": "claude-opus-5-5", "label": "Claude", "stop_reason": "end_turn"}
```

A stream always ends with exactly one `done` or one `error` (`{"status", "message"}`). Provider HTTP errors arrive as `error` events with the mapped status.

## Security model

- **Content-Security-Policy** in `index.html` and `studio.html`. Scripts load from `'self'` and jsDelivr. `'unsafe-eval'` is there for TensorFlow.js, which builds functions from strings, and `'wasm-unsafe-eval'` for MediaPipe. Connections go to `'self'`, jsDelivr, and `storage.googleapis.com`, which carries the model files; that also blocks MediaPipe's usage logging. No inline scripts, `object-src 'none'`, and `form-action 'none'`.
- **Local server**: a `Host` allowlist (DNS rebinding), the origin allowlist on the WebSocket, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, a Permissions-Policy, and COOP. JSON-only copilot endpoints (415) with a body cap (413) and two calls in flight (429).
- **Keys** stay in the browser's storage and travel only to the local server with each question. They are redacted from every provider error and never logged.
- Model output is rendered with text nodes only. Links must be `http(s)` and open with `noopener noreferrer`.

## Verification

- `pytest`: API, WebSocket, detector, mock model, tracker fixtures, security headers, and copilot request shapes and SSE parsing. No network, no weights.
- `npm run test:js`: syntax-checks every module, then Node tests for the tracker (sharing the Python fixture), glide, colours and contrast, settings migration, Markdown safety, the SSE parser, palette scoring, label placement, and studio mask logic.
- Manual: Pages mode, server mode with `--mock`, and the copilot stream against a scripted provider. Light, dark, and a 375 px phone.
