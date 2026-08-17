(function (root) {
  const PALETTE = [
    "#38d6c6",
    "#ff6f59",
    "#f5c84b",
    "#7bd88f",
    "#c084fc",
    "#7dd3fc",
    "#f472b6",
    "#fb923c",
  ];

  function colorForLabel(label) {
    const text = String(label || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return PALETTE[hash % PALETTE.length];
  }

  function formatCounts(counts) {
    if (!counts || typeof counts !== "object") {
      return "none";
    }
    const entries = Object.entries(counts)
      .filter(([, value]) => Number(value) > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    if (!entries.length) {
      return "none";
    }
    return entries.map(([label, count]) => `${label} ×${count}`).join(" · ");
  }

  function boxCenter(box) {
    const x = Number(box?.x) || 0;
    const y = Number(box?.y) || 0;
    const width = Number(box?.width) || 0;
    const height = Number(box?.height) || 0;
    return { x: x + width / 2, y: y + height / 2 };
  }

  function pointInRect(point, rect) {
    if (!point || !rect) {
      return false;
    }
    const x = Number(point.x);
    const y = Number(point.y);
    const left = Number(rect.x) || 0;
    const top = Number(rect.y) || 0;
    const width = Number(rect.width) || 0;
    const height = Number(rect.height) || 0;
    const right = left + width;
    const bottom = top + height;
    const minX = Math.min(left, right);
    const maxX = Math.max(left, right);
    const minY = Math.min(top, bottom);
    const maxY = Math.max(top, bottom);
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  function eventsToCsv(events) {
    const lines = ["timestamp,frame_id,label,confidence,x,y,w,h"];
    for (const event of events || []) {
      for (const detection of event.detections || []) {
        const box = detection.box || {};
        lines.push(
          [
            event.t,
            event.frame_id,
            detection.label,
            detection.confidence,
            box.x,
            box.y,
            box.width,
            box.height,
          ].join(","),
        );
      }
    }
    return `${lines.join("\n")}\n`;
  }

  root.DetectUtils = {
    PALETTE,
    colorForLabel,
    formatCounts,
    boxCenter,
    pointInRect,
    eventsToCsv,
  };
})(typeof window !== "undefined" ? window : globalThis);
