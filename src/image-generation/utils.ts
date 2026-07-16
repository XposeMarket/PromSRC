import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from '../tools/workspace-context.js';
import type {
  GeneratedImageAsset,
  ImageAspectRatio,
  ImageBackground,
  ImageGenerationFailure,
  ImageGenerationSuccess,
  ImageOutputFormat,
  ImageQuality,
} from './types.js';

export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = 'landscape';
export const DEFAULT_IMAGE_OUTPUT_DIR = 'generated/images';
export const DEFAULT_IMAGE_COUNT = 1;
export const MAX_IMAGE_COUNT = 4;
export const MAX_REFERENCE_IMAGE_COUNT = 16;
export const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;

export const IMAGE_SIZE_BY_ASPECT_RATIO: Record<ImageAspectRatio, string> = {
  landscape: '1536x1024',
  square: '1024x1024',
  portrait: '1024x1536',
};
export const GPT_IMAGE_2_EXACT_SIZE_RE = /^(?:1024x1024|1024x1536|1536x1024|auto|[1-9]\d{2,3}x[1-9]\d{2,3})$/;

type PersistGeneratedImageInput = {
  bytes: Buffer;
  mimeType?: string;
  provider: string;
  prompt: string;
  outputDir?: string;
  outputRunDir?: string;
  saveToWorkspace: boolean;
};

type PersistGeneratedImageResult = GeneratedImageAsset;

export type ResolvedReferenceImage = {
  source: string;
  mimeType: string;
  fileName: string;
  bytes?: Buffer;
  imageUrl: string;
};

function ensureDirectory(dirPath: string): Promise<void> {
  return fsp.mkdir(dirPath, { recursive: true }).then(() => undefined);
}

function sanitizePathSegment(input: string): string {
  return String(input || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'image';
}

function inferExtensionFromMimeType(mimeType?: string): string {
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}

function inferMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function readPngInfo(buffer: Buffer): { width: number; height: number; hasAlpha: boolean | null } | null {
  if (buffer.length < 26 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  const colorType = buffer[25];
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    hasAlpha: colorType === 4 || colorType === 6 ? true : (colorType === 0 || colorType === 2 || colorType === 3 ? false : null),
  };
}

function readGifInfo(buffer: Buffer): { width: number; height: number; hasAlpha: boolean | null } | null {
  if (buffer.length < 10) return null;
  const sig = buffer.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), hasAlpha: null };
}

function readJpegInfo(buffer: Buffer): { width: number; height: number; hasAlpha: boolean | null } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), hasAlpha: false };
    }
    offset += 2 + length;
  }
  return null;
}

export function inspectImageBuffer(buffer: Buffer, mimeType?: string): { width: number | null; height: number | null; hasAlpha: boolean | null } {
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const info = readPngInfo(buffer) || readGifInfo(buffer) || readJpegInfo(buffer);
  if (info) return info;
  return {
    width: null,
    height: null,
    hasAlpha: mime === 'image/jpeg' || mime === 'image/jpg' ? false : null,
  };
}

function buildUniqueFilePath(directory: string, baseName: string, extension: string): string {
  const safeBase = sanitizePathSegment(baseName);
  let candidate = path.join(directory, `${safeBase}${extension}`);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${safeBase}_${counter}${extension}`);
    counter += 1;
  }
  return candidate;
}

export function buildImageGenerationRunOutputDir(input: {
  outputDir?: string;
  provider: string;
  prompt: string;
  createdAt?: Date;
}): string {
  const cfg = getImageGenerationConfig();
  const baseDir = String(input.outputDir || cfg.default_output_dir || DEFAULT_IMAGE_OUTPUT_DIR).trim() || DEFAULT_IMAGE_OUTPUT_DIR;
  const providerStem = sanitizePathSegment(input.provider);
  const promptStem = sanitizePathSegment(String(input.prompt || '').slice(0, 48));
  const timestamp = (input.createdAt || new Date()).toISOString().replace(/[:.]/g, '-');
  const runFolder = `${providerStem}_${timestamp}_${promptStem}`;
  return path.join(baseDir, runFolder);
}

function getWorkspaceRoot(): string {
  const globalWorkspace = getConfig().getConfig().workspace.path;
  return getActiveWorkspace(globalWorkspace);
}

function ensurePathInWorkspace(workspaceRoot: string, requested: string): string {
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(path.join(workspaceRoot, requested));
  const rel = path.relative(workspaceRoot, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${requested}" is outside workspace.`);
  }
  return candidate;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isDataImageUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

export function normalizeReferenceImages(value?: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\r\n,]+/);
  const cleaned = raw
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return Array.from(new Set(cleaned)).slice(0, MAX_REFERENCE_IMAGE_COUNT);
}

export async function resolveReferenceImages(referenceImages: string[]): Promise<ResolvedReferenceImage[]> {
  const workspaceRoot = getWorkspaceRoot();
  const resolved: ResolvedReferenceImage[] = [];

  for (const reference of normalizeReferenceImages(referenceImages)) {
    if (isDataImageUrl(reference)) {
      const mimeType = String(reference.match(/^data:([^;]+);base64,/i)?.[1] || 'image/png');
      const b64 = reference.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
      resolved.push({
        source: reference,
        mimeType,
        fileName: `reference_${resolved.length + 1}${inferExtensionFromMimeType(mimeType)}`,
        bytes: Buffer.from(b64, 'base64'),
        imageUrl: reference,
      });
      continue;
    }

    if (isHttpUrl(reference)) {
      resolved.push({
        source: reference,
        mimeType: inferMimeTypeFromPath(reference),
        fileName: path.basename(new URL(reference).pathname) || `reference_${resolved.length + 1}.png`,
        imageUrl: reference,
      });
      continue;
    }

    const filePath = ensurePathInWorkspace(workspaceRoot, reference);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error(`Reference image "${reference}" was not found.`);
    }
    if (stat.size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error(`Reference image "${reference}" exceeds the 50MB GPT image limit.`);
    }

    const mimeType = inferMimeTypeFromPath(filePath);
    const bytes = await fsp.readFile(filePath);
    resolved.push({
      source: reference,
      mimeType,
      fileName: path.basename(filePath),
      bytes,
      imageUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    });
  }

  return resolved;
}

export async function validateMaskImage(mask: string, firstReferenceImage?: string): Promise<void> {
  const [resolvedMask] = await resolveReferenceImages([mask]);
  if (!resolvedMask?.bytes) {
    throw new Error('Mask image must be a workspace file or data URL so dimensions and alpha can be validated before editing.');
  }
  const maskInfo = inspectImageBuffer(resolvedMask.bytes, resolvedMask.mimeType);
  if (resolvedMask.mimeType !== 'image/png') throw new Error('Mask image must be a PNG with alpha.');
  if (maskInfo.hasAlpha !== true) throw new Error('Mask image must contain an alpha channel.');
  if (firstReferenceImage) {
    const [reference] = await resolveReferenceImages([firstReferenceImage]);
    const referenceBytes = reference?.bytes || (reference?.imageUrl ? (await fetchBinaryAsset(reference.imageUrl)).bytes : undefined);
    if (referenceBytes) {
      const refInfo = inspectImageBuffer(referenceBytes, reference.mimeType);
      if (maskInfo.width && refInfo.width && maskInfo.height && refInfo.height && (maskInfo.width !== refInfo.width || maskInfo.height !== refInfo.height)) {
        throw new Error(`Mask dimensions ${maskInfo.width}x${maskInfo.height} must match edited image dimensions ${refInfo.width}x${refInfo.height}.`);
      }
    }
  }
}

export function normalizeImageAspectRatio(value?: string): ImageAspectRatio {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return DEFAULT_IMAGE_ASPECT_RATIO;
  if (raw === 'square' || raw === '1:1') return 'square';
  if (raw === 'portrait' || raw === 'vertical' || raw === '9:16') return 'portrait';
  if (raw === 'landscape' || raw === 'horizontal' || raw === '16:9') return 'landscape';
  return DEFAULT_IMAGE_ASPECT_RATIO;
}

export function normalizeImageCount(value?: unknown): number {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count <= 0) return DEFAULT_IMAGE_COUNT;
  return Math.max(1, Math.min(MAX_IMAGE_COUNT, count));
}

export function promptRequestsTransparentBackground(prompt: string): boolean {
  const text = String(prompt || '').toLowerCase();
  return /\b(transparent background|transparent bg|alpha channel|with alpha|png transparency|no background|remove background|cutout|sprite sheet|game sprite|icon sprite)\b/.test(text);
}

export function normalizeImageBackground(value?: unknown, prompt?: string): ImageBackground {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'transparent' || raw === 'opaque' || raw === 'auto') return raw;
  return promptRequestsTransparentBackground(String(prompt || '')) ? 'transparent' : 'auto';
}

export function normalizeImageOutputFormat(value?: unknown, background?: ImageBackground): ImageOutputFormat {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'png' || raw === 'webp' || raw === 'jpeg') {
    if (background === 'transparent' && raw === 'jpeg') return 'png';
    return raw;
  }
  return 'png';
}

export function normalizeImageOutputCompression(value?: unknown, format?: ImageOutputFormat): number | undefined {
  if (format !== 'jpeg' && format !== 'webp') return undefined;
  const compression = Math.floor(Number(value));
  if (!Number.isFinite(compression)) return undefined;
  return Math.max(0, Math.min(100, compression));
}

export function normalizeImageQuality(value?: unknown): ImageQuality | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'auto') return raw;
  return undefined;
}

export function normalizeImagePresentationMode(value?: unknown): 'foreground' | 'background' {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'background' || raw === 'workflow' || raw === 'tool' ? 'background' : 'foreground';
}

export function normalizeImageSize(input: { size?: unknown; width?: unknown; height?: unknown; aspectRatio: ImageAspectRatio }): { size: string; width?: number; height?: number } {
  const rawSize = String(input.size || '').trim().toLowerCase();
  if (rawSize) {
    if (!GPT_IMAGE_2_EXACT_SIZE_RE.test(rawSize)) {
      throw new Error('Invalid image size. Use landscape/square/portrait, auto, or an exact WIDTHxHEIGHT size such as 1536x1024.');
    }
    const match = rawSize.match(/^(\d+)x(\d+)$/);
    if (match) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (width < 256 || height < 256 || width > 4096 || height > 4096) {
        throw new Error('Exact image width and height must both be between 256 and 4096 pixels.');
      }
    }
    return { size: rawSize, width: match ? Number(match[1]) : undefined, height: match ? Number(match[2]) : undefined };
  }
  const width = Math.floor(Number(input.width));
  const height = Math.floor(Number(input.height));
  if (Number.isFinite(width) || Number.isFinite(height)) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 256 || height < 256 || width > 4096 || height > 4096) {
      throw new Error('Exact image width and height must both be between 256 and 4096 pixels.');
    }
    return { size: `${width}x${height}`, width, height };
  }
  const size = IMAGE_SIZE_BY_ASPECT_RATIO[input.aspectRatio];
  const [w, h] = size.split('x').map(Number);
  return { size, width: w, height: h };
}

export function mimeTypeForImageOutputFormat(format?: ImageOutputFormat): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

export function getImageGenerationConfig(): {
  provider: string;
  model: string;
  save_to_workspace: boolean;
  default_output_dir: string;
  providers: Record<string, Record<string, unknown> | undefined>;
} {
  const cfg = getConfig().getConfig();
  const imageCfg = (cfg.image_generation || {}) as any;
  return {
    provider: String(imageCfg.provider || 'auto').trim() || 'auto',
    model: String(imageCfg.model || 'gpt-image-2-medium').trim() || 'gpt-image-2-medium',
    save_to_workspace: imageCfg.save_to_workspace !== false,
    default_output_dir: String(imageCfg.default_output_dir || DEFAULT_IMAGE_OUTPUT_DIR).trim() || DEFAULT_IMAGE_OUTPUT_DIR,
    providers: (imageCfg.providers && typeof imageCfg.providers === 'object') ? imageCfg.providers : {},
  };
}

export function resolveSecretReference(value: unknown): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('env:')) {
    const envName = raw.slice(4).trim();
    return envName ? process.env[envName] : undefined;
  }
  return getConfig().resolveSecret(raw);
}

export async function fetchBinaryAsset(url: string): Promise<{ bytes: Buffer; mimeType?: string }> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Prometheus/1.0',
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Asset download failed (${response.status} ${response.statusText})`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: String(response.headers.get('content-type') || '').trim() || undefined,
  };
}

export async function persistGeneratedImage(input: PersistGeneratedImageInput): Promise<PersistGeneratedImageResult> {
  const cfg = getImageGenerationConfig();
  const configDir = getConfig().getConfigDir();
  const workspaceRoot = getWorkspaceRoot();
  const mimeType = String(input.mimeType || 'image/png').trim() || 'image/png';
  const inspected = inspectImageBuffer(input.bytes, mimeType);
  const extension = inferExtensionFromMimeType(mimeType);
  const promptStem = sanitizePathSegment(String(input.prompt || '').slice(0, 48));
  const providerStem = sanitizePathSegment(input.provider);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${providerStem}_${timestamp}_${promptStem}`;

  const cacheDir = path.join(configDir, 'cache', 'images');
  await ensureDirectory(cacheDir);
  const cachePath = buildUniqueFilePath(cacheDir, baseName, extension);
  await fsp.writeFile(cachePath, input.bytes);

  if (!input.saveToWorkspace) {
    return {
      path: cachePath,
      cache_path: cachePath,
      mime_type: mimeType,
      file_name: path.basename(cachePath),
      bytes: input.bytes.length,
      width: inspected.width,
      height: inspected.height,
      has_alpha: inspected.hasAlpha,
    };
  }

  const outputDir = String(input.outputRunDir || input.outputDir || cfg.default_output_dir || DEFAULT_IMAGE_OUTPUT_DIR).trim() || DEFAULT_IMAGE_OUTPUT_DIR;
  const workspaceDir = ensurePathInWorkspace(workspaceRoot, outputDir);
  await ensureDirectory(workspaceDir);
  const workspacePath = buildUniqueFilePath(workspaceDir, baseName, extension);
  await fsp.writeFile(workspacePath, input.bytes);

  return {
    path: workspacePath,
    rel_path: path.relative(workspaceRoot, workspacePath).replace(/\\/g, '/'),
    cache_path: cachePath,
    mime_type: mimeType,
    file_name: path.basename(workspacePath),
    bytes: input.bytes.length,
    width: inspected.width,
    height: inspected.height,
    has_alpha: inspected.hasAlpha,
  };
}

export function buildImageGenerationSuccess(input: {
  provider: string;
  model: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  image: GeneratedImageAsset;
  images?: GeneratedImageAsset[];
  revisedPrompt?: string | null;
  quality?: string;
  size?: string;
  width?: number;
  height?: number;
  background?: ImageBackground;
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  presentationMode?: 'foreground' | 'background';
}): ImageGenerationSuccess {
  const images = Array.isArray(input.images) && input.images.length
    ? input.images
    : [input.image];
  return {
    success: true,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    image: images[0],
    images,
    image_count: images.length,
    revised_prompt: input.revisedPrompt ?? null,
    quality: input.quality,
    size: input.size,
    width: input.width,
    height: input.height,
    background: input.background,
    output_format: input.outputFormat,
    output_compression: input.outputCompression,
    presentation_mode: input.presentationMode,
  };
}

export function buildImageGenerationError(input: {
  provider: string;
  model?: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  background?: ImageBackground;
  outputFormat?: ImageOutputFormat;
  presentationMode?: 'foreground' | 'background';
  error: string;
  errorType: string;
}): ImageGenerationFailure {
  return {
    success: false,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    background: input.background,
    output_format: input.outputFormat,
    presentation_mode: input.presentationMode,
    error: input.error,
    error_type: input.errorType,
  };
}
