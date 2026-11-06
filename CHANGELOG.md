# Changelog

## 3.0.0 — 2026-11-06

A new interface and a deeper engine. Everything from 2.8 is still here.

### Added
- **New interface.** The page opens on the monitor itself. A tally lamp says whether the outgoing picture is idle, in preview, or on air, and a readout strip shows the engine, source, rate, latency, and object count. Controls live in five tabs: Detect, Studio, Zones, Session, Copilot. Light, dark, or match-system theme.
- **Command palette** (⌘K / Ctrl+K) for every action, a **shortcut sheet** (?), toasts for confirmations and errors, number keys 1–5 for the panels, and `Z` to draw a zone.
- **Sharper browser detection.** EfficientDet-Lite0 (the new default without a server) and EfficientDet-Lite2 run through MediaPipe, on the GPU with a CPU fallback. On the bundled samples they find objects COCO-SSD missed (a phone, a book, apples), with higher confidence. COCO-SSD Lite stays as the fallback. YOLOv8 on the local server is still the most accurate.
- **Person masks for the studio.** A MediaPipe segmenter cuts along the body instead of the box. Invisible learns the room as you move and fills the gap from it. Without a learned background it fills from the room's colours, not a blurred silhouette. People the mask can't see well, for example far away or side-on, fall back to a soft box mask automatically.
- **Smooth box motion.** Boxes glide between detections instead of jumping, and fade out when something leaves. Snaps instead under reduced motion.
- **Label colours from the ColorChecker chart.** The same class always gets the same colour, and every label tag passes WCAG AA contrast. Tags no longer overlap one another, and no box outline is drawn across a label.
- **Copilot streaming.** Replies stream in, can be stopped, and render as safe Markdown. Each provider has a model picker with suggestions. **Attach a still of the picture** is opt-in, off by default. Defaults: `grok-4.7` (xAI Responses API), `chat-latest` (OpenAI), `claude-opus-5-5` (Anthropic). Claude requests send `anthropic-version: 2026-10-21` and server-side refusal fallbacks on the models that support them.
- **Simulated detector.** `python -m app --mock` runs the server without Ultralytics. Useful for trying the UI and for tests.
- `python -m app` launcher. `/health` reports model status and features. YOLO weights warm up in the background at startup.
- Zone list with live counts, per-zone alert totals, and remove buttons. A screen-reader summary of what is in frame. Social card and favicon. `?sample=desk|kitchen|street` links open a sample straight away.

### Changed
- The tracker matches greedily by IoU across all pairs and predicts motion with a constant-velocity model, so fast movers keep their IDs. Python and JavaScript share one algorithm and one test fixture.
- The clean-feed window hides its label once frames arrive, so the label never appears in a shared picture. Double-click toggles full screen.
- While the clean feed, the virtual camera, or a recording is running, the studio keeps drawing when the browser stops animation frames for a covered window.
- Studio compositing reuses canvases instead of allocating several per frame. Blurs run at half size.
- Sample images no longer carry a watermark.
- The settings store validates everything it reads back and migrates 2.x settings.

### Fixed
- The stage no longer covers the controls while you scroll.
- Portrait blur, Replace background, and Pixelate lined up wrongly when the camera was wider than the studio picture.
- The copilot and the virtual camera used root-relative URLs that broke under a sub-path.
- The batch endpoint silently dropped images past the twelfth. It now reports `skipped`.
- `/api/model` blocked the event loop while weights loaded.
- Pressing Stop right after Ask could hold a copilot slot for two minutes. Two such presses locked the copilot.
- A malformed WebSocket message (a JSON array, or `classes: null`) closed the detection socket.
- Closing the source during a recording left the recorder capturing a frozen picture. The clip is now saved.
- Copilot history flattened earlier replies onto one line. Lists and code now keep their line breaks.
- In server mode, a still could show results from the previous image when two were opened quickly.

### Security
- A Content-Security-Policy on every page. Scripts come only from this site and jsDelivr; connections only to the model hosts. This also blocks MediaPipe's usage logging.
- The local server checks the `Host` header (`ALLOWED_HOSTS`, a DNS-rebinding guard). It sends `nosniff`, `no-referrer`, `DENY` framing, a Permissions-Policy, COOP, and `Cross-Origin-Resource-Policy: same-origin`, so other sites cannot embed the studio feed.
- Copilot endpoints accept only `application/json` (415 otherwise), cap the body size (413), and allow two calls in flight (429). Keys are never logged or echoed, and xAI requests ask the provider not to store them (`store: false`).

### Versions
- Application **3.0.0** everywhere: `app/__init__.py`, `package.json`, `pyproject.toml`, `static/app.js`, and the asset cache-busting in `index.html`. A test keeps them in step.

## 2.8.0 — 2026-11-05

### Added
- **Looks** under the picture: Call removes people with a flat grade, Booth sets a warm portrait, and Plain clears the effect, grade, and mirror.
- **Save** on the scene diary downloads the lines as a text file on this computer.

### Changed
- Application version **2.8.0**

## 2.7.0 — 2026-11-04

### Changed
- The studio layout puts the picture first. Status chips sit under the frame, so detection labels no longer cover them. Controls and the scene diary share the space below the picture, and the copilot stays in its own column.
- Application version **2.7.0**

## 2.6.0 — 2026-11-04

### Added
- **Scene diary** records what entered or left the frame. It stays on this computer. "Use the latest line" copies that sentence into the copilot box and does not send it.
- The copilot thread is remembered in this browser, separately from the API key. The Invisible chip says "Learning plate" until a background plate exists.

### Changed
- Application version **2.6.0**

## 2.5.0 — 2026-11-04

### Added
- **Home screen** with scene cards for Desk, Kitchen, and Street, plus a direct way into the studio.
- **Go invisible** sets the outgoing picture to remove people and starts the camera.
- **Copilot** panel with a choice of Grok (`grok-4.7`), ChatGPT (`chat-latest`), or Claude (`claude-sonnet-5`). An API key stays in this browser and is sent only to the local server with the question. Listen can dictate the question. Detection labels are optional. The reply is not drawn into the clean feed or the virtual camera.

### Changed
- The Disappear studio control is labeled Invisible.
- Application version **2.5.0**

## 2.4.0 — 2026-11-04

### Added
- **Mirror** flips the outgoing studio picture left to right. Toggle it in the panel or press `M`.
- **Auto frame** zooms that picture toward detected people and keeps the same shape.
- **Name plate** burns a short label into the picture after the color grade, so the letters stay readable.

### Changed
- Application version **2.4.0**

## 2.3.0 — 2026-11-04

### Added
- **Color grades** on the studio picture: Warm, Noir, Vivid, and Dawn. The grade is burned in before the detection-count label, and it is remembered with the other studio settings.
- Setup cards for Slack, Webex, and Twitch.

### Changed
- Application version **2.3.0**

## 2.2.0 — 2026-11-04

### Added
- **Studio effects** burned into the outgoing picture: Disappear, portrait blur, background replace, pixelate, spotlight, and outline
- Background plate capture so Disappear can put the room back where a person was, with a blur fallback before the plate exists
- **Photo booth**: countdown, four-shot strip, PNG download (`P`)
- **Clean feed** window for screen share, WebM clip recording, and a detection-count burn-in
- **Virtual camera bridge** for Zoom, Photo Booth, FaceTime, Google Meet, Teams, Discord, OBS, and QuickTime (`POST /api/virtualcam/frame`, optional `pyvirtualcam` / OBS Virtual Camera, `GET /api/studio.mjpg`)
- Per-app setup card in the Studio panel
- Keyboard: `D` disappear, `B` capture plate

### Changed
- Application version **2.2.0**

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
