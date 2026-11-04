/** Local count of what entered or left the frame. No network. */

export function countLabels(detections) {
  const counts = {};
  for (const detection of detections || []) {
    const label = String(detection?.label || detection?.class || "object").trim() || "object";
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

export function diffCounts(before, after) {
  const previous = before || {};
  const next = after || {};
  const labels = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const entered = [];
  const left = [];
  for (const label of labels) {
    const delta = (next[label] || 0) - (previous[label] || 0);
    if (delta > 0) {
      entered.push({ label, count: delta });
    } else if (delta < 0) {
      left.push({ label, count: -delta });
    }
  }
  return { entered, left };
}

export function diaryLine(diff) {
  const parts = [];
  for (const item of diff?.entered || []) {
    parts.push(`${item.count} ${item.label} entered`);
  }
  for (const item of diff?.left || []) {
    parts.push(`${item.count} ${item.label} left`);
  }
  return parts.join(", ");
}

function diaryText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain-text export of the diary. Stays on this computer. */
export function diaryDocument(entries) {
  const lines = ["Scene diary", ""];
  for (const entry of entries || []) {
    const line = diaryText(entry?.line);
    if (!line) {
      continue;
    }
    const at = diaryText(entry?.at);
    lines.push(at ? `${at}  ${line}` : line);
  }
  if (lines.length === 2) {
    lines.push("The diary is empty.");
  }
  return `${lines.join("\n")}\n`;
}
