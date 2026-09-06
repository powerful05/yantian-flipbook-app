function isPoint(value) {
  return Number.isFinite(Number(value?.x)) && Number.isFinite(Number(value?.y));
}

function anchorPoint(anchor) {
  return isPoint(anchor?.point) ? anchor.point : anchor;
}

function isInside(point, bbox, margin) {
  return (
    isPoint(point) &&
    Number.isFinite(Number(bbox?.x)) &&
    Number.isFinite(Number(bbox?.y)) &&
    Number.isFinite(Number(bbox?.w)) &&
    Number.isFinite(Number(bbox?.h)) &&
    point.x >= bbox.x - margin &&
    point.x <= bbox.x + bbox.w + margin &&
    point.y >= bbox.y - margin &&
    point.y <= bbox.y + bbox.h + margin
  );
}

/**
 * Resolve a canvas click against known semantic anchors before asking a model.
 * Generated pages prefer the nearest known anchor so baked-in labels remain clickable.
 */
export function findAnchorAtPoint(
  anchors,
  point,
  { expandedMargin = 0.04, maxDistance = 0.11, preferNearest = false, query = "" } = {},
) {
  const candidates = Array.isArray(anchors) ? anchors.filter((anchor) => isPoint(anchorPoint(anchor))) : [];
  if (!candidates.length || !isPoint(point)) return null;

  const boxed = candidates
    .filter((anchor) => isInside(point, anchor.bbox, expandedMargin))
    .map((anchor) => ({
      anchor,
      exact: isInside(point, anchor.bbox, 0),
      area: Number(anchor.bbox.w) * Number(anchor.bbox.h),
      distance: Math.hypot(anchorPoint(anchor).x - point.x, anchorPoint(anchor).y - point.y),
    }))
    .sort((left, right) =>
      Number(right.exact) - Number(left.exact) || left.area - right.area || left.distance - right.distance,
    )[0];
  if (boxed) return boxed.anchor;

  const normalizedQuery = String(query || "").trim();
  const queryMatches = normalizedQuery
    ? candidates.filter((anchor) => {
        const label = String(anchor.label || anchor.title || "").trim();
        return label && (normalizedQuery === label || normalizedQuery.includes(label) || label.includes(normalizedQuery));
      })
    : [];
  const spatialPool = preferNearest ? candidates : null;
  const pool = spatialPool || (queryMatches.length ? queryMatches : candidates);
  const nearest = pool.reduce((result, anchor) => {
    const position = anchorPoint(anchor);
    const distance = Math.hypot(position.x - point.x, position.y - point.y);
    return !result || distance < result.distance ? { anchor, distance } : result;
  }, null);
  if (nearest && (queryMatches.length > 0 || preferNearest || nearest.distance <= maxDistance)) return nearest.anchor;
  return null;
}
