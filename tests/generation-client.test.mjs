import assert from "node:assert/strict";
import test from "node:test";

import { consumeEventStream, createGenerationClient } from "../client/generation-client.js";

test("event stream parser handles chunk boundaries and ordered events", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: status\ndata: {"type":"status","sequence":1'));
      controller.enqueue(encoder.encode(',"data":{"stage":"received"}}\n\n'));
      controller.enqueue(encoder.encode('event: final\ndata: {"type":"final","sequence":2,"data":{"cached":false}}\n\n'));
      controller.close();
    },
  });
  const events = [];

  await consumeEventStream(
    new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    (event) => events.push(event),
  );

  assert.deepEqual(events.map((event) => event.type), ["status", "final"]);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
});

test("generation client keeps model credentials out of browser requests", async () => {
  const calls = [];
  const client = createGenerationClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "sess_test" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.createSession({ query: "盐田港" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/v1/sessions");
  assert.equal("authorization" in calls[0].init.headers, false);
  assert.equal(JSON.stringify(calls[0]).includes("DASHSCOPE"), false);
});

test("generation client can hydrate sessions and nodes without a generation request", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const body = url.includes("/nodes/")
      ? { id: "node_1", session_id: "sess_1", render: { final: {} } }
      : { id: "sess_1" };
    return { ok: true, status: 200, json: async () => body };
  };
  const client = createGenerationClient({ fetchImpl, baseUrl: "http://local" });
  assert.equal((await client.getSession("sess_1")).id, "sess_1");
  assert.equal((await client.getNode("node_1")).session_id, "sess_1");
  assert.deepEqual(calls.map((call) => call.url), [
    "http://local/v1/sessions/sess_1",
    "http://local/v1/nodes/node_1",
  ]);
  assert.ok(calls.every((call) => !call.options.body));
});
