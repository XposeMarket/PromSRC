import sharp from 'sharp';

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
  try {
    const encoded = String(base64 || '').trim();
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
