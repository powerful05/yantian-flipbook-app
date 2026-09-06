import { randomUUID } from "node:crypto";

import {
  assertGenerationEvent,
  assertGenerationRequest,
  assertSceneNode,
} from "./contracts.mjs";

export class EngineError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function defaultIdFactory(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function abortIfNeeded(signal) {
  if (signal?.aborted) {
    throw new EngineError("GENERATION_ABORTED", "Generation was cancelled", 499, false);
  }
}

const KNOWN_ANCHOR_MAX_DISTANCE = 0.24;

function knownAnchorForRequest(request, parentNode) {
  if (request?.mode !== "tap") return null;
  const candidates = Array.isArray(parentNode?.anchors) ? parentNode.anchors : [];
  if (!candidates.length) return null;

  if (request.anchor_id) {
    return candidates.find((candidate) => candidate.id === request.anchor_id) || null;
  }

  const query = String(request.query || "").trim();
  const queryMatches = query
    ? candidates.filter((candidate) => {
        const label = String(candidate.label || "").trim();
        return label && (query === label || query.includes(label) || label.includes(query));
      })
    : [];
  if (queryMatches.length === 1 && !request.point) return queryMatches[0];

  if (request.point) {
    const pool = queryMatches.length ? queryMatches : candidates;
    const nearest = pool.reduce((result, candidate) => {
      const distance = Math.hypot(candidate.point.x - request.point.x, candidate.point.y - request.point.y);
      return !result || distance < result.distance ? { candidate, distance } : result;
    }, null);
    if (nearest && (queryMatches.length > 0 || nearest.distance <= KNOWN_ANCHOR_MAX_DISTANCE)) {
      return nearest.candidate;
    }
  }

  return queryMatches.length === 1 ? queryMatches[0] : null;
}

function preserveTargetAnchor(anchors, target, request) {
  const list = Array.isArray(anchors) ? anchors.filter(Boolean) : [];
  if (request?.mode !== "tap" || !target?.label) return list;
  const targetLabel = String(target.label).trim();
  const existing = list.find(
    (candidate) => candidate.id === target.id || String(candidate.label || "").trim() === targetLabel,
  );
  const primary = existing || clone(target);
  return [primary, ...list.filter((candidate) => candidate !== existing && candidate.id !== primary.id)].slice(0, 8);
}

function normalizePlan(plan, { request, anchor, parentNode }) {
  const normalized = plan && typeof plan === "object" ? { ...plan } : {};
  if (request.mode === "root" || !anchor?.label) return normalized;

  const target = String(anchor.label).trim().slice(0, 120);
  const proposedTitle = typeof normalized.title === "string" ? normalized.title.trim() : "";
  const proposedPrompt = typeof normalized.prompt === "string" ? normalized.prompt.trim() : "";
  const conflictingPlace = /(小梅沙|大梅沙|东部华侨城|沙滩路线)/.test(
    `${proposedTitle} ${proposedPrompt}`,
  ) && !/(小梅沙|大梅沙|东部华侨城|沙滩路线)/.test(target);
  const trustedPrompt = (conflictingPlace ? proposedPrompt.replace(/小梅沙|大梅沙|东部华侨城|沙滩路线/g, "") : proposedPrompt).trim();
  const continuityPrompt = [
    `目标对象锁定：${target}。`,
    parentNode?.title ? `父图地点：${String(parentNode.title).slice(0, 120)}。` : "",
    "这是同一地点的连续下一层视图，只生成目标对象及其直接结构；不得替换为其他地点、景点或旅游路线。",
    trustedPrompt ? `辅助构图描述（不得改变目标对象）：${trustedPrompt}` : "",
    `最后确认：画面主标题必须是“${target}”，禁止出现与“${target}”无关的地标。`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...normalized,
    title: target,
    prompt: continuityPrompt,
  };
}

export class FlipbookEngine {
  constructor({ pipeline, clock = Date.now, idFactory = defaultIdFactory } = {}) {
    if (!pipeline) throw new TypeError("FlipbookEngine requires a scene pipeline");
    this.pipeline = pipeline;
    this.clock = clock;
    this.idFactory = idFactory;
    this.sessions = new Map();
    this.nodes = new Map();
    this.edges = new Map();
    this.idempotency = new Map();
    this.navigationIndex = new Map();
    this.activeKeys = new Set();
  }

  now() {
    return new Date(this.clock()).toISOString();
  }

  createSession({ query = "", locale = "zh-CN" } = {}) {
    if (typeof query !== "string" || query.length > 500) {
      throw new EngineError("INVALID_SESSION", "Session query must be at most 500 characters");
    }
    const session = {
      id: this.idFactory("sess"),
      query,
      locale,
      root_node_id: null,
      node_ids: [],
      edge_ids: [],
      created_at: this.now(),
    };
    this.sessions.set(session.id, session);
    return clone(session);
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new EngineError("SESSION_NOT_FOUND", "Session does not exist", 404);
    return clone(session);
  }

  getNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new EngineError("NODE_NOT_FOUND", "Scene node does not exist", 404);
    return clone(node);
  }

  getAnchorExplanation(nodeId, anchorId) {
    const node = this.getNode(nodeId);
    const anchor = node.anchors.find((candidate) => candidate.id === anchorId);
    if (!anchor) throw new EngineError("ANCHOR_NOT_FOUND", "Semantic anchor does not exist", 404);
    return clone({
      ...anchor,
      generated_at: node.created_at,
      model_receipt_id: null,
    });
  }

  async *generate(sessionId, request, { signal } = {}) {
    assertGenerationRequest(request);
    const session = this.sessions.get(sessionId);
    if (!session) throw new EngineError("SESSION_NOT_FOUND", "Session does not exist", 404);
    const parentNode = request.parent_node_id ? this.nodes.get(request.parent_node_id) : null;
    if (request.parent_node_id && (!parentNode || parentNode.session_id !== sessionId)) {
      throw new EngineError("PARENT_NOT_FOUND", "Parent node does not belong to this session", 404);
    }

    const traceId = this.idFactory("trace");
    const idempotencyKey = `${sessionId}:${request.idempotency_key}`;
    let sequence = 0;
    const event = (type, data) =>
      assertGenerationEvent({
        type,
        sequence: ++sequence,
        trace_id: traceId,
        timestamp: this.now(),
        data,
      });

    yield event("status", { stage: "received" });

    const cached = this.idempotency.get(idempotencyKey);
    if (cached) {
      const cachedNode = this.nodes.get(cached.nodeId);
      if (!cachedNode) {
        this.idempotency.delete(idempotencyKey);
      } else {
      yield event("status", { stage: "cached" });
      yield event("final", {
        node: clone(cachedNode),
        edge: clone(cached.edgeId ? this.edges.get(cached.edgeId) : null),
        cached: true,
      });
      return;
      }
    }

    const navigationKey =
      request.mode === "tap" && parentNode && request.anchor_id
        ? `${sessionId}:${parentNode.id}:${request.anchor_id}`
        : null;
    const knownNavigation = navigationKey ? this.navigationIndex.get(navigationKey) : null;
    if (knownNavigation) {
      const knownNode = this.nodes.get(knownNavigation.nodeId);
      const knownEdge = this.edges.get(knownNavigation.edgeId);
      if (knownNode && knownEdge) {
        yield event("status", { stage: "cached" });
        yield event("final", {
          node: clone(knownNode),
          edge: clone(knownEdge),
          cached: true,
        });
        return;
      }
      this.navigationIndex.delete(navigationKey);
    }

    if (this.activeKeys.has(idempotencyKey)) {
      yield event("error", {
        code: "GENERATION_IN_PROGRESS",
        message: "A request with this idempotency key is already running",
        retryable: true,
      });
      return;
    }

    this.activeKeys.add(idempotencyKey);
    try {
      abortIfNeeded(signal);
      yield event("status", { stage: "resolving" });
      const knownAnchor = knownAnchorForRequest(request, parentNode);
      if (request.mode === "tap" && request.anchor_id && !knownAnchor) {
        throw new EngineError("ANCHOR_NOT_FOUND", "Selected anchor does not belong to the parent node", 404, false);
      }
      const anchor = knownAnchor || await this.pipeline.resolveAnchor({ request, parentNode: clone(parentNode), signal });
      abortIfNeeded(signal);
      yield event("anchor", { anchor: clone(anchor) });

      yield event("status", { stage: "planning" });
      const proposedPlan = await this.pipeline.planPage({
        request,
        anchor: clone(anchor),
        parentNode: clone(parentNode),
        signal,
      });
      const plan = normalizePlan(proposedPlan, { request, anchor, parentNode });
      abortIfNeeded(signal);
      yield event("plan", {
        title: plan.title,
        prompt: plan.prompt,
        scale_tier: plan.scale_tier,
      });

      const draft = await this.pipeline.renderDraft({ request, plan, parentNode: clone(parentNode), signal });
      abortIfNeeded(signal);
      yield event("draft", { asset: clone(draft) });
      yield event("status", { stage: "rendering" });

      const rendered = await this.pipeline.renderFinal({ request, plan, parentNode: clone(parentNode), signal });
      abortIfNeeded(signal);
      const motionProfile = parentNode ? "transition" : "ambient";
      const render = { draft, final: rendered.asset };
      if (request.video !== "off") {
        render.motion = { status: "queued", profile: motionProfile };
      }
      const node = assertSceneNode({
        id: this.idFactory("node"),
        session_id: sessionId,
        parent_id: request.parent_node_id,
        relation: request.mode,
        title: plan.title,
        query: request.query,
        scale_tier: plan.scale_tier,
        ...(plan.placeContext ? { place_context: plan.placeContext } : {}),
        style_receipt: rendered.styleReceipt,
        render,
        anchors: preserveTargetAnchor(rendered.anchors, anchor, request),
        model_receipts: rendered.modelReceipts,
        created_at: this.now(),
      });
      const edge = parentNode
        ? {
            id: this.idFactory("edge"),
            session_id: sessionId,
            parent_node_id: parentNode.id,
            child_node_id: node.id,
            anchor_id: anchor?.id || request.anchor_id,
            point: request.point,
            mode: request.mode,
            created_at: this.now(),
          }
        : null;

      this.nodes.set(node.id, clone(node));
      if (edge) this.edges.set(edge.id, clone(edge));
      if (navigationKey && edge) {
        this.navigationIndex.set(navigationKey, { nodeId: node.id, edgeId: edge.id });
      }
      session.node_ids.push(node.id);
      if (edge) session.edge_ids.push(edge.id);
      if (!session.root_node_id) session.root_node_id = node.id;
      this.idempotency.set(idempotencyKey, { nodeId: node.id, edgeId: edge?.id || null });

      yield event("final", { node: clone(node), edge: clone(edge), cached: false });
      if (request.video !== "off") {
        this.activeKeys.delete(idempotencyKey);
        yield event("motion", { status: "queued", node_id: node.id, profile: motionProfile });
        try {
          if (typeof this.pipeline.renderMotion !== "function") {
            throw new EngineError(
              "MOTION_RENDERER_UNAVAILABLE",
              "The active scene pipeline does not provide motion rendering",
              501,
              false,
            );
          }
          const motion = await this.pipeline.renderMotion({
            request,
            plan,
            parentNode: clone(parentNode),
            node: clone(node),
            startAsset: clone(parentNode?.render?.final),
            endAsset: clone(rendered.asset),
            profile: motionProfile,
            signal,
          });
          abortIfNeeded(signal);
          if (!motion?.asset) {
            throw new EngineError("MOTION_ASSET_MISSING", "Motion renderer returned no video asset", 502, true);
          }
          const motionState = {
            status: "ready",
            profile: motion.profile || motionProfile,
            model: motion.model || "motion-renderer",
            task_id: motion.taskId || null,
            asset: clone(motion.asset),
            cached: motion.cached === true,
          };
          const updatedNode = clone(this.nodes.get(node.id));
          updatedNode.render.motion = motionState;
          if (motion.modelReceipt) updatedNode.model_receipts.push(clone(motion.modelReceipt));
          this.nodes.set(node.id, clone(assertSceneNode(updatedNode)));
          yield event("motion", {
            status: "ready",
            node_id: node.id,
            profile: motionState.profile,
            ...(motionState.task_id ? { task_id: motionState.task_id } : {}),
            asset: clone(motionState.asset),
            cached: motionState.cached,
          });
        } catch (motionError) {
          const known =
            motionError instanceof EngineError ||
            (typeof motionError?.code === "string" && Number.isInteger(motionError?.status));
          const code = known ? motionError.code : "MOTION_GENERATION_FAILED";
          const message = known ? motionError.message : "Motion generation failed";
          const updatedNode = clone(this.nodes.get(node.id));
          updatedNode.render.motion = {
            status: "failed",
            profile: motionProfile,
            error_code: code,
            message,
          };
          this.nodes.set(node.id, clone(assertSceneNode(updatedNode)));
          if (!signal?.aborted) {
            yield event("motion", {
              status: "failed",
              node_id: node.id,
              profile: motionProfile,
              error_code: code,
              message,
            });
          }
        }
      }
    } catch (error) {
      const known =
        error instanceof EngineError ||
        (typeof error?.code === "string" && Number.isInteger(error?.status));
      yield event("error", {
        code: known ? error.code : "GENERATION_FAILED",
        message: known ? error.message : "Generation failed",
        retryable: known ? error.retryable : true,
      });
    } finally {
      this.activeKeys.delete(idempotencyKey);
    }
  }
}
