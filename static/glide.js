/**
 * Boxes glide between detections.
 *
 * Detection runs a few times a second, the monitor repaints sixty times a
 * second. Each tracked box eases toward its newest position, so motion reads
 * as continuous instead of a jump every 150 ms. A box that drops out fades
 * for a moment rather than vanishing mid-frame.
 *
 * Pure module: no DOM. `now` is a millisecond clock passed in by the caller.
 */

function keyFor(detection, index) {
  if (detection.track_id != null) {
    return `t${detection.track_id}`;
  }
  return `i${detection.label}:${index}`;
}

function copyBox(box) {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

export function easeFactor(dtMs, halfLifeMs) {
  if (halfLifeMs <= 0) {
    return 1;
  }
  return 1 - 2 ** (-Math.max(0, dtMs) / halfLifeMs);
}

export function createGlide({ halfLifeMs = 70, fadeMs = 220, maxJump = 0.45 } = {}) {
  const items = new Map();
  let lastStep = null;
  let frame = { width: 1, height: 1 };

  function reset() {
    items.clear();
    lastStep = null;
  }

  /**
   * Feed a fresh detection list. `frameSize` resets the glide when the source
   * changes shape, so boxes never slide across from a different picture.
   */
  function update(detections, frameSize, now) {
    if (frameSize && (frameSize.width !== frame.width || frameSize.height !== frame.height)) {
      frame = { width: frameSize.width || 1, height: frameSize.height || 1 };
      reset();
    }
    const seen = new Set();
    (detections || []).forEach((detection, index) => {
      const key = keyFor(detection, index);
      seen.add(key);
      const existing = items.get(key);
      const target = copyBox(detection.box);
      if (!existing || existing.leaving) {
        items.set(key, { key, detection, box: copyBox(target), target, alpha: 1, leaving: false, leftAt: 0 });
        return;
      }
      // A box that teleports (new person, or a tracker id reuse) snaps instead of sliding.
      const jump =
        Math.abs(target.x - existing.box.x) / frame.width + Math.abs(target.y - existing.box.y) / frame.height;
      if (jump > maxJump) {
        existing.box = copyBox(target);
      }
      existing.detection = detection;
      existing.target = target;
      existing.alpha = 1;
    });
    for (const item of items.values()) {
      if (!seen.has(item.key) && !item.leaving) {
        item.leaving = true;
        item.leftAt = now;
      }
    }
  }

  /** Advance to `now` and return what to draw. `snap` disables easing (reduced motion). */
  function step(now, { snap = false } = {}) {
    const dt = lastStep == null ? 0 : now - lastStep;
    lastStep = now;
    const factor = snap ? 1 : easeFactor(dt, halfLifeMs);
    const out = [];
    for (const [key, item] of items) {
      if (item.leaving) {
        const age = now - item.leftAt;
        if (snap || age >= fadeMs) {
          items.delete(key);
          continue;
        }
        item.alpha = 1 - age / fadeMs;
      } else {
        item.box.x += (item.target.x - item.box.x) * factor;
        item.box.y += (item.target.y - item.box.y) * factor;
        item.box.width += (item.target.width - item.box.width) * factor;
        item.box.height += (item.target.height - item.box.height) * factor;
      }
      out.push({ ...item.detection, box: copyBox(item.box), alpha: item.alpha, leaving: item.leaving });
    }
    return out;
  }

  return { update, step, reset, get size() { return items.size; } };
}
