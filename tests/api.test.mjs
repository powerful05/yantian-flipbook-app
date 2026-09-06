import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppServer } from "../server.mjs";
import { LocalAssetStore } from "../src/local-asset-store.mjs";

function parseSse(body) {
  return body
    .trim()
    .split("\n\n")
    .map((block) => {
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      return JSON.parse(data);
    });
}

test("HTTP session and SSE generation form a complete deterministic loop", async () => {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const sessionResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "盐田港" }),
    });
    assert.equal(sessionResponse.status, 201);
    const session = await sessionResponse.json();

    const generateResponse = await fetch(`${baseUrl}/v1/sessions/${session.id}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "盐田港的潮汐与航运",
        parent_node_id: null,
        anchor_id: null,
        point: null,
        mode: "root",
        image_tier: "fast",
        video: "off",
        idempotency_key: "root:http-001",
      }),
    });
    assert.equal(generateResponse.status, 200);
    assert.match(generateResponse.headers.get("content-type"), /^text\/event-stream/);
    const events = parseSse(await generateResponse.text());
    const final = events.find((event) => event.type === "final").data;
    assert.equal(final.node.session_id, session.id);

    const nodeResponse = await fetch(`${baseUrl}/v1/nodes/${final.node.id}`);
    assert.equal(nodeResponse.status, 200);
    assert.equal((await nodeResponse.json()).id, final.node.id);

    const anchor = final.node.anchors[0];
    const anchorResponse = await fetch(
      `${baseUrl}/v1/nodes/${final.node.id}/anchors/${anchor.id}`,
    );
    assert.equal(anchorResponse.status, 200);
    assert.equal((await anchorResponse.json()).id, anchor.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP server serves only persisted generated assets from its dedicated public path", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yantian-assets-"));
  const assetStore = new LocalAssetStore({ rootDir });
  const server = createAppServer({ assetStore });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const asset = await assetStore.persist({ bytes: Uint8Array.from([1, 2, 3]), mimeType: "video/mp4", kind: "video" });
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${asset.url}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.from([1, 2, 3]));
    const rejectedStatus = await new Promise((resolve, reject) => {
      const request = get({ hostname: "127.0.0.1", port, path: "/generated-assets/%2e%2e/server.mjs" }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      request.once("error", reject);
    });
    assert.equal(rejectedStatus, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
