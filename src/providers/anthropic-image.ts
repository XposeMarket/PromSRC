import sharp from 'sharp';
import { createHash } from 'crypto';

// Bound retained encoded output; promises also deduplicate concurrent history replays.
const imageCache = new Map<string, Promise<NormalizedAnthropicImage | null>>();
const CACHE_ENTRIES = 16;
export const OMITTED_IMAGE_TEXT = '[image omitted: unreadable or unsupported]';

export async function normalizeAnthropicContent(content: any[]): Promise<any[]> {
  const result: any[] = [];
  for (const part of content) {
    if (part?.type === 'image' || part?.type === 'image_url') {
      const source = part.type === 'image_url' ? part.image_url?.url : (part.source?.data ?? part.source?.url);
      // Remote URLs cannot be byte-validated without introducing server-side URL fetches.
      // Fail closed rather than let the API fetch an unchecked/expired history image.
      const normalized = await normalizeAnthropicImage(typeof source === 'string' ? source : '');
      result.push(normalized
        ? { type: 'image', source: { type: 'base64', ...normalized } }
        : { type: 'text', text: OMITTED_IMAGE_TEXT });
    } else if (part?.type === 'tool_result' && Array.isArray(part.content)) {
      result.push({ ...part, content: await normalizeAnthropicContent(part.content) });
    } else if (part?.type === 'text' || part?.type === 'tool_result' || part?.type === 'tool_use' || part?.type === 'thinking' || part?.type === 'redacted_thinking') {
      result.push({ ...part });
    }
  }
  return result;
}

const MAX_BASE64_CHARS = 4 * 1024 * 1024;
const MAX_DIMENSION = 2000;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;

export interface NormalizedAnthropicImage {
  media_type: 'image/jpeg';
  data: string;
}

function hasSupportedImageSignature(bytes: Buffer): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return true;
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return true;
  // ISO-BMFF based HEIC/HEIF/AVIF images begin with ftyp at byte 4.
  return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
    && /^(?:heic|heix|hevc|hevx|mif1|msf1|avif|avis)$/.test(bytes.toString('ascii', 8, 12));
}

/**
 * Validate image bytes independently of the caller's filename/content-type,
 * then normalize them to a bounded JPEG payload accepted by Anthropic.
 * Invalid, unsupported, or unreasonably large data is returned as null so the
 * provider can omit that image without failing the complete chat turn.
 */
export async function normalizeAnthropicImage(base64: string, _declaredMediaType?: string): Promise<NormalizedAnthropicImage | null> {
  const raw = String(base64 || '').trim();
  const encoded = raw.replace(/^data:[^;,]+;base64,/i, '');
  if (!encoded || encoded.length > Math.ceil(MAX_INPUT_BYTES * 4 / 3) + 8) return null;
  const key = createHash('sha256').update(encoded).digest('hex');
  const cached = imageCache.get(key);
  if (cached) {
    imageCache.delete(key);
    imageCache.set(key, cached);
    return cached;
  }
  const pending = encodeAnthropicImage(encoded);
  imageCache.set(key, pending);
  if (imageCache.size > CACHE_ENTRIES) imageCache.delete(imageCache.keys().next().value!);
  return pending;
}

async function encodeAnthropicImage(encoded: string): Promise<NormalizedAnthropicImage | null> {
  try {
    if (!encoded || encoded.length > Math.ceil(MAX_INPUT_BYTES * 4 / 3) + 8 || encoded.length % 4 !== 0
      || /[^A-Za-z0-9+/=]/.test(encoded)) return null;
    const paddingAt = encoded.indexOf('=');
    if (paddingAt >= 0 && (encoded.length - paddingAt > 2 || !/^=+$/.test(encoded.slice(paddingAt)))) return null;

    const input = Buffer.from(encoded, 'base64');
    if (!input.length || input.length > MAX_INPUT_BYTES || input.toString('base64') !== encoded || !hasSupportedImageSignature(input)) return null;

    const metadata = await sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
    if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp', 'gif'].includes(String(metadata.format || ''))) return null;

    let width = Math.min(MAX_DIMENSION, metadata.width);
    let height = Math.min(MAX_DIMENSION, metadata.height);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(metadata.width, metadata.height));
    width = Math.max(1, Math.round(metadata.width * scale));
    height = Math.max(1, Math.round(metadata.height * scale));

    for (let attempt = 0; attempt < 8; attempt++) {
      const quality = Math.max(42, 82 - Math.max(0, attempt - 1) * 8);
      const output = await sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width, height, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      const data = output.toString('base64');
      if (data.length <= MAX_BASE64_CHARS) return { media_type: 'image/jpeg', data };
      width = Math.max(1, Math.floor(width * 0.78));
      height = Math.max(1, Math.floor(height * 0.78));
    }
    return null;
  } catch {
    return null;
  }
}
