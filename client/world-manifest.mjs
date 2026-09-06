const SCALE_TIERS = new Set(["region", "place", "object"]);
const RENDERERS = new Set(["map", "terminal", "crane", "channel", "estuary", "custom"]);
const ACTIONS = new Set(["inspect", "enter", "toggle"]);
const TRANSITIONS = new Set(["dive_to_anchor", "return_to_parent"]);

function fail(message) {
  throw new TypeError(`Invalid scene manifest: ${message}`);
}

function assertString(value, name, { min = 1, max = 200 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    fail(`${name} must be a string with ${min}-${max} characters`);
  }
  return value;
}

function assertNormalizedNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${name} must be a number from 0 to 1`);
  }
  return value;
}

function assertPoint(point, name) {
  if (!point || typeof point !== "object") fail(`${name} must be an object`);
  assertNormalizedNumber(point.x, `${name}.x`);
  assertNormalizedNumber(point.y, `${name}.y`);
}

function assertBbox(bbox, name) {
  if (!bbox || typeof bbox !== "object") fail(`${name} must be an object`);
  assertNormalizedNumber(bbox.x, `${name}.x`);
  assertNormalizedNumber(bbox.y, `${name}.y`);
  if (typeof bbox.w !== "number" || !Number.isFinite(bbox.w) || bbox.w <= 0 || bbox.w > 1) {
    fail(`${name}.w must be greater than 0 and at most 1`);
  }
  if (typeof bbox.h !== "number" || !Number.isFinite(bbox.h) || bbox.h <= 0 || bbox.h > 1) {
    fail(`${name}.h must be greater than 0 and at most 1`);
  }
  if (bbox.x + bbox.w > 1 || bbox.y + bbox.h > 1) fail(`${name} must fit inside normalized bounds`);
}

function assertAsset(asset, name) {
  if (asset == null) return;
  if (!asset || typeof asset !== "object") fail(`${name} must be an object`);
  assertString(asset.url, `${name}.url`, { max: 2000 });
  if (!Number.isInteger(asset.width) || asset.width < 1) fail(`${name}.width must be a positive integer`);
  if (!Number.isInteger(asset.height) || asset.height < 1) fail(`${name}.height must be a positive integer`);
  assertString(asset.mime_type, `${name}.mime_type`, { min: 3, max: 100 });
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function validateAction(action, sceneIds, entityId) {
  if (!action || typeof action !== "object") fail(`action for ${entityId} must be an object`);
  if (!ACTIONS.has(action.type)) fail(`unknown action type ${String(action.type)}`);
  if (action.type === "inspect") return;
  if (action.type === "enter") {
    assertString(action.target_scene_id, `enter action target_scene_id for ${entityId}`);
    if (!sceneIds.has(action.target_scene_id)) fail(`enter action target scene ${action.target_scene_id} does not exist`);
    if (!TRANSITIONS.has(action.transition)) fail(`unknown transition ${String(action.transition)}`);
    return;
  }
  assertString(action.state_key, `toggle action state_key for ${entityId}`, { max: 80 });
}

function validateEntity(entity, sceneIds, entityIds) {
  if (!entity || typeof entity !== "object") fail("entity must be an object");
  const id = assertString(entity.id, "entity.id", { max: 120 });
  if (entityIds.has(id)) fail(`duplicate entity id ${id}`);
  entityIds.add(id);
  assertString(entity.label, `entity ${id}.label`, { max: 80 });
  assertString(entity.kind, `entity ${id}.kind`, { max: 40 });
  assertPoint(entity.point, `entity ${id}.point`);
  assertBbox(entity.bbox, `entity ${id}.bbox`);
  assertString(entity.summary, `entity ${id}.summary`, { max: 500 });
  if (entity.asset_id != null) assertString(entity.asset_id, `entity ${id}.asset_id`, { max: 200 });
  if (entity.z != null && (typeof entity.z !== "number" || !Number.isFinite(entity.z))) fail(`entity ${id}.z must be a number`);
  if (entity.initial_state != null && (!entity.initial_state || typeof entity.initial_state !== "object" || Array.isArray(entity.initial_state))) {
    fail(`entity ${id}.initial_state must be an object`);
  }
  if (!Array.isArray(entity.actions)) fail(`entity ${id}.actions must be an array`);
  entity.actions.forEach((action) => validateAction(action, sceneIds, id));
  return id;
}

/**
 * Validate a WorldManifest and return an immutable-ish indexed view.
 * The caller receives cloned data plus Maps for O(1) scene/entity lookup.
 */
export function validateSceneManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("root must be an object");
  if (input.schema_version !== "mvp-1") fail("schema_version must be mvp-1");
  const worldId = assertString(input.world_id, "world_id", { max: 120 });
  const title = assertString(input.title, "title", { max: 200 });
  const startSceneId = assertString(input.start_scene_id, "start_scene_id", { max: 120 });
  if (!Array.isArray(input.scenes) || input.scenes.length === 0) fail("scenes must be a non-empty array");

  const scenes = clone(input.scenes);
  const sceneIds = new Set();
  for (const scene of scenes) {
    if (!scene || typeof scene !== "object") fail("scene must be an object");
    const id = assertString(scene.id, "scene.id", { max: 120 });
    if (sceneIds.has(id)) fail(`duplicate scene id ${id}`);
    sceneIds.add(id);
    assertString(scene.title, `scene ${id}.title`, { max: 200 });
    if (!SCALE_TIERS.has(scene.scale_tier)) fail(`scene ${id}.scale_tier must be region, place, or object`);
    if (!RENDERERS.has(scene.renderer)) fail(`scene ${id}.renderer is not supported`);
    if (!scene.camera || scene.camera.mode !== "orthographic") fail(`scene ${id}.camera.mode must be orthographic`);
    if (scene.camera.zoom != null && (typeof scene.camera.zoom !== "number" || scene.camera.zoom <= 0)) fail(`scene ${id}.camera.zoom must be positive`);
    assertAsset(scene.asset, `scene ${id}.asset`);
    if (!Array.isArray(scene.entities)) fail(`scene ${id}.entities must be an array`);
  }
  if (!sceneIds.has(startSceneId)) fail(`start scene ${startSceneId} does not exist`);

  const entityIds = new Set();
  const scenesById = new Map();
  const entitiesById = new Map();
  for (const scene of scenes) {
    for (const entity of scene.entities) {
      const entityId = validateEntity(entity, sceneIds, entityIds);
      entitiesById.set(entityId, entity);
    }
    scenesById.set(scene.id, scene);
  }

  return {
    schema_version: "mvp-1",
    world_id: worldId,
    title,
    start_scene_id: startSceneId,
    scenes,
    scenesById,
    entitiesById,
  };
}

export async function loadWorldManifest(source) {
  const url = source instanceof URL ? source : new URL(String(source), globalThis.location?.href || "file:///manifest.json");
  let raw;
  if (url.protocol === "file:") {
    const fs = await import("node:fs/promises");
    raw = JSON.parse(await fs.readFile(url, "utf8"));
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`World manifest request failed with HTTP ${response.status}`);
    raw = await response.json();
  }
  return validateSceneManifest(raw);
}

export const manifestConstants = Object.freeze({
  SCALE_TIERS,
  RENDERERS,
  ACTIONS,
  TRANSITIONS,
});
