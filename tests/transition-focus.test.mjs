import assert from "node:assert/strict";
import test from "node:test";

import { computeTransitionFocus } from "../client/transition-focus.mjs";

test("transition focus centers and scales the selected bbox", () => {
  const focus = computeTransitionFocus({
    point: { x: 0.2, y: 0.7 },
    bbox: { x: 0.1, y: 0.6, w: 0.2, h: 0.16 },
    width: 1000,
    height: 600,
  });
  assert.ok(focus.scale > 1.5);
  assert.ok(focus.shiftX > 0);
  assert.ok(focus.shiftY < 0);
  assert.equal(focus.originX, "20.00%");
  assert.equal(focus.originY, "70.00%");
});

test("transition focus remains bounded for malformed or missing geometry", () => {
  const focus = computeTransitionFocus({ point: null, bbox: null, width: 320, height: 240 });
  assert.equal(focus.originX, "50.00%");
  assert.equal(focus.originY, "50.00%");
  assert.ok(focus.scale >= 1.35 && focus.scale <= 2.6);
  assert.ok(Number.isFinite(focus.shiftX));
  assert.ok(Number.isFinite(focus.shiftY));
});
