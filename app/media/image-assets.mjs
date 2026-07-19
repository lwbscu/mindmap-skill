const SUPPORTED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const FORBIDDEN_IMAGE_MIMES = new Set(["image/svg+xml", "image/svg"]);
const IMAGE_PLACEMENTS = new Set(["node", "left", "top", "background"]);
const IMAGE_FITS = new Set(["contain", "cover"]);

export const IMAGE_ASSET_LIMITS = Object.freeze({
  maxSide: 2048,
  maxAssetBytes: 4 * 1024 * 1024,
  maxDiagramBytes: 32 * 1024 * 1024,
  jpegQuality: 0.88,
});

export class ImageAssetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ImageAssetError";
    this.code = code;
    this.details = details;
  }
}

function normalizeMime(mime) {
  return String(mime || "").split(";")[0].trim().toLowerCase();
}

function bytesFromBase64Length(base64) {
  const clean = String(base64 || "").replace(/\s/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function makeAssetId(sha256) {
  return `img_${sha256.slice(0, 16)}`;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImageAssetError("invalid_object", `${label} must be an object`);
  }
}

function assertSupportedMime(mime) {
  const normalized = normalizeMime(mime);
  if (FORBIDDEN_IMAGE_MIMES.has(normalized)) {
    throw new ImageAssetError("unsupported_image_type", "SVG images are not accepted for MindMap assets", {
      mime: normalized,
    });
  }
  if (!SUPPORTED_IMAGE_MIMES.has(normalized)) {
    throw new ImageAssetError("unsupported_image_type", "Only PNG, JPEG, and WebP images are accepted", {
      mime: normalized || "(empty)",
    });
  }
  return normalized;
}

function hasBrowserImageApis() {
  return typeof document !== "undefined" || typeof createImageBitmap === "function";
}

function getBlobCtor() {
  if (typeof Blob === "undefined") {
    throw new ImageAssetError("blob_unavailable", "Blob is not available in this runtime");
  }
  return Blob;
}

function getAtob() {
  if (typeof atob === "function") return atob;
  throw new ImageAssetError("base64_unavailable", "Base64 decoding is not available in this runtime");
}

function getBtoa() {
  if (typeof btoa === "function") return btoa;
  throw new ImageAssetError("base64_unavailable", "Base64 encoding is not available in this runtime");
}

function toUint8Array(arrayBuffer) {
  return arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
}

function readUint24LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) + bytes[offset + 1];
}

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function readAscii(bytes, offset, length) {
  return Array.from(bytes.slice(offset, offset + length), (code) => String.fromCharCode(code)).join("");
}

function parsePngSize(bytes) {
  const isPng =
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52;
  if (!isPng) return null;
  return {
    width: readUint32BE(bytes, 16),
    height: readUint32BE(bytes, 20),
  };
}

function parseJpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 7 < bytes.length) {
      return {
        width: readUint16BE(bytes, offset + 5),
        height: readUint16BE(bytes, offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function parseWebpSize(bytes) {
  if (
    bytes.length < 30 ||
    readAscii(bytes, 0, 4) !== "RIFF" ||
    readAscii(bytes, 8, 4) !== "WEBP"
  ) {
    return null;
  }
  const chunk = readAscii(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readUint24LE(bytes, 24),
      height: 1 + readUint24LE(bytes, 27),
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      width: readUint16BE(new Uint8Array([bytes[27], bytes[26]]), 0) & 0x3fff,
      height: readUint16BE(new Uint8Array([bytes[29], bytes[28]]), 0) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

export function isSupportedImageMime(mime) {
  return SUPPORTED_IMAGE_MIMES.has(normalizeMime(mime));
}

export function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    throw new ImageAssetError("invalid_data_url", "Image data URL must be a string");
  }
  const match = dataUrl.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new ImageAssetError("invalid_data_url", "Image data URL must be base64 encoded");
  }
  const mime = assertSupportedMime(match[1]);
  const base64 = match[2].replace(/\s/g, "");
  if (base64.length % 4 !== 0 || /[^a-z0-9+/=]/i.test(base64)) {
    throw new ImageAssetError("invalid_data_url", "Image data URL contains invalid base64 data");
  }
  return {
    mime,
    base64,
    byteLength: bytesFromBase64Length(base64),
  };
}

export function isSafeImageDataUrl(dataUrl) {
  try {
    parseImageDataUrl(dataUrl);
    return true;
  } catch {
    return false;
  }
}

export function dataUrlToBlob(dataUrl) {
  const { mime, base64 } = parseImageDataUrl(dataUrl);
  const binary = getAtob()(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const BlobCtor = getBlobCtor();
  return new BlobCtor([bytes], { type: mime });
}

export async function blobToDataUrl(blob) {
  const mime = assertSupportedMime(blob?.type);
  if (typeof FileReader !== "undefined") {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(new ImageAssetError("read_failed", "Could not read image blob as data URL"));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return `data:${mime};base64,${getBtoa()(binary)}`;
}

export function parseImageDimensions(arrayBuffer, mime) {
  const bytes = toUint8Array(arrayBuffer);
  const normalized = assertSupportedMime(mime);
  const size =
    normalized === "image/png"
      ? parsePngSize(bytes)
      : normalized === "image/jpeg"
        ? parseJpegSize(bytes)
        : parseWebpSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) {
    throw new ImageAssetError("decode_failed", "Could not decode image dimensions", {
      mime: normalized,
    });
  }
  return size;
}

export function fitWithinMaxSide(width, height, maxSide = IMAGE_ASSET_LIMITS.maxSide) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ImageAssetError("invalid_dimensions", "Image dimensions must be positive numbers");
  }
  if (Math.max(width, height) <= maxSide) {
    return { width: Math.round(width), height: Math.round(height), scale: 1 };
  }
  const scale = maxSide / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export function assertImageAssetBudget(asset, assets = {}, limits = IMAGE_ASSET_LIMITS) {
  assertObject(asset, "asset");
  if (asset.type !== "image") {
    throw new ImageAssetError("invalid_asset", "Asset type must be image");
  }
  const mime = assertSupportedMime(asset.mime);
  if (!isSafeImageDataUrl(asset.dataUrl)) {
    throw new ImageAssetError("invalid_data_url", "Asset dataUrl is not a safe supported image data URL");
  }
  if (asset.size > limits.maxAssetBytes) {
    throw new ImageAssetError("asset_too_large", "Image asset exceeds the 4MB per-image limit", {
      size: asset.size,
      limit: limits.maxAssetBytes,
    });
  }
  const existingTotal = totalImageAssetBytes(assets);
  const alreadyCounted = assets?.[asset.id]?.sha256 === asset.sha256 ? assets[asset.id].size || 0 : 0;
  if (existingTotal - alreadyCounted + asset.size > limits.maxDiagramBytes) {
    throw new ImageAssetError("diagram_images_too_large", "Diagram image assets exceed the 32MB total limit", {
      size: existingTotal - alreadyCounted + asset.size,
      limit: limits.maxDiagramBytes,
    });
  }
  return { ...asset, mime };
}

export function totalImageAssetBytes(assets = {}) {
  if (!assets || typeof assets !== "object") return 0;
  return Object.values(assets).reduce((sum, asset) => {
    if (asset?.type !== "image") return sum;
    return sum + Math.max(0, Number(asset.size) || 0);
  }, 0);
}

export function ensureAssetsContainer(diagram) {
  assertObject(diagram, "diagram");
  if (!diagram.assets || typeof diagram.assets !== "object" || Array.isArray(diagram.assets)) {
    diagram.assets = {};
  }
  return diagram.assets;
}

export function getReferencedImageAssetIds(diagram) {
  const ids = new Set();
  for (const node of Array.isArray(diagram?.nodes) ? diagram.nodes : []) {
    if (node?.image?.assetId) ids.add(String(node.image.assetId));
  }
  return ids;
}

export function removeUnreferencedImageAssets(diagram) {
  const assets = ensureAssetsContainer(diagram);
  const referenced = getReferencedImageAssetIds(diagram);
  const removed = [];
  for (const [id, asset] of Object.entries(assets)) {
    if (asset?.type === "image" && !referenced.has(id)) {
      delete assets[id];
      removed.push(id);
    }
  }
  return removed;
}

export function findImageAssetByHash(assets = {}, sha256) {
  if (!sha256) return null;
  for (const asset of Object.values(assets || {})) {
    if (asset?.type === "image" && asset.sha256 === sha256) return asset;
  }
  return null;
}

export function makeNodeImageReference(assetId, options = {}) {
  if (!assetId || typeof assetId !== "string") {
    throw new ImageAssetError("invalid_asset_id", "node.image.assetId must be a non-empty string");
  }
  const placement = IMAGE_PLACEMENTS.has(options.placement) ? options.placement : "node";
  const fit = IMAGE_FITS.has(options.fit) ? options.fit : "contain";
  return {
    assetId,
    placement,
    fit,
    padding: Number.isFinite(options.padding) ? Math.max(0, options.padding) : 8,
    opacity: Number.isFinite(options.opacity) ? Math.min(1, Math.max(0, options.opacity)) : 1,
    alt: typeof options.alt === "string" ? options.alt : "",
  };
}

export function assignImageToNode(node, assetId, options = {}) {
  assertObject(node, "node");
  node.image = makeNodeImageReference(assetId, options);
  return node.image;
}

export async function sha256Hex(arrayBuffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ImageAssetError("crypto_unavailable", "Web Crypto SHA-256 is not available");
  }
  const digest = await subtle.digest("SHA-256", arrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveInputBlob(input, options = {}) {
  if (typeof input === "string") {
    return {
      blob: dataUrlToBlob(input),
      name: options.name || "pasted-image",
      source: options.source || "data-url",
    };
  }
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const mime = assertSupportedMime(options.mime);
    const BlobCtor = getBlobCtor();
    return {
      blob: new BlobCtor([input], { type: mime }),
      name: options.name || "image",
      source: options.source || "buffer",
    };
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const mime = assertSupportedMime(input.type || options.mime);
    return {
      blob: input.type ? input : input.slice(0, input.size, mime),
      name: options.name || input.name || "image",
      source: options.source || (input.name ? "file" : "blob"),
    };
  }
  throw new ImageAssetError("invalid_input", "Image input must be a Blob, File, ArrayBuffer, or data URL");
}

async function createBitmapFromBlob(blob) {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(blob);
  }
  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new ImageAssetError("image_api_unavailable", "Image decoding APIs are not available");
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new ImageAssetError("decode_failed", "Could not decode image"));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new ImageAssetError("canvas_unavailable", "Canvas APIs are required to normalize oversized images");
}

function getImageSize(image) {
  return {
    width: image.width || image.naturalWidth || image.videoWidth,
    height: image.height || image.naturalHeight || image.videoHeight,
  };
}

function imageHasTransparency(context, width, height) {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 16) {
    if (pixels[index] < 255) return true;
  }
  return false;
}

async function canvasToBlob(canvas, mime, quality) {
  if (typeof canvas.convertToBlob === "function") {
    return await canvas.convertToBlob({ type: mime, quality });
  }
  if (typeof canvas.toBlob === "function") {
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new ImageAssetError("encode_failed", "Could not encode canvas image"));
      }, mime, quality);
    });
  }
  throw new ImageAssetError("canvas_unavailable", "Canvas encoding APIs are not available");
}

async function encodeWithBudget(canvas, hasTransparency, limits) {
  if (hasTransparency) {
    return await canvasToBlob(canvas, "image/png");
  }
  const qualities = [limits.jpegQuality, 0.82, 0.74, 0.66, 0.58, 0.5];
  let best = null;
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    best = blob;
    if (blob.size <= limits.maxAssetBytes) return blob;
  }
  return best;
}

export async function normalizeImageBlob(inputBlob, options = {}) {
  const limits = { ...IMAGE_ASSET_LIMITS, ...options.limits };
  const inputMime = assertSupportedMime(inputBlob?.type);
  const inputBytes = await inputBlob.arrayBuffer();
  const parsedSize = parseImageDimensions(inputBytes, inputMime);
  const targetSize = fitWithinMaxSide(parsedSize.width, parsedSize.height, limits.maxSide);
  const needsCanvas =
    hasBrowserImageApis() &&
    (targetSize.scale < 1 || inputMime === "image/webp" || inputMime === "image/png");

  if (!needsCanvas) {
    if (targetSize.scale < 1) {
      throw new ImageAssetError("canvas_unavailable", "Canvas APIs are required to resize this image");
    }
    return {
      blob: inputBlob,
      width: parsedSize.width,
      height: parsedSize.height,
      mime: inputMime,
      resized: false,
      transparent: inputMime === "image/png",
    };
  }

  const image = await createBitmapFromBlob(inputBlob);
  try {
    const canvas = createCanvas(targetSize.width, targetSize.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new ImageAssetError("canvas_unavailable", "2D canvas context is not available");
    context.clearRect(0, 0, targetSize.width, targetSize.height);
    context.drawImage(image, 0, 0, targetSize.width, targetSize.height);
    const transparent = imageHasTransparency(context, targetSize.width, targetSize.height);
    const blob = await encodeWithBudget(canvas, transparent, limits);
    return {
      blob,
      width: targetSize.width,
      height: targetSize.height,
      mime: normalizeMime(blob.type),
      resized: targetSize.scale < 1 || blob.type !== inputMime,
      transparent,
    };
  } finally {
    if (typeof image.close === "function") image.close();
  }
}

export async function createImageAsset(input, options = {}) {
  const limits = { ...IMAGE_ASSET_LIMITS, ...options.limits };
  const { blob, name, source } = await resolveInputBlob(input, options);
  const normalized = await normalizeImageBlob(blob, { limits });
  const arrayBuffer = await normalized.blob.arrayBuffer();
  if (arrayBuffer.byteLength > limits.maxAssetBytes) {
    throw new ImageAssetError("asset_too_large", "Image asset exceeds the 4MB per-image limit after normalization", {
      size: arrayBuffer.byteLength,
      limit: limits.maxAssetBytes,
    });
  }
  const sha256 = await sha256Hex(arrayBuffer);
  const dataUrl = await blobToDataUrl(normalized.blob);
  return {
    id: makeAssetId(sha256),
    type: "image",
    mime: normalized.mime,
    dataUrl,
    name: String(options.name || name || "image").slice(0, 180),
    size: arrayBuffer.byteLength,
    width: normalized.width,
    height: normalized.height,
    sha256,
    source: String(options.source || source || "import").slice(0, 80),
    alt: typeof options.alt === "string" ? options.alt : "",
  };
}

export async function addImageAssetToDiagram(diagram, input, options = {}) {
  const assets = ensureAssetsContainer(diagram);
  const candidate = await createImageAsset(input, options);
  const existing = findImageAssetByHash(assets, candidate.sha256);
  if (existing) {
    return { asset: existing, assetId: existing.id, added: false, deduped: true };
  }
  assertImageAssetBudget(candidate, assets, options.limits ? { ...IMAGE_ASSET_LIMITS, ...options.limits } : IMAGE_ASSET_LIMITS);
  assets[candidate.id] = candidate;
  return { asset: candidate, assetId: candidate.id, added: true, deduped: false };
}

export function validateImageAssets(diagram, limits = IMAGE_ASSET_LIMITS) {
  const errors = [];
  const assets = diagram?.assets && typeof diagram.assets === "object" ? diagram.assets : {};
  let total = 0;
  for (const [id, asset] of Object.entries(assets)) {
    try {
      assertImageAssetBudget({ ...asset, id: asset.id || id }, {}, limits);
      total += asset?.type === "image" ? Number(asset.size) || 0 : 0;
    } catch (error) {
      errors.push(`${id}: ${error.message}`);
    }
  }
  if (total > limits.maxDiagramBytes) {
    errors.push(`diagram image assets exceed ${limits.maxDiagramBytes} bytes`);
  }
  for (const node of Array.isArray(diagram?.nodes) ? diagram.nodes : []) {
    if (!node?.image) continue;
    if (!assets[node.image.assetId]) {
      errors.push(`node ${node.id || "(unknown)"} references missing image asset ${node.image.assetId}`);
    }
    if (!IMAGE_PLACEMENTS.has(node.image.placement)) {
      errors.push(`node ${node.id || "(unknown)"}.image.placement is invalid`);
    }
    if (!IMAGE_FITS.has(node.image.fit)) {
      errors.push(`node ${node.id || "(unknown)"}.image.fit is invalid`);
    }
    if (typeof node.image.alt !== "string" || node.image.alt.trim() === "") {
      errors.push(`node ${node.id || "(unknown)"}.image.alt must describe the image`);
    }
    if (!Number.isFinite(node.image.opacity) || node.image.opacity < 0 || node.image.opacity > 1) {
      errors.push(`node ${node.id || "(unknown)"}.image.opacity must be between 0 and 1`);
    }
  }
  return { ok: errors.length === 0, errors };
}
