import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const defaultDataset = JSON.parse(
  readFileSync(new URL("../fixtures/p0-scenes.json", import.meta.url), "utf8"),
);
const motionFixture = readFileSync(new URL("../fixtures/motion-preview.mp4", import.meta.url));
const motionFixtureSha256 = hashHex(motionFixture);

function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function seedFrom(value) {
  return Number.parseInt(hashHex(value).slice(0, 8), 16) & 0x7fffffff;
}

const SCALE_TIERS = ["region", "place", "object"];

function nextScaleTier(request, parentNode) {
  if (request.mode === "root") return "region";
  const parentIndex = SCALE_TIERS.indexOf(parentNode?.scale_tier);
  if (request.mode === "tap") {
    const nextIndex = parentIndex < 0 ? 1 : Math.min(SCALE_TIERS.length - 1, parentIndex + 1);
    return SCALE_TIERS[nextIndex];
  }
  if (request.mode === "ascend") {
    const previousIndex = parentIndex < 0 ? 0 : Math.max(0, parentIndex - 1);
    return SCALE_TIERS[previousIndex];
  }
  return parentNode?.scale_tier || "place";
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function semanticAnchor(anchor) {
  const width = 0.14;
  const height = 0.12;
  return {
    id: anchor.id,
    label: anchor.label,
    kind: anchor.kind,
    point: anchor.point,
    bbox: {
      x: clamp(anchor.point.x - width / 2, 0, 1 - width),
      y: clamp(anchor.point.y - height / 2, 0, 1 - height),
      w: width,
      h: height,
    },
    summary: `${anchor.label} 是当前 Mock 验收画面中的可探索语义锚点。`,
    facts: [],
    citations: [],
    confidence: 0.9,
  };
}

function svgAsset(scene, title, variant) {
  const width = variant === "draft" ? 768 : 1536;
  const height = variant === "draft" ? 480 : 960;
  const scale = width / 1536;
  const anchorMarkup = scene.expected_anchors
    .map((anchor, index) => {
      const x = Math.round(anchor.point.x * width);
      const y = Math.round(anchor.point.y * height);
      const color = ["#b34c43", "#6f9c9a", "#7e9877"][index % 3];
      return `<g><circle cx="${x}" cy="${y}" r="${18 * scale}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="${3 * scale}"/><text x="${x + 28 * scale}" y="${y + 7 * scale}" font-family="sans-serif" font-size="${22 * scale}" fill="#343735">${escapeXml(anchor.label)}</text></g>`;
    })
    .join("");
  const lineMarkup = Array.from({ length: 12 }, (_, index) => {
    const y = Math.round((160 + index * 55) * scale);
    const offset = (index % 3) * 65 * scale;
    return `<path d="M ${90 * scale} ${y} C ${360 * scale} ${y - offset}, ${920 * scale} ${y + offset}, ${1440 * scale} ${y}" fill="none" stroke="#6f9c9a" stroke-opacity="0.18" stroke-width="${2 * scale}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f2f0e8"/><rect x="${40 * scale}" y="${40 * scale}" width="${1456 * scale}" height="${880 * scale}" rx="${8 * scale}" fill="none" stroke="#343735" stroke-opacity="0.32" stroke-width="${2 * scale}"/>${lineMarkup}<text x="${88 * scale}" y="${112 * scale}" font-family="sans-serif" font-size="${42 * scale}" font-weight="600" fill="#343735">${escapeXml(title)}</text><text x="${90 * scale}" y="${148 * scale}" font-family="monospace" font-size="${16 * scale}" fill="#b34c43">DETERMINISTIC MOCK / ${escapeXml(scene.id.toUpperCase())}</text>${anchorMarkup}</svg>`;
  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
    mime_type: "image/svg+xml",
    sha256: hashHex(svg),
  };
}

export class MockScenePipeline {
  constructor({ dataset = defaultDataset } = {}) {
    this.dataset = dataset;
    this.anchorById = new Map(
      dataset.flatMap((scene) => scene.expected_anchors.map((anchor) => [anchor.id, anchor])),
    );
  }

  sceneFor(value) {
    return this.dataset[seedFrom(value) % this.dataset.length];
  }

  sceneForAnchor(anchor, request) {
    const sceneNumber = /^anchor_s(\d+)_/i.exec(anchor?.id || "")?.[1];
    const known = sceneNumber
      ? this.dataset.find((scene) => scene.id === `scene_${sceneNumber.padStart(2, "0")}`)
      : this.dataset.find((scene) => scene.expected_anchors.some((candidate) => candidate.label === anchor?.label));
    if (known) {
      const target = known.expected_anchors.find((candidate) => candidate.id === anchor.id || candidate.label === anchor.label);
      if (!target) return known;
      return {
        ...known,
        expected_anchors: [target, ...known.expected_anchors.filter((candidate) => candidate !== target)],
      };
    }

    const fallback = this.sceneFor(`${request.query}:${anchor?.label || "target"}`);
    const target = {
      id: anchor?.id || `anchor_${hashHex(anchor?.label || request.query).slice(0, 16)}`,
      label: anchor?.label || request.query,
      kind: anchor?.kind || "place",
      point: anchor?.point || { x: 0.5, y: 0.5 },
    };
    return {
      id: `scene_target_${hashHex(`${request.query}:${target.label}`).slice(0, 12)}`,
      query: request.query,
      expected_anchors: [target, ...fallback.expected_anchors.filter((candidate) => candidate.label !== target.label).slice(0, 2)],
    };
  }

  async resolveAnchor({ request, parentNode }) {
    if (request.mode === "root") return null;
    if (request.anchor_id && this.anchorById.has(request.anchor_id)) {
      return semanticAnchor(this.anchorById.get(request.anchor_id));
    }

    const candidates = parentNode?.anchors || this.sceneFor(request.query).expected_anchors.map(semanticAnchor);
    if (!request.point || candidates.length === 0) return candidates[0] || null;
    return candidates.reduce((nearest, anchor) => {
      const distance = Math.hypot(anchor.point.x - request.point.x, anchor.point.y - request.point.y);
      return !nearest || distance < nearest.distance ? { anchor, distance } : nearest;
    }, null).anchor;
  }

  async planPage({ request, anchor, parentNode }) {
    const subject = anchor?.label || request.query;
    const scene = anchor ? this.sceneForAnchor(anchor, request) : this.sceneFor(`${request.query}:${subject}`);
    return {
      title: subject,
      prompt: `港口技术图志风格的信息插画，主题：${subject}。保持等距线描、淡彩和清晰语义锚点。`,
      scale_tier: nextScaleTier(request, parentNode),
      fixture: scene,
    };
  }

  async renderDraft({ plan }) {
    return svgAsset(plan.fixture, plan.title, "draft");
  }

  async renderFinal({ plan }) {
    return {
      asset: svgAsset(plan.fixture, plan.title, "final"),
      anchors: plan.fixture.expected_anchors.map(semanticAnchor),
      styleReceipt: {
        schema_version: "1.0",
        style_id: "yantian-editorial-etching-v1",
        style_version: 1,
        reference_pack_id: "refpack_yantian_p0_mock",
        prompt_template_version: "scene-v1",
        seed: seedFrom(`${plan.fixture.id}:${plan.title}`),
      },
      modelReceipts: [
        {
          provider: "local",
          model: "deterministic-svg-fixture",
          stage: "page",
          latency_ms: 0,
          cost_cny: 0,
          mock: true,
        },
      ],
    };
  }

  async renderMotion({ profile = "ambient" }) {
    return {
      status: "ready",
      profile,
      model: "deterministic-motion-fixture",
      taskId: null,
      asset: {
        url: "/fixtures/motion-preview.mp4",
        width: 768,
        height: 480,
        mime_type: "video/mp4",
        sha256: motionFixtureSha256,
        duration_ms: 2_000,
      },
      cached: true,
      modelReceipt: {
        provider: "local",
        model: "deterministic-motion-fixture",
        stage: "motion",
        latency_ms: 0,
        cost_cny: 0,
        mock: true,
      },
    };
  }
}
