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

export class SimpleTracker {
  constructor({ iouThreshold = 0.35, trailLength = 12, ttlFrames = 8 } = {}) {
    this.iouThreshold = iouThreshold;
    this.trailLength = trailLength;
    this.ttlFrames = ttlFrames;
    this._nextId = 1;
    this._tracks = new Map();
  }

  assign(detections) {
    const assigned = [];
    const usedTracks = new Set();

    for (const detection of detections) {
      let bestId = null;
      let bestScore = 0;
      for (const [trackId, track] of this._tracks) {
        if (usedTracks.has(trackId)) {
          continue;
        }
        if (track.label !== detection.label) {
          continue;
        }
        const score = iou(track.box, detection.box);
        if (score > bestScore) {
          bestScore = score;
          bestId = trackId;
        }
      }

      let trackId;
      if (bestId != null && bestScore >= this.iouThreshold) {
        trackId = bestId;
      } else {
        trackId = this._nextId;
        this._nextId += 1;
      }

      usedTracks.add(trackId);
      const box = detection.box;
      const center = [box.x + box.width / 2, box.y + box.height / 2];
      const priorTrail = this._tracks.get(trackId)?.trail ?? [];
      const trail = [...priorTrail, center].slice(-this.trailLength);
      this._tracks.set(trackId, {
        label: detection.label,
        box,
        trail,
        missed: 0,
      });
      assigned.push({
        ...detection,
        track_id: trackId,
        trail: trail.map(([x, y]) => ({ x, y })),
      });
    }

    for (const [trackId, track] of this._tracks) {
      if (usedTracks.has(trackId)) {
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
