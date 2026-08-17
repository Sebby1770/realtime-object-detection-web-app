# Changelog

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
