/**
 * Normalize images before they are sent to any vision-capable provider.
 *
 * Why: provider limits differ and are strict. Anthropic rejects the ENTIRE
 * request when any image side exceeds 8000px (and 2000px once a request
 * carries many images). A stock full-resolution iPhone photo is 4536x8064,
 * so a normal phone upload used to kill the turn with a 400. Because images
 * stay in chat history, the bad image also poisoned every later turn.
 *
 * Policy: cap the long edge at VISION_MAX_EDGE_PX (2000, safe for every
 * provider and the multi-image Anthropic rule), honor EXIF orientation, and
 * re-encode large/oversized payloads as JPEG. Small in-bounds images pass
 * through untouched so screenshots keep pixel-perfect text.
 */
import sharpModule from 'sharp';

const sharp: any = (sharpModule as any)?.default || sharpModule;

export const VISION_MAX_EDGE_PX = 2000;
export const VISION_TARGET_MAX_BYTES = 3_500_000;

export type NormalizedVisionImage = {
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  resized: boolean;
  reencoded: boolean;
};

const PASSTHROUGH_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function normalizeVisionImageBuffer(
  input: Buffer,
  mimeType: string,
  options: { maxEdgePx?: number; maxBytes?: number } = {},
): Promise<NormalizedVisionImage> {
  const maxEdge = Math.max(256, Math.floor(options.maxEdgePx || VISION_MAX_EDGE_PX));
  const maxBytes = Math.max(64 * 1024, Math.floor(options.maxBytes || VISION_TARGET_MAX_BYTES));
  const mime = String(mimeType || 'image/png').toLowerCase();

  let meta: any = null;
  try {
    meta = await sharp(input, { failOn: 'none' }).metadata();
  } catch {
    // Unknown/undecodable format: hand it back unchanged; the provider decides.
    return { base64: input.toString('base64'), mimeType: mime, resized: false, reencoded: false };
  }

  // EXIF orientations 5-8 swap width/height after rotation.
  const swap = Number(meta?.orientation || 1) >= 5;
  const w = Number(swap ? meta?.height : meta?.width) || 0;
  const h = Number(swap ? meta?.width : meta?.height) || 0;
  const oversized = Math.max(w, h) > maxEdge;
  const tooHeavy = input.length > maxBytes;
  const rotated = Number(meta?.orientation || 1) > 1;
  const animated = Number(meta?.pages || 1) > 1;

  if (!oversized && !tooHeavy && !rotated && PASSTHROUGH_MIME.has(mime)) {
    return { base64: input.toString('base64'), mimeType: mime, width: w, height: h, originalWidth: w, originalHeight: h, resized: false, reencoded: false };
  }
  if (animated && !oversized && !tooHeavy) {
    return { base64: input.toString('base64'), mimeType: mime, width: w, height: h, originalWidth: w, originalHeight: h, resized: false, reencoded: false };
  }

  const keepPng = mime === 'image/png' && !tooHeavy && meta?.hasAlpha;
  let pipeline = sharp(input, { failOn: 'none', animated: false }).rotate();
  if (oversized) pipeline = pipeline.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  let out: { data: Buffer; info: any };
  let outMime: string;
  if (keepPng) {
    out = await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    outMime = 'image/png';
  } else {
    out = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    outMime = 'image/jpeg';
    // Still too heavy (rare, noisy photos): step quality down.
    for (const quality of [72, 60]) {
      if (out.data.length <= maxBytes) break;
      out = await sharp(out.data).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    }
  }
  return {
    base64: out.data.toString('base64'),
    mimeType: outMime,
    width: out.info?.width,
    height: out.info?.height,
    originalWidth: w,
    originalHeight: h,
    resized: oversized,
    reencoded: true,
  };
}

export async function normalizeVisionImageBase64(base64: string, mimeType: string, options?: { maxEdgePx?: number; maxBytes?: number }): Promise<NormalizedVisionImage> {
  return normalizeVisionImageBuffer(Buffer.from(String(base64 || ''), 'base64'), mimeType, options);
}
