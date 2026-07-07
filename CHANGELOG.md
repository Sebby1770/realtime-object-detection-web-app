# Changelog

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