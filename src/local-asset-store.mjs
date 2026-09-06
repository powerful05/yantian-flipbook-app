import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const DEFAULT_PUBLIC_PREFIX = "/generated-assets";

const extensionsByMime = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
});

function normalizedPrefix(value) {
  const prefix = String(value || DEFAULT_PUBLIC_PREFIX).trim().replace(/\/+$/, "");
  if (!prefix.startsWith("/")) throw new TypeError("LocalAssetStore publicPrefix must start with /");
  return prefix || DEFAULT_PUBLIC_PREFIX;
}

function extensionFor(mimeType) {
  const extension = extensionsByMime[String(mimeType || "").toLowerCase()];
  if (!extension) throw new TypeError(`Unsupported generated asset MIME type: ${mimeType}`);
  return extension;
}

function categoryFor(kind, mimeType) {
  if (kind === "video" || String(mimeType).startsWith("video/")) return "videos";
  if (kind === "image" || String(mimeType).startsWith("image/")) return "images";
  throw new TypeError(`Unsupported generated asset kind: ${kind}`);
}

function contentHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export class LocalAssetStore {
  constructor({ rootDir, publicPrefix = DEFAULT_PUBLIC_PREFIX } = {}) {
    if (!rootDir) throw new TypeError("LocalAssetStore requires rootDir");
    this.rootDir = resolve(rootDir);
    this.publicPrefix = normalizedPrefix(publicPrefix);
  }

  publicUrl(relativePath) {
    return `${this.publicPrefix}/${relativePath.replaceAll("\\", "/")}`;
  }

  resolve(publicUrl) {
    let pathname;
    try {
      // URL.pathname normalizes non-ASCII characters to percent escapes. Decode
      // before resolving so checked-in local asset folders may use human names.
      pathname = decodeURIComponent(new URL(publicUrl, "http://local.invalid").pathname);
    } catch {
      return null;
    }
    if (!pathname.startsWith(`${this.publicPrefix}/`)) return null;
    const relativePath = pathname.slice(this.publicPrefix.length + 1);
    if (!relativePath || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
      return null;
    }
    const filePath = resolve(this.rootDir, relativePath);
    const relativeToRoot = relative(this.rootDir, filePath);
    if (relativeToRoot.startsWith("..") || relativeToRoot === "" || relativeToRoot.includes(":")) return null;
    return filePath;
  }

  async persist({ bytes, mimeType, sha256, kind }) {
    const content = Buffer.from(bytes);
    if (!content.length) throw new TypeError("Generated asset bytes must not be empty");
    const hash = contentHash(content);
    if (sha256 && String(sha256).toLowerCase() !== hash) throw new TypeError("Generated asset checksum mismatch");
    const relativePath = `${categoryFor(kind, mimeType)}/${hash}${extensionFor(mimeType)}`;
    const filePath = resolve(this.rootDir, relativePath);
    await mkdir(resolve(this.rootDir, categoryFor(kind, mimeType)), { recursive: true });
    try {
      await stat(filePath);
    } catch {
      const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temporaryPath, content, { flag: "wx" });
        await rename(temporaryPath, filePath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => {});
        throw error;
      }
    }
    return { url: this.publicUrl(relativePath), sha256: hash, mime_type: mimeType };
  }

  async toDataUrl(publicUrl) {
    const filePath = this.resolve(publicUrl);
    if (!filePath) return null;
    const bytes = await readFile(filePath);
    const extension = extname(filePath).toLowerCase();
    const mimeType = Object.entries(extensionsByMime).find(([, candidate]) => candidate === extension)?.[0];
    if (!mimeType) return null;
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  }
}
