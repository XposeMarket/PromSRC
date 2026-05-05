import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  CreativeAssetRecord,
  CreativeAssetStorage,
  importCreativeAsset,
  resolveCreativeAssetPath,
  upsertCreativeAssetRecord,
} from './assets';

const execFileAsync = promisify(execFile);

export type CreativeAsciiRenderMode = 'image-to-ascii' | 'video-to-ascii' | 'audio-reactive' | 'generative' | 'hybrid';
export type CreativeAsciiRenderQuality = 'draft' | 'balanced' | 'premium';

export type CreativeAsciiRenderOptions = {
  source?: string;
  mode?: CreativeAsciiRenderMode;
  width?: number;
  height?: number;
  durationMs?: number;
  frameRate?: number;
  quality?: CreativeAsciiRenderQuality;
  glyphSet?: 'ascii' | 'binary' | 'blocks' | 'matrix' | 'braille' | 'dense' | string;
  palette?: 'nous-cyan-magenta' | 'phosphor-green' | 'amber' | 'mono' | 'source' | string | string[];
  style?: string;
  motion?: 'resolve' | 'scan' | 'hold' | string;
  fit?: 'cover' | 'contain' | string;
  background?: string;
  glitch?: number;
  glow?: number;
  seed?: number;
  filename?: string;
  tags?: any;
  brandId?: string | null;
  license?: Record<string, any> | null;
  importToCreative?: boolean;
  keepFrames?: boolean;
  timeoutMs?: number;
};

export type CreativeAsciiRenderJob = {
  id: string;
  jobDir: string;
  configPath: string;
  manifestPath: string;
  logPath: string;
  outputPath: string;
  sourcePath: string | null;
};

export type CreativeAsciiRenderResult = {
  job: CreativeAsciiRenderJob;
  renderer: Record<string, any>;
  asset: CreativeAssetRecord | null;
  outputPath: string;
  outputWorkspacePath: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeSegment(raw: any, fallback = 'ascii-render'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
    .replace(/^[/\\]+/, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
  return cleaned || fallback;
}

function normalizeNumber(raw: any, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  const parsed = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeFloat(raw: any, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeTags(input: any, extras: string[] = []): string[] {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((part) => part.trim());
  const merged = [...raw, ...extras]
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(merged)).slice(0, 32);
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = path.resolve(String(basePath || ''));
  const target = path.resolve(String(targetPath || ''));
  const rel = path.relative(base, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function workspaceRelative(storage: CreativeAssetStorage, absPath: string): string | null {
  const rel = path.relative(storage.workspacePath, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
}

function createJobId(): string {
  if (typeof crypto.randomUUID === 'function') return `ascii_${crypto.randomUUID()}`;
  return `ascii_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRendererScript(): string {
  const repoRootFromDist = path.resolve(__dirname, '..', '..', '..');
  const resourcesPath = String((process as any).resourcesPath || '');
  const candidates = [
    path.resolve(__dirname, 'renderers', 'ascii_renderer.py'),
    path.resolve(process.cwd(), 'dist', 'gateway', 'creative', 'renderers', 'ascii_renderer.py'),
    path.resolve(process.cwd(), 'src', 'gateway', 'creative', 'renderers', 'ascii_renderer.py'),
    path.resolve(repoRootFromDist, 'src', 'gateway', 'creative', 'renderers', 'ascii_renderer.py'),
    path.resolve(repoRootFromDist, 'dist', 'gateway', 'creative', 'renderers', 'ascii_renderer.py'),
    path.resolve(resourcesPath, 'app.asar.unpacked', 'dist', 'gateway', 'creative', 'renderers', 'ascii_renderer.py'),
    path.resolve(resourcesPath, 'app', 'dist', 'gateway', 'creative', 'renderers', 'ascii_renderer.py'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Prometheus ASCII Python renderer was not found. Checked: ${candidates.join('; ')}`);
  }
  return found;
}

function resolveSource(storage: CreativeAssetStorage, source: any, mode: CreativeAsciiRenderMode): string | null {
  const raw = String(source || '').trim();
  if (!raw) {
    if (mode === 'generative') return null;
    throw new Error('creative_render_ascii_asset requires source unless mode is generative.');
  }
  const resolved = resolveCreativeAssetPath(storage, raw);
  if (resolved.sourceType === 'remote' || !resolved.absPath) {
    throw new Error('creative_render_ascii_asset currently requires a local workspace source for Python rendering.');
  }
  if (!fs.existsSync(resolved.absPath) || !fs.statSync(resolved.absPath).isFile()) {
    throw new Error('ASCII render source file not found.');
  }
  if (!isPathInside(storage.workspacePath, resolved.absPath) && !isPathInside(storage.rootAbsPath, resolved.absPath)) {
    throw new Error('ASCII render source must stay inside the workspace or creative project root.');
  }
  return resolved.absPath;
}

function normalizeMode(input: any, sourcePath: string | null): CreativeAsciiRenderMode {
  const raw = String(input || '').trim().toLowerCase();
  if (raw === 'generative' || raw === 'hybrid' || raw === 'audio-reactive') return raw;
  if (raw === 'video-to-ascii' || raw === 'image-to-ascii') return raw;
  const ext = sourcePath ? path.extname(sourcePath).toLowerCase() : '';
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'].includes(ext) ? 'video-to-ascii' : 'image-to-ascii';
}

function timeoutFor(options: CreativeAsciiRenderOptions): number {
  if (Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0) {
    return Math.max(5000, Math.min(30 * 60 * 1000, Math.floor(Number(options.timeoutMs))));
  }
  const durationMs = normalizeNumber(options.durationMs, 6000, 250, 120000);
  const frameRate = normalizeNumber(options.frameRate, 30, 1, 60);
  const quality = String(options.quality || 'balanced').toLowerCase();
  const multiplier = quality === 'premium' ? 140 : quality === 'draft' ? 50 : 90;
  return Math.max(60000, Math.min(30 * 60 * 1000, Math.ceil(durationMs / 1000 * frameRate * multiplier)));
}

export async function renderCreativeAsciiAsset(
  storage: CreativeAssetStorage,
  options: CreativeAsciiRenderOptions = {},
): Promise<CreativeAsciiRenderResult> {
  const requestedMode = String(options.mode || '').toLowerCase() as CreativeAsciiRenderMode;
  const sourcePath = resolveSource(storage, options.source, requestedMode || 'image-to-ascii');
  const mode = normalizeMode(requestedMode, sourcePath);
  const jobId = createJobId();
  const jobDir = path.join(storage.creativeDir, 'render-jobs', 'ascii', jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const filenameBase = sanitizeSegment(
    options.filename || (sourcePath ? `${path.basename(sourcePath, path.extname(sourcePath))}-ascii` : 'generative-ascii'),
    'ascii-render',
  );
  const outputPath = path.join(jobDir, `${filenameBase}.mp4`);
  const configPath = path.join(jobDir, 'config.json');
  const manifestPath = path.join(jobDir, 'manifest.json');
  const logPath = path.join(jobDir, 'renderer.log');
  const rendererScript = resolveRendererScript();
  const width = normalizeNumber(options.width, 1080, 160, 3840);
  const height = normalizeNumber(options.height, 1920, 160, 3840);
  const durationMs = normalizeNumber(options.durationMs, 6000, 250, 120000);
  const frameRate = normalizeNumber(options.frameRate, 30, 1, 60);
  const quality = (['draft', 'balanced', 'premium'].includes(String(options.quality || '').toLowerCase())
    ? String(options.quality).toLowerCase()
    : 'balanced') as CreativeAsciiRenderQuality;
  const config = {
    source: sourcePath,
    output: outputPath,
    logPath,
    width,
    height,
    durationMs,
    frameRate,
    mode,
    quality,
    glyphSet: String(options.glyphSet || 'dense'),
    palette: options.palette || 'nous-cyan-magenta',
    style: String(options.style || 'terminal-cinema'),
    motion: String(options.motion || 'resolve'),
    fit: String(options.fit || 'cover'),
    background: String(options.background || '#020506'),
    glitch: normalizeFloat(options.glitch, quality === 'draft' ? 0.12 : 0.22, 0, 1),
    glow: normalizeFloat(options.glow, quality === 'premium' ? 0.58 : 0.42, 0, 1),
    seed: normalizeNumber(options.seed, 12345, 0, Number.MAX_SAFE_INTEGER),
    keepFrames: options.keepFrames === true,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  let stdout = '';
  let stderr = '';
  try {
    const result = await execFileAsync('python', [rendererScript, configPath], {
      windowsHide: true,
      timeout: timeoutFor(options),
      maxBuffer: 1024 * 1024 * 8,
    });
    stdout = String(result.stdout || '');
    stderr = String(result.stderr || '');
  } catch (error: any) {
    stdout = String(error?.stdout || '');
    stderr = String(error?.stderr || '');
    const detail = stdout.trim() || stderr.trim() || error?.message || 'ASCII Python renderer failed.';
    throw new Error(detail);
  }

  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const parsed = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  if (!parsed?.ok || !fs.existsSync(outputPath)) {
    throw new Error(parsed?.error || stderr.trim() || 'ASCII Python renderer did not produce an output asset.');
  }

  const tags = normalizeTags(options.tags, ['ascii', 'python-render', mode, quality]);
  let asset: CreativeAssetRecord | null = null;
  if (options.importToCreative !== false) {
    const imported = await importCreativeAsset(storage, {
      source: outputPath,
      filename: filenameBase,
      tags,
      brandId: options.brandId ? String(options.brandId) : null,
      license: options.license || null,
      copy: true,
    });
    asset = upsertCreativeAssetRecord(storage, {
      ...imported,
      metadata: {
        ...(imported.metadata || {}),
        asciiRender: {
          renderer: 'python',
          rendererScript,
          jobId,
          jobDir,
          configPath,
          manifestPath,
          logPath,
          sourcePath,
          mode,
          quality,
          glyphSet: config.glyphSet,
          palette: config.palette,
          motion: config.motion,
          createdAt: nowIso(),
        },
      },
    });
  }

  const manifest = {
    kind: 'prometheus-creative-ascii-render-job',
    version: 1,
    createdAt: nowIso(),
    jobId,
    renderer: parsed,
    config,
    sourcePath,
    outputPath,
    outputWorkspacePath: workspaceRelative(storage, outputPath),
    importedAsset: asset,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return {
    job: {
      id: jobId,
      jobDir,
      configPath,
      manifestPath,
      logPath,
      outputPath,
      sourcePath,
    },
    renderer: parsed,
    asset,
    outputPath,
    outputWorkspacePath: workspaceRelative(storage, outputPath),
  };
}
