import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadModelConfig, publicModelStatus } from "./model-config.mjs";
import { createApiRouter } from "./src/api-router.mjs";
import { BailianScenePipeline } from "./src/bailian-scene-pipeline.mjs";
import { FlipbookEngine } from "./src/flipbook-engine.mjs";
import { MockScenePipeline } from "./src/mock-scene-pipeline.mjs";
import { LocalAssetStore } from "./src/local-asset-store.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function createAppServer({
  modelConfig = loadModelConfig(),
  engine = null,
  assetStore = new LocalAssetStore({ rootDir: process.env.GENERATED_ASSETS_DIR || resolve(root, "..", "generated-assets", "yantian-flipbook") }),
} = {}) {
  const activeEngine = engine || new FlipbookEngine({ pipeline: createPipeline(modelConfig, assetStore) });
  const routeApi = createApiRouter(activeEngine);
  return createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      if (!response.writableEnded) response.end('{"code":"INTERNAL_ERROR","message":"Unexpected server error"}');
    });
  });

  async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || "/", "http://localhost");
  const rawPathname = (request.url || "/").split(/[?#]/, 1)[0];
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (pathname === "/api/model/status") {
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" });
      response.end();
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(publicModelStatus(modelConfig)));
    return;
  }

  if (await routeApi(request, response, requestUrl)) return;

  const generatedAssetRequest = pathname === assetStore?.publicPrefix || pathname.startsWith(`${assetStore?.publicPrefix}/`);
  const generatedAssetPath = assetStore?.resolve(pathname);
  if (generatedAssetPath) {
    if (!existsSync(generatedAssetPath) || statSync(generatedAssetPath).isDirectory()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": contentTypes[extname(generatedAssetPath)] || "application/octet-stream",
    });
    createReadStream(generatedAssetPath).pipe(response);
    return;
  }
  if (generatedAssetRequest) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
  }
}

function createPipeline(modelConfig, assetStore) {
  if (modelConfig.requestsEnabled && modelConfig.apiKey && (!modelConfig.issues || modelConfig.issues.length === 0)) {
    return new BailianScenePipeline({ config: modelConfig, assetStore });
  }
  return new MockScenePipeline();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4173);
  createAppServer().listen(port, "127.0.0.1", () => {
    console.log(`Yantian Flipbook UI running at http://127.0.0.1:${port}`);
  });
}
