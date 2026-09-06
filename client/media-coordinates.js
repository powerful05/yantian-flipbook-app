export function containRect(containerWidth, containerHeight, mediaWidth, mediaHeight) {
  if (containerWidth <= 0 || containerHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(containerWidth / mediaWidth, containerHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function normalizePointInMedia(x, y, contentRect) {
  if (contentRect.width <= 0 || contentRect.height <= 0) {
    return { x: 0.5, y: 0.5, inside: false };
  }
  const normalizedX = (x - contentRect.x) / contentRect.width;
  const normalizedY = (y - contentRect.y) / contentRect.height;
  return {
    x: Math.min(1, Math.max(0, normalizedX)),
    y: Math.min(1, Math.max(0, normalizedY)),
    inside: normalizedX >= 0 && normalizedX <= 1 && normalizedY >= 0 && normalizedY <= 1,
  };
}

export function mediaPointToContainerPercent(point, contentRect, containerWidth, containerHeight) {
  return {
    x: ((contentRect.x + point.x * contentRect.width) / containerWidth) * 100,
    y: ((contentRect.y + point.y * contentRect.height) / containerHeight) * 100,
  };
}
