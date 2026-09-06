import { validateSceneManifest } from "./world-manifest.mjs";

const PHASES = new Set(["ready", "transitioning", "inspecting", "failed"]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function isPoint(point) {
  return Boolean(
    point &&
      typeof point.x === "number" &&
      Number.isFinite(point.x) &&
      point.x >= 0 &&
      point.x <= 1 &&
      typeof point.y === "number" &&
      Number.isFinite(point.y) &&
      point.y >= 0 &&
      point.y <= 1,
  );
}

function contains(point, bbox, margin = 0) {
  return (
    point.x >= bbox.x - margin &&
    point.x <= bbox.x + bbox.w + margin &&
    point.y >= bbox.y - margin &&
    point.y <= bbox.y + bbox.h + margin
  );
}

function storageRead(storage, key) {
  try {
    if (!storage) return null;
    const value = typeof storage.getItem === "function" ? storage.getItem(key) : storage.get(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function storageWrite(storage, key, value) {
  try {
    if (!storage) return;
    const serialized = JSON.stringify(value);
    if (typeof storage.setItem === "function") storage.setItem(key, serialized);
    else storage.set(key, serialized);
  } catch {
    // Storage is an enhancement; memory state remains authoritative.
  }
}

function error(code, message) {
  return { accepted: false, error: { code, message } };
}

function initialEntityState(manifest) {
  const state = {};
  for (const entity of manifest.entitiesById.values()) {
    if (entity.initial_state) state[entity.id] = clone(entity.initial_state);
  }
  return state;
}

function normalizeState(manifest, value) {
  const sceneId = manifest.scenesById.has(value?.sceneId) ? value.sceneId : manifest.start_scene_id;
  const phase = PHASES.has(value?.phase) && value.phase !== "transitioning" ? value.phase : "ready";
  const entityState = initialEntityState(manifest);
  if (value?.entityState && typeof value.entityState === "object") {
    for (const [entityId, patch] of Object.entries(value.entityState)) {
      if (manifest.entitiesById.has(entityId) && patch && typeof patch === "object") {
        entityState[entityId] = { ...entityState[entityId], ...clone(patch) };
      }
    }
  }
  return {
    worldId: manifest.world_id,
    sceneId,
    phase,
    selectedEntityId: manifest.entitiesById.has(value?.selectedEntityId) ? value.selectedEntityId : null,
    history: Array.isArray(value?.history)
      ? value.history.filter((item) => manifest.scenesById.has(item?.sceneId)).map((item) => clone(item))
      : [],
    entityState,
    lastError: value?.lastError || null,
  };
}

/**
 * Deep client-side world runtime for the MVP. It owns scene navigation,
 * action validation, local state, persistence and the transition lock.
 */
export function createWorldRuntime({ manifest: rawManifest, storage = null, storageKey = "yantian-flipbook:mvp", onChange = () => {} } = {}) {
  const manifest = rawManifest?.scenesById instanceof Map ? rawManifest : validateSceneManifest(rawManifest);
  const persisted = storageRead(storage, storageKey);
  let state = normalizeState(manifest, persisted);
  let transition = null;

  function emit() {
    const snapshot = clone(state);
    storageWrite(storage, storageKey, snapshot);
    onChange(snapshot);
    return snapshot;
  }

  function scene() {
    return manifest.scenesById.get(state.sceneId) || manifest.scenesById.get(manifest.start_scene_id);
  }

  function sceneEntity(entityId) {
    return scene()?.entities.find((entity) => entity.id === entityId) || null;
  }

  function snapshot() {
    return clone(state);
  }

  function loadScene(sceneId) {
    if (!manifest.scenesById.has(sceneId)) return error("SCENE_NOT_FOUND", `Scene ${sceneId} does not exist`);
    if (state.phase === "transitioning") return error("TRANSITION_IN_PROGRESS", "A scene transition is already running");
    state = { ...state, sceneId, phase: "ready", selectedEntityId: null, lastError: null };
    emit();
    return { accepted: true, scene: clone(manifest.scenesById.get(sceneId)), snapshot: snapshot() };
  }

  function hitTest(point, { margin = 0.025, maxDistance = 0.11 } = {}) {
    if (!isPoint(point)) return null;
    const entities = scene()?.entities || [];
    const boxed = entities
      .filter((entity) => contains(point, entity.bbox, margin))
      .sort((left, right) => left.bbox.w * left.bbox.h - right.bbox.w * right.bbox.h);
    if (boxed.length) return clone(boxed[0]);
    let nearest = null;
    let distance = Infinity;
    for (const entity of entities) {
      const current = Math.hypot(entity.point.x - point.x, entity.point.y - point.y);
      if (current < distance) {
        nearest = entity;
        distance = current;
      }
    }
    return nearest && distance <= maxDistance ? clone(nearest) : null;
  }

  function actionFor(entity, type, stateKey = null) {
    return entity?.actions?.find((action) => action.type === type && (type !== "toggle" || action.state_key === stateKey)) || null;
  }

  function dispatch(action) {
    if (!action || typeof action !== "object") return error("INVALID_ACTION", "Action must be an object");
    if (action.type === "back") return back();
    if (state.phase === "transitioning") return error("TRANSITION_IN_PROGRESS", "Complete or cancel the current transition first");
    const entity = action.entityId ? sceneEntity(action.entityId) : null;
    if (!entity) return error("ENTITY_NOT_FOUND", `Entity ${action.entityId || ""} is not in the current scene`);
    const declared = actionFor(entity, action.type, action.stateKey);
    if (!declared) return error("ACTION_NOT_ALLOWED", `${action.type} is not allowed for ${entity.id}`);

    if (action.type === "inspect") {
      state = { ...state, phase: "inspecting", selectedEntityId: entity.id, lastError: null };
      emit();
      return { accepted: true, entity: clone(entity), snapshot: snapshot() };
    }
    if (action.type === "toggle") {
      const previous = Boolean(state.entityState[entity.id]?.[declared.state_key]);
      state = {
        ...state,
        phase: "ready",
        selectedEntityId: entity.id,
        entityState: {
          ...state.entityState,
          [entity.id]: { ...state.entityState[entity.id], [declared.state_key]: !previous },
        },
        lastError: null,
      };
      emit();
      return { accepted: true, entity: clone(entity), stateKey: declared.state_key, value: !previous, snapshot: snapshot() };
    }

    const targetSceneId = declared.target_scene_id;
    const transitionId = `${state.sceneId}:${entity.id}:${targetSceneId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    transition = { id: transitionId, fromSceneId: state.sceneId, toSceneId: targetSceneId, entityId: entity.id, profile: declared.transition };
    state = { ...state, phase: "transitioning", selectedEntityId: entity.id, lastError: null };
    emit();
    return {
      accepted: true,
      transitionId,
      fromSceneId: transition.fromSceneId,
      toSceneId: transition.toSceneId,
      profile: transition.profile,
      entity: clone(entity),
      snapshot: snapshot(),
    };
  }

  function completeTransition(transitionId) {
    if (!transition || transition.id !== transitionId || state.phase !== "transitioning") return error("TRANSITION_NOT_FOUND", "Transition token is stale or missing");
    const completed = transition;
    const previous = {
      sceneId: completed.fromSceneId,
      selectedEntityId: null,
      entityState: clone(state.entityState),
    };
    transition = null;
    state = {
      ...state,
      sceneId: completed.toSceneId,
      phase: "ready",
      selectedEntityId: null,
      history: [...state.history, previous],
      lastError: null,
    };
    emit();
    return { accepted: true, sceneId: state.sceneId, snapshot: snapshot() };
  }

  function cancelTransition(transitionId) {
    if (!transition || transition.id !== transitionId || state.phase !== "transitioning") return error("TRANSITION_NOT_FOUND", "Transition token is stale or missing");
    transition = null;
    state = { ...state, phase: "ready", selectedEntityId: null, lastError: null };
    emit();
    return { accepted: true, snapshot: snapshot() };
  }

  function closeInspect() {
    if (state.phase !== "inspecting") return { accepted: false, snapshot: snapshot() };
    state = { ...state, phase: "ready", selectedEntityId: null };
    emit();
    return { accepted: true, snapshot: snapshot() };
  }

  function back() {
    if (state.phase === "transitioning") return error("TRANSITION_IN_PROGRESS", "Complete or cancel the current transition first");
    const previous = state.history.at(-1);
    if (!previous) return { accepted: false, snapshot: snapshot() };
    state = {
      ...state,
      sceneId: previous.sceneId,
      phase: "ready",
      selectedEntityId: null,
      history: state.history.slice(0, -1),
      // Entity state belongs to the world session, so navigation does not undo
      // a local action performed in a deeper scene.
      entityState: state.entityState,
      lastError: null,
    };
    emit();
    return { accepted: true, sceneId: state.sceneId, snapshot: snapshot() };
  }

  emit();
  return Object.freeze({
    manifest,
    loadScene,
    hitTest,
    dispatch,
    completeTransition,
    cancelTransition,
    closeInspect,
    back,
    snapshot,
  });
}
