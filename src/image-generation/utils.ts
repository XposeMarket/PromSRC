import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from '../tools/workspace-context.js';
import type {
  GeneratedImageAsset,
  ImageAspectRatio,
  ImageGenerationFailure,
  ImageGenerationSuccess,
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

type PersistGeneratedImageInput = {
  bytes: Buffer;
  mimeType?: string;
  provider: string;
  prompt: string;
  outputDir?: string;
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
    };
  }

  const outputDir = String(input.outputDir || cfg.default_output_dir || DEFAULT_IMAGE_OUTPUT_DIR).trim() || DEFAULT_IMAGE_OUTPUT_DIR;
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
  };
}

export function buildImageGenerationError(input: {
  provider: string;
  model?: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  error: string;
  errorType: string;
}): ImageGenerationFailure {
  return {
    success: false,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    error: input.error,
    error_type: input.errorType,
  };
}
