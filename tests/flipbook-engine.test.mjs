import assert from "node:assert/strict";
import test from "node:test";

import { ContractError } from "../src/contracts.mjs";
import { FlipbookEngine } from "../src/flipbook-engine.mjs";
import { MockScenePipeline } from "../src/mock-scene-pipeline.mjs";

function createEngine() {
  let id = 0;
  let time = Date.parse("2026-08-28T00:00:00.000Z");
  return new FlipbookEngine({
    pipeline: new MockScenePipeline(),
    idFactory: (prefix) => `${prefix}_${String(++id).padStart(4, "0")}`,
    clock: () => time++,
  });
}

function request(overrides = {}) {
  return {
    query: "盐田港的潮汐与航运",
    parent_node_id: null,
    anchor_id: null,
    point: null,
    mode: "root",
    image_tier: "fast",
    video: "off",
    idempotency_key: "root:engine-001",
    ...overrides,
  };
}

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

test("root generation emits the contracted order and commits one node", async () => {
  const engine = createEngine();
  const session = engine.createSession({ query: "盐田港" });
  const events = await collect(engine.generate(session.id, request()));

  assert.deepEqual(
    events.map((event) => `${event.type}:${event.data.stage || ""}`),
    [
      "status:received",
      "status:resolving",
      "anchor:",
      "status:planning",
      "plan:",
      "draft:",
      "status:rendering",
      "final:",
    ],
  );
  const final = events.at(-1).data;
  assert.equal(final.cached, false);
  assert.equal(final.edge, null);
  assert.equal(final.node.session_id, session.id);
  assert.equal(final.node.model_receipts[0].mock, true);
  assert.equal(engine.getSession(session.id).node_ids.length, 1);
});

test("a plan place context is retained on the generated node", async () => {
  const placeContext = {
    canonical_name: "深圳市盐田区人民政府",
    kind: "government_institution",
    administrative_area: "广东省深圳市盐田区",
    verified_facts: ["官方门户标识该机构。"],
    source_urls: ["https://www.yantian.gov.cn/"],
    visual_focus: "政务办公建筑群。",
    excluded_visuals: ["盐田港"],
    coordinate_status: "not_verified_from_official_source",
  };
  const pipeline = new MockScenePipeline();
  const originalPlanPage = pipeline.planPage.bind(pipeline);
  pipeline.planPage = async (input) => ({ ...(await originalPlanPage(input)), placeContext });
  const engine = new FlipbookEngine({ pipeline });
  const session = engine.createSession({ query: "盐田区人民政府" });
  const events = await collect(engine.generate(session.id, request({ query: "盐田区人民政府", idempotency_key: "root:place-context-001" })));
  assert.deepEqual(events.at(-1).data.node.place_context, placeContext);
});

test("idempotent replay returns the same node without creating another edge", async () => {
  const engine = createEngine();
  const session = engine.createSession();
  const first = await collect(engine.generate(session.id, request()));
  const replay = await collect(engine.generate(session.id, request()));

  assert.deepEqual(replay.map((event) => event.type), ["status", "status", "final"]);
  assert.equal(replay.at(-1).data.cached, true);
  assert.equal(replay.at(-1).data.node.id, first.at(-1).data.node.id);
  assert.equal(engine.getSession(session.id).node_ids.length, 1);
});

test("tap generation creates a child edge inside the same session", async () => {
  const engine = createEngine();
  const session = engine.createSession();
  const rootEvents = await collect(engine.generate(session.id, request()));
  const rootNode = rootEvents.at(-1).data.node;
  const events = await collect(
    engine.generate(
      session.id,
      request({
        query: "进入自动化桥吊",
        parent_node_id: rootNode.id,
        point: { x: 0.65, y: 0.3 },
        mode: "tap",
        idempotency_key: "tap:engine-002",
      }),
    ),
  );

  const final = events.find((event) => event.type === "final").data;
  assert.equal(final.node.parent_id, rootNode.id);
  assert.equal(rootNode.scale_tier, "region");
  assert.equal(final.node.scale_tier, "place");
  assert.equal(final.edge.parent_node_id, rootNode.id);
  assert.equal(final.edge.child_node_id, final.node.id);
  assert.equal(engine.getSession(session.id).node_ids.length, 2);

  const deeperEvents = await collect(
    engine.generate(
      session.id,
      request({
        query: "进入桥吊吊具",
        parent_node_id: final.node.id,
        point: { x: 0.4, y: 0.5 },
        mode: "tap",
        idempotency_key: "tap:engine-003",
      }),
    ),
  );
  assert.equal(deeperEvents.find((event) => event.type === "final").data.node.scale_tier, "object");
});

test("tap generation keeps the selected anchor as the child subject", async () => {
  const asset = {
    url: "data:image/png;base64,AA==",
    width: 1,
    height: 1,
    mime_type: "image/png",
    sha256: "c".repeat(64),
  };
  const anchor = {
    id: "anchor_ocean_world",
    label: "海洋世界",
    kind: "place",
    point: { x: 0.42, y: 0.4 },
    bbox: { x: 0.34, y: 0.3, w: 0.16, h: 0.2 },
    summary: "海洋世界建筑",
    facts: [],
    citations: [],
    confidence: 0.96,
  };
  const engine = new FlipbookEngine({
    pipeline: {
      resolveAnchor: async () => anchor,
      planPage: async () => ({
        title: "小梅沙风景",
        prompt: "生成小梅沙海滩与旅游路线",
        scale_tier: "place",
      }),
      renderDraft: async () => asset,
      renderFinal: async () => ({
        asset,
        anchors: [anchor],
        styleReceipt: {
          schema_version: "1.0",
          style_id: "test",
          style_version: 1,
          reference_pack_id: "test",
          prompt_template_version: "test",
          seed: 1,
        },
        modelReceipts: [],
      }),
    },
  });
  const session = engine.createSession();
  const parent = {
    id: "node_parent",
    session_id: session.id,
    title: "深圳盐田总览",
    scale_tier: "region",
    render: { final: asset },
    anchors: [anchor],
  };
  engine.nodes.set(parent.id, parent);
  session.node_ids.push(parent.id);
  session.root_node_id = parent.id;
  const events = await collect(
    engine.generate(
      session.id,
      request({
        query: "海洋世界建筑局部导览",
        parent_node_id: parent.id,
        anchor_id: anchor.id,
        point: anchor.point,
        mode: "tap",
        idempotency_key: "tap-ocean-world-001",
      }),
    ),
  );
  const plan = events.find((event) => event.type === "plan").data;
  const child = events.find((event) => event.type === "final").data.node;
  assert.equal(child.title, "海洋世界");
  assert.match(plan.prompt, /海洋世界/);
  assert.doesNotMatch(plan.prompt, /小梅沙/);
});

test("explicit tap anchor wins when a provider resolves a different place", async () => {
  const asset = {
    url: "data:image/png;base64,AA==",
    width: 1,
    height: 1,
    mime_type: "image/png",
    sha256: "e".repeat(64),
  };
  const oceanAnchor = {
    id: "anchor_ocean_world",
    label: "海洋世界",
    kind: "place",
    point: { x: 0.42, y: 0.4 },
    bbox: { x: 0.34, y: 0.3, w: 0.16, h: 0.2 },
    summary: "海洋世界建筑",
    facts: [],
    citations: [],
    confidence: 0.96,
  };
  const wrongAnchor = { ...oceanAnchor, id: "anchor_xiaomeisha", label: "小梅沙" };
  const engine = new FlipbookEngine({
    pipeline: {
      resolveAnchor: async () => wrongAnchor,
      planPage: async ({ anchor }) => ({ title: anchor.label, prompt: anchor.label, scale_tier: "place" }),
      renderDraft: async () => asset,
      renderFinal: async () => ({
        asset,
        anchors: [wrongAnchor],
        styleReceipt: {
          schema_version: "1.0",
          style_id: "test",
          style_version: 1,
          reference_pack_id: "test",
          prompt_template_version: "test",
          seed: 1,
        },
        modelReceipts: [],
      }),
    },
  });
  const session = engine.createSession();
  const parent = {
    id: "node_parent",
    session_id: session.id,
    title: "深圳盐田总览",
    scale_tier: "region",
    render: { final: asset },
    anchors: [oceanAnchor],
  };
  engine.nodes.set(parent.id, parent);
  session.node_ids.push(parent.id);
  session.root_node_id = parent.id;

  const events = await collect(
    engine.generate(
      session.id,
      request({
        query: "海洋世界",
        parent_node_id: parent.id,
        anchor_id: oceanAnchor.id,
        point: oceanAnchor.point,
        mode: "tap",
        idempotency_key: "tap-explicit-anchor-001",
      }),
    ),
  );

  const child = events.find((event) => event.type === "final").data.node;
  assert.equal(child.title, "海洋世界");
  assert.equal(child.anchors[0].label, "海洋世界");
});

test("repeated tap on the same known anchor reuses the existing child node", async () => {
  let renderCount = 0;
  const engine = new FlipbookEngine({ pipeline: new MockScenePipeline() });
  const session = engine.createSession();
  const root = (
    await collect(
      engine.generate(
        session.id,
        request({ idempotency_key: "root-known-anchor-01" }),
      ),
    )
  ).at(-1).data.node;
  const anchor = root.anchors[0];
  const originalRenderFinal = engine.pipeline.renderFinal.bind(engine.pipeline);
  engine.pipeline.renderFinal = async (...args) => {
    renderCount += 1;
    return originalRenderFinal(...args);
  };
  const childRequest = request({
    query: anchor.label,
    parent_node_id: root.id,
    anchor_id: anchor.id,
    point: anchor.point,
    mode: "tap",
    idempotency_key: "tap-known-anchor-01",
  });
  const first = await collect(engine.generate(session.id, childRequest));
  const second = await collect(
    engine.generate(session.id, { ...childRequest, idempotency_key: "tap-known-anchor-02" }),
  );
  assert.equal(first.at(-1).data.cached, false);
  assert.equal(second.at(-1).data.cached, true);
  assert.equal(second.at(-1).data.node.id, first.at(-1).data.node.id);
  assert.equal(renderCount, 1);
});

test("mock child scene keeps an unknown target visible as its primary anchor", async () => {
  const engine = new FlipbookEngine({
    pipeline: new MockScenePipeline({
      dataset: [
        {
          id: "scene_fallback",
          query: "无关背景",
          expected_anchors: [{ id: "anchor_fallback", label: "无关背景", kind: "place", point: { x: 0.7, y: 0.7 } }],
        },
      ],
    }),
  });
  const session = engine.createSession();
  const anchor = {
    id: "anchor_ocean_world",
    label: "海洋世界",
    kind: "place",
    point: { x: 0.4, y: 0.4 },
    bbox: { x: 0.33, y: 0.33, w: 0.14, h: 0.14 },
    summary: "海洋世界建筑",
    facts: [],
    citations: [],
    confidence: 0.96,
  };
  const parent = {
    id: "node_parent",
    session_id: session.id,
    title: "深圳盐田总览",
    scale_tier: "region",
    anchors: [anchor],
    render: {
      final: {
        url: "data:image/png;base64,AA==",
        width: 1,
        height: 1,
        mime_type: "image/png",
        sha256: "d".repeat(64),
      },
    },
  };
  engine.nodes.set(parent.id, parent);
  session.node_ids.push(parent.id);
  session.root_node_id = parent.id;
  const events = await collect(
    engine.generate(
      session.id,
      request({
        query: "海洋世界",
        parent_node_id: parent.id,
        anchor_id: anchor.id,
        point: anchor.point,
        mode: "tap",
        idempotency_key: "tap-ocean-mock-001",
      }),
    ),
  );
  const child = events.find((event) => event.type === "final").data.node;
  assert.equal(child.title, "海洋世界");
  assert.equal(child.anchors[0].label, "海洋世界");
});

test("mock child scene promotes a known non-first anchor to the primary target", async () => {
  const pipeline = new MockScenePipeline();
  const anchor = pipeline.dataset.find((scene) => scene.id === "scene_15").expected_anchors[1];
  const plan = await pipeline.planPage({
    request: { query: anchor.label, mode: "tap", idempotency_key: "tap-promote-001" },
    anchor: { ...anchor, bbox: { x: 0.2, y: 0.2, w: 0.14, h: 0.12 }, summary: anchor.label, facts: [], citations: [], confidence: 0.9 },
    parentNode: { scale_tier: "region" },
  });
  const rendered = await pipeline.renderFinal({ plan });
  assert.equal(rendered.anchors[0].label, anchor.label);
});

test("invalid coordinates are rejected before the pipeline is called", async () => {
  const engine = createEngine();
  const session = engine.createSession();

  await assert.rejects(
    async () => collect(engine.generate(session.id, request({ point: { x: 40, y: 20 } }))),
    ContractError,
  );
});

test("pipeline errors preserve provider code and retryability in the SSE contract", async () => {
  const engine = new FlipbookEngine({
    pipeline: {
      resolveAnchor: async () => {
        const error = new Error("provider unavailable");
        error.code = "BAILIAN_HTTP_ERROR";
        error.status = 503;
        error.retryable = true;
        throw error;
      },
    },
  });
  const session = engine.createSession();
  const events = await collect(engine.generate(session.id, request()));
  assert.deepEqual(events.at(-1).data, {
    code: "BAILIAN_HTTP_ERROR",
    message: "provider unavailable",
    retryable: true,
  });
});

test("motion is queued after final and ready motion is persisted on the node", async () => {
  const engine = createEngine();
  const session = engine.createSession();
  const events = await collect(engine.generate(session.id, request({ video: "async", idempotency_key: "root:motion-003" })));
  assert.deepEqual(events.map((event) => event.type), [
    "status", "status", "anchor", "status", "plan", "draft", "status", "final", "motion", "motion",
  ]);
  assert.equal(events.at(-2).data.status, "queued");
  assert.equal(events.at(-1).data.status, "ready");
  assert.equal(events.at(-1).data.asset.mime_type, "video/mp4");
  const node = engine.getNode(events.find((event) => event.type === "final").data.node.id);
  assert.equal(node.render.motion.status, "ready");
  assert.equal(node.render.motion.asset.url, "/fixtures/motion-preview.mp4");
});

test("motion failure keeps the static node usable and records a failed state", async () => {
  const engine = new FlipbookEngine({
    pipeline: {
      resolveAnchor: async () => null,
      planPage: async () => ({ title: "测试", prompt: "测试", scale_tier: "region" }),
      renderDraft: async () => ({ url: "data:image/png;base64,AA==", width: 1, height: 1, mime_type: "image/png", sha256: "a".repeat(64) }),
      renderFinal: async () => ({
        asset: { url: "data:image/png;base64,AA==", width: 1, height: 1, mime_type: "image/png", sha256: "b".repeat(64) },
        anchors: [],
        styleReceipt: { schema_version: "1.0", style_id: "test", style_version: 1, reference_pack_id: "test", prompt_template_version: "test", seed: 1 },
        modelReceipts: [],
      }),
      renderMotion: async () => {
        const error = new Error("video provider unavailable");
        error.code = "BAILIAN_HTTP_ERROR";
        error.status = 503;
        error.retryable = true;
        throw error;
      },
    },
  });
  const session = engine.createSession();
  const events = await collect(engine.generate(session.id, request({ video: "async", idempotency_key: "root:motion-004" })));
  assert.equal(events.find((event) => event.type === "final").data.cached, false);
  const motion = events.at(-1);
  assert.equal(motion.type, "motion");
  assert.equal(motion.data.status, "failed");
  assert.equal(motion.data.error_code, "BAILIAN_HTTP_ERROR");
  const nodeId = events.find((event) => event.type === "final").data.node.id;
  assert.equal(engine.getNode(nodeId).render.motion.status, "failed");
});
