import assert from "node:assert/strict";
import test from "node:test";

import {
  loadWorldManifest,
  validateSceneManifest,
} from "../client/world-manifest.mjs";

const validManifest = {
  schema_version: "mvp-1",
  world_id: "test-world",
  title: "测试世界",
  start_scene_id: "scene_root",
  scenes: [
    {
      id: "scene_root",
      title: "根场景",
      scale_tier: "region",
      renderer: "map",
      camera: { mode: "orthographic", zoom: 1 },
      entities: [
        {
          id: "entity_terminal",
          label: "码头",
          kind: "place",
          point: { x: 0.7, y: 0.35 },
          bbox: { x: 0.6, y: 0.25, w: 0.2, h: 0.2 },
          summary: "测试码头",
          actions: [
            { type: "inspect" },
            { type: "enter", target_scene_id: "scene_detail", transition: "dive_to_anchor" },
          ],
        },
      ],
    },
    {
      id: "scene_detail",
      title: "细节场景",
      scale_tier: "place",
      renderer: "terminal",
      camera: { mode: "orthographic", zoom: 1 },
      entities: [],
    },
  ],
};

test("validates and indexes a scene manifest", () => {
  const manifest = validateSceneManifest(validManifest);
  assert.equal(manifest.world_id, "test-world");
  assert.equal(manifest.scenesById.get("scene_detail").title, "细节场景");
  assert.equal(manifest.entitiesById.get("entity_terminal").label, "码头");
});

test("rejects duplicate ids, invalid coordinates, and missing action targets", () => {
  assert.throws(
    () =>
      validateSceneManifest({
        ...validManifest,
        scenes: [
          ...validManifest.scenes,
          { ...validManifest.scenes[1], id: "scene_root" },
        ],
      }),
    /duplicate scene id/i,
  );

  assert.throws(
    () =>
      validateSceneManifest({
        ...validManifest,
        scenes: [
          {
            ...validManifest.scenes[0],
            entities: [{ ...validManifest.scenes[0].entities[0], point: { x: 2, y: 0.2 } }],
          },
          validManifest.scenes[1],
        ],
      }),
    /point.*0.*1/i,
  );

  assert.throws(
    () =>
      validateSceneManifest({
        ...validManifest,
        scenes: [
          {
            ...validManifest.scenes[0],
            entities: [
              {
                ...validManifest.scenes[0].entities[0],
                actions: [{ type: "enter", target_scene_id: "scene_missing", transition: "dive_to_anchor" }],
              },
            ],
          },
          validManifest.scenes[1],
        ],
      }),
    /target scene/i,
  );
});

test("loads the checked-in MVP manifest", async () => {
  const manifest = await loadWorldManifest(new URL("../fixtures/mvp-world.json", import.meta.url));
  assert.equal(manifest.world_id, "yantian-port-mvp");
  assert.equal(manifest.start_scene_id, "scene_region");
  assert.equal(manifest.scenesById.size, 5);
  assert.ok(manifest.entitiesById.has("entity_crane_01"));
});
