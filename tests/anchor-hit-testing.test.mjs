import assert from "node:assert/strict";
import test from "node:test";

import { findAnchorAtPoint } from "../client/anchor-hit-testing.mjs";

test("generated pages choose the nearest known anchor when a baked label is offset", () => {
  const anchors = [
    { id: "anchor_ocean", point: { x: 0.42, y: 0.4 }, bbox: { x: 0.38, y: 0.36, w: 0.08, h: 0.08 } },
    { id: "anchor_beach", point: { x: 0.82, y: 0.72 }, bbox: { x: 0.78, y: 0.68, w: 0.08, h: 0.08 } },
  ];

  assert.equal(
    findAnchorAtPoint(anchors, { x: 0.55, y: 0.48 }, { preferNearest: true }).id,
    "anchor_ocean",
  );
  assert.equal(findAnchorAtPoint(anchors, { x: 0.55, y: 0.48 }), null);
});

test("an expanded bbox wins over a farther anchor", () => {
  const anchors = [
    { id: "anchor_ocean", point: { x: 0.42, y: 0.4 }, bbox: { x: 0.34, y: 0.3, w: 0.18, h: 0.2 } },
    { id: "anchor_beach", point: { x: 0.7, y: 0.4 }, bbox: { x: 0.66, y: 0.36, w: 0.08, h: 0.08 } },
  ];

  assert.equal(findAnchorAtPoint(anchors, { x: 0.5, y: 0.45 }).id, "anchor_ocean");
});

test("an exact specific bbox wins over an overlapping expanded region", () => {
  const anchors = [
    { id: "anchor_port", point: { x: 0.55, y: 0.45 }, bbox: { x: 0.35, y: 0.35, w: 0.47, h: 0.3 } },
    { id: "anchor_beach", point: { x: 0.82, y: 0.68 }, bbox: { x: 0.75, y: 0.58, w: 0.2, h: 0.2 } },
  ];

  assert.equal(findAnchorAtPoint(anchors, { x: 0.82, y: 0.68 }).id, "anchor_beach");
});

test("legacy canvas anchors using x/y remain selectable", () => {
  const anchor = { id: "anchor_legacy", x: 0.42, y: 0.4, bbox: { x: 0.38, y: 0.36, w: 0.08, h: 0.08 } };
  assert.equal(findAnchorAtPoint([anchor], { x: 0.7, y: 0.55 }, { preferNearest: true }), anchor);
});

test("the active query disambiguates an offset baked-in label", () => {
  const ocean = { id: "anchor_ocean", label: "海洋世界", point: { x: 0.2, y: 0.2 } };
  const beach = { id: "anchor_beach", label: "小梅沙", point: { x: 0.72, y: 0.7 } };
  assert.equal(
    findAnchorAtPoint([ocean, beach], { x: 0.55, y: 0.45 }, { query: "海洋世界建筑局部导览" }),
    ocean,
  );
});

test("a stale search query does not override the nearest generated-page anchor", () => {
  const overview = { id: "anchor_overview", label: "盐田港全貌", point: { x: 0.12, y: 0.08 } };
  const beach = { id: "anchor_beach", label: "大梅沙", point: { x: 0.88, y: 0.52 } };

  assert.equal(
    findAnchorAtPoint(
      [overview, beach],
      { x: 0.86, y: 0.5 },
      { preferNearest: true, query: "盐田港" },
    ),
    beach,
  );
});
