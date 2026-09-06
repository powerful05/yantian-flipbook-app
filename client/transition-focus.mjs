function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function coordinate(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : fallback;
}

/**
 * Calculate a deterministic local camera move for a semantic anchor.
 * The result is CSS-ready and never depends on a network response.
 */
export function computeTransitionFocus({ point, bbox, width = 1, height = 1 } = {}) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const hasBox = Number.isFinite(Number(bbox?.w)) && Number.isFinite(Number(bbox?.h));
  const fallbackX = hasBox ? Number(bbox.x) + Number(bbox.w) / 2 : 0.5;
  const fallbackY = hasBox ? Number(bbox.y) + Number(bbox.h) / 2 : 0.5;
  const x = coordinate(point?.x, coordinate(fallbackX, 0.5));
  const y = coordinate(point?.y, coordinate(fallbackY, 0.5));
  const boxWidth = hasBox ? clamp(Number(bbox.w), 0.04, 1) : 0.28;
  const boxHeight = hasBox ? clamp(Number(bbox.h), 0.04, 1) : 0.22;
  const scale = clamp(0.42 / Math.max(boxWidth, boxHeight), 1.35, 2.6);

  return {
    originX: `${(x * 100).toFixed(2)}%`,
    originY: `${(y * 100).toFixed(2)}%`,
    scale: Number(scale.toFixed(3)),
    shiftX: Number(((0.5 - x) * safeWidth * (scale - 1)).toFixed(2)),
    shiftY: Number(((0.5 - y) * safeHeight * (scale - 1)).toFixed(2)),
  };
}
