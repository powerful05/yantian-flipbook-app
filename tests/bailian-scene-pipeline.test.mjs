import assert from "node:assert/strict";
import test from "node:test";

import { BailianScenePipeline } from "../src/bailian-scene-pipeline.mjs";

const config = {
  apiKey: "test-key",
  models: { text: "qwen-text", vision: "qwen-vl", image: "qwen-image" },
  endpoints: {
    openAiBaseUrl: "https://workspace.example/compatible-mode/v1",
    nativeBaseUrl: "https://workspace.example/api/v1",
  },
};

function png1x1() {
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  ]);
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  };
}

test("Bailian adapter sends structured prompts, polls image tasks, and returns contract assets", async () => {
  const calls = [];
  const imageBytes = png1x1();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/chat/completions")) {
      const body = JSON.parse(options.body);
      if (body.model === "qwen-text") {
        return jsonResponse({ choices: [{ message: { content: JSON.stringify({ title: "港口地图", prompt: "等距港口插画", scale_tier: "region" }) } }] });
      }
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ anchors: [{ label: "码头", kind: "place", point: { x: 0.4, y: 0.5 }, bbox: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 }, summary: "码头", confidence: 0.9 }] }) } }] });
    }
    if (url.endsWith("/services/aigc/image-generation/generation")) return jsonResponse({ output: { task_id: "task-1" } });
    if (url.endsWith("/tasks/task-1")) return jsonResponse({ output: { task_status: "SUCCEEDED", results: [{ url: "https://assets.example/scene.png" }] } });
    if (url === "https://assets.example/scene.png") {
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => imageBytes.buffer };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const pipeline = new BailianScenePipeline({ config, fetchImpl, pollIntervalMs: 0, taskTimeoutMs: 1000 });
  const request = { query: "盐田港", mode: "root", idempotency_key: "root:test-001" };
  const plan = await pipeline.planPage({ request, anchor: null, parentNode: null });
  const draft = await pipeline.renderDraft({ request, plan });
  const final = await pipeline.renderFinal({ request, plan });

  assert.equal(plan.scale_tier, "region");
  assert.equal(draft.mime_type, "image/png");
  assert.equal(draft.width, 1);
  assert.equal(draft.height, 1);
  assert.equal(final.anchors[0].label, "码头");
  assert.equal(final.modelReceipts.filter((receipt) => !receipt.mock).length, 4);
  const imageCall = calls.find(({ url }) => url.endsWith("/services/aigc/image-generation/generation"));
  const imageBody = JSON.parse(imageCall.options.body);
  assert.equal(imageBody.input.messages[0].role, "user");
  assert.equal(imageBody.input.messages[0].content.at(-1).text.includes("等距港口插画"), true);
  assert.equal(imageBody.parameters.negative_prompt.includes("photorealistic"), true);
  assert.ok(calls.filter(({ url }) => !url.startsWith("https://assets.example/")).every(({ options }) => options.headers.Authorization === "Bearer test-key"));
  assert.ok(calls.find(({ url }) => url.endsWith("/chat/completions"))?.options.body.includes("response_format"));
});

test("a verified government query cannot be planned or rendered as Yantian Port", async () => {
  let plannerPayload = null;
  let imageBody = null;
  const pipeline = new BailianScenePipeline({
    config,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/chat/completions")) {
        plannerPayload = JSON.parse(options.body);
        return jsonResponse({ choices: [{ message: { content: JSON.stringify({ title: "盐田区港口手绘鸟瞰图", prompt: "盐田港、桥吊和集装箱码头", scale_tier: "region" }) } }] });
      }
      if (url.endsWith("/services/aigc/image-generation/generation")) {
        imageBody = JSON.parse(options.body);
        return jsonResponse({ output: { task_id: "government-image" } });
      }
      if (url.endsWith("/tasks/government-image")) {
        return jsonResponse({ output: { task_status: "SUCCEEDED", results: [{ url: "https://assets.example/government.png" }] } });
      }
      if (url === "https://assets.example/government.png") {
        const imageBytes = png1x1();
        return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => imageBytes.buffer };
      }
      throw new Error(`unexpected URL: ${url}`);
    },
    pollIntervalMs: 0,
    taskTimeoutMs: 1000,
  });
  const request = { query: "盐田区人民政府", mode: "root", idempotency_key: "root:government-001" };
  const plan = await pipeline.planPage({ request, anchor: null, parentNode: null });
  await pipeline.renderDraft({ request, plan });

  assert.equal(plan.title, "深圳市盐田区人民政府");
  assert.equal(plan.placeContext.canonical_name, "深圳市盐田区人民政府");
  assert.equal(plan.placeContext.coordinate_status, "not_verified_from_official_source");
  assert.doesNotMatch(plan.prompt, /盐田港|桥吊|集装箱码头/);
  assert.deepEqual(JSON.parse(plannerPayload.messages[1].content).geographic_context.source_urls, ["https://www.yantian.gov.cn/"]);
  const renderedPrompt = imageBody.input.messages[0].content.at(-1).text;
  assert.doesNotMatch(renderedPrompt, /盐田港|桥吊|集装箱码头/);
  assert.match(imageBody.parameters.negative_prompt, /盐田港/);
});

test("a verified Dameisha query is isolated from port labels and port reference images", async () => {
  let imageBody = null;
  const imageBytes = png1x1();
  const pipeline = new BailianScenePipeline({
    config,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/chat/completions")) {
        const body = JSON.parse(options.body);
        if (body.model === "qwen-text") {
          return jsonResponse({ choices: [{ message: { content: JSON.stringify({ title: "盐田港", prompt: "盐田港、桥吊和集装箱码头", scale_tier: "region" }) } }] });
        }
        throw new Error(`unexpected chat model: ${body.model}`);
      }
      if (url.endsWith("/services/aigc/image-generation/generation")) {
        imageBody = JSON.parse(options.body);
        return jsonResponse({ output: { task_id: "beach-image" } });
      }
      if (url.endsWith("/tasks/beach-image")) return jsonResponse({ output: { task_status: "SUCCEEDED", results: [{ url: "https://assets.example/beach.png" }] } });
      if (url === "https://assets.example/beach.png") return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => imageBytes.buffer };
      throw new Error(`unexpected URL: ${url}`);
    },
    pollIntervalMs: 0,
    taskTimeoutMs: 1000,
  });
  const request = { query: "大梅沙", mode: "root", idempotency_key: "root:dameisha-001" };
  const plan = await pipeline.planPage({ request, anchor: null, parentNode: null });
  await pipeline.renderDraft({ request, plan });
  assert.equal(plan.title, "大梅沙海滨公园");
  assert.equal(plan.referenceAssets.length, 0);
  assert.doesNotMatch(plan.prompt, /盐田港|桥吊|集装箱码头/);
  assert.doesNotMatch(imageBody.input.messages[0].content.at(-1).text, /盐田港|桥吊|集装箱码头/);
  assert.match(imageBody.parameters.negative_prompt, /盐田港/);
});

test("Bailian adapter normalizes array points and pixel xyxy boxes from Qwen VL", async () => {
  const pipeline = new BailianScenePipeline({
    config,
    fetchImpl: async (url) => {
      assert.equal(url.endsWith("/chat/completions"), true);
      return jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              anchors: [
                {
                  label: "盐田港纵深",
                  kind: "region",
                  point: [0.72, 0.48],
                  bbox: [400, 380, 860, 680],
                  summary: "港口核心区",
                  confidence: 0.98,
                },
              ],
            }),
          },
        }],
      });
    },
  });

  const result = await pipeline.discoverAnchors({
    request: { query: "盐田港", mode: "root", idempotency_key: "root:array-coordinates" },
    asset: { url: "https://assets.example/scene.png", width: 1536, height: 960, sha256: "a".repeat(64) },
  });

  assert.deepEqual(result[0].point, { x: 0.72, y: 0.48 });
  const expectedBox = { x: 400 / 1536, y: 380 / 960, w: 460 / 1536, h: 300 / 960 };
  for (const key of Object.keys(expectedBox)) {
    assert.ok(Math.abs(result[0].bbox[key] - expectedBox[key]) < 1e-12, `${key} should be normalized`);
  }
});

test("Bailian adapter reuses a known parent anchor without another VLM request", async () => {
  let calls = 0;
  const pipeline = new BailianScenePipeline({ config, fetchImpl: async () => { calls += 1; return jsonResponse({}); } });
  const parentNode = {
    id: "node_parent",
    anchors: [{ id: "anchor_known", label: "桥吊", point: { x: 0.2, y: 0.3 } }],
    render: { final: { url: "data:image/png;base64,AA==", width: 1, height: 1 } },
  };
  const result = await pipeline.resolveAnchor({
    request: { mode: "tap", anchor_id: "anchor_known", point: { x: 0.2, y: 0.3 } },
    parentNode,
  });
  assert.equal(result.label, "桥吊");
  assert.equal(calls, 0);
});

test("Bailian adapter reuses a nearby parent bbox when the client omitted anchor_id", async () => {
  let calls = 0;
  const pipeline = new BailianScenePipeline({ config, fetchImpl: async () => { calls += 1; return jsonResponse({}); } });
  const parentNode = {
    id: "node_parent",
    anchors: [{
      id: "anchor_ocean_world",
      label: "海洋世界",
      kind: "place",
      point: { x: 0.42, y: 0.4 },
      bbox: { x: 0.34, y: 0.31, w: 0.18, h: 0.2 },
      summary: "海洋世界建筑",
      facts: [],
      citations: [],
      confidence: 0.96,
    }],
    render: { final: { url: "data:image/png;base64,AA==", width: 1, height: 1 } },
  };
  const result = await pipeline.resolveAnchor({
    request: { mode: "tap", query: "海洋世界建筑局部导览", point: { x: 0.48, y: 0.46 } },
    parentNode,
  });
  assert.equal(result.label, "海洋世界");
  assert.equal(calls, 0);
});

test("Bailian adapter resolves the nearest duplicate label without another VLM call", async () => {
  let calls = 0;
  const pipeline = new BailianScenePipeline({
    config,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });
  const parentNode = {
    id: "node_parent",
    anchors: [
      {
        id: "anchor_ocean_left",
        label: "海洋世界",
        kind: "place",
        point: { x: 0.28, y: 0.4 },
        bbox: { x: 0.2, y: 0.32, w: 0.14, h: 0.16 },
        summary: "左侧海洋世界",
        facts: [],
        citations: [],
        confidence: 0.9,
      },
      {
        id: "anchor_ocean_right",
        label: "海洋世界",
        kind: "place",
        point: { x: 0.76, y: 0.4 },
        bbox: { x: 0.68, y: 0.32, w: 0.14, h: 0.16 },
        summary: "右侧海洋世界",
        facts: [],
        citations: [],
        confidence: 0.9,
      },
    ],
    render: { final: { url: "data:image/png;base64,AA==", width: 1, height: 1 } },
  };

  const result = await pipeline.resolveAnchor({
    request: { mode: "tap", query: "海洋世界", point: { x: 0.9, y: 0.5 } },
    parentNode,
  });

  assert.equal(result.id, "anchor_ocean_right");
  assert.equal(calls, 0);
});

test("Bailian image editing sends the parent final image as an ordered reference", async () => {
  let generationBody = null;
  const imageBytes = png1x1();
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/services/aigc/image-generation/generation")) {
      generationBody = JSON.parse(options.body);
      return jsonResponse({ output: { task_id: "image-ref-task" } });
    }
    if (url.endsWith("/tasks/image-ref-task")) {
      return jsonResponse({ output: { task_status: "SUCCEEDED", results: [{ url: "https://assets.example/ref.png" }] } });
    }
    if (url === "https://assets.example/ref.png") {
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => imageBytes.buffer };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const pipeline = new BailianScenePipeline({ config, fetchImpl, pollIntervalMs: 0, taskTimeoutMs: 1000 });
  await pipeline.renderDraft({
    request: { query: "进入码头", mode: "tap", idempotency_key: "tap:reference-001" },
    plan: { prompt: "保持父图中的桥吊结构", seed: 7 },
    parentNode: {
      render: { final: { url: "https://assets.example/parent.png", width: 1536, height: 960, sha256: "d".repeat(64) } },
    },
  });
  const content = generationBody.input.messages[0].content;
  assert.deepEqual(content[0], { image: "https://assets.example/parent.png" });
  assert.equal(content.at(-1).text, "保持父图中的桥吊结构");
});

test("Bailian pipeline persists generated assets and reuses local parent images as data URLs", async () => {
  const imageBytes = png1x1();
  const persisted = [];
  let generationBody = null;
  const assetStore = {
    persist: async (asset) => {
      persisted.push(asset);
      return { url: `/generated-assets/images/${asset.sha256}.png` };
    },
    toDataUrl: async (url) => url.startsWith("/generated-assets/") ? "data:image/png;base64,cGFyZW50" : null,
  };
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/services/aigc/image-generation/generation")) {
      generationBody = JSON.parse(options.body);
      return jsonResponse({ output: { task_id: "local-store-task" } });
    }
    if (url.endsWith("/tasks/local-store-task")) {
      return jsonResponse({ output: { task_status: "SUCCEEDED", results: [{ url: "https://assets.example/local.png" }] } });
    }
    if (url === "https://assets.example/local.png") {
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => imageBytes.buffer };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const pipeline = new BailianScenePipeline({ config, fetchImpl, assetStore, pollIntervalMs: 0, taskTimeoutMs: 1000 });
  const asset = await pipeline.renderDraft({
    request: { query: "进入码头", mode: "tap", idempotency_key: "tap:local-store-001" },
    plan: { prompt: "保持父图中的桥吊结构", seed: 7 },
    parentNode: { render: { final: { url: "/generated-assets/images/parent.png", width: 1, height: 1, sha256: "d".repeat(64) } } },
  });
  assert.equal(generationBody.input.messages[0].content[0].image, "data:image/png;base64,cGFyZW50");
  assert.match(asset.url, /^\/generated-assets\/images\//);
  assert.equal(persisted[0].kind, "image");
  assert.equal(persisted[0].mimeType, "image/png");
});

test("Bailian anchor discovery sends a persisted local final image as a data URL", async () => {
  let visionBody = null;
  const pipeline = new BailianScenePipeline({
    config,
    assetStore: {
      toDataUrl: async (url) => url === "/generated-assets/images/final.png" ? "data:image/png;base64,ZmluYWw=" : null,
    },
    fetchImpl: async (url, options = {}) => {
      assert.equal(url.endsWith("/chat/completions"), true);
      visionBody = JSON.parse(options.body);
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ anchors: [] }) } }] });
    },
  });
  await pipeline.discoverAnchors({
    request: { query: "盐田港", mode: "root", idempotency_key: "root:local-vision-001" },
    asset: { url: "/generated-assets/images/final.png", width: 1, height: 1, sha256: "a".repeat(64) },
  });
  assert.equal(visionBody.messages[1].content[1].image_url.url, "data:image/png;base64,ZmluYWw=");
});

test("Bailian style workflow sends ordered references and enforces one-step tap depth", async () => {
  const calls = [];
  const imageBytes = png1x1();
  const styleRefs = [
    { asset_id: "ref-overview", role: "region-overview", url: "data:image/png;base64,AA==", width: 1, height: 1, sha256: "1".repeat(64) },
    { asset_id: "ref-route", role: "route-and-label-system", url: "data:image/png;base64,AA==", width: 1, height: 1, sha256: "2".repeat(64) },
    { asset_id: "ref-detail", role: "place-and-object-detail", url: "data:image/png;base64,AA==", width: 1, height: 1, sha256: "3".repeat(64) },
  ];
  const referencePack = {
    packId: "refpack_test",
    maxImages: 3,
    availableRoles: styleRefs.map((asset) => asset.role),
    select: () => styleRefs,
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/chat/completions")) {
      const body = JSON.parse(options.body);
      if (body.model === "qwen-text") {
        return jsonResponse({ choices: [{ message: { content: JSON.stringify({ title: "桥吊", prompt: "桥吊局部", scale_tier: "region" }) } }] });
      }
      throw new Error(`unexpected chat model: ${body.model}`);
    }
    if (url.endsWith("/services/aigc/image-generation/generation")) return jsonResponse({ output: { task_id: "style-task" } });
    if (url.endsWith("/tasks/style-task")) return jsonResponse({ output: { task_status: "SUCCEEDED", results: [{ url: "https://assets.example/style.png" }] } });
    if (url === "https://assets.example/style.png") {
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => imageBytes.buffer };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const pipeline = new BailianScenePipeline({ config, fetchImpl, referencePack, pollIntervalMs: 0, taskTimeoutMs: 1000 });
  const rootRequest = { query: "盐田港", mode: "root", idempotency_key: "root:style-001" };
  const rootPlan = await pipeline.planPage({ request: rootRequest, anchor: null, parentNode: null });
  assert.equal(rootPlan.referencePackId, "refpack_test");
  assert.equal(rootPlan.referenceAssets.length, 3);
  await pipeline.renderDraft({ request: rootRequest, plan: rootPlan });
  const rootImageCall = calls.filter(({ url }) => url.endsWith("/services/aigc/image-generation/generation")).at(-1);
  const rootContent = JSON.parse(rootImageCall.options.body).input.messages[0].content;
  assert.deepEqual(rootContent.slice(0, 3).map((item) => item.image), styleRefs.map((asset) => asset.url));

  const childRequest = { query: "进入桥吊", mode: "tap", idempotency_key: "tap:style-002", point: { x: 0.4, y: 0.5 } };
  const childPlan = await pipeline.planPage({
    request: childRequest,
    anchor: { label: "桥吊", point: { x: 0.4, y: 0.5 }, bbox: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 } },
    parentNode: { id: "node_parent", title: "盐田港", scale_tier: "region", style_receipt: {} },
  });
  assert.equal(childPlan.scale_tier, "place");
  assert.match(childPlan.prompt, /桥吊/);
  assert.match(childPlan.prompt, /尺度=place/);
  const objectPlan = await pipeline.planPage({
    request: { ...childRequest, idempotency_key: "tap:style-003" },
    anchor: { label: "桥吊吊具", point: { x: 0.4, y: 0.5 }, bbox: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 } },
    parentNode: { id: "node_place", title: "桥吊", scale_tier: "place", style_receipt: {} },
  });
  assert.equal(objectPlan.scale_tier, "object");
  await pipeline.renderDraft({
    request: childRequest,
    plan: childPlan,
    parentNode: { render: { final: { url: "https://assets.example/parent.png", width: 1, height: 1, sha256: "p".repeat(64) } } },
  });
  const childImageCall = calls.filter(({ url }) => url.endsWith("/services/aigc/image-generation/generation")).at(-1);
  const childContent = JSON.parse(childImageCall.options.body).input.messages[0].content;
  assert.equal(childContent[0].image, "https://assets.example/parent.png");
  assert.equal(childContent[1].image, styleRefs[0].url);
  assert.equal(childContent[2].image, styleRefs[1].url);
});

test("Bailian adapter creates and polls a first-last-frame transition, then caches it", async () => {
  const calls = [];
  let taskPolls = 0;
  const videoBytes = Uint8Array.from([0, 1, 2, 3, 4]);
  const motionConfig = {
    ...config,
    motionMode: "hybrid",
    models: { ...config.models, transition: "wan-transition", ambient: "wan-ambient" },
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/services/aigc/image2video/video-synthesis")) {
      return jsonResponse({ output: { task_id: "video-task-1" } });
    }
    if (url.endsWith("/tasks/video-task-1")) {
      taskPolls += 1;
      return taskPolls === 1
        ? jsonResponse({ output: { task_status: "RUNNING" } })
        : jsonResponse({ output: { task_status: "SUCCEEDED", video_url: "https://assets.example/transition.mp4" } });
    }
    if (url === "https://assets.example/transition.mp4") {
      return { ok: true, status: 200, headers: { get: () => "video/mp4" }, arrayBuffer: async () => videoBytes.buffer };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const pipeline = new BailianScenePipeline({ config: motionConfig, fetchImpl, pollIntervalMs: 0, taskTimeoutMs: 1000 });
  const request = { query: "进入桥吊", mode: "tap", video: "async", idempotency_key: "tap:motion-001" };
  const parentNode = { id: "node_parent" };
  const startAsset = { url: "https://assets.example/start.png", width: 1536, height: 960, sha256: "a".repeat(64) };
  const endAsset = { url: "https://assets.example/end.png", width: 1536, height: 960, sha256: "b".repeat(64) };
  const longMotionPrompt = `${"连续性约束 ".repeat(220)}盐田桥吊进入局部`;
  const first = await pipeline.renderMotion({
    request,
    plan: { prompt: longMotionPrompt },
    parentNode,
    startAsset,
    endAsset,
    profile: "transition",
  });

  assert.equal(first.status, "ready");
  assert.equal(first.profile, "transition");
  assert.equal(first.taskId, "video-task-1");
  assert.equal(first.asset.mime_type, "video/mp4");
  assert.equal(first.asset.duration_ms, 5_000);
  const createCall = calls.find(({ url }) => url.endsWith("/services/aigc/image2video/video-synthesis"));
  const createBody = JSON.parse(createCall.options.body);
  assert.equal(createCall.options.headers["X-DashScope-Async"], "enable");
  assert.equal(createBody.model, "wan-transition");
  assert.deepEqual(createBody.input.first_frame_url, startAsset.url);
  assert.deepEqual(createBody.input.last_frame_url, endAsset.url);
  assert.equal(createBody.input.prompt.length <= 800, true);
  assert.equal(createBody.input.prompt.includes("盐田桥吊进入局部"), true);
  assert.equal(typeof createBody.input.negative_prompt, "string");
  assert.equal(createBody.parameters.resolution, "720P");

  const callCountBeforeCache = calls.length;
  const cached = await pipeline.renderMotion({
    request,
    plan: { prompt: longMotionPrompt },
    parentNode,
    startAsset,
    endAsset,
    profile: "transition",
  });
  assert.equal(cached.cached, true);
  assert.equal(calls.length, callCountBeforeCache);
});

test("Bailian adapter uses the single-frame ambient contract", async () => {
  const calls = [];
  const videoBytes = Uint8Array.from([5, 6, 7]);
  const motionConfig = {
    ...config,
    motionMode: "ambient",
    models: { ...config.models, ambient: "wan-ambient" },
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/services/aigc/video-generation/video-synthesis")) {
      return jsonResponse({ output: { task_status: "SUCCEEDED", video_url: "https://assets.example/ambient.mp4" } });
    }
    if (url === "https://assets.example/ambient.mp4") {
      return { ok: true, status: 200, headers: { get: () => "video/mp4" }, arrayBuffer: async () => videoBytes.buffer };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const pipeline = new BailianScenePipeline({ config: motionConfig, fetchImpl, pollIntervalMs: 0, taskTimeoutMs: 1000 });
  const result = await pipeline.renderMotion({
    request: { query: "盐田河口", mode: "root", video: "async", idempotency_key: "root:motion-002" },
    plan: {},
    endAsset: { url: "https://assets.example/end.png", width: 1536, height: 960, sha256: "c".repeat(64) },
    profile: "ambient",
  });
  const createCall = calls.find(({ url }) => url.endsWith("/services/aigc/video-generation/video-synthesis"));
  const createBody = JSON.parse(createCall.options.body);
  assert.equal(result.profile, "ambient");
  assert.equal(createCall.options.headers["X-DashScope-Async"], "enable");
  assert.equal(createBody.model, "wan-ambient");
  assert.equal(createBody.input.img_url, "https://assets.example/end.png");
  assert.equal(createBody.input.prompt.includes("Keep the camera nearly still"), true);
  assert.equal(createBody.input.prompt.length <= 1500, true);
  assert.equal(createBody.input.prompt.includes("深圳盐田视觉页面"), true);
  assert.equal(createBody.input.prompt.includes("盐田港技术图志"), false);
  assert.equal(typeof createBody.input.negative_prompt, "string");
  assert.equal(createBody.parameters.resolution, "720P");
  assert.equal(createBody.parameters.duration, 2);
  assert.equal(createBody.parameters.audio, false);
  assert.equal(Number.isInteger(createBody.parameters.seed), true);
});

test("Bailian adapter maps provider task failures to a stable motion error", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/services/aigc/video-generation/video-synthesis")) {
      return jsonResponse({ output: { task_id: "video-task-failed" } });
    }
    if (url.endsWith("/tasks/video-task-failed")) {
      return jsonResponse({ output: { task_status: "FAILED", code: "ModelError" } });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const pipeline = new BailianScenePipeline({
    config: { ...config, motionMode: "ambient", models: { ...config.models, ambient: "wan-ambient" } },
    fetchImpl,
    pollIntervalMs: 0,
    taskTimeoutMs: 1000,
  });

  await assert.rejects(
    pipeline.renderMotion({
      request: { query: "盐田河口", mode: "root", video: "async", idempotency_key: "root:motion-failed" },
      plan: { prompt: "湿地技术图志" },
      endAsset: { url: "https://assets.example/end.png", width: 1536, height: 960, sha256: "e".repeat(64) },
      profile: "ambient",
    }),
    (error) => error.code === "BAILIAN_TASK_FAILED" && error.retryable === true,
  );
});

test("Bailian adapter stops a motion request when its signal is aborted", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetchImpl = async (url, options = {}) => {
    calls += 1;
    if (url.endsWith("/services/aigc/video-generation/video-synthesis")) {
      controller.abort();
      return jsonResponse({ output: { task_id: "video-task-aborted" } });
    }
    if (options.signal?.aborted) throw new Error("aborted");
    throw new Error(`unexpected URL: ${url}`);
  };
  const pipeline = new BailianScenePipeline({
    config: { ...config, motionMode: "ambient", models: { ...config.models, ambient: "wan-ambient" } },
    fetchImpl,
    pollIntervalMs: 0,
    taskTimeoutMs: 1000,
  });

  await assert.rejects(
    pipeline.renderMotion({
      request: { query: "盐田河口", mode: "root", video: "async", idempotency_key: "root:motion-aborted" },
      plan: { prompt: "湿地技术图志" },
      endAsset: { url: "https://assets.example/end.png", width: 1536, height: 960, sha256: "f".repeat(64) },
      profile: "ambient",
      signal: controller.signal,
    }),
    (error) => error.code === "GENERATION_ABORTED" && error.retryable === false,
  );
  assert.equal(calls, 1);
});
