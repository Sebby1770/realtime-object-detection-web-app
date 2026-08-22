# Real-Time Object Detection — Structural Upgrade Plan (v2.0)

Written against local `codex/security-hardening` (v1.6.0). GitHub `main` is still the original v1.0 commit. v2.0 lands **on `main`**.

## 1. What this product is

A live object detector: webcam (or demo feed) in the browser, boxes on a canvas, class counts, ROI alerts, privacy cloak, snapshots. The v1.x stack is FastAPI + WebSocket JPEGs + YOLOv8n + OpenCV. That is the high-accuracy self-host path.

GitHub Pages cannot run Python, OpenCV, Ultralytics, or WebSockets. A Pages “website” that only shows a dead UI is a lie. v2.0 therefore has **two inference runtimes** that speak the same detection JSON.

## 2. Current architecture (v1.6)

```
getUserMedia → JPEG frames ──WS /ws/detect──► OpenCV decode → YOLOv8 → SimpleTracker
                                    ▲
REST /api/detect[ /batch] ──────────┘
```

Frontend is a 1,366-line `static/app.js` plus a sidebar that dumps ~25 controls above the video on mobile. Known defects:

- ROI draw handlers sit on `#overlay { pointer-events: none }` and the heatmap canvas is stacked above it — **ROI drawing does not work**.
- WebSocket `config_ack` is treated as a detections payload and **clears live boxes**.
- Privacy cloak blurs the overlay only; JPEGs still leave the machine.
- ROI alerts fire every in-zone frame (sound/filmstrip spam).
- `config_ack` / `JSON.parse` unguarded; REST uploads unbounded.
- README describes v1.0. No CI, no LICENSE, no Pages.

## 3. Target architecture (v2.0)

```
                    ┌── server  → FastAPI /ws/detect + YOLOv8n     (local)
UI ── runtime ──────┤
                    └── browser → TF.js coco-ssd + JS tracker      (GitHub Pages)
```

Both runtimes emit:

```json
{
  "type": "detections",
  "frame_width": 640,
  "frame_height": 360,
  "confidence_threshold": 0.35,
  "class_counts": { "person": 1 },
  "detections": [
    {
      "label": "person",
      "confidence": 0.91,
      "box": { "x": 10, "y": 20, "width": 80, "height": 200 },
      "track_id": 1,
      "trail": [{ "x": 50, "y": 120 }]
    }
  ],
  "latency_ms": 42.1,
  "session": { "frames_processed": 1, "detections_total": 1, "classes_seen": ["person"], "roi_alerts": 0, "average_latency_ms": 42.1 }
}
```

The overlay, heatmap, radar, ROI, sonification, filmstrip, and history **do not care** which runtime produced the boxes.

### 3.1 Runtime selection

1. On boot, `GET /health` (relative). If it returns `{ status: "ok" }`, default to **server** (YOLOv8).
2. Otherwise default to **browser** (coco-ssd). GitHub Pages always takes this path.
3. A visible mode badge: `YOLOv8 · server` or `COCO-SSD · in-browser`. User can switch.
4. In browser mode, frames **never leave the tab**. Privacy cloak is then actually private. Copy must say so.
5. In server mode, privacy cloak is labeled “overlay only — frames are still sent to the local model.” Optionally (P1) blur people on the capture canvas **before** JPEG encode when cloak is on.

### 3.2 Module split

| File | Responsibility |
|---|---|
| `index.html` | Shell, moved to **repo root** so Pages and FastAPI share one document with relative `static/` URLs |
| `static/app.js` | Orchestrator: camera, loop, settings, wiring |
| `static/runtime-server.js` | WebSocket client, origin/reconnect backoff, config messages |
| `static/runtime-browser.js` | Lazy-load TF.js + coco-ssd from jsDelivr, map bbox → detection JSON |
| `static/tracker.js` | JS port of `SimpleTracker` + short TTL so IDs survive one missed frame |
| `static/overlay.js` | Boxes, trails, ghosts, heatmap, radar, density, ROI geometry |
| `static/audio.js` | **One** AudioContext, master gain, spatial pings, sonify chords |
| `static/styles.css` | Video-first layout, collapsible control groups, complete light theme |

No Lucide CDN. Inline SVG in buttons.

### 3.3 Path rules

`index.html` at repo root:

```html
<link rel="stylesheet" href="static/styles.css" />
<script type="module" src="static/app.js"></script>
```

FastAPI `GET /` serves that file; `/static` remains `StaticFiles`. GitHub Pages publishes the repo (or `index.html` + `static/`). Relative URLs work at `/` and at `/realtime-object-detection-web-app/`.

## 4. Product structure

Video is the product. Controls are grouped, collapsed by default except Capture + Model.

```
┌──────────────────────────────────────────┬──────────────────┐
│ Stage (video + overlay + heatmap)        │ Capture          │
│ Demo-feed badge when fallback is active  │ Model / classes  │
│ Mode badge                               │ Overlay          │
│                                          │ Zones            │
│                                          │ Privacy / audio  │
│                                          │ Session          │
└──────────────────────────────────────────┴──────────────────┘
```

Mobile: stage first, accordion controls below — never `order: -1` dumping the sidebar on top.

Class filter: searchable chip list, not an 80-row `<select multiple>`.

`object-fit: contain` + letterbox box mapping (no stretched webcams).

## 5. Key decisions

| Decision | Rationale |
|---|---|
| Dual runtime, same JSON | Pages must be a working detector. Server YOLO stays for local accuracy. |
| coco-ssd not in-browser YOLOv8 | coco-ssd is the reliable CDN path (lite_mobilenet_v2, COCO 80). Exporting ONNX YOLOv8 is a follow-up. |
| Merge `codex/security-hardening` into `main` | GitHub currently shows a 1-commit toy. |
| Overlay hit-testing fix | ROI is advertised and broken. |
| Ignore non-`detections` WS messages | `config_ack` wiping boxes is a live bug. |
| Edge-triggered ROI alerts | Enter/exit + cooldown, not per-frame. |
| One AudioContext | Per-event contexts click, leak, and hit browser limits. |
| Do not commit `*.pt` | Ultralytics downloads weights on first local run. |
| Browser mode = no network of frames | Makes the Pages demo privacy-honest. |

## 6. Workstreams

### W1 — Correctness (keep v1.6 features actually working)

- Overlay `pointer-events: auto` while drawing; heatmap under overlay.
- Branch WS on `type`; never apply `config_ack` as boxes; try/catch `JSON.parse`.
- Clamp confidence `[0.05, 0.95]`.
- Debounce ROI alerts; call `record_roi_alert` and include in session JSON.
- Upload size/type limits on `/api/detect*`.
- Explicit “Demo feed” badge; camera permission timeout 8s, not silent 2.5s.
- Tracker TTL (~8 missed frames) in Python and JS.

### W2 — Browser runtime + Pages

- `static/runtime-browser.js` lazy-loads TF.js 4.22 and coco-ssd 2.2.3 from jsDelivr.
- JS tracker + session stats.
- Image upload in browser mode runs coco-ssd on an `Image` / canvas (no REST).
- `.github/workflows/pages.yml` + CI pytest with mocked YOLO.
- MIT LICENSE, rewritten README.

### W3 — UI

- Collapsible groups, video-first, contain-fit, searchable classes.
- Keyboard: `Space` pause, `S` snapshot, `Esc` stop drawing.
- Light theme tokens cover body/charts/radar.
- Reduced-motion: skip sonify and ghost trails.

### W4 — Tests

- Existing detector tests updated to version `2.0.0`.
- WS `config` does not emit a detections-shaped payload.
- Tracker TTL: ID survives one unmatched frame.
- REST reject empty / oversized.
- Optional: tiny JS tests for tracker IoU if Node can import `static/tracker.js`.

## 7. Out of scope

- GPU / TensorRT
- ByteTrack
- Auth
- Recording to WebM
- Hosted YOLO API (would need a server; Pages cannot be that server)

## 8. Verification

- `pytest` green with mocked YOLO (no network, no weight download in CI).
- Local: `uvicorn app.main:app` → camera or demo → boxes, ROI draw, pause, snapshot.
- With backend down / on Pages: coco-ssd loads, camera works, boxes render, frames stay local.
- GitHub `main` contains v2.0, not v1.0.

## 9. Version

- Application **2.0.0**
- Default local model still `yolov8n.pt`
- Default Pages model `coco-ssd lite_mobilenet_v2`
