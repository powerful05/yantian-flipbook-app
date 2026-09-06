import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalAssetStore } from "../src/local-asset-store.mjs";

test("LocalAssetStore persists content-addressed generated media outside the app and blocks traversal", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yantian-assets-"));
  try {
    const store = new LocalAssetStore({ rootDir });
    const result = await store.persist({ bytes: Uint8Array.from([1, 2, 3]), mimeType: "video/mp4", kind: "video" });
    assert.match(result.url, /^\/generated-assets\/videos\/[a-f0-9]{64}\.mp4$/);
    assert.deepEqual(await readFile(store.resolve(result.url)), Buffer.from([1, 2, 3]));
    assert.equal(store.resolve("/generated-assets/../secret.txt"), null);
    assert.equal(store.resolve("/generated-assets/%2e%2e/secret.txt"), null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("LocalAssetStore turns persisted images into model-safe data URLs", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yantian-assets-"));
  try {
    const store = new LocalAssetStore({ rootDir });
    const result = await store.persist({ bytes: Uint8Array.from([137, 80, 78, 71]), mimeType: "image/png", kind: "image" });
    assert.equal(await store.toDataUrl(result.url), "data:image/png;base64,iVBORw==");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("LocalAssetStore resolves percent-encoded Unicode asset paths", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yantian-assets-"));
  try {
    const store = new LocalAssetStore({ rootDir });
    const relativePath = "L0--L3(大梅沙)/L0.png";
    const filePath = join(rootDir, relativePath);
    await mkdir(join(rootDir, "L0--L3(大梅沙)"), { recursive: true });
    await writeFile(filePath, Uint8Array.from([137, 80, 78, 71]));
    const publicUrl = store.publicUrl(relativePath);
    assert.deepEqual(await readFile(store.resolve(publicUrl)), Buffer.from([137, 80, 78, 71]));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
