# Changelog

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