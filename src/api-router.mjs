import { once } from "node:events";

import { ContractError, assertGenerationRequest } from "./contracts.mjs";
import { EngineError } from "./flipbook-engine.mjs";

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readJson(request, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function writeSse(response, event) {
  if (!response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) {
    await once(response, "drain");
  }
}

function sendError(response, error) {
  if (response.headersSent || response.writableEnded) return;
  if (error instanceof ContractError) {
    json(response, 400, { code: "CONTRACT_REJECTED", message: error.message, errors: error.errors });
    return;
  }
  if (error instanceof EngineError || error instanceof HttpError) {
    json(response, error.status, { code: error.code, message: error.message });
    return;
  }
  json(response, 500, { code: "INTERNAL_ERROR", message: "Unexpected server error" });
}

export function createApiRouter(engine) {
  return async function routeApi(request, response, requestUrl) {
    const { pathname } = requestUrl;

    try {
      if (request.method === "POST" && pathname === "/v1/sessions") {
        const body = await readJson(request);
        const session = engine.createSession({ query: body.query || "", locale: body.locale || "zh-CN" });
        json(response, 201, session, { location: `/v1/sessions/${session.id}` });
        return true;
      }

      const sessionMatch = pathname.match(/^\/v1\/sessions\/(sess_[a-zA-Z0-9_-]+)$/);
      if (request.method === "GET" && sessionMatch) {
        json(response, 200, engine.getSession(sessionMatch[1]));
        return true;
      }

      const generateMatch = pathname.match(/^\/v1\/sessions\/(sess_[a-zA-Z0-9_-]+)\/generate$/);
      if (request.method === "POST" && generateMatch) {
        const body = await readJson(request);
        assertGenerationRequest(body);
        engine.getSession(generateMatch[1]);
        const controller = new AbortController();
        request.once("aborted", () => controller.abort());
        response.once("close", () => {
          if (!response.writableEnded) controller.abort();
        });
        response.writeHead(200, {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no",
        });
        response.flushHeaders?.();
        for await (const event of engine.generate(generateMatch[1], body, { signal: controller.signal })) {
          if (response.destroyed) break;
          await writeSse(response, event);
        }
        if (!response.writableEnded) response.end();
        return true;
      }

      const nodeMatch = pathname.match(/^\/v1\/nodes\/(node_[a-zA-Z0-9_-]+)$/);
      if (request.method === "GET" && nodeMatch) {
        json(response, 200, engine.getNode(nodeMatch[1]));
        return true;
      }

      const anchorMatch = pathname.match(
        /^\/v1\/nodes\/(node_[a-zA-Z0-9_-]+)\/anchors\/(anchor_[a-zA-Z0-9_-]+)$/,
      );
      if (request.method === "GET" && anchorMatch) {
        json(response, 200, engine.getAnchorExplanation(anchorMatch[1], anchorMatch[2]));
        return true;
      }
    } catch (error) {
      sendError(response, error);
      return true;
    }

    return pathname.startsWith("/v1/")
      ? (json(response, 404, { code: "NOT_FOUND", message: "Route does not exist" }), true)
      : false;
  };
}
