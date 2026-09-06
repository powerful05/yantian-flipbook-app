import assert from "node:assert/strict";
import test from "node:test";

import { loadModelConfig, publicModelStatus } from "../model-config.mjs";

test("defaults use the workspace-scoped Beijing endpoints with billing locked", () => {
  const config = loadModelConfig({});
  const status = publicModelStatus(config);

  assert.equal(status.region, "cn-beijing");
  assert.match(status.endpoints.openAiBaseUrl, /compatible-mode\/v1$/);
  assert.match(status.endpoints.nativeBaseUrl, /api\/v1$/);
  assert.equal(status.keyConfigured, false);
  assert.equal(status.paidRequestsEnabled, false);
  assert.equal(status.mvpWorldMode, false);
  assert.equal(status.ready, false);
  assert.deepEqual(status.issues, []);
  assert.equal(status.styleReferenceEnabled, true);
  assert.equal(status.styleReferenceMaxImages, 3);
});

test("MVP world mode is opt-in for the default homepage", () => {
  const status = publicModelStatus(loadModelConfig({ MVP_WORLD_MODE: "true" }));
  assert.equal(status.mvpWorldMode, true);
});

test("public status never serializes the API Key", () => {
  const secret = "test-secret-that-must-not-leak";
  const status = publicModelStatus(
    loadModelConfig({
      DASHSCOPE_API_KEY: secret,
      MODEL_REQUESTS_ENABLED: "true",
    }),
  );

  assert.equal(status.keyConfigured, true);
  assert.equal(status.ready, true);
  assert.equal(JSON.stringify(status).includes(secret), false);
});

test("cross-host endpoints and invalid motion modes are rejected", () => {
  const status = publicModelStatus(
    loadModelConfig({
      DASHSCOPE_OPENAI_BASE_URL: "https://example.com/compatible-mode/v1",
      MOTION_GENERATION_MODE: "realtime",
    }),
  );

  assert.equal(status.ready, false);
  assert.equal(status.issues.length, 2);
});

test("style reference image count is bounded and can be disabled", () => {
  const disabled = publicModelStatus(loadModelConfig({ STYLE_REFERENCE_ENABLED: "false" }));
  assert.equal(disabled.styleReferenceEnabled, false);

  const invalid = publicModelStatus(loadModelConfig({ STYLE_REFERENCE_MAX_IMAGES: "4" }));
  assert.equal(invalid.ready, false);
  assert.match(invalid.issues.at(-1), /STYLE_REFERENCE_MAX_IMAGES/);
});

test("public reference base URL must be HTTPS", () => {
  const status = publicModelStatus(loadModelConfig({ STYLE_REFERENCE_BASE_URL: "http://assets.example" }));
  assert.equal(status.ready, false);
  assert.ok(status.issues.some((issue) => issue.includes("STYLE_REFERENCE_BASE_URL")));
});
