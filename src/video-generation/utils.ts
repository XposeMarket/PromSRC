import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from '../tools/workspace-context.js';
import type {
  GeneratedVideoAsset,
  VideoAspectRatio,
  VideoGenerationFailure,
  VideoGenerationSuccess,
  VideoMode,
  VideoResolution,
} from './types.js';

export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = 'landscape';
export const DEFAULT_VIDEO_OUTPUT_DIR = 'generated/videos';
export const DEFAULT_VIDEO_DURATION = 6;
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = '480p';
export const DEFAULT_VIDEO_MODE: VideoMode = 'generate';
export const DEFAULT_VIDEO_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_VIDEO_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_VIDEO_REFERENCE_IMAGES = 7;
export const MAX_LOCAL_VIDEO_INPUT_BYTES = 100 * 1024 * 1024;

type PersistGeneratedVideoInput = {
  bytes: Buffer;
  mimeType?: string;
  provider: string;
  prompt: string;
  outputDir?: string;
  saveToWorkspace: boolean;
  sourceUrl?: string;
};

export type ResolvedVideoInput = {
  source: string;
  mimeType: string;
  fileName: string;
  bytes?: Buffer;
  url: string;
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
    .slice(0, 80) || 'video';
}

function inferExtensionFromMimeType(mimeType?: string): string {
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (mime === 'video/webm') return '.webm';
  if (mime === 'video/quicktime') return '.mov';
  return '.mp4';
}

function inferMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.png') return 'image/png';
  return 'video/mp4';
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

function isDataMediaUrl(value: string): boolean {
  return /^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(value);
}

export function normalizeVideoAspectRatio(value?: string): VideoAspectRatio {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return DEFAULT_VIDEO_ASPECT_RATIO;
  if (raw === 'square' || raw === '1:1') return 'square';
  if (raw === 'portrait' || raw === 'vertical' || raw === '9:16') return 'portrait';
  if (raw === 'landscape' || raw === 'horizontal' || raw === '16:9') return 'landscape';
  return DEFAULT_VIDEO_ASPECT_RATIO;
}

export function normalizeVideoResolution(value?: string): VideoResolution {
  const raw = String(value || '').trim().toLowerCase();
  return raw === '720p' ? '720p' : DEFAULT_VIDEO_RESOLUTION;
}

export function normalizeVideoDuration(value?: unknown): number {
  const duration = Math.floor(Number(value));
  if (!Number.isFinite(duration) || duration <= 0) return DEFAULT_VIDEO_DURATION;
  return Math.max(1, Math.min(15, duration));
}

export function normalizeVideoMode(value?: string): VideoMode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'edit' || raw === 'edit-video') return 'edit';
  if (raw === 'extend' || raw === 'extend-video' || raw === 'extension') return 'extend';
  return DEFAULT_VIDEO_MODE;
}

export function normalizePollIntervalMs(value?: unknown): number {
  const ms = Math.floor(Number(value));
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_VIDEO_POLL_INTERVAL_MS;
  return Math.max(1_000, Math.min(30_000, ms));
}

export function normalizeTimeoutMs(value?: unknown): number {
  const ms = Math.floor(Number(value));
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_VIDEO_TIMEOUT_MS;
  return Math.max(30_000, Math.min(30 * 60 * 1000, ms));
}

export function normalizeVideoReferences(value?: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[\r\n,]+/);
  const cleaned = raw.map((item) => String(item || '').trim()).filter(Boolean);
  return Array.from(new Set(cleaned)).slice(0, MAX_VIDEO_REFERENCE_IMAGES);
}

export function getVideoGenerationConfig(): {
  provider: string;
  model: string;
  save_to_workspace: boolean;
  default_output_dir: string;
  duration: number;
  resolution: VideoResolution;
  providers: Record<string, Record<string, unknown> | undefined>;
} {
  const cfg = getConfig().getConfig() as any;
  const videoCfg = (cfg.video_generation || {}) as any;
  return {
    provider: String(videoCfg.provider || 'auto').trim() || 'auto',
    model: String(videoCfg.model || 'grok-imagine-video').trim() || 'grok-imagine-video',
    save_to_workspace: videoCfg.save_to_workspace !== false,
    default_output_dir: String(videoCfg.default_output_dir || DEFAULT_VIDEO_OUTPUT_DIR).trim() || DEFAULT_VIDEO_OUTPUT_DIR,
    duration: normalizeVideoDuration(videoCfg.duration),
    resolution: normalizeVideoResolution(videoCfg.resolution),
    providers: (videoCfg.providers && typeof videoCfg.providers === 'object') ? videoCfg.providers : {},
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

export async function resolveVideoInput(input: string): Promise<ResolvedVideoInput> {
  const source = String(input || '').trim();
  if (!source) throw new Error('Video or image input is empty.');

  if (isDataMediaUrl(source)) {
    const mimeType = String(source.match(/^data:([^;]+);base64,/i)?.[1] || 'video/mp4');
    const b64 = source.replace(/^data:(image|video)\/[a-z0-9.+-]+;base64,/i, '');
    return {
      source,
      mimeType,
      fileName: `input${inferExtensionFromMimeType(mimeType)}`,
      bytes: Buffer.from(b64, 'base64'),
      url: source,
    };
  }

  if (isHttpUrl(source)) {
    return {
      source,
      mimeType: inferMimeTypeFromPath(source),
      fileName: path.basename(new URL(source).pathname) || 'input.mp4',
      url: source,
    };
  }

  const workspaceRoot = getWorkspaceRoot();
  const filePath = ensurePathInWorkspace(workspaceRoot, source);
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`Input media "${source}" was not found.`);
  }
  if (stat.size > MAX_LOCAL_VIDEO_INPUT_BYTES) {
    throw new Error(`Input media "${source}" exceeds the ${MAX_LOCAL_VIDEO_INPUT_BYTES / 1024 / 1024}MB local data URL limit.`);
  }

  const mimeType = inferMimeTypeFromPath(filePath);
  const bytes = await fsp.readFile(filePath);
  return {
    source,
    mimeType,
    fileName: path.basename(filePath),
    bytes,
    url: `data:${mimeType};base64,${bytes.toString('base64')}`,
  };
}

export async function fetchBinaryAsset(url: string): Promise<{ bytes: Buffer; mimeType?: string }> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Prometheus/1.0',
    },
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) {
    throw new Error(`Asset download failed (${response.status} ${response.statusText})`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: String(response.headers.get('content-type') || '').trim() || undefined,
  };
}

export async function persistGeneratedVideo(input: PersistGeneratedVideoInput): Promise<GeneratedVideoAsset> {
  const cfg = getVideoGenerationConfig();
  const configDir = getConfig().getConfigDir();
  const workspaceRoot = getWorkspaceRoot();
  const mimeType = String(input.mimeType || 'video/mp4').split(';')[0].trim() || 'video/mp4';
  const extension = inferExtensionFromMimeType(mimeType);
  const promptStem = sanitizePathSegment(String(input.prompt || '').slice(0, 48));
  const providerStem = sanitizePathSegment(input.provider);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${providerStem}_${timestamp}_${promptStem}`;

  const cacheDir = path.join(configDir, 'cache', 'videos');
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
      source_url: input.sourceUrl,
    };
  }

  const outputDir = String(input.outputDir || cfg.default_output_dir || DEFAULT_VIDEO_OUTPUT_DIR).trim() || DEFAULT_VIDEO_OUTPUT_DIR;
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
    source_url: input.sourceUrl,
  };
}

export function buildVideoGenerationSuccess(input: {
  provider: string;
  model: string;
  prompt: string;
  mode: VideoMode;
  aspectRatio: VideoAspectRatio;
  duration: number;
  resolution: VideoResolution;
  requestId: string;
  video: GeneratedVideoAsset;
  videoUrl?: string;
  respectModeration?: boolean | null;
  progress?: number;
}): VideoGenerationSuccess {
  return {
    success: true,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    mode: input.mode,
    aspect_ratio: input.aspectRatio,
    duration: input.duration,
    resolution: input.resolution,
    request_id: input.requestId,
    video: input.video,
    video_url: input.videoUrl,
    respect_moderation: input.respectModeration ?? null,
    progress: input.progress,
  };
}

export function buildVideoGenerationError(input: {
  provider: string;
  model?: string;
  prompt: string;
  mode: VideoMode;
  aspectRatio: VideoAspectRatio;
  error: string;
  errorType: string;
  requestId?: string;
  progress?: number;
}): VideoGenerationFailure {
  return {
    success: false,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    mode: input.mode,
    aspect_ratio: input.aspectRatio,
    error: input.error,
    error_type: input.errorType,
    request_id: input.requestId,
    progress: input.progress,
  };
}
