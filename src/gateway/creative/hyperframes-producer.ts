import fs from 'fs';
import path from 'path';
import { normalizeForHyperframes, wrapForIframePreview } from './hyperframes-bridge';
import { resolveRuntimeBinary } from '../../runtime/dependencies';

export type HyperframesProducerFormat = 'mp4' | 'webm' | 'mov' | 'png-sequence';
export type HyperframesProducerQuality = 'draft' | 'standard' | 'high';
export type HyperframesProducerFps = 24 | 30 | 60;

export type HyperframesProducerRenderInput = {
  html: string;
  workspacePath: string;
  outputPath: string;
  compositionId?: string;
  fps?: HyperframesProducerFps;
  quality?: HyperframesProducerQuality;
  format?: HyperframesProducerFormat;
  workers?: number;
  timeoutMs?: number;
  variables?: Record<string, unknown>;
  debug?: boolean;
};

export type HyperframesProducerRenderResult = {
  outputPath: string;
  projectDir: string;
  entryFile: string;
  job: any;
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export class HyperframesProducerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`@hyperframes/producer render timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'HyperframesProducerTimeoutError';
  }
}

function safeSegment(raw: string, fallback = 'composition'): string {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;
}

function ensureInside(basePath: string, targetPath: string): void {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`HyperFrames producer path escapes workspace: ${target}`);
  }
}

function readCompositionId(html: string, fallback?: string): string {
  const htmlId = /<html\b[^>]*\bdata-composition-id\s*=\s*(["'])(.*?)\1/i.exec(html)?.[2];
  const stageId = /\bdata-composition-id\s*=\s*(["'])(.*?)\1/i.exec(html)?.[2];
  return htmlId || stageId || fallback || 'prometheus-hyperframes';
}

function prependPathDir(dir: string): void {
  const resolved = path.resolve(dir);
  const pathKey = process.platform === 'win32'
    ? (Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'Path')
    : 'PATH';
  const current = String(process.env[pathKey] || '');
  const parts = current.split(path.delimiter).filter(Boolean);
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const alreadyPresent = parts.some((part) => {
    const candidate = path.resolve(part);
    return (process.platform === 'win32' ? candidate.toLowerCase() : candidate) === normalized;
  });
  if (!alreadyPresent) {
    process.env[pathKey] = [resolved, ...parts].join(path.delimiter);
  }
}

function exposePrometheusFfmpegToHyperframes(): void {
  for (const binary of ['ffmpeg', 'ffprobe'] as const) {
    try {
      const resolved = resolveRuntimeBinary(binary, { allowPathFallback: true });
      if (!path.isAbsolute(resolved) || !fs.existsSync(resolved)) continue;
      prependPathDir(path.dirname(resolved));
      const envName = binary === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
      if (!String(process.env[envName] || '').trim()) {
        process.env[envName] = resolved;
      }
    } catch {
      // HyperFrames will report its own dependency error if neither bundled nor PATH binaries work.
    }
  }
}

export async function renderHyperframesWithProducer(input: HyperframesProducerRenderInput): Promise<HyperframesProducerRenderResult> {
  const workspacePath = path.resolve(input.workspacePath || process.cwd());
  const outputPath = path.resolve(input.outputPath);
  ensureInside(workspacePath, outputPath);
  exposePrometheusFfmpegToHyperframes();

  const normalized = normalizeForHyperframes(input.html);
  const compositionId = safeSegment(input.compositionId || readCompositionId(normalized));
  const projectDir = path.join(workspacePath, '.prometheus', 'creative', 'hyperframes-producer', `${compositionId}-${Date.now()}`);
  fs.mkdirSync(projectDir, { recursive: true });

  const entryFile = 'index.html';
  const entryPath = path.join(projectDir, entryFile);
  // @hyperframes/producer waits for the composition page to expose window.__hf.
  // Prometheus-authored clips may only register timelines/seek handlers, so add
  // the HF runtime plus producer bridge explicitly while keeping the source HTML
  // itself canonical in the editor/project metadata.
  fs.writeFileSync(entryPath, wrapForIframePreview(normalized, { includeProducerBridge: true }), 'utf8');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const producer = await dynamicImport('@hyperframes/producer');
  const fps = input.fps || 30;
  const job = producer.createRenderJob({
    inputPath: entryFile,
    outputPath,
    fps: { num: fps, den: 1 },
    quality: input.quality || 'standard',
    format: input.format || 'mp4',
    workers: Math.max(1, Math.min(4, Math.round(Number(input.workers) || 1))),
    entryFile,
    variables: input.variables,
    debug: !!input.debug,
  });
  const timeoutMs = Math.max(30_000, Math.min(15 * 60_000, Math.round(Number(input.timeoutMs) || 120_000)));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new HyperframesProducerTimeoutError(timeoutMs));
  }, timeoutMs);
  try {
    await producer.executeRenderJob(
      job,
      projectDir,
      outputPath,
      input.debug
        ? (_job: any, message: string) => {
            if (message) console.log(`[hyperframes-producer] ${message}`);
          }
        : undefined,
      controller.signal,
    );
  } catch (err: any) {
    if (timedOut) throw new HyperframesProducerTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return { outputPath, projectDir, entryFile, job };
}
