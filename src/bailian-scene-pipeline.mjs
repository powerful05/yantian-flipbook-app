import { createHash } from "node:crypto";

import { resolvePlaceContext } from "./place-context.mjs";
import { loadStyleReferencePack } from "./style-reference-pack.mjs";

const STYLE_LOCK =
  "原创深圳盐田手绘信息图：温暖米白纸张底，深石墨墨线，蓝青、低饱和植被绿、赭石与少量珊瑚红；等距或近似正交鸟瞰，线条有轻微手绘粗细变化，阴影用疏排线，保留充足纸张留白，不使用照片或塑料 3D 质感。";
const NEGATIVE_PROMPT =
  "photorealistic, 3D plastic render, glossy CGI, neon cyberpunk, dramatic depth of field, fisheye lens, style shift, duplicated structures, floating labels, warped Chinese text, illegible text, random icons, excessive gradients, dense tiny paragraphs, random landmarks, scene cut, geometry melting";
const MOTION_LOCK =
  "One continuous shot. Preserve the editorial isometric ink illustration, warm paper texture, palette, architecture, labels and object count. Keep the selected anchor spatially stable while the camera moves from the parent composition to the child composition. No cut, no new landmark, no style change, no geometry melting, no duplicated structures, no warped typography, no flicker.";
const STYLE_ID = "yantian-editorial-atlas-v2";
const STYLE_VERSION = 2;
const PROMPT_TEMPLATE_VERSION = "scene-v3";
const SCALE_GUIDANCE = Object.freeze({
  region:
    "尺度=region：建立查询地点所在行政区、街区或自然区域的坐标系；宽幅总览图只放 3-6 个显著地标和短引线标签，不堆叠行程卡片，主体覆盖约 35%-60%。",
  place:
    "尺度=place：围绕一个建筑群、公共空间或自然地点；保留一条道路、步道或场地轴作为方向锚点，主地点占中央或右侧，配 2-4 个邻近标签和一条可追踪路径。",
  object:
    "尺度=object：聚焦一个设备、入口或局部对象；采用剖视/局部技术图，保留少量外部轮廓作方位参照，最多 1-3 个短标签，不改变对象身份。",
});
const LABEL_GUIDANCE =
  "标签规则：短标题与少量事实直接画入插图；浅色纸牌、深色细边框、邻近对象或细引线绑定，路径用小箭头/定位点表达；不要生成漂浮 UI 芯片或长段落。";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TRANSITION_DURATION_MS = 5_000;
const DEFAULT_AMBIENT_DURATION_MS = 2_000;
const MOTION_PROMPT_LIMITS = Object.freeze({ transition: 800, ambient: 1500 });
const MOTION_NEGATIVE_PROMPT =
  "镜头切换、场景替换、风格突变、几何融化、重复物体、新增地标、文字变形、闪烁、突然变焦、强运动模糊";
const MOTION_ENDPOINTS = Object.freeze({
  transition: "services/aigc/image2video/video-synthesis",
  ambient: "services/aigc/video-generation/video-synthesis",
});

function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function seedFrom(value) {
  return Number.parseInt(hashHex(value).slice(0, 8), 16) & 0x7fffffff;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function asString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function fitPrompt(value, maximum) {
  const text = asString(value);
  if (text.length <= maximum) return text;
  const suffixLength = Math.min(320, Math.max(120, Math.floor(maximum * 0.35)));
  const prefixLength = Math.max(1, maximum - suffixLength - 1);
  return `${text.slice(0, prefixLength).trim()} ${text.slice(-suffixLength).trim()}`.slice(0, maximum).trim();
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 12) : [];
}

function removeExcludedVisuals(value, excludedVisuals) {
  let result = asString(value);
  for (const term of asStringArray(excludedVisuals).sort((left, right) => right.length - left.length)) {
    result = result.replaceAll(term, "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

function normalizeCoordinate(value, extent = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return clamp(number > 1 && extent > 1 ? number / extent : number, 0, 1);
}

function coordinatePair(value) {
  if (Array.isArray(value)) return { x: value[0], y: value[1] };
  return value || {};
}

function normalizePoint(value, width, height) {
  const point = coordinatePair(value);
  return {
    x: normalizeCoordinate(point.x, width),
    y: normalizeCoordinate(point.y, height),
  };
}

function normalizeBox(value, width, height, point) {
  const box = Array.isArray(value)
    ? { x: value[0], y: value[1], x2: value[2], y2: value[3] }
    : value || {};
  const x = normalizeCoordinate(box.x, width);
  const y = normalizeCoordinate(box.y, height);
  const right = box.x2 == null ? null : normalizeCoordinate(box.x2, width);
  const bottom = box.y2 == null ? null : normalizeCoordinate(box.y2, height);
  const w = box.w ?? box.width ?? (right == null ? 0.14 : right - x);
  const h = box.h ?? box.height ?? (bottom == null ? 0.12 : bottom - y);
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    w: clamp(normalizeCoordinate(w, width), 0.01, 1),
    h: clamp(normalizeCoordinate(h, height), 0.01, 1),
    point,
  };
}

function stripJsonFence(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseJson(value, stage) {
  const text = stripJsonFence(value);
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Fall through to a stable provider error below.
      }
    }
    throw new BailianError("BAILIAN_INVALID_JSON", `${stage} returned invalid JSON`, 502, true);
  }
}

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function mimeFromUrl(url) {
  if (url.startsWith("data:")) return url.slice(5, url.indexOf(";") > 0 ? url.indexOf(";") : url.indexOf(","));
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".mp4")) return "video/mp4";
  if (pathname.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

function sniffMimeType(bytes) {
  if (!bytes || bytes.length < 4) return "";
  if (bytes.readUInt32BE?.(0) === 0x89504e47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString?.("ascii", 0, 4) === "RIFF" && bytes.toString?.("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString?.("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return "";
}

function decodeDataUrl(url) {
  const comma = url.indexOf(",");
  if (comma < 0) throw new BailianError("BAILIAN_INVALID_ASSET", "Media data URL is malformed", 502, true);
  const metadata = url.slice(5, comma);
  const body = url.slice(comma + 1);
  return {
    mimeType: metadata.split(";")[0] || "application/octet-stream",
    bytes: Buffer.from(body, metadata.includes(";base64") ? "base64" : "utf8"),
  };
}

function imageDimensions(bytes, mimeType, fallback) {
  if (mimeType === "image/png" && bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg" && bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  if (mimeType === "image/webp" && bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF") {
    const subtype = bytes.toString("ascii", 12, 16);
    if (subtype === "VP8X") {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { width, height };
    }
  }
  return fallback;
}

function responseContentType(response) {
  return response.headers?.get?.("content-type")?.split(";", 1)[0] || "";
}

async function readJsonResponse(response) {
  if (typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      // Some test doubles and providers return an empty body; text parsing below
      // gives the caller a useful error instead of leaking provider internals.
    }
  }
  let text = "";
  try {
    text = typeof response.text === "function" ? await response.text() : "";
  } catch {
    return {};
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 400) };
  }
}

function extractChatText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => typeof part?.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  throw new BailianError("BAILIAN_EMPTY_RESPONSE", "Chat model returned no content", 502, true);
}

function extractTaskId(body) {
  return asString(body?.output?.task_id || body?.output?.taskId || body?.task_id || body?.taskId);
}

function extractImageUrl(body) {
  return asString(
    body?.output?.results?.[0]?.url ||
      body?.output?.choices?.[0]?.message?.content?.find?.((part) => typeof part?.image === "string")?.image ||
      body?.output?.result_url ||
      body?.output?.image_url ||
      body?.output?.url ||
      body?.results?.[0]?.url ||
      body?.image_url ||
      body?.url,
  );
}

function extractVideoUrl(body) {
  return asString(
    body?.output?.video_url ||
      body?.output?.videoUrl ||
      body?.output?.video?.url ||
      body?.output?.results?.[0]?.video_url ||
      body?.output?.results?.[0]?.url ||
      body?.video_url ||
      body?.videoUrl ||
      body?.video?.url ||
      body?.results?.[0]?.video_url ||
      body?.results?.[0]?.url ||
      body?.url,
  );
}

function taskStatus(body) {
  return asString(body?.output?.task_status || body?.output?.status || body?.task_status || body?.status).toUpperCase();
}

function cloneAnchor(anchor) {
  return anchor ? structuredClone(anchor) : null;
}

function pointInExpandedBox(point, bbox, margin = 0.04) {
  if (!point || !bbox) return false;
  return (
    point.x >= bbox.x - margin &&
    point.x <= bbox.x + bbox.w + margin &&
    point.y >= bbox.y - margin &&
    point.y <= bbox.y + bbox.h + margin
  );
}

const KNOWN_ANCHOR_MAX_DISTANCE = 0.24;

export class BailianError extends Error {
  constructor(code, message, status = 502, retryable = true) {
    super(message);
    this.name = "BailianError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export class BailianScenePipeline {
  constructor({
    config,
    fetchImpl = globalThis.fetch,
    clock = Date.now,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    taskTimeoutMs = DEFAULT_TIMEOUT_MS,
    referencePack,
    assetStore = null,
  } = {}) {
    if (!config?.apiKey || !config?.endpoints?.openAiBaseUrl || !config?.endpoints?.nativeBaseUrl) {
      throw new TypeError("BailianScenePipeline requires a complete model configuration");
    }
    if (typeof fetchImpl !== "function") throw new TypeError("BailianScenePipeline requires fetch");
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.pollIntervalMs = pollIntervalMs;
    this.taskTimeoutMs = taskTimeoutMs;
    this.receiptsByRequest = new WeakMap();
    this.motionCache = new Map();
    this.referencePack = referencePack === undefined ? null : referencePack;
    this.assetStore = assetStore;
    this.referencePackError = null;
    if (referencePack === undefined && config.styleReferenceEnabled === true) {
      try {
        this.referencePack = loadStyleReferencePack({
          manifestPath: config.styleReferenceManifest,
          baseUrl: config.styleReferenceBaseUrl,
          maxImages: config.styleReferenceMaxImages,
        });
      } catch (error) {
        this.referencePackError = error instanceof Error ? error.message : "Style reference pack could not be loaded";
      }
    }
  }

  receiptsFor(request) {
    let receipts = this.receiptsByRequest.get(request);
    if (!receipts) {
      receipts = [];
      this.receiptsByRequest.set(request, receipts);
    }
    return receipts;
  }

  addReceipt(request, receipt) {
    this.receiptsFor(request).push(receipt);
  }

  selectStyleReferences(scaleTier) {
    if (!this.referencePack) return [];
    try {
      return this.referencePack.select(scaleTier);
    } catch {
      return [];
    }
  }

  async requestJson(url, { method = "GET", body, signal, stage, headers = {} } = {}) {
    if (signal?.aborted) throw new BailianError("GENERATION_ABORTED", "Generation was cancelled", 499, false);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(body == null ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body == null ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (signal?.aborted) throw new BailianError("GENERATION_ABORTED", "Generation was cancelled", 499, false);
      throw new BailianError("BAILIAN_NETWORK_ERROR", `${stage} request failed`, 502, true);
    }
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const status = Number(response.status) || 502;
      throw new BailianError(
        "BAILIAN_HTTP_ERROR",
        `${stage} request returned HTTP ${status}`,
        status,
        status >= 500 || status === 429,
      );
    }
    return payload;
  }

  async chatJson({ request, model, stage, messages, signal, maxTokens = 1200 }) {
    const started = this.clock();
    const body = await this.requestJson(joinUrl(this.config.endpoints.openAiBaseUrl, "chat/completions"), {
      method: "POST",
      stage,
      signal,
      body: {
        model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      },
    });
    this.addReceipt(request, {
      provider: "aliyun-bailian",
      model,
      stage,
      latency_ms: Math.max(0, this.clock() - started),
      cost_cny: 0,
      mock: false,
    });
    return parseJson(extractChatText(body), stage);
  }

  async resolveAnchor({ request, parentNode, signal }) {
    if (request.mode === "root") return null;
    const candidates = Array.isArray(parentNode?.anchors) ? parentNode.anchors : [];
    const cached = candidates.find((anchor) => anchor.id === request.anchor_id);
    if (cached) return cloneAnchor(cached);

    const query = asString(request.query);
    const queryMatch = candidates.filter((anchor) => {
      const label = asString(anchor.label);
      return label && (query === label || query.includes(label) || label.includes(query));
    });
    if (queryMatch.length === 1 && !request.point) return cloneAnchor(queryMatch[0]);

    if (request.point && candidates.length) {
      const pool = queryMatch.length ? queryMatch : candidates;
      const boxed = pool.find((anchor) => pointInExpandedBox(request.point, anchor.bbox));
      if (boxed) return cloneAnchor(boxed);
      const nearest = pool.reduce((result, anchor) => {
        const distance = Math.hypot(anchor.point.x - request.point.x, anchor.point.y - request.point.y);
        return !result || distance < result.distance ? { anchor, distance } : result;
      }, null);
      if (nearest && (queryMatch.length > 0 || nearest.distance <= KNOWN_ANCHOR_MAX_DISTANCE)) {
        return cloneAnchor(nearest.anchor);
      }
    }

    if (queryMatch.length === 1) return cloneAnchor(queryMatch[0]);

    const asset = parentNode?.render?.final;
    if (!asset?.url) throw new BailianError("PARENT_ASSET_MISSING", "Parent image is required for click resolution", 409, false);
    const raw = await this.chatJson({
      request,
      model: this.config.models.vision,
      stage: "resolve-anchor",
      signal,
      maxTokens: 700,
      messages: [
        {
          role: "system",
          content:
            "你是视觉定位器。只返回 JSON，不要 Markdown。根据图片和归一化点击点识别目标，字段为 label、kind、point、bbox、summary、facts、citations、confidence。point 和 bbox 的坐标必须是 0 到 1。",
        },
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify({ click: request.point, image_width: asset.width, image_height: asset.height }) },
            { type: "image_url", image_url: { url: asset.url } },
          ],
        },
      ],
    });
    const point = normalizePoint(raw.point || raw.center || request.point, asset.width, asset.height);
    const bbox = normalizeBox(raw.bbox || raw.box, asset.width, asset.height, point);
    const label = asString(raw.label || raw.subject || raw.name, "未命名区域");
    return {
      id: `anchor_${hashHex(`${parentNode.id}:${label}:${point.x}:${point.y}`).slice(0, 16)}`,
      label,
      kind: asString(raw.kind || raw.category, "place"),
      point,
      bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
      summary: asString(raw.summary || raw.description, `${label} 的视觉语义锚点。`),
      facts: asStringArray(raw.facts),
      citations: asStringArray(raw.citations),
      confidence: clamp(Number(raw.confidence) || 0.5, 0, 1),
    };
  }

  async planPage({ request, anchor, parentNode, signal }) {
    const fallbackTier = request.mode === "root" ? "region" : request.mode === "tap" ? "object" : "place";
    const referencePackId = this.referencePack?.packId || "refpack_yantian_v1";
    const placeContext = request.mode === "root" ? resolvePlaceContext(request.query) : null;
    const raw = await this.chatJson({
      request,
      model: this.config.models.text,
      stage: "plan-page",
      signal,
      maxTokens: 1000,
      messages: [
        {
          role: "system",
          content:
            "你是页面规划器。只返回 JSON，字段为 title、prompt、scale_tier。不要编造来源，不要输出 Markdown。prompt 只描述画面，不要依赖 HTML 覆盖。",
        },
        {
          role: "user",
          content: JSON.stringify({
            query: request.query,
            mode: request.mode,
            anchor,
            geographic_context: placeContext,
            parent: parentNode
              ? { title: parentNode.title, scale_tier: parentNode.scale_tier, style_receipt: parentNode.style_receipt }
              : null,
            style_lock: STYLE_LOCK,
            scale_rules: SCALE_GUIDANCE,
            label_rules: LABEL_GUIDANCE,
            reference_pack: {
              id: referencePackId,
              available_roles: this.referencePack?.availableRoles || [],
              max_images: this.referencePack?.maxImages || 0,
            },
          }),
        },
      ],
    });
    const proposedTier = ["region", "place", "object"].includes(raw.scale_tier) ? raw.scale_tier : fallbackTier;
    const parentRank = { region: 0, place: 1, object: 2 }[parentNode?.scale_tier];
    const nextTapRank = request.mode === "tap" && Number.isInteger(parentRank) ? Math.min(2, parentRank + 1) : null;
    const scaleTier = nextTapRank != null
      ? ["region", "place", "object"][nextTapRank]
      : proposedTier;
    const title = request.mode === "root"
      ? asString(placeContext?.canonical_name, request.query).slice(0, 120)
      : asString(raw.title || raw.heading, anchor?.label || request.query).slice(0, 120);
    const anchorPoint = anchor?.point || { x: 0.5, y: 0.5 };
    const continuityLock = parentNode && anchor
      ? `父图连续性锁：保持地点关系和实体身份；从点击中心 ${anchorPoint.x.toFixed(4)},${anchorPoint.y.toFixed(4)}、框 ${anchor.bbox?.x?.toFixed?.(4) || ""},${anchor.bbox?.y?.toFixed?.(4) || ""},${anchor.bbox?.w?.toFixed?.(4) || ""},${anchor.bbox?.h?.toFixed?.(4) || ""} 进入，保留对象颜色、方向、数量和至少两条环境锚点。`
      : `根页先建立“${title}”的地点坐标系，不预设港口或其他无关地点。`;
    const anchorLabelLock = anchor
      ? `目标标签锁：画面主标题或短标签必须明确写出“${asString(anchor.label, "目标区域").slice(0, 80)}”；只保留与该目标直接相关的少量标签。`
      : `根页标题必须是“${title}”，不虚构无关地点名称。`;
    const anchorFactsLock = anchor && asStringArray(anchor.facts).length
      ? `已知事实提示（仅供构图，不替代引用）：${asStringArray(anchor.facts).slice(0, 3).join("；")}`
      : "";
    const referenceLock = this.referencePack
      ? `参考包 ${referencePackId} 只用于统一纸张、墨线、色板和标签语法；不要复制参考图中的地点、文字或人物。`
      : "未加载本地参考包，只使用文字风格合同。";
    const geographyLock = placeContext
      ? `已核验地点上下文：名称=${placeContext.canonical_name}；类别=${placeContext.kind}；行政区=${placeContext.administrative_area}；构图重点=${placeContext.visual_focus}；来源=${placeContext.source_urls.join("、")}；坐标状态=${placeContext.coordinate_status}。`
      : "未命中已核验地点目录；不得把查询默认替换为盐田港。";
    const excludedVisuals = asStringArray(placeContext?.excluded_visuals);
    const exclusionLock = excludedVisuals.length
      ? "严格保持目标类别和已核验地点身份；排除约束已写入图像模型的负向提示词。"
      : "不得擅自把无关港口、海岸或景区作为默认主题。";
    const supplementalPrompt = removeExcludedVisuals(raw.prompt, excludedVisuals);
    const prompt = [
      STYLE_LOCK,
      SCALE_GUIDANCE[scaleTier],
      LABEL_GUIDANCE,
      referenceLock,
      continuityLock,
      anchorLabelLock,
      anchorFactsLock,
      geographyLock,
      exclusionLock,
      supplementalPrompt || `主题：${title}。`,
      "输出中文短标签，标签与对象保持可读间距。",
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .slice(0, 2600);
    // Location-specific references can contain their own labels and landmarks.
    // For a verified beach query, sending the port overview as an I2I reference
    // is more likely to copy "盐田港" than to preserve the requested identity.
    const isPortQuery = /盐田港|集装箱码头|桥吊/.test(`${request.query} ${title}`);
    const referenceAssets = placeContext?.kind === "beach_park" || (!placeContext && !isPortQuery)
      ? []
      : this.selectStyleReferences(scaleTier);
    return {
      title,
      prompt,
      scale_tier: scaleTier,
      seed: seedFrom(`${request.idempotency_key}:${parentNode?.id || "root"}:${anchor?.id || "none"}:style-v${STYLE_VERSION}`),
      placeContext,
      negativePrompt: excludedVisuals.join(", "),
      referenceAssets,
      referencePackId,
      styleVersion: STYLE_VERSION,
      modelReceipts: [...this.receiptsFor(request)],
    };
  }

  async pollTask(taskId, { request, signal, stage = "task", extractResult = () => null, failureMessage = "Generation task failed" } = {}) {
    const started = this.clock();
    const deadline = started + this.taskTimeoutMs;
    while (true) {
      const body = await this.requestJson(joinUrl(this.config.endpoints.nativeBaseUrl, `tasks/${encodeURIComponent(taskId)}`), {
        stage,
        signal,
      });
      const status = taskStatus(body);
      if (status === "SUCCEEDED" || status === "SUCCESS" || extractResult(body)) return body;
      if (["FAILED", "CANCELED", "CANCELLED"].includes(status)) {
        throw new BailianError("BAILIAN_TASK_FAILED", failureMessage, 502, true);
      }
      if (this.clock() >= deadline) throw new BailianError("BAILIAN_TASK_TIMEOUT", `${stage} timed out`, 504, true);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, this.pollIntervalMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new BailianError("GENERATION_ABORTED", "Generation was cancelled", 499, false));
        }, { once: true });
      });
    }
  }

  async pollImageTask(taskId, { request, signal }) {
    return this.pollTask(taskId, {
      request,
      signal,
      stage: "image-task",
      extractResult: extractImageUrl,
      failureMessage: "Image generation task failed",
    });
  }

  async assetFromUrl(url, fallback, signal) {
    let bytes;
    let mimeType;
    if (url.startsWith("data:")) {
      ({ bytes, mimeType } = decodeDataUrl(url));
    } else {
      let response;
      try {
        response = await this.fetchImpl(url, { signal });
      } catch {
        throw new BailianError("BAILIAN_ASSET_FETCH_FAILED", "Generated image could not be downloaded", 502, true);
      }
      if (!response.ok) throw new BailianError("BAILIAN_ASSET_FETCH_FAILED", "Generated image could not be downloaded", 502, true);
      bytes = Buffer.from(await response.arrayBuffer());
      mimeType = responseContentType(response) || mimeFromUrl(url);
    }
    if (!bytes.length) throw new BailianError("BAILIAN_EMPTY_ASSET", "Generated image is empty", 502, true);
    mimeType = mimeType === "application/octet-stream" ? sniffMimeType(bytes) : mimeType;
    if (!mimeType || !mimeType.startsWith("image/")) {
      throw new BailianError("BAILIAN_IMAGE_MIME_UNSUPPORTED", "Generated image MIME type could not be determined", 502, true);
    }
    const dimensions = imageDimensions(bytes, mimeType, fallback);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let persisted = null;
    if (this.assetStore) {
      try {
        persisted = await this.assetStore.persist({ bytes, mimeType, sha256, kind: "image" });
      } catch {
        throw new BailianError("BAILIAN_ASSET_PERSIST_FAILED", "Generated image could not be persisted locally", 500, true);
      }
    }
    return {
      url: persisted?.url || url,
      width: dimensions.width,
      height: dimensions.height,
      mime_type: mimeType,
      sha256,
    };
  }

  async videoAssetFromUrl(url, fallback, signal) {
    let bytes;
    let mimeType;
    if (url.startsWith("data:")) {
      ({ bytes, mimeType } = decodeDataUrl(url));
    } else {
      let response;
      try {
        response = await this.fetchImpl(url, { signal });
      } catch {
        throw new BailianError("BAILIAN_ASSET_FETCH_FAILED", "Generated video could not be downloaded", 502, true);
      }
      if (!response.ok) throw new BailianError("BAILIAN_ASSET_FETCH_FAILED", "Generated video could not be downloaded", 502, true);
      bytes = Buffer.from(await response.arrayBuffer());
      mimeType = responseContentType(response) || mimeFromUrl(url);
    }
    if (!bytes.length) throw new BailianError("BAILIAN_EMPTY_ASSET", "Generated video is empty", 502, true);
    mimeType = mimeType === "application/octet-stream" ? sniffMimeType(bytes) : mimeType;
    if (!mimeType || !mimeType.startsWith("video/")) {
      throw new BailianError("BAILIAN_VIDEO_MIME_UNSUPPORTED", "Generated video MIME type could not be determined", 502, true);
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let persisted = null;
    if (this.assetStore) {
      try {
        persisted = await this.assetStore.persist({ bytes, mimeType, sha256, kind: "video" });
      } catch {
        throw new BailianError("BAILIAN_ASSET_PERSIST_FAILED", "Generated video could not be persisted locally", 500, true);
      }
    }
    return {
      url: persisted?.url || url,
      width: Number(fallback?.width) || 1280,
      height: Number(fallback?.height) || 720,
      mime_type: mimeType,
      sha256,
      duration_ms: Number(fallback?.duration_ms) || DEFAULT_TRANSITION_DURATION_MS,
    };
  }

  async renderImage({ request, plan, variant, parentNode, signal }) {
    const dimensions = variant === "draft" ? { width: 768, height: 480 } : { width: 1536, height: 960 };
    const started = this.clock();
    const styleReferences = Array.isArray(plan?.referenceAssets) ? plan.referenceAssets : [];
    const references = [
      ...(parentNode?.render?.final ? [parentNode.render.final] : []),
      ...styleReferences,
    ]
      .filter((asset) => typeof asset?.url === "string" && asset.url.length > 0)
      .slice(0, 3);
    const content = [];
    for (const asset of references) {
      const localDataUrl = this.assetStore ? await this.assetStore.toDataUrl(asset.url) : null;
      content.push({ image: localDataUrl || asset.url });
    }
    content.push({ text: plan.prompt });
    const body = await this.requestJson(joinUrl(this.config.endpoints.nativeBaseUrl, "services/aigc/image-generation/generation"), {
      method: "POST",
      stage: `image-${variant}`,
      signal,
      headers: { "X-DashScope-Async": "enable" },
      body: {
        model: this.config.models.image,
        input: { messages: [{ role: "user", content }] },
        parameters: {
          size: `${dimensions.width}*${dimensions.height}`,
          n: 1,
          seed: plan.seed,
          prompt_extend: false,
          negative_prompt: [NEGATIVE_PROMPT, asString(plan.negativePrompt)].filter(Boolean).join(", "),
          watermark: false,
        },
      },
    });
    const resolved = extractTaskId(body) ? await this.pollImageTask(extractTaskId(body), { request, signal }) : body;
    const url = extractImageUrl(resolved);
    if (!url) throw new BailianError("BAILIAN_IMAGE_URL_MISSING", "Image generation returned no image URL", 502, true);
    const asset = await this.assetFromUrl(url, dimensions, signal);
    this.addReceipt(request, {
      provider: "aliyun-bailian",
      model: this.config.models.image,
      stage: `image-${variant}`,
      latency_ms: Math.max(0, this.clock() - started),
      cost_cny: 0,
      mock: false,
    });
    return asset;
  }

  async discoverAnchors({ request, asset, signal }) {
    const visionUrl = this.assetStore ? await this.assetStore.toDataUrl(asset.url) : null;
    const raw = await this.chatJson({
      request,
      model: this.config.models.vision,
      stage: "discover-anchors",
      signal,
      maxTokens: 1400,
      messages: [
        {
          role: "system",
          content:
            "你是视觉锚点提取器。只返回 JSON，格式为 {\"anchors\":[...]}。最多返回 8 个显著且可点击的对象，每项包含 label、kind、point、bbox、summary、facts、citations、confidence；point 和 bbox 坐标必须是 0 到 1。",
        },
        { role: "user", content: [{ type: "text", text: "提取可继续探索的显著区域。" }, { type: "image_url", image_url: { url: visionUrl || asset.url } }] },
      ],
    });
    const list = Array.isArray(raw) ? raw : raw.anchors;
    return (Array.isArray(list) ? list : []).slice(0, 8).map((item, index) => {
      const point = normalizePoint(item.point || item.center, asset.width, asset.height);
      const bbox = normalizeBox(item.bbox || item.box, asset.width, asset.height, point);
      const label = asString(item.label || item.subject || item.name, `探索区域 ${index + 1}`);
      return {
        id: `anchor_${hashHex(`${asset.sha256}:${label}:${index}`).slice(0, 16)}`,
        label,
        kind: asString(item.kind || item.category, "place"),
        point,
        bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
        summary: asString(item.summary || item.description, `${label} 的视觉语义锚点。`),
        facts: asStringArray(item.facts),
        citations: asStringArray(item.citations),
        confidence: clamp(Number(item.confidence) || 0.5, 0, 1),
      };
    });
  }

  async renderDraft({ request, plan, parentNode, signal }) {
    return this.renderImage({ request, plan, variant: "draft", parentNode, signal });
  }

  async renderFinal({ request, plan, parentNode, signal }) {
    const asset = await this.renderImage({ request, plan, variant: "final", parentNode, signal });
    const anchors = await this.discoverAnchors({ request, asset, signal });
    return {
      asset,
      anchors,
      styleReceipt: {
        schema_version: "1.0",
        style_id: STYLE_ID,
        style_version: STYLE_VERSION,
        reference_pack_id: plan.referencePackId || this.referencePack?.packId || "refpack_yantian_v1",
        prompt_template_version: PROMPT_TEMPLATE_VERSION,
        seed: plan.seed,
      },
      modelReceipts: [...this.receiptsFor(request)],
    };
  }

  async renderMotion({ request, plan, parentNode, startAsset, endAsset, profile, signal }) {
    if (request.video === "stream") {
      throw new BailianError(
        "MOTION_STREAM_UNSUPPORTED",
        "Incremental video streaming is not implemented by the hosted adapter",
        409,
        false,
      );
    }
    if (this.config.motionMode === "off") {
      throw new BailianError("MOTION_DISABLED", "Paid motion generation is disabled", 409, false);
    }
    if (!endAsset?.url || !endAsset?.sha256) {
      throw new BailianError("MOTION_END_ASSET_MISSING", "A final image is required for motion generation", 409, false);
    }

    let resolvedProfile = profile || (parentNode && startAsset ? "transition" : "ambient");
    if (this.config.motionMode === "ambient") resolvedProfile = "ambient";
    if (this.config.motionMode === "transition") resolvedProfile = "transition";
    if (resolvedProfile === "transition" && (!startAsset?.url || !startAsset?.sha256)) {
      throw new BailianError("MOTION_START_ASSET_MISSING", "A parent image is required for a transition video", 409, false);
    }

    const transition = resolvedProfile === "transition";
    const models = this.config.models || {};
    const model = transition
      ? asString(models.transition, "wan2.2-kf2v-flash")
      : asString(models.ambient, "wan2.6-i2v-flash");
    const durationMs = transition ? DEFAULT_TRANSITION_DURATION_MS : DEFAULT_AMBIENT_DURATION_MS;
    const seed = seedFrom(`${request.idempotency_key}:${startAsset?.sha256 || "ambient"}:${endAsset.sha256}:${resolvedProfile}`);
    const cacheKey = hashHex(`${startAsset?.sha256 || "none"}:${endAsset.sha256}:${resolvedProfile}:${model}:${seed}`);
    const cached = this.motionCache.get(cacheKey);
    if (cached) {
      return {
        ...structuredClone(cached),
        cached: true,
        modelReceipt: {
          provider: "aliyun-bailian",
          model,
          stage: "motion-cache",
          latency_ms: 0,
          cost_cny: 0,
          mock: false,
        },
      };
    }

    const pagePrompt = asString(plan?.prompt, "深圳盐田视觉页面");
    const prompt = transition
      ? `${MOTION_LOCK} The camera smoothly dives from the exact selected region in the first frame into the matching subject and composition in the last frame. ${pagePrompt}`
      : `${MOTION_LOCK} Keep the camera nearly still. Add only subtle water, cloud, vegetation or machine motion while the final composition remains stable. ${pagePrompt}`;
    const boundedPrompt = fitPrompt(prompt, MOTION_PROMPT_LIMITS[transition ? "transition" : "ambient"]);
    const resolvedStartUrl = transition && this.assetStore ? await this.assetStore.toDataUrl(startAsset.url) : null;
    const resolvedEndUrl = this.assetStore ? await this.assetStore.toDataUrl(endAsset.url) : null;
    const input = transition
      ? {
          first_frame_url: resolvedStartUrl || startAsset.url,
          last_frame_url: resolvedEndUrl || endAsset.url,
          prompt: boundedPrompt,
          negative_prompt: MOTION_NEGATIVE_PROMPT,
        }
      : {
          img_url: resolvedEndUrl || endAsset.url,
          prompt: boundedPrompt,
          negative_prompt: MOTION_NEGATIVE_PROMPT,
        };
    const parameters = transition
      ? { resolution: "720P" }
      : { resolution: "720P", duration: durationMs / 1000, audio: false, seed };
    const started = this.clock();
    const body = await this.requestJson(
      joinUrl(this.config.endpoints.nativeBaseUrl, MOTION_ENDPOINTS[transition ? "transition" : "ambient"]),
      {
        method: "POST",
        stage: `motion-${resolvedProfile}`,
        signal,
        headers: { "X-DashScope-Async": "enable" },
        body: { model, input, parameters },
      },
    );
    const taskId = extractTaskId(body);
    const resolved = taskId
      ? await this.pollTask(taskId, {
          request,
          signal,
          stage: "video-task",
          extractResult: extractVideoUrl,
          failureMessage: "Video generation task failed",
        })
      : body;
    const url = extractVideoUrl(resolved);
    if (!url) throw new BailianError("BAILIAN_VIDEO_URL_MISSING", "Video generation returned no video URL", 502, true);
    const asset = await this.videoAssetFromUrl(
      url,
      { width: 1280, height: 720, duration_ms: durationMs },
      signal,
    );
    const modelReceipt = {
      provider: "aliyun-bailian",
      model,
      stage: `motion-${resolvedProfile}`,
      latency_ms: Math.max(0, this.clock() - started),
      cost_cny: 0,
      mock: false,
    };
    this.addReceipt(request, modelReceipt);
    const result = {
      status: "ready",
      profile: resolvedProfile,
      model,
      taskId: taskId || null,
      asset,
      cached: false,
    };
    this.motionCache.set(cacheKey, structuredClone(result));
    return { ...result, modelReceipt };
  }
}

export {
  LABEL_GUIDANCE,
  MOTION_NEGATIVE_PROMPT,
  MOTION_ENDPOINTS,
  MOTION_LOCK,
  MOTION_PROMPT_LIMITS,
  NEGATIVE_PROMPT,
  PROMPT_TEMPLATE_VERSION,
  SCALE_GUIDANCE,
  STYLE_ID,
  STYLE_LOCK,
  STYLE_VERSION,
  imageDimensions,
};
