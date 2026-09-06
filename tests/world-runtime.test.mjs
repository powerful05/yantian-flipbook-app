import assert from "node:assert/strict";
import test from "node:test";

import { createWorldRuntime } from "../client/world-runtime.mjs";

function manifest() {
  return {
    schema_version: "mvp-1",
    world_id: "runtime-test",
    title: "运行时测试",
    start_scene_id: "scene_root",
    scenes: [
      {
        id: "scene_root",
        title: "总览",
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
            summary: "码头摘要",
            actions: [
              { type: "inspect" },
              { type: "enter", target_scene_id: "scene_terminal", transition: "dive_to_anchor" },
            ],
          },
        ],
      },
      {
        id: "scene_terminal",
        title: "码头",
        scale_tier: "place",
        renderer: "terminal",
        camera: { mode: "orthographic", zoom: 1 },
        entities: [
          {
            id: "entity_crane",
            label: "桥吊",
            kind: "machine",
            point: { x: 0.64, y: 0.31 },
            bbox: { x: 0.56, y: 0.2, w: 0.18, h: 0.22 },
            summary: "桥吊摘要",
            initial_state: { running: false },
            actions: [
              { type: "toggle", state_key: "running" },
            ],
          },
        ],
      },
    ],
  };
}

function create(storage = new Map()) {
  const changes = [];
  const runtime = createWorldRuntime({
    manifest: manifest(),
    storage,
    storageKey: "runtime-test",
    onChange: (snapshot) => changes.push(snapshot),
  });
  return { runtime, changes, storage };
}

test("starts at the manifest root and resolves bbox hits", () => {
  const { runtime } = create();
  assert.equal(runtime.snapshot().sceneId, "scene_root");
  assert.equal(runtime.hitTest({ x: 0.68, y: 0.34 }).id, "entity_terminal");
  assert.equal(runtime.hitTest({ x: 0.1, y: 0.1 }), null);
});

test("inspect selects an entity without changing the scene", () => {
  const { runtime } = create();
  const result = runtime.dispatch({ type: "inspect", entityId: "entity_terminal" });
  assert.equal(result.accepted, true);
  assert.equal(runtime.snapshot().sceneId, "scene_root");
  assert.equal(runtime.snapshot().phase, "inspecting");
  assert.equal(runtime.snapshot().selectedEntityId, "entity_terminal");
  runtime.closeInspect();
  assert.equal(runtime.snapshot().phase, "ready");
});

test("enter locks the transition, commits the target, and records history", () => {
  const { runtime } = create();
  const result = runtime.dispatch({ type: "enter", entityId: "entity_terminal" });
  assert.equal(result.accepted, true);
  assert.equal(result.fromSceneId, "scene_root");
  assert.equal(result.toSceneId, "scene_terminal");
  assert.equal(runtime.snapshot().sceneId, "scene_root");
  assert.equal(runtime.snapshot().phase, "transitioning");
  assert.equal(runtime.dispatch({ type: "enter", entityId: "entity_terminal" }).accepted, false);

  runtime.completeTransition(result.transitionId);
  assert.equal(runtime.snapshot().sceneId, "scene_terminal");
  assert.equal(runtime.snapshot().phase, "ready");
  assert.equal(runtime.snapshot().history.length, 1);
  assert.equal(runtime.back().sceneId, "scene_root");
  assert.equal(runtime.snapshot().history.length, 0);
});

test("toggle changes only the declared boolean state and survives storage restore", () => {
  const { runtime, storage } = create();
  const enter = runtime.dispatch({ type: "enter", entityId: "entity_terminal" });
  runtime.completeTransition(enter.transitionId);
  const result = runtime.dispatch({ type: "toggle", entityId: "entity_crane", stateKey: "running" });
  assert.equal(result.accepted, true);
  assert.equal(runtime.snapshot().entityState.entity_crane.running, true);

  const restored = create(storage).runtime;
  assert.equal(restored.snapshot().sceneId, "scene_terminal");
  assert.equal(restored.snapshot().entityState.entity_crane.running, true);
});

test("rejects undeclared actions and invalid transition completion tokens", () => {
  const { runtime } = create();
  assert.equal(runtime.dispatch({ type: "toggle", entityId: "entity_terminal", stateKey: "running" }).accepted, false);
  const enter = runtime.dispatch({ type: "enter", entityId: "entity_terminal" });
  assert.equal(runtime.completeTransition("stale-token").accepted, false);
  assert.equal(runtime.snapshot().phase, "transitioning");
  assert.equal(runtime.cancelTransition(enter.transitionId).accepted, true);
  assert.equal(runtime.snapshot().phase, "ready");
});
