# Changelog

## 2.1.0 — 2026-08-22

### Added
- Photorealistic **sample scenes** (desk, kitchen, street) so GitHub Pages detects real COCO objects without a camera
- Model-loading overlay while TensorFlow.js / coco-ssd downloads
- Class presets: All, People, Vehicles, Kitchen
- Fullscreen stage (`F`) and an explicit synthetic demo button
- Camera failure now loads the desk sample instead of a geometric feed coco-ssd cannot see

### Changed
- Application version **2.1.0**

## 2.0.0 — 2026-08-22

### Added
- Dual inference runtime: local FastAPI + YOLOv8 WebSocket, or in-browser TensorFlow.js coco-ssd
- GitHub Pages deploy that publishes `index.html`, `favicon.svg`, and `static/` so the hosted site is a working detector
- Shared detection JSON across runtimes (boxes, tracks, trails, session stats)
- JS `SimpleTracker` with unmatched-track TTL (~8 frames); Python tracker matches
- Collapsible control groups, searchable class chips, video-first console layout
- MIT LICENSE, CI pytest workflow, GitHub Pages workflow
- REST upload limits: reject empty, non-image, and >8MB bodies
- Edge-triggered ROI alerts (enter + 1.2s cooldown) and `record_roi_alert` on the server session
- Visible **Demo feed** badge and 8s camera timeout
- Single `AudioContext` with master gain (`static/audio.js`)

### Changed
- Application version **2.0.0**
- `index.html` moved to the repo root with relative `static/` URLs
- Overlay heatmap stacks under the box canvas; overlay pointer events only while drawing ROI
- Confidence clamped to `[0.05, 0.95]` on WS config and REST
- `object-fit: contain` + letterbox box mapping
- Light theme tokens cover the page background, charts, and radar
- Privacy copy distinguishes overlay-only server cloak vs on-device browser mode
- WS client ignores non-`detections` messages (`config_ack` no longer clears boxes)

### Fixed
- ROI drawing (pointer-events / z-index)
- Per-frame ROI alert spam
- New `AudioContext` on every beep
- Silent 2.5s camera timeout falling back to demo

## 1.6.0 — 2026-07-07

### Added
- **Proximity radar** — polar blip map of detection centers
- **Detection density chart** — rolling bar chart of object counts per frame
- **Filmstrip HTML export** — download ROI alert gallery as standalone page
- **Privacy blur strength** and **ghost fade** sliders

### Improved
- Sonification now plays up to 3-note chords when multiple objects are present
- Ghost overlay opacity is configurable (8%–55%)

## 1.5.0 — 2026-07-07

### Added
- **Privacy cloak** — blur detected people on the live overlay
- **Detection sonification** — map object classes to musical tones
- **Ghost persistence** — faded previous-frame boxes linger briefly
- **Spatial audio pings** — stereo-panned tones on ROI alerts
- **Alert filmstrip** — captures snapshot thumbnails when zones trigger

### Improved
- Tracker trails now expose `{x, y}` coordinate objects for rendering

## 1.4.0 — 2026-07-07

### Added
- **Multi-ROI zones** (up to 3) with per-zone colors and labels
- **Tracker motion trails** rendered on the overlay canvas
- **Pause/resume** detection without stopping the camera
- **ROI alert sound** via Web Audio tone
- **Light/dark theme** toggle with localStorage persistence
- **Batch image upload** detection via `POST /api/detect/batch`

### Improved
- Tracker now returns `trail` coordinates for each detection
- Upload UI accepts multiple files in one batch

## 1.3.0 — 2026-07-07

### Added
- **Region of interest (ROI)** drawing with entry alerts
- **Image upload detection** UI using `POST /api/detect`
- **Corner bracket box** rendering style toggle
- **Session stats** panel (frames, total detections, classes, ROI alerts)
- **`GET /api/stats`** global session metrics endpoint
- WebSocket payloads now include per-connection `session` stats

## 1.2.0 — 2026-07-07

### Added
- **Simple IoU object tracking** with stable `track_id` labels on bounding boxes
- **Detection heatmap** overlay showing where objects appear most often
- **Class count chips** for live per-class totals
- **Latency sparkline chart** with rolling average
- **REST image detect** endpoint (`POST /api/detect`)
- **Export detection history** as JSON
- **Settings persistence** via localStorage (confidence, fps, filters, heatmap toggle)

### Fixed
- Class filter parameter shadowing bug in detection pipeline

## 1.1.0 — 2026-07-07

### Added
- **Live confidence threshold** slider synced to the backend via WebSocket config messages
- **Class filter** multi-select populated from `/api/model`
- **Detection history** panel tracking recent detection events with timestamps
- **Snapshot capture** exports the current video frame with overlay bounding boxes as PNG
- **Model metadata endpoint** (`GET /api/model`) exposing model name and COCO class list
- **Frame dropping** when a previous frame is still processing (no more blocking queue)

### Improved
- Health endpoint reports version, active connections, and max connections
- Demo camera fallback with animated synthetic feed
- WebSocket security hardening (origin allowlist, frame size limits, rate limiting)

### Tests
- Model info and health version endpoint tests
- Class filter unit test for detection pipeline
