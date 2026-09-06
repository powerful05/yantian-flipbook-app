function apiError(response, body) {
  const error = new Error(body?.message || `Request failed with HTTP ${response.status}`);
  error.code = body?.code || "HTTP_ERROR";
  error.status = response.status;
  return error;
}

export async function consumeEventStream(response, onEvent) {
  if (!response.ok) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Keep the generic HTTP error when the response is not JSON.
    }
    throw apiError(response, body);
  }
  if (!response.body) throw new Error("Streaming response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) await onEvent(JSON.parse(data));
    }
    if (done) break;
  }

  const trailingData = buffer
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .join("\n");
  if (trailingData) await onEvent(JSON.parse(trailingData));
}

export function createGenerationClient({ fetchImpl = globalThis.fetch, baseUrl = "" } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");

  return {
    async createSession({ query = "", locale = "zh-CN" } = {}) {
      const response = await fetchImpl(`${baseUrl}/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, locale }),
      });
      const body = await response.json();
      if (!response.ok) throw apiError(response, body);
      return body;
    },

    async getSession(sessionId) {
      const response = await fetchImpl(`${baseUrl}/v1/sessions/${sessionId}`, {
        headers: { accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok) throw apiError(response, body);
      return body;
    },

    async getNode(nodeId) {
      const response = await fetchImpl(`${baseUrl}/v1/nodes/${nodeId}`, {
        headers: { accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok) throw apiError(response, body);
      return body;
    },

    async generate(sessionId, request, onEvent, { signal } = {}) {
      const response = await fetchImpl(`${baseUrl}/v1/sessions/${sessionId}/generate`, {
        method: "POST",
        headers: { accept: "text/event-stream", "content-type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
      await consumeEventStream(response, onEvent);
    },
  };
}
