const DEFAULTS = Object.freeze({
  apiHost: "ws-03hwkssn1m52nl33.cn-beijing.maas.aliyuncs.com",
  textModel: "qwen3.8-flash",
  visionModel: "qwen3-vl-flash",
  imageModel: "qwen-image-3.0",
  transitionModel: "wan2.2-kf2v-flash",
  ambientModel: "wan2.6-i2v-flash",
  dailyBudgetCny: 20,
  styleReferenceManifest: "fixtures/style-reference/yantian/manifest.json",
  styleReferenceMaxImages: 3,
});

const MOTION_MODES = new Set(["off", "ambient", "transition", "hybrid"]);

function value(env, key, fallback = "") {
  const candidate = env[key]?.trim();
  return candidate || fallback;
}

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(value || "");
}

function validateBaseUrl(raw, key, apiHost, issues) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      issues.push(`${key} must use HTTPS`);
    }
    if (url.host !== apiHost) {
      issues.push(`${key} must use the configured DASHSCOPE_API_HOST`);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    issues.push(`${key} must be a valid URL`);
    return raw;
  }
}

export function loadModelConfig(env = process.env) {
  const issues = [];
  const apiHost = value(env, "DASHSCOPE_API_HOST", DEFAULTS.apiHost)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const openAiBaseUrl = validateBaseUrl(
    value(env, "DASHSCOPE_OPENAI_BASE_URL", `https://${apiHost}/compatible-mode/v1`),
    "DASHSCOPE_OPENAI_BASE_URL",
    apiHost,
    issues,
  );
  const nativeBaseUrl = validateBaseUrl(
    value(env, "DASHSCOPE_NATIVE_BASE_URL", `https://${apiHost}/api/v1`),
    "DASHSCOPE_NATIVE_BASE_URL",
    apiHost,
    issues,
  );
  const apiKey = value(env, "DASHSCOPE_API_KEY");
  const requestsEnabled = enabled(env.MODEL_REQUESTS_ENABLED);
  const mvpWorldMode = enabled(value(env, "MVP_WORLD_MODE", "false"));
  const motionMode = value(env, "MOTION_GENERATION_MODE", "off").toLowerCase();
  const dailyBudgetCny = Number(value(env, "MODEL_DAILY_BUDGET_CNY", String(DEFAULTS.dailyBudgetCny)));
  const styleReferenceEnabled = enabled(value(env, "STYLE_REFERENCE_ENABLED", "true"));
  const styleReferenceManifest = value(env, "STYLE_REFERENCE_MANIFEST", DEFAULTS.styleReferenceManifest);
  const styleReferenceBaseUrl = value(env, "STYLE_REFERENCE_BASE_URL");
  const styleReferenceMaxImages = Number(
    value(env, "STYLE_REFERENCE_MAX_IMAGES", String(DEFAULTS.styleReferenceMaxImages)),
  );

  if (!MOTION_MODES.has(motionMode)) {
    issues.push("MOTION_GENERATION_MODE must be off, ambient, transition, or hybrid");
  }
  if (!Number.isFinite(dailyBudgetCny) || dailyBudgetCny <= 0) {
    issues.push("MODEL_DAILY_BUDGET_CNY must be a positive number");
  }
  if (!Number.isInteger(styleReferenceMaxImages) || styleReferenceMaxImages < 1 || styleReferenceMaxImages > 3) {
    issues.push("STYLE_REFERENCE_MAX_IMAGES must be an integer from 1 to 3");
  }
  if (styleReferenceBaseUrl) {
    try {
      if (new URL(styleReferenceBaseUrl).protocol !== "https:") {
        issues.push("STYLE_REFERENCE_BASE_URL must use HTTPS");
      }
    } catch {
      issues.push("STYLE_REFERENCE_BASE_URL must be a valid HTTPS URL");
    }
  }
  if (requestsEnabled && !apiKey) {
    issues.push("DASHSCOPE_API_KEY is required when MODEL_REQUESTS_ENABLED=true");
  }

  return Object.freeze({
    provider: "aliyun-bailian",
    region: "cn-beijing",
    apiHost,
    apiKey,
    requestsEnabled,
    mvpWorldMode,
    motionMode,
    dailyBudgetCny,
    styleReferenceEnabled,
    styleReferenceManifest,
    styleReferenceBaseUrl,
    styleReferenceMaxImages,
    endpoints: Object.freeze({ openAiBaseUrl, nativeBaseUrl }),
    models: Object.freeze({
      text: value(env, "QWEN_TEXT_MODEL", DEFAULTS.textModel),
      vision: value(env, "QWEN_VL_MODEL", DEFAULTS.visionModel),
      image: value(env, "QWEN_IMAGE_MODEL", DEFAULTS.imageModel),
      transition: value(env, "WAN_TRANSITION_MODEL", DEFAULTS.transitionModel),
      ambient: value(env, "WAN_AMBIENT_MODEL", DEFAULTS.ambientModel),
    }),
    issues: Object.freeze(issues),
  });
}

export function publicModelStatus(config) {
  const keyConfigured = Boolean(config.apiKey);
  return {
    provider: config.provider,
    region: config.region,
    apiHost: config.apiHost,
    keyConfigured,
    paidRequestsEnabled: config.requestsEnabled,
    mvpWorldMode: config.mvpWorldMode,
    ready: keyConfigured && config.requestsEnabled && config.issues.length === 0,
    motionMode: config.motionMode,
    dailyBudgetCny: config.dailyBudgetCny,
    styleReferenceEnabled: config.styleReferenceEnabled,
    styleReferenceManifest: config.styleReferenceManifest,
    styleReferenceBaseUrlConfigured: Boolean(config.styleReferenceBaseUrl),
    styleReferenceMaxImages: config.styleReferenceMaxImages,
    endpoints: config.endpoints,
    models: config.models,
    issues: config.issues,
  };
}
