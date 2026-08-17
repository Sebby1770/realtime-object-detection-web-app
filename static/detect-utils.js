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

  root.DetectUtils = { PALETTE, colorForLabel, formatCounts };
})(typeof window !== "undefined" ? window : globalThis);
