/**
 * IoU tracker with constant-velocity prediction and global greedy matching.
 * Mirrors app/tracker.py line for line; tests/fixtures/tracker_cases.json
 * keeps the two in agreement.
 */

function iou(left, right) {
  const leftRight = Math.min(left.x + left.width, right.x + right.width);
  const leftBottom = Math.min(left.y + left.height, right.y + right.height);
  const overlapWidth = Math.max(0, leftRight - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, leftBottom - Math.max(left.y, right.y));
  const overlap = overlapWidth * overlapHeight;
  if (overlap <= 0) {
    return 0;
  }
  const union = left.width * left.height + right.width * right.height - overlap;
  return union > 0 ? overlap / union : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export class SimpleTracker {
  constructor({ iouThreshold = 0.3, trailLength = 16, ttlFrames = 8, velocitySmoothing = 0.5 } = {}) {
    this.iouThreshold = iouThreshold;
    this.trailLength = trailLength;
    this.ttlFrames = ttlFrames;
    this.velocitySmoothing = velocitySmoothing;
    this._nextId = 1;
    this._tracks = new Map();
  }

  predicted(track) {
    const steps = track.missed + 1;
    return {
      x: track.box.x + track.vx * steps,
      y: track.box.y + track.vy * steps,
      width: track.box.width,
      height: track.box.height,
    };
  }

  assign(detections) {
    const list = detections || [];
    const pairs = [];
    for (const [trackId, track] of this._tracks) {
      const predicted = this.predicted(track);
      list.forEach((detection, detectionIndex) => {
        if (track.label !== detection.label) {
          return;
        }
        const score = iou(predicted, detection.box);
        if (score >= this.iouThreshold) {
          pairs.push([score, trackId, detectionIndex]);
        }
      });
    }
    pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);

    const matchedTracks = new Set();
    const match = new Map();
    for (const [, trackId, detectionIndex] of pairs) {
      if (matchedTracks.has(trackId) || match.has(detectionIndex)) {
        continue;
      }
      matchedTracks.add(trackId);
      match.set(detectionIndex, trackId);
    }

    const touched = new Set();
    const smoothing = this.velocitySmoothing;
    const assigned = list.map((detection, detectionIndex) => {
      const box = detection.box;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      let trackId;
      let track;
      if (match.has(detectionIndex)) {
        trackId = match.get(detectionIndex);
        track = this._tracks.get(trackId);
        const steps = track.missed + 1;
        const [lastX, lastY] = track.trail[track.trail.length - 1];
        const dx = (cx - lastX) / steps;
        const dy = (cy - lastY) / steps;
        track.vx = smoothing * track.vx + (1 - smoothing) * dx;
        track.vy = smoothing * track.vy + (1 - smoothing) * dy;
      } else {
        trackId = this._nextId;
        this._nextId += 1;
        track = { label: detection.label, box, trail: [], missed: 0, vx: 0, vy: 0, hits: 0 };
        this._tracks.set(trackId, track);
      }
      track.trail = [...track.trail, [cx, cy]].slice(-this.trailLength);
      track.box = box;
      track.missed = 0;
      track.hits += 1;
      touched.add(trackId);
      return {
        ...detection,
        track_id: trackId,
        trail: track.trail.map(([x, y]) => ({ x, y })),
        velocity: { x: round2(track.vx), y: round2(track.vy) },
        hits: track.hits,
      };
    });

    for (const [trackId, track] of this._tracks) {
      if (touched.has(trackId)) {
        continue;
      }
      track.missed += 1;
      if (track.missed >= this.ttlFrames) {
        this._tracks.delete(trackId);
      }
    }
    return assigned;
  }

  reset() {
    this._tracks.clear();
    this._nextId = 1;
  }
}

export { iou };
