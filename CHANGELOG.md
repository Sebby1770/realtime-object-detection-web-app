# Changelog

## 2.1.0 — 2026-08-17

### Added
- Camera-free **sample reel**: synthetic JPEG frames over the existing WebSocket (no `getUserMedia`). HUD shows a `REEL` badge. Camera errors offer “Play sample reel instead”.
- Client-side **ROI / draw zone** (`Z`): click-drag a rectangle on the overlay. Out-of-zone boxes are dimmed and excluded from object count, histogram increments, and watchlist alerts. Readout is `in zone / total`.
- In-tab **session recorder** (`R`): compact events `{t, frame_id, detections, counts, alerts, latency_ms}`, cap 2000, export JSON or CSV. Nothing is stored on the server.
- JPEG quality slider (0.40–0.95, default 0.72) used by `toBlob`.
- Busy / dropped frame counters (server `{type:"busy"}` and client `inFlight` skips).
- Prefs now persist JPEG quality and last watchlist labels.

### Changed
- Project and `/health` version bumped to 2.1.0.
- Keyboard: `R` record, `Z` draw zone. Space still starts the camera or stops whichever session is live.

### Tests
- `box_center`, `point_in_rect`, and ROI filtering (`app/geometry.py`).
- `events_to_csv` header plus one row (`app/session_export.py`).

## 2.0.0 — 2026-08-17

### Added
- Optional YOLO path with a deterministic `MockDetector` when `YOLO_MOCK=1`, Ultralytics is missing, or weights are not on disk.
- Health, config, stats, and class-list HTTP APIs (`/health`, `/api/config`, `/api/stats`, `/api/classes`).
- Per-connection WebSocket config messages for live confidence, image size, class filters, and a watchlist.
- Detection payloads now include `frame_id`, `latency_ms`, `inference_ms`, `counts`, and `alerts`.
- Server-side busy signal when a socket still has inference in flight; frames larger than 2.5 MB are rejected.
- Command-center UI: topbar badges, live confidence slider, class chips, watchlist flash/beep, histogram, latency sparkline, snapshot gallery, camera facing toggle, and keyboard shortcuts.
- Client-side PNG snapshots persisted locally (last ~12). Webcam frames are never stored on the server.
- Dockerfile and `docker-compose.yml` (CPU, `YOLO_MOCK=1` by default, port 8000).
- GitHub Actions CI for Python 3.11 and 3.12.
- MIT license.

### Changed
- FastAPI app and project version bumped to 2.0.0.
- `load_model()` no longer crashes app import; it always returns a usable detector.
- README rewritten for mock mode, Docker, keyboard, privacy, environment variables, and CI.

### Tests
- Existing JPEG decode and class-name helpers still covered.
- Mock boxes, protocol parsing, oversized frames, health, stats increment, and watchlist alerts run with `YOLO_MOCK=1` and do not download weights.
