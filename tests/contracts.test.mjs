import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ContractError,
  assertGenerationRequest,
  assertP0Dataset,
} from "../src/contracts.mjs";

const dataset = JSON.parse(
  readFileSync(new URL("../fixtures/p0-scenes.json", import.meta.url), "utf8"),
);

const rootRequest = {
  query: "盐田港的潮汐与航运",
  parent_node_id: null,
  anchor_id: null,
  point: null,
  mode: "root",
  image_tier: "fast",
  video: "off",
  idempotency_key: "root:test-001",
};

test("P0 acceptance dataset contains exactly 20 valid scenes", () => {
  assert.equal(assertP0Dataset(dataset), dataset);
  assert.equal(dataset.length, 20);
  assert.equal(new Set(dataset.map((scene) => scene.id)).size, 20);
});

test("root generation accepts normalized empty navigation context", () => {
  assert.equal(assertGenerationRequest(rootRequest), rootRequest);
});

test("tap generation accepts normalized edge coordinates", () => {
  const request = {
    ...rootRequest,
    parent_node_id: "node_parent",
    anchor_id: null,
    point: { x: 0, y: 1 },
    mode: "tap",
    idempotency_key: "tap:test-001",
  };

  assert.equal(assertGenerationRequest(request), request);
});

test("tap generation rejects CSS pixel coordinates and missing target", () => {
  assert.throws(
    () =>
      assertGenerationRequest({
        ...rootRequest,
        parent_node_id: "node_parent",
        point: { x: 320, y: 180 },
        mode: "tap",
        idempotency_key: "tap:test-002",
      }),
    ContractError,
  );

  assert.throws(
    () =>
      assertGenerationRequest({
        ...rootRequest,
        parent_node_id: "node_parent",
        mode: "tap",
        idempotency_key: "tap:test-003",
      }),
    ContractError,
  );
});
