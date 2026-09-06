import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MANIFEST = fileURLToPath(
  new URL("../fixtures/style-reference/yantian/manifest.json", import.meta.url),
);
const MAX_REFERENCE_IMAGES = 3;
const MIME_BY_EXTENSION = Object.freeze({
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
});

const ROLE_ORDER_BY_TIER = Object.freeze({
  region: ["region-overview", "route-and-label-system", "place-and-object-detail", "sequence-layout"],
  place: ["place-and-object-detail", "route-and-label-system", "region-overview", "sequence-layout"],
  object: ["place-and-object-detail", "sequence-layout", "region-overview", "route-and-label-system"],
});

function clampReferenceCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MAX_REFERENCE_IMAGES;
  return Math.min(MAX_REFERENCE_IMAGES, Math.max(1, Math.floor(number)));
}

function normaliseBaseUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function mimeFor(file) {
  return MIME_BY_EXTENSION[extname(file).toLowerCase()] || "application/octet-stream";
}

function hashHex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new TypeError("Style reference manifest must be an object");
  if (typeof manifest.pack_id !== "string" || !manifest.pack_id) {
    throw new TypeError("Style reference manifest requires pack_id");
  }
  if (!Array.isArray(manifest.assets)) throw new TypeError("Style reference manifest requires assets");
  return manifest;
}

function safeAssetPath(manifestPath, file) {
  if (typeof file !== "string" || !file.trim()) throw new TypeError("Style reference asset file is missing");
  const manifestDirectory = resolve(manifestPath, "..");
  const candidate = resolve(manifestDirectory, file);
  if (candidate !== manifestDirectory && !candidate.startsWith(`${manifestDirectory}${"\\"}`) && !candidate.startsWith(`${manifestDirectory}/`)) {
    throw new TypeError("Style reference asset must stay inside its manifest directory");
  }
  return candidate;
}

function assetWithDataUrl(asset, filePath, readFile) {
  const bytes = readFile(filePath);
  const actualHash = hashHex(bytes);
  if (asset.sha256 && actualHash !== String(asset.sha256).toLowerCase()) {
    throw new TypeError(`Style reference checksum mismatch: ${asset.file}`);
  }
  const mimeType = mimeFor(asset.file);
  return {
    asset_id: asset.asset_id,
    role: asset.role,
    file: asset.file,
    sha256: actualHash,
    width: Number(asset.width) || 1,
    height: Number(asset.height) || 1,
    mime_type: mimeType,
    url: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };
}

function assetWithRemoteUrl(asset, baseUrl) {
  const url = new URL(encodeURI(asset.file), `${baseUrl}/`).toString();
  return {
    asset_id: asset.asset_id,
    role: asset.role,
    file: asset.file,
    sha256: String(asset.sha256 || "").toLowerCase(),
    width: Number(asset.width) || 1,
    height: Number(asset.height) || 1,
    mime_type: mimeFor(asset.file),
    url,
  };
}

/**
 * Load a small, deterministic style reference pack.
 *
 * Local assets are emitted as data URLs because the DashScope I2I contract
 * accepts Base64 images and a developer machine is not publicly reachable.
 * Set a public STYLE_REFERENCE_BASE_URL in a deployed environment to avoid
 * putting image bytes in each request.
 */
export function loadStyleReferencePack({
  manifestPath = DEFAULT_MANIFEST,
  baseUrl = "",
  maxImages = MAX_REFERENCE_IMAGES,
  readFile = readFileSync,
} = {}) {
  const resolvedManifestPath = isAbsolute(manifestPath) ? manifestPath : resolve(process.cwd(), manifestPath);
  if (!existsSync(resolvedManifestPath)) return null;
  const manifest = assertManifest(JSON.parse(readFile(resolvedManifestPath, "utf8")));
  const remoteBaseUrl = normaliseBaseUrl(baseUrl);
  const cache = new Map();
  const count = clampReferenceCount(maxImages);

  function materialise(asset) {
    if (!asset?.approved_for_model_reference) return null;
    if (cache.has(asset.file)) return cache.get(asset.file);
    const value = remoteBaseUrl
      ? assetWithRemoteUrl(asset, remoteBaseUrl)
      : assetWithDataUrl(asset, safeAssetPath(resolvedManifestPath, asset.file), readFile);
    cache.set(asset.file, value);
    return value;
  }

  function select(scaleTier = "region") {
    const roleOrder = ROLE_ORDER_BY_TIER[scaleTier] || ROLE_ORDER_BY_TIER.region;
    const selected = [];
    const used = new Set();
    for (const role of roleOrder) {
      for (const asset of manifest.assets) {
        if (used.has(asset.file) || asset.role !== role) continue;
        const materialised = materialise(asset);
        if (!materialised) continue;
        selected.push(materialised);
        used.add(asset.file);
        break;
      }
      if (selected.length >= count) break;
    }
    if (selected.length < count) {
      for (const asset of manifest.assets) {
        if (used.has(asset.file)) continue;
        const materialised = materialise(asset);
        if (!materialised) continue;
        selected.push(materialised);
        used.add(asset.file);
        if (selected.length >= count) break;
      }
    }
    return selected;
  }

  return Object.freeze({
    packId: manifest.pack_id,
    styleId: manifest.style_id || "",
    styleVersion: Number(manifest.style_version) || 1,
    manifestPath: resolvedManifestPath,
    maxImages: count,
    sourcePolicy: manifest.source_policy || "",
    availableRoles: Object.freeze(
      manifest.assets
        .filter((asset) => asset?.approved_for_model_reference && typeof asset.role === "string")
        .map((asset) => asset.role)
        .filter((role, index, roles) => roles.indexOf(role) === index),
    ),
    select,
  });
}

export { DEFAULT_MANIFEST, MAX_REFERENCE_IMAGES, ROLE_ORDER_BY_TIER };
