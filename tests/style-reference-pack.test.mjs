import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadStyleReferencePack,
  ROLE_ORDER_BY_TIER,
} from "../src/style-reference-pack.mjs";

const manifestPath = fileURLToPath(
  new URL("../fixtures/style-reference/yantian/manifest.json", import.meta.url),
);

test("style reference pack verifies the checked-in assets and selects semantic order", () => {
  const pack = loadStyleReferencePack({ manifestPath, maxImages: 3 });
  assert.equal(pack.packId, "refpack_yantian_v1");
  assert.deepEqual(pack.availableRoles.slice(0, 3), ROLE_ORDER_BY_TIER.region.slice(0, 3));

  const region = pack.select("region");
  assert.equal(region.length, 3);
  assert.deepEqual(region.map((asset) => asset.role), ROLE_ORDER_BY_TIER.region.slice(0, 3));
  assert.ok(region.every((asset) => asset.url.startsWith("data:image/png;base64,")));
  assert.ok(region.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)));
});

test("style reference pack can use public URLs without embedding local bytes", () => {
  const pack = loadStyleReferencePack({
    manifestPath,
    baseUrl: "https://assets.example/style-pack",
    maxImages: 2,
  });
  const objectRefs = pack.select("object");
  assert.equal(objectRefs.length, 2);
  assert.deepEqual(objectRefs.map((asset) => asset.role), ROLE_ORDER_BY_TIER.object.slice(0, 2));
  assert.equal(objectRefs[0].url, "https://assets.example/style-pack/yantian-itinerary-panels.png");
  assert.equal(objectRefs[0].url.includes("base64"), false);
});
