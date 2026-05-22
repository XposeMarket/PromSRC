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
