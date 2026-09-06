import assert from "node:assert/strict";
import test from "node:test";

import {
  containRect,
  mediaPointToContainerPercent,
  normalizePointInMedia,
} from "../client/media-coordinates.js";

test("contain geometry preserves a 16:10 image inside a 16:9 stage", () => {
  const rect = containRect(1600, 900, 1600, 1000);
  assert.deepEqual(rect, { x: 80, y: 0, width: 1440, height: 900 });
  assert.deepEqual(normalizePointInMedia(800, 450, rect), { x: 0.5, y: 0.5, inside: true });
});

test("letterbox clicks are reported outside and clamped for transport safety", () => {
  const rect = containRect(1600, 900, 1600, 1000);
  assert.deepEqual(normalizePointInMedia(20, 450, rect), { x: 0, y: 0.5, inside: false });
});

test("semantic points map back to the visible media rectangle", () => {
  const rect = containRect(1000, 1000, 1600, 1000);
  const result = mediaPointToContainerPercent({ x: 0.25, y: 0.75 }, rect, 1000, 1000);
  assert.deepEqual(result, { x: 25, y: 65.625 });
});
