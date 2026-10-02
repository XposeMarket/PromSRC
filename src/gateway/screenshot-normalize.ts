import Jimp from 'jimp';

export interface NormalizedScreenshot {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  normalized: boolean;
  originalBytes: number;
  bytes: number;
}

export interface NormalizeScreenshotOptions {
  maxSide?: number;
  maxBytes?: number;
  preferJpeg?: boolean;
  jpegQualityStart?: number;
  jpegQualityMin?: number;
}

const DEFAULT_MAX_SIDE = 2400;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function getScreenshotNormalizeDefaults(prefix: string = 'PROMETHEUS_SCREENSHOT'): Required<NormalizeScreenshotOptions> {
  return {
    maxSide: clampInt(process.env[`${prefix}_MAX_SIDE`], 512, 8192, DEFAULT_MAX_SIDE),
    maxBytes: clampInt(process.env[`${prefix}_MAX_BYTES`], 128 * 1024, 32 * 1024 * 1024, DEFAULT_MAX_BYTES),
    preferJpeg: String(process.env[`${prefix}_PREFER_JPEG`] || '1').trim() !== '0',
    jpegQualityStart: clampInt(process.env[`${prefix}_JPEG_QUALITY_START`], 45, 95, 82),
    jpegQualityMin: clampInt(process.env[`${prefix}_JPEG_QUALITY_MIN`], 30, 90, 55),
  };
}

// sharp (libvips) is ~13x faster than jimp for a 3440x1440 frame (83 ms vs
// 1075 ms measured 2026-10-02). It is loaded lazily and optionally; jimp stays
// as the fallback so a missing/broken native binary never breaks screenshots.
type SharpFactory = (input?: Buffer, options?: Record<string, unknown>) => any;
let sharpModule: SharpFactory | null | undefined;
export function loadSharp(): SharpFactory | null {
  if (sharpModule !== undefined) return sharpModule ?? null;
  if (String(process.env.PROMETHEUS_SCREENSHOT_SHARP || '1').trim() === '0') {
    sharpModule = null;
    return sharpModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('sharp');
    sharpModule = (typeof mod === 'function' ? mod : mod?.default) || null;
  } catch {
    sharpModule = null;
  }
  return sharpModule ?? null;
}

/** Width/height of a PNG/JPEG without a full decode where possible. */
export async function readImageSize(input: Buffer): Promise<{ width: number; height: number }> {
  // PNG IHDR is at a fixed offset; avoid any decoder for the common case.
  if (input.length >= 24 && input.readUInt32BE(0) === 0x89504e47 && input.toString('ascii', 12, 16) === 'IHDR') {
    return { width: input.readUInt32BE(16), height: input.readUInt32BE(20) };
  }
  const sharp = loadSharp();
  if (sharp) {
    try {
      const meta = await sharp(input).metadata();
      if (meta?.width && meta?.height) return { width: meta.width, height: meta.height };
    } catch { /* fall through */ }
  }
  const image = await Jimp.read(input);
  return { width: image.bitmap.width, height: image.bitmap.height };
}

/** Crop a PNG to a pixel rectangle, returning PNG. */
export async function cropImageBuffer(input: Buffer, left: number, top: number, width: number, height: number): Promise<Buffer> {
  const sharp = loadSharp();
  if (sharp) {
    try {
      return await sharp(input).extract({ left, top, width, height }).png({ compressionLevel: 1 }).toBuffer();
    } catch { /* fall through */ }
  }
  const image = await Jimp.read(input);
  image.crop(left, top, width, height);
  return image.getBufferAsync(Jimp.MIME_PNG);
}

async function normalizeWithSharp(
  sharp: SharpFactory,
  input: Buffer,
  opts: { maxSide: number; maxBytes: number; preferJpeg: boolean; jpegQualityStart: number; jpegQualityMin: number },
): Promise<NormalizedScreenshot> {
  const meta = await sharp(input).metadata();
  const originalWidth = Number(meta?.width || 0);
  const originalHeight = Number(meta?.height || 0);
  if (!originalWidth || !originalHeight) throw new Error('sharp could not read image dimensions');
  const maxDim = Math.max(originalWidth, originalHeight);
  const needsResize = maxDim > opts.maxSide;
  if (!needsResize && input.byteLength <= opts.maxBytes) {
    return {
      buffer: input, mimeType: 'image/png', width: originalWidth, height: originalHeight,
      scaleX: 1, scaleY: 1, normalized: false, originalBytes: input.byteLength, bytes: input.byteLength,
    };
  }
  const ratio = needsResize ? opts.maxSide / maxDim : 1;
  const targetWidth = Math.max(1, Math.round(originalWidth * ratio));
  const targetHeight = Math.max(1, Math.round(originalHeight * ratio));
  // Decode + resize once, then encode candidates from the raw pixels.
  const { data, info } = await sharp(input)
    .resize(targetWidth, targetHeight, { kernel: 'lanczos3', fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  const base = {
    width: info.width, height: info.height,
    scaleX: originalWidth / info.width, scaleY: originalHeight / info.height,
    normalized: true, originalBytes: input.byteLength,
  };
  if (!opts.preferJpeg) {
    const png = await raw().png({ compressionLevel: 6 }).toBuffer();
    if (png.byteLength <= opts.maxBytes) return { ...base, buffer: png, mimeType: 'image/png', bytes: png.byteLength };
  }
  let best: Buffer | null = null;
  for (let quality = opts.jpegQualityStart; quality >= opts.jpegQualityMin; quality -= 8) {
    const candidate: Buffer = await raw().jpeg({ quality, mozjpeg: false }).toBuffer();
    if (!best || candidate.byteLength < best.byteLength) best = candidate;
    if (candidate.byteLength <= opts.maxBytes) break;
  }
  const buffer = best || await raw().png().toBuffer();
  return { ...base, buffer, mimeType: best ? 'image/jpeg' : 'image/png', bytes: buffer.byteLength };
}

export async function normalizeScreenshotBuffer(
  input: Buffer,
  options?: NormalizeScreenshotOptions,
): Promise<NormalizedScreenshot> {
  const defaults = getScreenshotNormalizeDefaults();
  const maxSide = clampInt(options?.maxSide, 512, 8192, defaults.maxSide);
  const maxBytes = clampInt(options?.maxBytes, 128 * 1024, 32 * 1024 * 1024, defaults.maxBytes);
  const preferJpeg = options?.preferJpeg ?? defaults.preferJpeg;
  const jpegQualityStart = clampInt(options?.jpegQualityStart, 45, 95, defaults.jpegQualityStart);
  const jpegQualityMin = clampInt(options?.jpegQualityMin, 30, 90, defaults.jpegQualityMin);

  const sharp = loadSharp();
  if (sharp) {
    try {
      return await normalizeWithSharp(sharp, input, { maxSide, maxBytes, preferJpeg, jpegQualityStart, jpegQualityMin });
    } catch {
      // Fall back to jimp below.
    }
  }

  const image = await Jimp.read(input);
  const originalWidth = image.bitmap.width;
  const originalHeight = image.bitmap.height;
  const maxDim = Math.max(originalWidth, originalHeight);
  const needsResize = maxDim > maxSide;
  const ratio = needsResize ? maxSide / maxDim : 1;
  const targetWidth = Math.max(1, Math.round(originalWidth * ratio));
  const targetHeight = Math.max(1, Math.round(originalHeight * ratio));

  if (!needsResize && input.byteLength <= maxBytes) {
    return {
      buffer: input,
      mimeType: 'image/png',
      width: originalWidth,
      height: originalHeight,
      scaleX: 1,
      scaleY: 1,
      normalized: false,
      originalBytes: input.byteLength,
      bytes: input.byteLength,
    };
  }

  const resized = needsResize
    ? image.clone().resize(targetWidth, targetHeight, Jimp.RESIZE_BILINEAR)
    : image.clone();

  const png = await resized.getBufferAsync(Jimp.MIME_PNG);
  if (!preferJpeg && png.byteLength <= maxBytes) {
    return {
      buffer: png,
      mimeType: 'image/png',
      width: resized.bitmap.width,
      height: resized.bitmap.height,
      scaleX: originalWidth / resized.bitmap.width,
      scaleY: originalHeight / resized.bitmap.height,
      normalized: true,
      originalBytes: input.byteLength,
      bytes: png.byteLength,
    };
  }

  let best = png;
  let bestMime: 'image/png' | 'image/jpeg' = 'image/png';
  for (let quality = jpegQualityStart; quality >= jpegQualityMin; quality -= 8) {
    const candidate = await resized.quality(quality).getBufferAsync(Jimp.MIME_JPEG);
    if (candidate.byteLength < best.byteLength) {
      best = candidate;
      bestMime = 'image/jpeg';
    }
    if (candidate.byteLength <= maxBytes) break;
  }

  return {
    buffer: best,
    mimeType: bestMime,
    width: resized.bitmap.width,
    height: resized.bitmap.height,
    scaleX: originalWidth / resized.bitmap.width,
    scaleY: originalHeight / resized.bitmap.height,
    normalized: true,
    originalBytes: input.byteLength,
    bytes: best.byteLength,
  };
}
