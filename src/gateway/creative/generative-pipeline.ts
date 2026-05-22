import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '../../types';
import { getConfig } from '../../config/config';
import { getValidXAIToken, isXAIConnected } from '../../auth/xai-oauth';
import { getValidToken as getValidOpenAiToken, loadTokens as loadOpenAiTokens } from '../../auth/openai-oauth';
import { executeDownloadMedia } from '../../tools/download-tools';
import { executeGenerateImage } from '../../tools/generate-image';
import { executeGenerateVideo } from '../../tools/generate-video';
import { executeAnalyzeVisionFrames } from '../../tools/media-analysis';
import { analyzeCreativeAudioSource, enrichCreativeAudioTrack } from './audio';
import { normalizeCreativeAudioTrack, type CreativeAudioTrack } from './contracts';
import {
  analyzeCreativeAsset,
  importCreativeAsset,
  resolveCreativeAssetPath,
  type CreativeAssetRecord,
  type CreativeAssetStorage,
} from './assets';
import { addClip, createEmptyComposition } from './composition';
import { renderComposition } from './renderers/composition_renderer';
import { extractCreativeLayers, type CreativeLayerExtractionMode } from './layer-extraction';
import { launchCreativeChromium } from './playwright-runtime';

const execFileAsync = promisify(execFile);
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

export type CreativeGenerationRecord = {
  id: string;
  kind: 'image' | 'video' | 'frame' | 'audio' | 'other';
  shotId: string | null;
  attempt: number;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  mode: string | null;
  parentGenerationId: string | null;
  parentAssetId: string | null;
  sourceImage: string | null;
  sourceVideo: string | null;
  referenceImages: string[];
  outputPath: string | null;
  outputAssetId: string | null;
  metadata: Record<string, any>;
  createdAt: string;
};

type GenerationIndex = {
  kind: 'prometheus-creative-generation-index';
  version: number;
  updatedAt: string;
  generations: CreativeGenerationRecord[];
};

export type CreativeStoryboardShot = {
  shotId: string;
  title: string | null;
  duration: number | null;
  prompt: string;
  action: string | null;
  camera: string | null;
  openingFrame: string | null;
  endingFrameGoal: string | null;
  transition: string | null;
  generationMode: string | null;
  qaCriteria: string[];
  status: 'planned' | 'generated' | 'approved' | 'needs_retry';
  metadata: Record<string, any>;
};

export type CreativeStoryboardDoc = {
  kind: 'prometheus-creative-storyboard';
  version: number;
  id: string;
  title: string;
  brief: string | null;
  styleGuide: string | null;
  characterBible: string | null;
  shots: CreativeStoryboardShot[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, any>;
};

type StoryboardIndex = {
  kind: 'prometheus-creative-storyboard-index';
  version: number;
  updatedAt: string;
  storyboards: Array<{ id: string; title: string; path: string; shotCount: number; updatedAt: string }>;
};

export type CreativeProjectDoc = {
  kind: 'prometheus-creative-project';
  version: number;
  id: string;
  title: string;
  brief: string | null;
  target: {
    format: string | null;
    durationSec: number | null;
    aspectRatio: string | null;
    resolution: string | null;
    width: number | null;
    height: number | null;
    frameRate: number | null;
  };
  storyboard: { id: string | null; path: string | null };
  generationIds: string[];
  selectedTakes: Record<string, { generationId: string; outputPath: string; score: number | null; selectedAt: string; qa?: any }>;
  sourceAssets: string[];
  extractedLayers: any[];
  roughCuts: any[];
  exports: any[];
  qaReports: any[];
  audioTracks: any[];
  captions: any[];
  notes: Record<string, any>;
  createdAt: string;
  updatedAt: string;
};

type ProjectIndex = {
  kind: 'prometheus-creative-project-index';
  version: number;
  updatedAt: string;
  projects: Array<{ id: string; title: string; path: string; updatedAt: string; brief: string | null }>;
};

type ExtractFrameSelector = {
  frame?: 'first' | 'middle' | 'last' | 'best_continuity_frame';
  timestamp?: number;
  timestampMs?: number;
  percent?: number;
};

type ExtractFrameInput = ExtractFrameSelector & {
  source: string;
  outputName?: string;
  registerAsAsset?: boolean;
  tags?: any;
};

type ExtractFramesInput = {
  source: string;
  frames?: Array<ExtractFrameSelector | string | number>;
  timestamps?: number[];
  percents?: number[];
  count?: number;
  rangeStartPercent?: number;
  rangeEndPercent?: number;
  outputNamePrefix?: string;
  registerAsAssets?: boolean;
  contactSheet?: boolean;
  tags?: any;
};

export type CreativeLayerSpec = {
  id: string;
  kind: 'video' | 'image' | 'html-motion' | 'hyperframes' | 'audio' | 'caption' | 'shape';
  source: string | null;
  html: string | null;
  label: string | null;
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  zIndex: number;
  opacity: number;
  fit: 'cover' | 'contain' | 'fill' | 'none';
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'lighten' | 'darken';
  bounds: { x: number; y: number; width: number; height: number };
  safeArea: boolean;
  editableSlots: Record<string, any>;
  metadata: Record<string, any>;
};

type LayerIssue = {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  layerId?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function sanitizeSegment(raw: string, fallback = 'asset'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
    .replace(/^[/\\]+/, '')
    .replace(/\s+/g, '-')
    .slice(0, 120);
  return cleaned || fallback;
}

function mediaFrameDir(storage: CreativeAssetStorage, sourceAbsPath: string): string {
  const base = sanitizeSegment(path.basename(sourceAbsPath, path.extname(sourceAbsPath)), 'video').slice(0, 56);
  const hash = crypto.createHash('sha1').update(path.resolve(sourceAbsPath)).digest('hex').slice(0, 8);
  return path.join(storage.creativeDir, 'frames', `${base}-${hash}`);
}

function buildWorkspaceRelativePath(workspacePath: string, absPath: string): string {
  const rel = path.relative(workspacePath, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : absPath.replace(/\\/g, '/');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureInside(basePath: string, targetPath: string): void {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${target}`);
  }
}

function fileUrl(absPath: string): string {
  return `file:///${path.resolve(absPath).replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inferMime(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function imageToVisionFrame(absPath: string, atMs?: number | null): any {
  const base64 = fs.readFileSync(absPath).toString('base64');
  return { base64, mimeType: inferMime(absPath), atMs };
}

function parseJsonObject(text: string): any | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced?.[1] || raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(candidate.slice(first, last + 1)); } catch {}
    }
  }
  return null;
}

function normalizeReferenceList(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String).map((item) => item.trim()).filter(Boolean);
  if (input == null) return [];
  return String(input).split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeLayerKind(raw: any): CreativeLayerSpec['kind'] {
  const value = String(raw || '').trim().toLowerCase();
  if (['video', 'image', 'html-motion', 'hyperframes', 'audio', 'caption', 'shape'].includes(value)) return value as CreativeLayerSpec['kind'];
  return value === 'html' ? 'html-motion' : 'image';
}

function normalizeFit(raw: any): CreativeLayerSpec['fit'] {
  const value = String(raw || '').trim().toLowerCase();
  return ['cover', 'contain', 'fill', 'none'].includes(value) ? value as CreativeLayerSpec['fit'] : 'cover';
}

function normalizeBlend(raw: any): CreativeLayerSpec['blendMode'] {
  const value = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  return ['normal', 'multiply', 'screen', 'overlay', 'lighten', 'darken'].includes(value) ? value as CreativeLayerSpec['blendMode'] : 'normal';
}

function normalizeBounds(raw: any, width: number, height: number): CreativeLayerSpec['bounds'] {
  const x = Number.isFinite(Number(raw?.x)) ? Number(raw.x) : Number.isFinite(Number(raw?.xPct)) ? width * Number(raw.xPct) / 100 : 0;
  const y = Number.isFinite(Number(raw?.y)) ? Number(raw.y) : Number.isFinite(Number(raw?.yPct)) ? height * Number(raw.yPct) / 100 : 0;
  const w = Number.isFinite(Number(raw?.width)) ? Number(raw.width) : Number.isFinite(Number(raw?.wPct)) ? width * Number(raw.wPct) / 100 : width;
  const h = Number.isFinite(Number(raw?.height)) ? Number(raw.height) : Number.isFinite(Number(raw?.hPct)) ? height * Number(raw.hPct) / 100 : height;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h)),
  };
}

export function creativeNormalizeLayerSpecs(input: {
  layers: any[];
  width?: number;
  height?: number;
  durationMs?: number;
}): { layers: CreativeLayerSpec[]; width: number; height: number; durationMs: number } {
  const width = Math.max(120, Math.round(Number(input.width) || 1280));
  const height = Math.max(120, Math.round(Number(input.height) || 720));
  const durationMs = Math.max(100, Math.round(Number(input.durationMs) || 6000));
  const layers = (Array.isArray(input.layers) ? input.layers : []).map((raw, index) => {
    const kind = normalizeLayerKind(raw?.kind || raw?.type);
    const startMs = Math.max(0, Math.round(Number(raw?.startMs ?? raw?.start_ms) || 0));
    const explicitDuration = Number(raw?.durationMs ?? raw?.duration_ms);
    return {
      id: String(raw?.id || `layer-${String(index + 1).padStart(2, '0')}`),
      kind,
      source: raw?.source ? String(raw.source) : null,
      html: raw?.html ? String(raw.html) : null,
      label: raw?.label ? String(raw.label) : null,
      startMs,
      durationMs: Math.max(1, Math.round(Number.isFinite(explicitDuration) ? explicitDuration : durationMs - startMs)),
      trimStartMs: Math.max(0, Math.round(Number(raw?.trimStartMs ?? raw?.trim_start_ms) || 0)),
      trimEndMs: Math.max(0, Math.round(Number(raw?.trimEndMs ?? raw?.trim_end_ms) || 0)),
      zIndex: Math.round(Number(raw?.zIndex ?? raw?.z_index ?? index * 100) || 0),
      opacity: Math.max(0, Math.min(1, Number.isFinite(Number(raw?.opacity)) ? Number(raw.opacity) : 1)),
      fit: normalizeFit(raw?.fit),
      blendMode: normalizeBlend(raw?.blendMode ?? raw?.blend_mode),
      bounds: normalizeBounds(raw?.bounds || raw, width, height),
      safeArea: raw?.safeArea !== false && raw?.safe_area !== false,
      editableSlots: raw?.editableSlots && typeof raw.editableSlots === 'object' ? raw.editableSlots : {},
      metadata: {
        ...(raw?.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}),
        ...(raw?.volume !== undefined ? { volume: raw.volume } : {}),
        ...(raw?.muted !== undefined ? { muted: raw.muted } : {}),
        ...(raw?.fadeInMs !== undefined || raw?.fade_in_ms !== undefined ? { fadeInMs: raw.fadeInMs ?? raw.fade_in_ms } : {}),
        ...(raw?.fadeOutMs !== undefined || raw?.fade_out_ms !== undefined ? { fadeOutMs: raw.fadeOutMs ?? raw.fade_out_ms } : {}),
      },
    } satisfies CreativeLayerSpec;
  }).sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  return { layers, width, height, durationMs };
}

function extractHtmlAssetRefs(html: string): string[] {
  const refs = new Set<string>();
  const attrRe = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const cssRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(html))) refs.add(match[1]);
  while ((match = cssRe.exec(html))) refs.add(match[1]);
  return Array.from(refs).filter((ref) => ref && !/^(data:|https?:|file:|#)/i.test(ref));
}

function sourceExists(storage: CreativeAssetStorage, source: string): boolean {
  try {
    const resolved = resolveCreativeAssetPath(storage, source);
    return !!resolved.absPath && fs.existsSync(resolved.absPath);
  } catch {
    return false;
  }
}

export function creativeValidateCompositionLayers(
  storage: CreativeAssetStorage,
  input: { layers: any[]; width?: number; height?: number; durationMs?: number; strict?: boolean },
): { ok: boolean; issues: LayerIssue[]; normalized: ReturnType<typeof creativeNormalizeLayerSpecs>; complexityScore: number } {
  const normalized = creativeNormalizeLayerSpecs(input);
  const issues: LayerIssue[] = [];
  const seen = new Set<string>();
  const safePadX = normalized.width * 0.04;
  const safePadY = normalized.height * 0.04;
  for (const layer of normalized.layers) {
    if (seen.has(layer.id)) issues.push({ severity: 'error', code: 'duplicate_layer_id', message: `Duplicate layer id "${layer.id}".`, layerId: layer.id });
    seen.add(layer.id);
    if (layer.startMs + layer.durationMs > normalized.durationMs) issues.push({ severity: input.strict ? 'error' : 'warning', code: 'layer_exceeds_timeline', message: 'Layer extends beyond composition duration.', layerId: layer.id });
    if (layer.bounds.width <= 0 || layer.bounds.height <= 0) issues.push({ severity: 'error', code: 'invalid_bounds', message: 'Layer has invalid dimensions.', layerId: layer.id });
    if (layer.safeArea && (layer.bounds.x < safePadX || layer.bounds.y < safePadY || layer.bounds.x + layer.bounds.width > normalized.width - safePadX || layer.bounds.y + layer.bounds.height > normalized.height - safePadY)) {
      issues.push({ severity: 'warning', code: 'outside_safe_area', message: 'Layer touches or exceeds the safe area.', layerId: layer.id });
    }
    if (['video', 'image', 'html-motion', 'hyperframes', 'audio'].includes(layer.kind) && !layer.source && !layer.html) {
      issues.push({ severity: 'error', code: 'missing_source', message: 'Layer requires source or inline HTML.', layerId: layer.id });
    }
    if (layer.source && !/^https?:/i.test(layer.source) && !sourceExists(storage, layer.source)) {
      issues.push({ severity: 'error', code: 'missing_asset', message: `Layer source does not exist: ${layer.source}`, layerId: layer.id });
    }
    const html = layer.html || (layer.kind === 'html-motion' || layer.kind === 'hyperframes' ? (layer.source && sourceExists(storage, layer.source) ? fs.readFileSync(resolveCreativeAssetPath(storage, layer.source).absPath!, 'utf-8') : '') : '');
    if (html) {
      if (/\b(setInterval|Date\.now|performance\.now|Math\.random)\b/.test(html)) issues.push({ severity: 'warning', code: 'nondeterministic_animation', message: 'HTML layer may use wall-clock/random animation.', layerId: layer.id });
      if (!/(__hf|prometheus-html-motion-seek|hf-seek|__PROMETHEUS_HTML_MOTION_TIME_MS__)/.test(html)) issues.push({ severity: 'warning', code: 'missing_seek_adapter', message: 'HTML layer does not expose an obvious seek adapter.', layerId: layer.id });
      for (const ref of extractHtmlAssetRefs(html)) {
        if (!sourceExists(storage, ref)) issues.push({ severity: 'error', code: 'missing_html_asset', message: `Referenced asset does not exist: ${ref}`, layerId: layer.id });
      }
      if (!/data-prom-slot-|data-composition-id/.test(html)) issues.push({ severity: 'info', code: 'limited_editability', message: 'HTML layer has limited Prometheus editability metadata.', layerId: layer.id });
    }
  }
  const activeVideoLayers = normalized.layers.filter((layer) => layer.kind === 'video').length;
  const htmlLayers = normalized.layers.filter((layer) => layer.kind === 'html-motion' || layer.kind === 'hyperframes').length;
  const blendedLayers = normalized.layers.filter((layer) => layer.blendMode !== 'normal' || layer.opacity < 1).length;
  const complexityScore = activeVideoLayers * 25 + htmlLayers * 15 + blendedLayers * 8 + normalized.layers.length * 3;
  if (activeVideoLayers > 3) issues.push({ severity: 'warning', code: 'many_video_layers', message: 'More than three video layers may render slowly.' });
  if (complexityScore > 100) issues.push({ severity: 'warning', code: 'high_complexity', message: `Composite complexity score is high (${complexityScore}).` });
  return { ok: !issues.some((issue) => issue.severity === 'error'), issues, normalized, complexityScore };
}

function layerToHtml(storage: CreativeAssetStorage, layer: CreativeLayerSpec, stage: { width: number; height: number }): string {
  const style = [
    `position:absolute`,
    `left:${layer.bounds.x}px`,
    `top:${layer.bounds.y}px`,
    `width:${layer.bounds.width}px`,
    `height:${layer.bounds.height}px`,
    `z-index:${layer.zIndex}`,
    `opacity:${layer.opacity}`,
    `mix-blend-mode:${layer.blendMode === 'normal' ? 'normal' : layer.blendMode}`,
    `overflow:hidden`,
  ].join(';');
  const timing = `data-start="${layer.startMs / 1000}s" data-duration="${layer.durationMs / 1000}s" data-track-index="${layer.zIndex}"`;
  if (layer.html) return `<div class="layer html-layer" id="${escapeHtml(layer.id)}" style="${style}" ${timing}>${layer.html}</div>`;
  if (layer.kind === 'shape') return `<div class="layer shape-layer" id="${escapeHtml(layer.id)}" style="${style};background:${escapeHtml(layer.metadata?.color || '#ffffff')}"></div>`;
  if (layer.kind === 'caption') return `<div class="layer caption-layer" id="${escapeHtml(layer.id)}" style="${style};display:grid;place-items:center;color:white;font:800 44px/1.08 Inter,system-ui,sans-serif;text-align:center;text-wrap:balance;text-shadow:0 3px 16px #000" ${timing}>${escapeHtml(layer.metadata?.text || layer.label || '')}</div>`;
  const resolved = layer.source ? resolveCreativeAssetPath(storage, layer.source) : { absPath: '' };
  const src = resolved.absPath ? fileUrl(resolved.absPath) : escapeHtml(layer.source || '');
  const objectFit = layer.fit === 'none' ? 'contain' : layer.fit;
  if (layer.kind === 'video') return `<video class="layer video-layer" id="${escapeHtml(layer.id)}" style="${style};object-fit:${objectFit}" ${timing} src="${escapeHtml(src)}" muted playsinline preload="auto"></video>`;
  if (layer.kind === 'image') return `<img class="layer image-layer" id="${escapeHtml(layer.id)}" style="${style};object-fit:${objectFit}" ${timing} src="${escapeHtml(src)}" />`;
  if (layer.kind === 'html-motion' || layer.kind === 'hyperframes') {
    const html = layer.source && resolved.absPath && fs.existsSync(resolved.absPath) ? fs.readFileSync(resolved.absPath, 'utf-8') : '';
    return `<iframe class="layer iframe-layer" id="${escapeHtml(layer.id)}" style="${style};border:0;background:transparent" ${timing} srcdoc="${escapeHtml(html)}"></iframe>`;
  }
  return `<div class="layer" id="${escapeHtml(layer.id)}" style="${style}"></div>`;
}

function buildCompositePreviewHtml(storage: CreativeAssetStorage, normalized: ReturnType<typeof creativeNormalizeLayerSpecs>): string {
  const layerHtml = normalized.layers
    .filter((layer) => layer.kind !== 'audio')
    .map((layer) => layerToHtml(storage, layer, { width: normalized.width, height: normalized.height }))
    .join('\n');
  return `<!doctype html>
<html data-composition-id="guardrail-preview" data-width="${normalized.width}" data-height="${normalized.height}" data-duration="${normalized.durationMs}ms">
<head><meta charset="utf-8"><style>
html,body{margin:0;width:${normalized.width}px;height:${normalized.height}px;overflow:hidden;background:#000}
#stage{position:relative;width:${normalized.width}px;height:${normalized.height}px;overflow:hidden;background:#000}
.layer{box-sizing:border-box}
</style></head>
<body><main id="stage">${layerHtml}</main>
<script>
(() => {
  const TOTAL_MS = ${normalized.durationMs};
  function readMs(node, name, fallback){
    const raw = String(node.dataset[name] || '').trim();
    if (!raw) return fallback;
    const numeric = Number(raw.replace(/ms$/i, '').replace(/s$/i, ''));
    if (!Number.isFinite(numeric)) return fallback;
    return /ms$/i.test(raw) ? numeric : numeric * 1000;
  }
  function visibleAt(node, timeMs){
    const start = readMs(node, 'start', 0);
    const dur = readMs(node, 'duration', TOTAL_MS);
    return timeMs + 0.5 >= start && timeMs < start + dur - 0.5;
  }
  function waitForVideoReady(video){
    if (video.readyState >= 2) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok) => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('loadedmetadata', onReady);
        resolve(ok);
      };
      const onReady = () => done(true);
      const timer = setTimeout(() => done(false), 1200);
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('loadedmetadata', onReady, { once: true });
      try { video.load(); } catch {}
    });
  }
  async function seekVideo(video, targetSeconds){
    try {
      video.pause();
      video.muted = true;
      await waitForVideoReady(video);
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : targetSeconds;
      const safeTarget = Math.max(0, Math.min(Math.max(0, duration - 0.02), targetSeconds));
      if (Math.abs((Number(video.currentTime) || 0) - safeTarget) >= 0.035) {
        await new Promise((resolve) => {
          const done = (ok) => {
            clearTimeout(timer);
            video.removeEventListener('seeked', onSeeked);
            resolve(ok);
          };
          const onSeeked = () => done(true);
          const timer = setTimeout(() => done(false), 1600);
          video.addEventListener('seeked', onSeeked, { once: true });
          try { video.currentTime = safeTarget; } catch { done(false); }
        });
      }
      await new Promise((resolve) => {
        try {
          if (typeof video.requestVideoFrameCallback === 'function') {
            video.requestVideoFrameCallback(() => resolve(true));
            return;
          }
        } catch {}
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      });
    } catch {}
    return true;
  }
  async function seek(timeMs){
    timeMs = Math.max(0, Math.min(TOTAL_MS, Number(timeMs) || 0));
    const pending = [];
    document.querySelectorAll('.layer').forEach((node) => {
      const active = visibleAt(node, timeMs);
      node.style.display = active ? '' : 'none';
      if (node.tagName === 'VIDEO') {
        try {
          node.pause();
          if (active) {
            const start = readMs(node, 'start', 0);
            const mediaStart = readMs(node, 'mediaStart', 0);
            pending.push(seekVideo(node, Math.max(0, (timeMs - start + mediaStart) / 1000)));
          }
        } catch {}
      } else if (node.tagName === 'IFRAME' && active) {
        try {
          const child = node.contentWindow;
          const start = readMs(node, 'start', 0);
          const mediaStart = readMs(node, 'mediaStart', 0);
          const localTimeMs = Math.max(0, timeMs - start + mediaStart);
          child?.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', { detail: { timeMs: localTimeMs, timeSeconds: localTimeMs / 1000 } }));
          if (child?.__promSeek && typeof child.__promSeek === 'function') child.__promSeek(localTimeMs);
          if (child?.__hf && typeof child.__hf.seek === 'function') child.__hf.seek(localTimeMs / 1000);
        } catch {}
      }
    });
    await Promise.all(pending);
    window.__PROMETHEUS_HTML_MOTION_TIME_MS__ = timeMs;
    window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__ = timeMs / 1000;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  window.__hf = { duration: ${normalized.durationMs / 1000}, seek: (seconds) => seek(seconds * 1000) };
  window.__promSeek = seek;
  window.addEventListener('prometheus-html-motion-seek', (event) => {
    window.__promLastSeekPromise = seek(event.detail?.timeMs || 0);
  });
  window.__promLastSeekPromise = seek(0);
})();
</script></body></html>`;
}

export async function creativePreflightOverlay(
  storage: CreativeAssetStorage,
  input: { layers: any[]; width?: number; height?: number; durationMs?: number; strict?: boolean; writePreview?: boolean },
): Promise<{ ok: boolean; issues: LayerIssue[]; normalized: any; complexityScore: number; previewPath: string | null; html: string | null }> {
  const validation = creativeValidateCompositionLayers(storage, input);
  let previewPath: string | null = null;
  let html: string | null = null;
  if (input.writePreview !== false) {
    html = buildCompositePreviewHtml(storage, validation.normalized);
    const dir = path.join(storage.creativeDir, 'composites', 'preflight');
    ensureDir(dir);
    const absPath = path.join(dir, `preflight-${Date.now().toString(36)}.html`);
    ensureInside(storage.rootAbsPath, absPath);
    fs.writeFileSync(absPath, html, 'utf-8');
    previewPath = buildWorkspaceRelativePath(storage.workspacePath, absPath);
  }
  return { ...validation, normalized: validation.normalized, previewPath, html };
}

export async function creativeSampleCompositeFrames(
  storage: CreativeAssetStorage,
  input: { layers: any[]; width?: number; height?: number; durationMs?: number; timestampsMs?: number[]; count?: number },
): Promise<{ ok: boolean; issues: LayerIssue[]; frames: any[]; previewPath: string | null; contactSheet: any | null }> {
  const preflight = await creativePreflightOverlay(storage, { ...input, writePreview: true });
  if (!preflight.previewPath) throw new Error('Could not write composite preview.');
  const absPreview = resolveCreativeAssetPath(storage, preflight.previewPath).absPath;
  if (!absPreview) throw new Error('Could not resolve composite preview.');
  const timestamps = Array.isArray(input.timestampsMs) && input.timestampsMs.length
    ? input.timestampsMs.map((item) => Math.max(0, Math.round(Number(item) || 0)))
    : (() => {
      const count = Math.max(2, Math.min(8, Number(input.count) || 3));
      return Array.from({ length: count }, (_unused, i) => Math.round((preflight.normalized.durationMs * i) / Math.max(1, count - 1)));
    })();
  const outDir = path.join(storage.creativeDir, 'composites', 'samples', id('sample'));
  ensureDir(outDir);
  const playwright = require('playwright');
  const browser = await launchCreativeChromium(playwright);
  const frames = [];
  try {
    const context = await browser.newContext({ viewport: { width: preflight.normalized.width, height: preflight.normalized.height } });
    const page = await context.newPage();
    await page.goto(fileUrl(absPreview));
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    for (let i = 0; i < timestamps.length; i += 1) {
      const timeMs = timestamps[i];
      await page.evaluate((ms: number) => (globalThis as any).__promSeek?.(ms), timeMs);
      await page.waitForTimeout(80);
      const absPath = path.join(outDir, `sample_${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: absPath, type: 'png', animations: 'disabled', caret: 'hide' });
      frames.push({ timestampMs: timeMs, absPath, path: buildWorkspaceRelativePath(storage.workspacePath, absPath) });
    }
    await context.close();
  } finally {
    await browser.close();
  }
  const contactSheet = await makeContactSheet({ storage, framePaths: frames.map((frame) => frame.absPath), outputAbsPath: path.join(outDir, 'contact_sheet.jpg') });
  return { ok: preflight.ok, issues: preflight.issues, frames, previewPath: preflight.previewPath, contactSheet };
}

function motionGraphicHtml(input: {
  mode: string;
  text?: string;
  secondaryText?: string;
  accentColor?: string;
  width: number;
  height: number;
  durationMs: number;
  data?: Record<string, any>;
  asset?: string;
}): { html: string; slots: Record<string, any> } {
  const mode = String(input.mode || 'title_card').trim().toLowerCase();
  const text = escapeHtml(input.text || (mode === 'cta_outro' ? 'Start Today' : 'Launch Ready'));
  const secondary = escapeHtml(input.secondaryText || '');
  const accent = /^#[0-9a-f]{3,8}$/i.test(String(input.accentColor || '')) ? String(input.accentColor) : '#66e3ff';
  const durationSec = input.durationMs / 1000;
  const common = `
html,body{margin:0;width:${input.width}px;height:${input.height}px;overflow:hidden;background:transparent}
#stage{position:relative;width:${input.width}px;height:${input.height}px;overflow:hidden;background:transparent;color:#fff;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.prom-layer{position:absolute;box-sizing:border-box;letter-spacing:0}
.safe{left:6%;right:6%}
`;
  const script = `
<script>
(() => {
  function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
  function seek(ms){
    const t = clamp(ms / ${Math.max(1, input.durationMs)}, 0, 1);
    document.documentElement.style.setProperty('--t', String(t));
    window.__PROMETHEUS_HTML_MOTION_TIME_MS__ = ms;
  }
  window.addEventListener('prometheus-html-motion-seek', e => seek(e.detail?.timeMs || 0));
  window.__hf = { duration: ${durationSec}, seek: (seconds) => seek(seconds * 1000) };
  seek(0);
})();
</script>`;
  let body = '';
  let css = common;
  if (mode === 'captions' || mode === 'subtitle') {
    css += `.caption{bottom:8%;min-height:120px;display:grid;place-items:center;text-align:center;font-weight:900;font-size:clamp(34px,6vw,74px);line-height:1.05;text-shadow:0 6px 30px rgba(0,0,0,.78);transform:translateY(calc((1 - min(var(--t), .18)/.18) * 22px));opacity:min(1,var(--t)*8)}.caption span{background:rgba(0,0,0,.48);padding:.12em .28em;border-radius:8px;box-decoration-break:clone;-webkit-box-decoration-break:clone}`;
    body = `<div class="prom-layer safe caption" data-prom-slot-text="caption"><span>${text}</span></div>`;
  } else if (mode === 'lower_third') {
    css += `.lower{left:5%;bottom:9%;min-width:42%;max-width:74%;padding:22px 26px;border-left:8px solid ${accent};background:linear-gradient(90deg,rgba(0,0,0,.78),rgba(0,0,0,.32));transform:translateX(calc((1 - min(var(--t),.22)/.22) * -80px));opacity:min(1,var(--t)*7)}.name{font-size:48px;font-weight:950;line-height:1}.sub{margin-top:8px;color:${accent};font-size:24px;font-weight:800}`;
    body = `<div class="prom-layer lower"><div class="name" data-prom-slot-text="title">${text}</div><div class="sub" data-prom-slot-text="subtitle">${secondary}</div></div>`;
  } else if (mode === 'hud') {
    const health = Math.max(0, Math.min(100, Number(input.data?.health ?? 74)));
    css += `.hud{inset:5%;border:2px solid ${accent};box-shadow:0 0 28px ${accent}55 inset;opacity:.92}.label{left:28px;top:22px;font-size:30px;font-weight:950;color:${accent}}.bar{left:28px;top:72px;width:260px;height:18px;border:1px solid ${accent};background:rgba(0,0,0,.55)}.fill{height:100%;width:${health}%;background:${accent};transform-origin:left;transform:scaleX(min(1,var(--t)*3))}.readout{right:28px;bottom:22px;font-size:22px;font-weight:800}`;
    body = `<div class="prom-layer hud"><div class="prom-layer label" data-prom-slot-text="title">${text}</div><div class="prom-layer bar"><div class="fill"></div></div><div class="prom-layer readout" data-prom-slot-text="secondary">${secondary || `HP ${health}%`}</div></div>`;
  } else if (mode === 'callout' || mode === 'app_annotation') {
    css += `.call{right:6%;top:16%;max-width:38%;padding:18px 20px;background:rgba(6,12,20,.82);border:2px solid ${accent};border-radius:8px;box-shadow:0 12px 38px rgba(0,0,0,.42);opacity:min(1,var(--t)*7);transform:translateY(calc((1 - min(var(--t),.25)/.25) * 28px))}.call:before{content:'';position:absolute;left:-82px;top:42px;width:82px;border-top:3px solid ${accent}}.call h2{margin:0;font-size:34px;line-height:1}.call p{margin:8px 0 0;color:#dce7f3;font-size:20px;line-height:1.25}`;
    body = `<div class="prom-layer call"><h2 data-prom-slot-text="title">${text}</h2><p data-prom-slot-text="body">${secondary}</p></div>`;
  } else if (mode === 'data_card') {
    css += `.card{right:5%;bottom:8%;width:360px;padding:24px;background:rgba(255,255,255,.92);color:#101820;border-radius:8px;box-shadow:0 18px 60px rgba(0,0,0,.32);opacity:min(1,var(--t)*7);transform:scale(calc(.96 + min(var(--t),.25)*.16))}.k{color:${accent};font-size:18px;font-weight:900;text-transform:uppercase}.v{font-size:58px;font-weight:950;line-height:1}.s{font-size:20px;color:#334155}`;
    body = `<div class="prom-layer card"><div class="k" data-prom-slot-text="kicker">${text}</div><div class="v" data-prom-slot-text="value">${escapeHtml(String((input.data?.value ?? secondary) || '42%'))}</div><div class="s" data-prom-slot-text="body">${secondary}</div></div>`;
  } else {
    css += `.title{inset:0;display:grid;place-items:center;text-align:center;padding:9%;font-weight:950;font-size:clamp(54px,8vw,124px);line-height:.95;text-shadow:0 8px 44px rgba(0,0,0,.62);opacity:min(1,var(--t)*5)}.title span{border-bottom:8px solid ${accent};padding-bottom:.08em}.secondary{position:absolute;left:8%;right:8%;bottom:13%;text-align:center;color:#dbeafe;font-size:clamp(22px,3vw,38px);font-weight:800;opacity:clamp(0,(var(--t)-.22)*5,1)}`;
    body = `<div class="prom-layer title"><span data-prom-slot-text="title">${text}</span></div><div class="prom-layer secondary" data-prom-slot-text="subtitle">${secondary}</div>`;
  }
  return {
    html: `<!doctype html><html data-composition-id="motion-${escapeHtml(mode)}" data-width="${input.width}" data-height="${input.height}" data-duration="${durationSec}s"><head><meta charset="utf-8"><style>${css}</style></head><body><main id="stage" data-composition-id="motion-${escapeHtml(mode)}" data-width="${input.width}" data-height="${input.height}" data-duration="${durationSec}s">${body}</main>${script}</body></html>`,
    slots: { title: input.text || null, subtitle: input.secondaryText || null, accentColor: accent, mode },
  };
}

async function collectCompositeAudioTracks(
  storage: CreativeAssetStorage,
  layers: CreativeLayerSpec[],
  durationMs: number,
): Promise<CreativeAudioTrack[]> {
  const tracks: CreativeAudioTrack[] = [];
  for (const layer of layers || []) {
    if (layer.kind !== 'audio' || !layer.source) continue;
    const metadata = layer.metadata || {};
    const track = await enrichCreativeAudioTrack(storage, {
      source: layer.source,
      label: layer.label || layer.id || 'Audio layer',
      startMs: layer.startMs || 0,
      durationMs: layer.durationMs || durationMs,
      trimStartMs: layer.trimStartMs || 0,
      trimEndMs: layer.trimEndMs || 0,
      volume: Number.isFinite(Number(metadata.volume)) ? Number(metadata.volume) : (Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1),
      muted: metadata.muted === true,
      fadeInMs: Number(metadata.fadeInMs || 0),
      fadeOutMs: Number(metadata.fadeOutMs || 0),
    }, { resolveLocalPath: (raw) => resolveLocalSource(storage, raw).absPath });
    tracks.push(track);
  }
  return tracks;
}

function canStreamCopySingleVideoComposite(normalized: ReturnType<typeof creativeNormalizeLayerSpecs>): CreativeLayerSpec | null {
  const visibleLayers = (normalized.layers || []).filter((layer) => layer.kind !== 'audio');
  if (visibleLayers.length !== 1) return null;
  const layer = visibleLayers[0];
  if (layer.kind !== 'video' || !layer.source) return null;
  if (layer.startMs !== 0) return null;
  if (layer.opacity !== 1 || layer.blendMode !== 'normal') return null;
  if (layer.bounds.x !== 0 || layer.bounds.y !== 0) return null;
  if (Math.round(layer.bounds.width) !== Math.round(normalized.width) || Math.round(layer.bounds.height) !== Math.round(normalized.height)) return null;
  return layer;
}

async function muxAudioOntoExistingVideo(
  storage: CreativeAssetStorage,
  videoSource: string,
  audioTracks: CreativeAudioTrack[],
  outputPath: string,
  format: 'mp4' | 'webm',
): Promise<{ mode: string; inputVideo: string; audioTrackCount: number }> {
  const video = resolveLocalSource(storage, videoSource);
  ensureDir(path.dirname(outputPath));
  if (!audioTracks.length) {
    fs.copyFileSync(video.absPath, outputPath);
    return { mode: 'stream-copy-video', inputVideo: video.relPath, audioTrackCount: 0 };
  }

  const args: string[] = ['-y', '-i', video.absPath];
  const filterParts: string[] = [];
  const audioLabels: string[] = [];
  let inputIndex = 0;
  for (const track of audioTracks) {
    if (!track.source || track.muted) continue;
    const audio = resolveLocalSource(storage, track.source);
    args.push('-i', audio.absPath);
    inputIndex += 1;
    const startMs = Math.max(0, Math.round(Number(track.startMs) || 0));
    const trimStartSec = Math.max(0, Number(track.trimStartMs || 0) / 1000);
    const durationSec = Number(track.durationMs) > 0 ? Math.max(0.01, Number(track.durationMs) / 1000) : null;
    const fadeInSec = Math.max(0, Number(track.fadeInMs || 0) / 1000);
    const fadeOutSec = Math.max(0, Number(track.fadeOutMs || 0) / 1000);
    const volume = Math.max(0, Number.isFinite(Number(track.volume)) ? Number(track.volume) : 1);
    const filters = [
      `atrim=start=${trimStartSec.toFixed(3)}${durationSec ? `:duration=${durationSec.toFixed(3)}` : ''}`,
      'asetpts=PTS-STARTPTS',
      volume !== 1 ? `volume=${volume.toFixed(3)}` : '',
      fadeInSec > 0 ? `afade=t=in:st=0:d=${fadeInSec.toFixed(3)}` : '',
      fadeOutSec > 0 && durationSec ? `afade=t=out:st=${Math.max(0, durationSec - fadeOutSec).toFixed(3)}:d=${fadeOutSec.toFixed(3)}` : '',
      startMs > 0 ? `adelay=${startMs}|${startMs}` : '',
    ].filter(Boolean).join(',');
    filterParts.push(`[${inputIndex}:a]${filters}[a${inputIndex}]`);
    audioLabels.push(`[a${inputIndex}]`);
  }

  if (!audioLabels.length) {
    fs.copyFileSync(video.absPath, outputPath);
    return { mode: 'stream-copy-video', inputVideo: video.relPath, audioTrackCount: 0 };
  }

  const mix = audioLabels.length === 1
    ? `${audioLabels[0]}acopy[aout]`
    : `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[aout]`;
  args.push(
    '-filter_complex', [...filterParts, mix].join(';'),
    '-map', '0:v:0',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', format === 'mp4' ? 'aac' : 'libopus',
    '-b:a', '192k',
    '-shortest',
    ...(format === 'mp4' ? ['-movflags', '+faststart'] : []),
    outputPath,
  );
  await execFileAsync(ffmpegInstaller.path, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 16 });
  return { mode: 'stream-copy-video-audio-mux', inputVideo: video.relPath, audioTrackCount: audioLabels.length };
}

async function renderLayerComposite(
  storage: CreativeAssetStorage,
  input: {
    layers: any[];
    width?: number;
    height?: number;
    durationMs?: number;
    frameRate?: number;
    filename?: string;
    format?: 'mp4' | 'webm';
    strict?: boolean;
    sampleBeforeRender?: boolean;
  },
): Promise<{ outputPath: string; outputRelPath: string; compositionPath: string; preflight: any; samples: any | null; render: any; asset: CreativeAssetRecord | null }> {
  const preflight = await creativePreflightOverlay(storage, { layers: input.layers, width: input.width, height: input.height, durationMs: input.durationMs, strict: input.strict, writePreview: true });
  if (!preflight.ok) throw new Error(`Composite preflight failed: ${preflight.issues.filter((issue: LayerIssue) => issue.severity === 'error').map((issue: LayerIssue) => issue.message).join('; ')}`);
  const format = input.format || 'mp4';
  const outDir = path.join(storage.creativeDir, 'exports');
  ensureDir(outDir);
  const fileName = sanitizeSegment(input.filename || `composite-${Date.now().toString(36)}.${format}`, `composite.${format}`);
  const outputPath = path.join(outDir, fileName.toLowerCase().endsWith(`.${format}`) ? fileName : `${fileName}.${format}`);
  ensureInside(storage.rootAbsPath, outputPath);
  const normalizedLayers = (preflight.normalized.layers || []) as CreativeLayerSpec[];
  const audioTracks = await collectCompositeAudioTracks(storage, normalizedLayers, preflight.normalized.durationMs);
  const streamCopyVideo = canStreamCopySingleVideoComposite(preflight.normalized);
  if (streamCopyVideo) {
    const render = await muxAudioOntoExistingVideo(storage, streamCopyVideo.source!, audioTracks, outputPath, format);
    const compDir = path.join(storage.creativeDir, 'composites', 'manifests');
    ensureDir(compDir);
    const compositionAbsPath = path.join(compDir, `${path.basename(outputPath, path.extname(outputPath))}.json`);
    fs.writeFileSync(compositionAbsPath, JSON.stringify({ layers: normalizedLayers, preflight, samples: null, render, outputPath: buildWorkspaceRelativePath(storage.workspacePath, outputPath) }, null, 2), 'utf-8');
    const asset = await importCreativeAsset(storage, { source: outputPath, tags: ['composite-video'], copy: false });
    return {
      outputPath,
      outputRelPath: buildWorkspaceRelativePath(storage.workspacePath, outputPath),
      compositionPath: buildWorkspaceRelativePath(storage.workspacePath, compositionAbsPath),
      preflight,
      samples: null,
      render,
      asset,
    };
  }
  const samples = input.sampleBeforeRender === false ? null : await creativeSampleCompositeFrames(storage, { layers: input.layers, width: input.width, height: input.height, durationMs: input.durationMs, count: 3 });
  if (samples && !samples.ok) throw new Error('Composite sample preflight failed.');
  const comp = createEmptyComposition({
    width: preflight.normalized.width,
    height: preflight.normalized.height,
    frameRate: Number(input.frameRate) || 30,
    durationMs: preflight.normalized.durationMs,
    background: '#000000',
  });
  comp.audioTracks = audioTracks;
  const trackId = comp.tracks.find((track) => track.kind === 'video')?.id;
  if (!preflight.previewPath) throw new Error('Composite preview path was not written.');
  addClip(comp, {
    trackId,
    lane: 'html-motion',
    source: { kind: 'html-motion', clipPath: preflight.previewPath, compositionId: 'guardrail-preview' },
    atMs: 0,
    durationMs: preflight.normalized.durationMs,
    label: 'Composite',
  });
  const render = await renderComposition({ composition: comp, workspacePath: storage.workspacePath, outputPath, format });
  const compDir = path.join(storage.creativeDir, 'composites', 'manifests');
  ensureDir(compDir);
  const compositionAbsPath = path.join(compDir, `${path.basename(outputPath, path.extname(outputPath))}.json`);
  fs.writeFileSync(compositionAbsPath, JSON.stringify({ layers: preflight.normalized.layers, composition: comp, preflight, samples, render, outputPath: buildWorkspaceRelativePath(storage.workspacePath, outputPath) }, null, 2), 'utf-8');
  const asset = await importCreativeAsset(storage, { source: outputPath, tags: ['composite-video'], copy: false });
  return {
    outputPath,
    outputRelPath: buildWorkspaceRelativePath(storage.workspacePath, outputPath),
    compositionPath: buildWorkspaceRelativePath(storage.workspacePath, compositionAbsPath),
    preflight,
    samples,
    render,
    asset,
  };
}

export async function creativeGenerateMotionGraphicsLayer(
  storage: CreativeAssetStorage,
  input: {
    mode?: 'captions' | 'lower_third' | 'callout' | 'hud' | 'data_card' | 'logo_intro' | 'cta_outro' | 'subtitle' | 'app_annotation' | 'title_card';
    text?: string;
    secondaryText?: string;
    accentColor?: string;
    startMs?: number;
    durationMs?: number;
    width?: number;
    height?: number;
    targetRegion?: any;
    data?: Record<string, any>;
    asset?: string;
    filename?: string;
    sample?: boolean;
  },
): Promise<{ layer: CreativeLayerSpec; htmlPath: string; absHtmlPath: string; html: string; slots: Record<string, any>; preflight: any; samples: any | null }> {
  const width = Math.max(120, Math.round(Number(input.width) || 1280));
  const height = Math.max(120, Math.round(Number(input.height) || 720));
  const durationMs = Math.max(250, Math.round(Number(input.durationMs) || 4000));
  const generated = motionGraphicHtml({
    mode: input.mode || 'title_card',
    text: input.text,
    secondaryText: input.secondaryText,
    accentColor: input.accentColor,
    width,
    height,
    durationMs,
    data: input.data,
    asset: input.asset,
  });
  const outDir = path.join(storage.creativeDir, 'motion-graphics');
  ensureDir(outDir);
  const fileName = sanitizeSegment(input.filename || `${input.mode || 'title-card'}-${Date.now().toString(36)}.html`, 'motion-graphic.html');
  const absHtmlPath = path.join(outDir, fileName.toLowerCase().endsWith('.html') ? fileName : `${fileName}.html`);
  ensureInside(storage.rootAbsPath, absHtmlPath);
  fs.writeFileSync(absHtmlPath, generated.html, 'utf-8');
  const htmlPath = buildWorkspaceRelativePath(storage.workspacePath, absHtmlPath);
  const bounds = normalizeBounds(input.targetRegion || { x: 0, y: 0, width, height }, width, height);
  const normalized = creativeNormalizeLayerSpecs({
    width,
    height,
    durationMs,
    layers: [{
      id: `motion-${sanitizeSegment(input.mode || 'title')}`,
      kind: 'html-motion',
      source: htmlPath,
      label: input.text || input.mode || 'Motion graphic',
      startMs: Number(input.startMs) || 0,
      durationMs,
      zIndex: 600,
      bounds,
      editableSlots: generated.slots,
      metadata: { mode: input.mode || 'title_card', sourceTool: 'creative_generate_motion_graphics_layer' },
    }],
  });
  const layer = normalized.layers[0];
  const preflight = await creativePreflightOverlay(storage, { layers: [layer], width, height, durationMs, writePreview: true });
  if (!preflight.ok) throw new Error(`Generated motion layer failed preflight: ${preflight.issues.filter((issue: LayerIssue) => issue.severity === 'error').map((issue: LayerIssue) => issue.message).join('; ')}`);
  const samples = input.sample === false ? null : await creativeSampleCompositeFrames(storage, { layers: [layer], width, height, durationMs, count: 3 });
  return { layer, htmlPath, absHtmlPath, html: generated.html, slots: generated.slots, preflight, samples };
}

export async function creativeOverlayHyperframesOnVideo(
  storage: CreativeAssetStorage,
  input: {
    baseVideo: string;
    overlayHtml?: string;
    overlayPath?: string;
    startMs?: number;
    durationMs?: number;
    position?: 'full' | 'top' | 'bottom' | 'custom';
    bounds?: any;
    blendMode?: CreativeLayerSpec['blendMode'];
    opacity?: number;
    width?: number;
    height?: number;
    frameRate?: number;
    outputFilename?: string;
    format?: 'mp4' | 'webm';
    sampleBeforeRender?: boolean;
  },
): Promise<any> {
  if (!input.baseVideo) throw new Error('creative_overlay_hyperframes_on_video requires baseVideo.');
  const baseAsset = await analyzeCreativeAsset(storage, { source: input.baseVideo, tags: ['overlay-base-video'], upsert: true });
  if (baseAsset.kind !== 'video') throw new Error(`baseVideo must be video, received ${baseAsset.kind}.`);
  const width = Math.max(120, Math.round(Number(input.width) || Number(baseAsset.width) || 1280));
  const height = Math.max(120, Math.round(Number(input.height) || Number(baseAsset.height) || 720));
  const durationMs = Math.max(100, Math.round(Number(input.durationMs) || Number(baseAsset.durationMs) || 6000));
  let overlaySource = input.overlayPath || '';
  if (input.overlayHtml && !overlaySource) {
    const dir = path.join(storage.creativeDir, 'motion-graphics', 'inline-overlays');
    ensureDir(dir);
    const absPath = path.join(dir, `overlay-${Date.now().toString(36)}.html`);
    ensureInside(storage.rootAbsPath, absPath);
    fs.writeFileSync(absPath, input.overlayHtml, 'utf-8');
    overlaySource = buildWorkspaceRelativePath(storage.workspacePath, absPath);
  }
  if (!overlaySource) throw new Error('Overlay requires overlayHtml or overlayPath.');
  const position = input.position || 'full';
  const bounds = input.bounds || (
    position === 'top' ? { x: 0, y: 0, width, height: Math.round(height * 0.34) } :
    position === 'bottom' ? { x: 0, y: Math.round(height * 0.66), width, height: Math.round(height * 0.34) } :
    { x: 0, y: 0, width, height }
  );
  const layers = [
    { id: 'base-video', kind: 'video', source: baseAsset.path || baseAsset.relativePath || input.baseVideo, startMs: 0, durationMs, zIndex: 0, bounds: { x: 0, y: 0, width, height }, fit: 'cover' },
    { id: 'overlay', kind: 'html-motion', source: overlaySource, startMs: Number(input.startMs) || 0, durationMs, zIndex: 600, bounds, blendMode: input.blendMode || 'normal', opacity: Number.isFinite(Number(input.opacity)) ? Number(input.opacity) : 1 },
  ];
  return renderLayerComposite(storage, {
    layers,
    width,
    height,
    durationMs,
    frameRate: input.frameRate,
    filename: input.outputFilename,
    format: input.format,
    sampleBeforeRender: input.sampleBeforeRender,
    strict: true,
  });
}

export async function creativeCompositeVideoLayers(
  storage: CreativeAssetStorage,
  input: {
    layers: any[];
    width?: number;
    height?: number;
    durationMs?: number;
    frameRate?: number;
    filename?: string;
    format?: 'mp4' | 'webm';
    sampleBeforeRender?: boolean;
    strict?: boolean;
    audioLayer?: any;
  },
): Promise<any> {
  const layers = Array.isArray(input.layers) ? [...input.layers] : [];
  if (input.audioLayer) layers.push({ ...input.audioLayer, kind: 'audio', zIndex: -1 });
  if (!layers.length) throw new Error('creative_composite_video_layers requires at least one layer.');
  return renderLayerComposite(storage, {
    layers,
    width: input.width,
    height: input.height,
    durationMs: input.durationMs,
    frameRate: input.frameRate,
    filename: input.filename,
    format: input.format,
    sampleBeforeRender: input.sampleBeforeRender,
    strict: input.strict !== false,
  });
}

function providerConfig(providerId: string): any {
  const raw = getConfig().getConfig() as any;
  const providers = raw?.llm?.providers && typeof raw.llm.providers === 'object' ? raw.llm.providers : {};
  const cfg = providers?.[providerId];
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

function providerSecret(providerId: string, field = 'api_key'): string {
  const value = providerConfig(providerId)?.[field];
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  if (trimmed.startsWith('env:')) return String(process.env[trimmed.slice(4)] || '').trim();
  try {
    return String(getConfig().resolveSecret(trimmed) || '').trim();
  } catch {
    return '';
  }
}

function providerApiKey(providerId: string, envNames: string[]): string {
  for (const envName of envNames) {
    const key = String(process.env[envName] || '').trim();
    if (key) return key;
  }
  return providerSecret(providerId, 'api_key');
}

function openAiVoiceKey(): string {
  return providerApiKey('openai', ['OPENAI_REALTIME_API_KEY', 'OPENAI_API_KEY', 'VOICE_TOOLS_OPENAI_KEY']);
}

async function openAiVoiceAuthCandidates(): Promise<Array<{ token: string; auth: 'api_key' | 'openai_oauth_api_key' | 'openai_oauth_access_token' }>> {
  const candidates: Array<{ token: string; auth: 'api_key' | 'openai_oauth_api_key' | 'openai_oauth_access_token' }> = [];
  const explicit = openAiVoiceKey();
  if (explicit) candidates.push({ token: explicit, auth: 'api_key' });

  const configDir = getConfig().getConfigDir();
  const tokens = loadOpenAiTokens(configDir);
  if (tokens?.api_key && !candidates.some((candidate) => candidate.token === tokens.api_key)) {
    candidates.push({ token: tokens.api_key, auth: 'openai_oauth_api_key' });
  }
  if (tokens?.access_token) {
    try {
      const accessToken = await getValidOpenAiToken(configDir);
      if (accessToken && !candidates.some((candidate) => candidate.token === accessToken)) {
        candidates.push({ token: accessToken, auth: 'openai_oauth_access_token' });
      }
    } catch {
      // The final error below will report that OpenAI voice auth is unavailable.
    }
  }
  return candidates;
}

const OPENAI_CREATIVE_TTS_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);

function normalizeOpenAiTtsVoice(value: string | undefined): string {
  const requested = String(value || process.env.OPENAI_TTS_VOICE || 'alloy').trim();
  return OPENAI_CREATIVE_TTS_VOICES.has(requested) ? requested : 'alloy';
}

function xaiVoiceKey(): string {
  const key = providerApiKey('xai', ['XAI_API_KEY']);
  return /^xai-[A-Za-z0-9_-]+/.test(key) ? key : '';
}

async function xaiVoiceAuthToken(): Promise<string> {
  const key = xaiVoiceKey();
  if (key) return key;
  if (!isXAIConnected(getConfig().getConfigDir())) return '';
  return getValidXAIToken(getConfig().getConfigDir());
}

function xaiVoiceBaseUrl(): string {
  const configured = String(providerConfig('xai')?.endpoint || process.env.XAI_TTS_ENDPOINT || process.env.XAI_STT_ENDPOINT || process.env.XAI_ENDPOINT || 'https://api.x.ai/v1').trim();
  return (configured || 'https://api.x.ai/v1').replace(/\/+$/, '');
}

function normalizeVoiceId(raw: any): string {
  return String(raw?.id || raw?.voice_id || raw?.name || raw || '').trim();
}

async function listXaiVoiceIds(key: string): Promise<string[]> {
  try {
    const response = await fetch(`${xaiVoiceBaseUrl()}/tts/voices`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        'User-Agent': process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0',
      },
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) return [];
    const raw = Array.isArray(data?.voices) ? data.voices : Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return raw.map(normalizeVoiceId).filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveXaiVoiceId(key: string, requested?: string): Promise<{ voice: string; available: string[]; substituted: boolean }> {
  const fallback = ['eve', 'ara', 'rex', 'sal', 'leo'];
  const available = [...new Set([...(await listXaiVoiceIds(key)), ...fallback])];
  const preferred = String(requested || process.env.XAI_TTS_VOICE || '').trim();
  if (preferred && available.includes(preferred)) return { voice: preferred, available, substituted: false };
  const envVoice = String(process.env.XAI_TTS_VOICE || '').trim();
  if (envVoice && available.includes(envVoice)) return { voice: envVoice, available, substituted: !!preferred };
  return { voice: available[0] || 'eve', available, substituted: !!preferred };
}

function audioExtensionForMime(mimeType: string, fallback = '.mp3'): string {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('webm')) return '.webm';
  return fallback;
}

async function fetchBinaryOrThrow(url: string, init: any): Promise<{ buffer: Buffer; mimeType: string; status: number; text: string }> {
  const response = await fetch(url, init);
  const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim();
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const text = mimeType.includes('json') || mimeType.includes('text') ? buffer.toString('utf-8') : '';
  if (!response.ok) throw new Error(text || `Request failed (${response.status})`);
  return { buffer, mimeType, status: response.status, text };
}

async function writeGeneratedAudio(storage: CreativeAssetStorage, buffer: Buffer, mimeType: string, filename: string): Promise<{ absPath: string; relPath: string }> {
  const outDir = path.join(storage.creativeDir, 'audio', 'generated');
  ensureDir(outDir);
  const ext = audioExtensionForMime(mimeType);
  const safe = sanitizeSegment(filename || `voiceover-${Date.now().toString(36)}${ext}`, `voiceover${ext}`);
  const absPath = path.join(outDir, safe.toLowerCase().endsWith(ext) ? safe : `${safe}${ext}`);
  ensureInside(storage.rootAbsPath, absPath);
  fs.writeFileSync(absPath, buffer);
  return { absPath, relPath: buildWorkspaceRelativePath(storage.workspacePath, absPath) };
}

function normalizeAudioTags(tags: any, defaults: string[] = []): string[] {
  const raw = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(['audio', ...defaults, ...raw.map((tag) => String(tag || '').trim()).filter(Boolean)])];
}

async function importAndRegisterAudio(
  storage: CreativeAssetStorage,
  input: {
    source: string;
    label?: string;
    tags?: any;
    generationPrompt?: string | null;
    provider?: string | null;
    model?: string | null;
    mode?: string | null;
    shotId?: string | null;
    parentGenerationId?: string | null;
    parentAssetId?: string | null;
    metadata?: Record<string, any>;
    copy?: boolean;
  },
): Promise<{ asset: CreativeAssetRecord; audioTrack: CreativeAudioTrack; analysis: any; generation: CreativeGenerationRecord }> {
  const asset = await importCreativeAsset(storage, {
    source: input.source,
    tags: normalizeAudioTags(input.tags),
    copy: input.copy !== false,
  });
  if (asset.kind !== 'audio') throw new Error(`Audio import expected an audio file, received ${asset.kind}.`);
  const source = asset.path || asset.relativePath || input.source;
  const audioTrack = await enrichCreativeAudioTrack(storage, {
    source,
    label: input.label || asset.name || 'Creative audio',
    startMs: 0,
    durationMs: Number(asset.durationMs) || 0,
    volume: 1,
  }, { resolveLocalPath: (raw) => resolveLocalSource(storage, raw).absPath, forceAnalysis: true });
  const registered = await creativeRegisterGeneration(storage, {
    kind: 'audio',
    shotId: input.shotId || null,
    prompt: input.generationPrompt || null,
    provider: input.provider || null,
    model: input.model || null,
    mode: input.mode || 'audio_import',
    parentGenerationId: input.parentGenerationId || null,
    parentAssetId: input.parentAssetId || null,
    outputPath: source,
    outputAssetId: asset.id,
    metadata: { ...(input.metadata || {}), analysis: audioTrack.analysis },
  });
  return { asset, audioTrack, analysis: audioTrack.analysis, generation: registered.generation };
}

function attachAudioToProject(storage: CreativeAssetStorage, projectId: string | undefined, payload: any): CreativeProjectDoc | null {
  if (!projectId) return null;
  const project = creativeGetProject(storage, { projectId });
  const audioTracks = Array.isArray(project.audioTracks) ? project.audioTracks : [];
  project.audioTracks = [...audioTracks, payload];
  project.updatedAt = nowIso();
  writeProject(storage, project);
  return project;
}

export async function creativeImportAudio(
  storage: CreativeAssetStorage,
  input: { source: string; label?: string; tags?: any; projectId?: string; shotId?: string; copy?: boolean },
): Promise<{ asset: CreativeAssetRecord; audioTrack: CreativeAudioTrack; analysis: any; generation: CreativeGenerationRecord; project: CreativeProjectDoc | null }> {
  if (!input.source) throw new Error('creative_import_audio requires source.');
  const imported = await importAndRegisterAudio(storage, {
    source: input.source,
    label: input.label,
    tags: input.tags,
    shotId: input.shotId || null,
    mode: 'audio_import',
    copy: input.copy !== false,
  });
  const project = attachAudioToProject(storage, input.projectId, { kind: 'imported_audio', assetId: imported.asset.id, track: imported.audioTrack, generationId: imported.generation.id, createdAt: nowIso() });
  return { ...imported, project };
}

export async function creativeDownloadAudio(
  storage: CreativeAssetStorage,
  input: { url: string; label?: string; tags?: any; projectId?: string; shotId?: string; outputDir?: string },
): Promise<{ download: any; asset: CreativeAssetRecord; audioTrack: CreativeAudioTrack; analysis: any; generation: CreativeGenerationRecord; project: CreativeProjectDoc | null }> {
  if (!input.url) throw new Error('creative_download_audio requires url.');
  const outputDir = input.outputDir || buildWorkspaceRelativePath(storage.workspacePath, path.join(storage.creativeDir, 'audio', 'downloads'));
  const download = await executeDownloadMedia({ url: input.url, output_dir: outputDir, audio_only: true });
  if (!download.success) throw new Error(download.error || 'Audio download failed.');
  const files = Array.isArray((download as any).data?.files) ? (download as any).data.files : [];
  const first = files.find((file: any) => file?.path || file?.rel_path);
  if (!first) throw new Error('Audio download completed but no file path was returned.');
  const imported = await importAndRegisterAudio(storage, {
    source: first.path || first.rel_path,
    label: input.label,
    tags: normalizeAudioTags(input.tags, ['downloaded-audio']),
    shotId: input.shotId || null,
    provider: 'yt-dlp',
    mode: 'audio_download',
    metadata: { url: input.url, download: (download as any).data },
  });
  const project = attachAudioToProject(storage, input.projectId, { kind: 'downloaded_audio', url: input.url, assetId: imported.asset.id, track: imported.audioTrack, generationId: imported.generation.id, createdAt: nowIso() });
  return { download: (download as any).data, ...imported, project };
}

export async function creativeExtractAudioFromVideo(
  storage: CreativeAssetStorage,
  input: { source: string; filename?: string; format?: 'mp3' | 'wav' | 'm4a'; label?: string; tags?: any; projectId?: string; shotId?: string },
): Promise<{ outputPath: string; asset: CreativeAssetRecord; audioTrack: CreativeAudioTrack; analysis: any; generation: CreativeGenerationRecord; project: CreativeProjectDoc | null }> {
  if (!input.source) throw new Error('creative_extract_audio_from_video requires source.');
  const video = resolveLocalSource(storage, input.source);
  const outDir = path.join(storage.creativeDir, 'audio', 'extracted');
  ensureDir(outDir);
  const format = input.format || 'mp3';
  const ext = `.${format}`;
  const safe = sanitizeSegment(input.filename || `${path.basename(video.absPath, path.extname(video.absPath))}-audio${ext}`, `extracted-audio${ext}`);
  const outputPath = path.join(outDir, safe.toLowerCase().endsWith(ext) ? safe : `${safe}${ext}`);
  ensureInside(storage.rootAbsPath, outputPath);
  const codecArgs = format === 'wav' ? ['-ac', '2', '-ar', '48000'] : format === 'm4a' ? ['-c:a', 'aac', '-b:a', '192k'] : ['-codec:a', 'libmp3lame', '-q:a', '2'];
  await execFileAsync(ffmpegInstaller.path, ['-y', '-i', video.absPath, '-vn', ...codecArgs, outputPath], { windowsHide: true, maxBuffer: 1024 * 1024 * 16 });
  const imported = await importAndRegisterAudio(storage, {
    source: outputPath,
    label: input.label,
    tags: normalizeAudioTags(input.tags, ['extracted-audio']),
    shotId: input.shotId || null,
    mode: 'audio_extract',
    metadata: { sourceVideo: video.relPath, format },
    copy: false,
  });
  const project = attachAudioToProject(storage, input.projectId, { kind: 'extracted_audio', sourceVideo: video.relPath, assetId: imported.asset.id, track: imported.audioTrack, generationId: imported.generation.id, createdAt: nowIso() });
  return { outputPath: buildWorkspaceRelativePath(storage.workspacePath, outputPath), ...imported, project };
}

export async function creativeGenerateVoiceover(
  storage: CreativeAssetStorage,
  input: { text: string; provider?: 'auto' | 'openai' | 'openai_realtime' | 'xai'; voice?: string; language?: string; speed?: number; filename?: string; projectId?: string; shotId?: string; tags?: any },
): Promise<{ outputPath: string; asset: CreativeAssetRecord; audioTrack: CreativeAudioTrack; analysis: any; generation: CreativeGenerationRecord; project: CreativeProjectDoc | null }> {
  const text = String(input.text || '').trim();
  if (!text) throw new Error('creative_generate_voiceover requires text.');
  if (text.length > 6000) throw new Error('Voiceover text is too long for a single generation. Split it into sections under 6000 characters.');
  const requestedProvider = input.provider || 'auto';
  let provider: 'openai' | 'xai' = requestedProvider === 'xai' ? 'xai' : 'openai';
  if (requestedProvider === 'auto') {
    provider = (await openAiVoiceAuthCandidates()).length ? 'openai' : ((await xaiVoiceAuthToken()) ? 'xai' : 'openai');
  }
  let buffer: Buffer;
  let mimeType = 'audio/mpeg';
  let model: string;
  let selectedVoice = input.voice || null;
  let voiceMetadata: Record<string, any> = {};
  if (provider === 'xai') {
    const key = await xaiVoiceAuthToken();
    if (!key) throw new Error('xAI voice is not configured. Connect xAI OAuth or add XAI_API_KEY.');
    model = process.env.XAI_TTS_MODEL || 'grok-2-tts';
    const resolvedVoice = await resolveXaiVoiceId(key, input.voice);
    selectedVoice = resolvedVoice.voice;
    voiceMetadata = {
      requestedVoice: input.voice || null,
      selectedVoice: resolvedVoice.voice,
      substitutedVoice: resolvedVoice.substituted,
      availableVoiceCount: resolvedVoice.available.length,
    };
    const result = await fetchBinaryOrThrow(`${xaiVoiceBaseUrl()}/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0',
      },
      body: JSON.stringify({
        text,
        voice_id: resolvedVoice.voice,
        language: input.language || process.env.XAI_TTS_LANGUAGE || 'en',
        ...(Number.isFinite(Number(input.speed)) ? { speed: Math.max(0.5, Math.min(2, Number(input.speed))) } : {}),
      }),
    });
    buffer = result.buffer;
    mimeType = result.mimeType.includes('audio/') ? result.mimeType : 'audio/mpeg';
  } else {
    const candidates = await openAiVoiceAuthCandidates();
    if (!candidates.length) throw new Error('OpenAI voice is not configured. Add OPENAI_API_KEY/OPENAI_REALTIME_API_KEY, connect OpenAI OAuth, or configure the OpenAI provider.');
    model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
    const voice = normalizeOpenAiTtsVoice(input.voice);
    selectedVoice = voice;
    voiceMetadata = { requestedVoice: input.voice || null, selectedVoice: voice, substitutedVoice: !!input.voice && input.voice !== voice };
    let result: { buffer: Buffer; mimeType: string; status: number; text: string } | null = null;
    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        result = await fetchBinaryOrThrow('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: `Bearer ${candidate.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            voice,
            input: text,
            response_format: 'mp3',
            ...(Number.isFinite(Number(input.speed)) ? { speed: Math.max(0.25, Math.min(4, Number(input.speed))) } : {}),
          }),
        });
        break;
      } catch (err: any) {
        failures.push(`${candidate.auth}: ${String(err?.message || err).slice(0, 240)}`);
      }
    }
    if (!result) throw new Error(`OpenAI voice synthesis failed with all configured auth bridges. ${failures.join(' | ')}`);
    buffer = result.buffer;
    mimeType = 'audio/mpeg';
  }
  if (!buffer.length) throw new Error(`${provider} returned empty voiceover audio.`);
  const written = await writeGeneratedAudio(storage, buffer, mimeType, input.filename || `voiceover-${Date.now().toString(36)}`);
  const imported = await importAndRegisterAudio(storage, {
    source: written.absPath,
    label: input.filename || 'Generated voiceover',
    tags: normalizeAudioTags(input.tags, ['voiceover', provider]),
    shotId: input.shotId || null,
    generationPrompt: text,
    provider: requestedProvider,
    model,
    mode: 'voiceover',
    metadata: { text, voice: selectedVoice, language: input.language || null, speed: input.speed || null, ...voiceMetadata },
    copy: false,
  });
  const project = attachAudioToProject(storage, input.projectId, { kind: 'voiceover', text, provider: requestedProvider, voice: selectedVoice, assetId: imported.asset.id, track: imported.audioTrack, generationId: imported.generation.id, createdAt: nowIso() });
  return { outputPath: written.relPath, ...imported, project };
}

export async function creativeTranscribeAudio(
  storage: CreativeAssetStorage,
  input: { source: string; provider?: 'openai' | 'xai'; language?: string; filename?: string },
): Promise<{ provider: string; text: string; raw: any; analysis: any }> {
  if (!input.source) throw new Error('creative_transcribe_audio requires source.');
  const source = resolveLocalSource(storage, input.source);
  const audio = fs.readFileSync(source.absPath);
  const provider = input.provider || 'openai';
  const filename = input.filename || path.basename(source.absPath);
  let response: Response;
  const form = new (globalThis as any).FormData();
  form.append('file', new (globalThis as any).Blob([audio], { type: 'audio/mpeg' }), filename);
  if (input.language) form.append('language', input.language);
  if (provider === 'xai') {
    const key = await xaiVoiceAuthToken();
    if (!key) throw new Error('xAI transcription is not configured. Connect xAI OAuth or add XAI_API_KEY.');
    form.append('model', process.env.XAI_STT_MODEL || 'grok-stt');
    response = await fetch(`${xaiVoiceBaseUrl()}/stt`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'User-Agent': process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0' }, body: form as any });
  } else {
    const candidates = await openAiVoiceAuthCandidates();
    if (!candidates.length) throw new Error('OpenAI transcription is not configured. Add OPENAI_API_KEY/OPENAI_REALTIME_API_KEY, connect OpenAI OAuth, or configure the OpenAI provider.');
    form.append('model', process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe');
    const failures: string[] = [];
    let okResponse: Response | null = null;
    for (const candidate of candidates) {
      const retryForm = new (globalThis as any).FormData();
      retryForm.append('file', new (globalThis as any).Blob([audio], { type: 'audio/mpeg' }), filename);
      if (input.language) retryForm.append('language', input.language);
      retryForm.append('model', process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe');
      const attempt = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${candidate.token}` }, body: retryForm as any });
      if (attempt.ok) {
        okResponse = attempt;
        break;
      }
      const errText = await attempt.text().catch(() => '');
      failures.push(`${candidate.auth}: ${errText.slice(0, 240) || attempt.status}`);
    }
    if (!okResponse) throw new Error(`OpenAI transcription failed with all configured auth bridges. ${failures.join(' | ')}`);
    response = okResponse;
  }
  const data: any = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || data?.message || `${provider} transcription failed (${response.status})`);
  const analysis = await analyzeCreativeAudioSource({ storage, source: source.relPath, resolveLocalPath: (raw) => resolveLocalSource(storage, raw).absPath, force: true });
  return { provider, text: String(data?.text || data?.transcript || '').trim(), raw: data, analysis };
}

export async function creativeSyncCaptionsToAudio(
  storage: CreativeAssetStorage,
  input: { transcript?: string; segments?: Array<{ text: string; startMs?: number; endMs?: number; start?: number; end?: number }>; audioSource?: string; width?: number; height?: number; durationMs?: number; style?: string; filename?: string; projectId?: string },
): Promise<{ layer: CreativeLayerSpec; htmlPath: string; absHtmlPath: string; segments: any[]; project: CreativeProjectDoc | null; samples: any | null }> {
  const durationMs = Math.max(500, Math.round(Number(input.durationMs) || (input.audioSource ? (await analyzeCreativeAudioSource({ storage, source: input.audioSource, resolveLocalPath: (raw) => resolveLocalSource(storage, raw).absPath })).durationMs || 6000 : 6000)));
  let segments = Array.isArray(input.segments) ? input.segments.map((segment, index) => ({
    id: `caption-${index + 1}`,
    text: String(segment.text || '').trim(),
    startMs: Number.isFinite(Number(segment.startMs)) ? Number(segment.startMs) : Math.round(Number(segment.start || 0) * 1000),
    endMs: Number.isFinite(Number(segment.endMs)) ? Number(segment.endMs) : Math.round(Number(segment.end || 0) * 1000),
  })).filter((segment) => segment.text) : [];
  if (!segments.length) {
    const words = String(input.transcript || '').trim().split(/\s+/).filter(Boolean);
    const chunkSize = 7;
    segments = [];
    for (let i = 0; i < words.length; i += chunkSize) {
      const startMs = Math.round((i / Math.max(1, words.length)) * durationMs);
      const endMs = Math.round((Math.min(words.length, i + chunkSize) / Math.max(1, words.length)) * durationMs);
      segments.push({ id: `caption-${segments.length + 1}`, text: words.slice(i, i + chunkSize).join(' '), startMs, endMs: Math.max(startMs + 350, endMs) });
    }
  }
  if (!segments.length) throw new Error('creative_sync_captions_to_audio requires transcript or segments.');
  const width = Math.max(120, Math.round(Number(input.width) || 1280));
  const height = Math.max(120, Math.round(Number(input.height) || 720));
  const segmentsJson = JSON.stringify(segments).replace(/</g, '\\u003c');
  const html = `<!doctype html><html data-composition-id="captions" data-width="${width}" data-height="${height}" data-duration="${durationMs / 1000}s"><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:Inter,Arial,sans-serif}.cap{position:absolute;left:8%;right:8%;bottom:8%;text-align:center;font-weight:950;font-size:clamp(32px,5vw,76px);line-height:1.05;color:#fff;text-shadow:0 4px 22px rgba(0,0,0,.8);letter-spacing:0}.cap span{box-decoration-break:clone;-webkit-box-decoration-break:clone;background:rgba(0,0,0,.58);padding:.08em .22em;border-radius:8px}</style></head><body><div class="cap"><span id="caption"></span></div><script>const segments=${segmentsJson};const el=document.getElementById('caption');function setFrame(ms){ms=Math.max(0,Number(ms)||0);window.__PROMETHEUS_HTML_MOTION_TIME_MS__=ms;window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__=ms/1000;const hit=segments.find(s=>ms>=s.startMs&&ms<s.endMs);el.textContent=hit?hit.text:'';}window.__prometheusSetTime=(ms)=>setFrame(ms);window.__promSeek=(ms)=>setFrame(ms);window.__hf={duration:${durationMs / 1000},seek:(seconds)=>setFrame(seconds*1000)};window.addEventListener('prometheus-html-motion-seek',(event)=>setFrame(event.detail?.timeMs||0));setFrame(0);</script></body></html>`;
  const dir = path.join(storage.creativeDir, 'motion-graphics', 'captions');
  ensureDir(dir);
  const captionFileName = sanitizeSegment(input.filename || `captions-${Date.now().toString(36)}.html`, 'captions.html');
  const absHtmlPath = path.join(dir, captionFileName.toLowerCase().endsWith('.html') ? captionFileName : `${captionFileName}.html`);
  ensureInside(storage.rootAbsPath, absHtmlPath);
  fs.writeFileSync(absHtmlPath, html, 'utf-8');
  const htmlPath = buildWorkspaceRelativePath(storage.workspacePath, absHtmlPath);
  const layer = creativeNormalizeLayerSpecs({ width, height, durationMs, layers: [{ id: 'captions', kind: 'html-motion', source: htmlPath, startMs: 0, durationMs, zIndex: 800, bounds: { x: 0, y: 0, width, height }, label: 'Synced captions', editableSlots: { segments } }] }).layers[0];
  const samples = await creativeSampleCompositeFrames(storage, { layers: [layer], width, height, durationMs, count: 3 });
  let project: CreativeProjectDoc | null = null;
  if (input.projectId) {
    project = creativeGetProject(storage, { projectId: input.projectId });
    project.captions = [...(Array.isArray(project.captions) ? project.captions : []), { layer, htmlPath, segments, createdAt: nowIso() }];
    writeProject(storage, project);
  }
  return { layer, htmlPath, absHtmlPath, segments, project, samples };
}

export async function creativeAddAudioTrack(
  storage: CreativeAssetStorage,
  input: { source: string; label?: string; startMs?: number; durationMs?: number; trimStartMs?: number; trimEndMs?: number; volume?: number; muted?: boolean; fadeInMs?: number; fadeOutMs?: number; projectId?: string },
): Promise<{ audioTrack: CreativeAudioTrack; project: CreativeProjectDoc | null }> {
  if (!input.source) throw new Error('creative_add_audio_track requires source.');
  const track = await enrichCreativeAudioTrack(storage, {
    source: input.source,
    label: input.label || path.basename(input.source),
    startMs: input.startMs || 0,
    durationMs: input.durationMs || 0,
    trimStartMs: input.trimStartMs || 0,
    trimEndMs: input.trimEndMs || 0,
    volume: Number.isFinite(Number(input.volume)) ? Number(input.volume) : 1,
    muted: input.muted === true,
    fadeInMs: input.fadeInMs || 0,
    fadeOutMs: input.fadeOutMs || 0,
  }, { resolveLocalPath: (raw) => resolveLocalSource(storage, raw).absPath, forceAnalysis: true });
  const project = attachAudioToProject(storage, input.projectId, { kind: 'timeline_audio', track, createdAt: nowIso() });
  return { audioTrack: track, project };
}

export async function creativeMixAudioTracks(
  storage: CreativeAssetStorage,
  input: { tracks: any[]; filename?: string; format?: 'mp3' | 'wav' | 'm4a'; projectId?: string },
): Promise<{ outputPath: string; audioTrack: CreativeAudioTrack; asset: CreativeAssetRecord; project: CreativeProjectDoc | null; ffmpeg: any }> {
  const tracks = await Promise.all((Array.isArray(input.tracks) ? input.tracks : []).map((track) => enrichCreativeAudioTrack(storage, track, { resolveLocalPath: (raw) => resolveLocalSource(storage, raw).absPath })));
  const active = tracks.filter((track) => track.source && !track.muted);
  if (!active.length) throw new Error('creative_mix_audio_tracks requires at least one unmuted track.');
  const outDir = path.join(storage.creativeDir, 'audio', 'mixes');
  ensureDir(outDir);
  const format = input.format || 'mp3';
  const outputAbsPath = path.join(outDir, sanitizeSegment(input.filename || `audio-mix-${Date.now().toString(36)}.${format}`, `audio-mix.${format}`));
  ensureInside(storage.rootAbsPath, outputAbsPath);
  const args = ['-y'];
  const filters: string[] = [];
  active.forEach((track, index) => {
    args.push('-i', resolveLocalSource(storage, track.source).absPath);
    const delay = Math.max(0, Math.round(track.startMs || 0));
    const trimSeconds = track.durationMs ? Math.max(0.01, track.durationMs / 1000) : null;
    const fadeOutStart = trimSeconds && track.fadeOutMs ? Math.max(0, trimSeconds - track.fadeOutMs / 1000) : null;
    const pieces = [
      `atrim=start=${Math.max(0, (track.trimStartMs || 0) / 1000)}${trimSeconds ? `:duration=${trimSeconds}` : ''}`,
      'asetpts=PTS-STARTPTS',
      `volume=${Math.max(0, Math.min(1, Number(track.volume) || 1)).toFixed(3)}`,
      track.fadeInMs ? `afade=t=in:st=0:d=${Math.max(0.01, track.fadeInMs / 1000).toFixed(3)}` : '',
      fadeOutStart !== null ? `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${Math.max(0.01, (track.fadeOutMs || 0) / 1000).toFixed(3)}` : '',
      delay ? `adelay=${delay}|${delay}` : '',
    ].filter(Boolean).join(',');
    filters.push(`[${index}:a]${pieces}[a${index}]`);
  });
  filters.push(`${active.map((_track, index) => `[a${index}]`).join('')}amix=inputs=${active.length}:duration=longest:dropout_transition=0[outa]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[outa]');
  if (format === 'wav') args.push('-ar', '48000');
  else if (format === 'm4a') args.push('-c:a', 'aac', '-b:a', '192k');
  else args.push('-codec:a', 'libmp3lame', '-q:a', '2');
  args.push(outputAbsPath);
  await execFileAsync(ffmpegInstaller.path, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 16 });
  const imported = await importAndRegisterAudio(storage, { source: outputAbsPath, label: 'Mixed audio', tags: ['mixed-audio'], mode: 'audio_mix', metadata: { tracks: active }, copy: false });
  const project = attachAudioToProject(storage, input.projectId, { kind: 'mixed_audio', assetId: imported.asset.id, track: imported.audioTrack, generationId: imported.generation.id, sourceTrackCount: active.length, createdAt: nowIso() });
  return { outputPath: buildWorkspaceRelativePath(storage.workspacePath, outputAbsPath), audioTrack: imported.audioTrack, asset: imported.asset, project, ffmpeg: { inputCount: active.length } };
}

export async function creativeAddMusicBed(storage: CreativeAssetStorage, input: { source?: string; url?: string; volume?: number; fadeInMs?: number; fadeOutMs?: number; projectId?: string; label?: string }): Promise<any> {
  const imported = input.url
    ? await creativeDownloadAudio(storage, { url: input.url, label: input.label || 'Music bed', tags: ['music-bed'], projectId: input.projectId })
    : await creativeImportAudio(storage, { source: String(input.source || ''), label: input.label || 'Music bed', tags: ['music-bed'], projectId: input.projectId });
  const added = await creativeAddAudioTrack(storage, { source: imported.audioTrack.source, label: input.label || 'Music bed', volume: Number.isFinite(Number(input.volume)) ? Number(input.volume) : 0.35, fadeInMs: input.fadeInMs ?? 500, fadeOutMs: input.fadeOutMs ?? 900, projectId: input.projectId });
  return { ...imported, audioTrack: added.audioTrack, project: added.project || imported.project };
}

export async function creativeAddSoundEffects(storage: CreativeAssetStorage, input: { effects: Array<{ source: string; atMs?: number; label?: string; volume?: number }>; projectId?: string; mix?: boolean; filename?: string }): Promise<{ tracks: CreativeAudioTrack[]; mix: any | null; project: CreativeProjectDoc | null }> {
  const tracks: CreativeAudioTrack[] = [];
  for (const effect of Array.isArray(input.effects) ? input.effects : []) {
    const added = await creativeAddAudioTrack(storage, { source: effect.source, label: effect.label || 'SFX', startMs: effect.atMs || 0, volume: Number.isFinite(Number(effect.volume)) ? Number(effect.volume) : 0.85, projectId: input.projectId });
    tracks.push(added.audioTrack);
  }
  if (!tracks.length) throw new Error('creative_add_sound_effects requires at least one effect.');
  const mix = input.mix === false ? null : await creativeMixAudioTracks(storage, { tracks, filename: input.filename || `sfx-mix-${Date.now().toString(36)}.mp3`, projectId: input.projectId });
  const project = input.projectId ? creativeGetProject(storage, { projectId: input.projectId }) : null;
  return { tracks, mix, project };
}

function getGenerationIndexPath(storage: CreativeAssetStorage): string {
  const dir = path.join(storage.creativeDir, 'generations');
  ensureDir(dir);
  return path.join(dir, 'index.json');
}

function getStoryboardDir(storage: CreativeAssetStorage): string {
  const dir = path.join(storage.creativeDir, 'storyboards');
  ensureDir(dir);
  return dir;
}

function getStoryboardIndexPath(storage: CreativeAssetStorage): string {
  return path.join(getStoryboardDir(storage), 'index.json');
}

function getProjectDir(storage: CreativeAssetStorage): string {
  const dir = path.join(storage.creativeDir, 'projects');
  ensureDir(dir);
  return dir;
}

function getProjectIndexPath(storage: CreativeAssetStorage): string {
  return path.join(getProjectDir(storage), 'index.json');
}

function projectPath(storage: CreativeAssetStorage, projectId: string): string {
  return path.join(getProjectDir(storage), `${sanitizeSegment(projectId, 'project')}.json`);
}

function storyboardPath(storage: CreativeAssetStorage, storyboardId: string): string {
  const safeId = sanitizeSegment(storyboardId, 'storyboard');
  return path.join(getStoryboardDir(storage), `${safeId}.json`);
}

function readGenerationIndex(storage: CreativeAssetStorage): GenerationIndex {
  const indexPath = getGenerationIndexPath(storage);
  if (!fs.existsSync(indexPath)) {
    return {
      kind: 'prometheus-creative-generation-index',
      version: 1,
      updatedAt: nowIso(),
      generations: [],
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return {
      kind: 'prometheus-creative-generation-index',
      version: Math.max(1, Number(parsed?.version) || 1),
      updatedAt: String(parsed?.updatedAt || nowIso()),
      generations: Array.isArray(parsed?.generations) ? parsed.generations : [],
    };
  } catch {
    return {
      kind: 'prometheus-creative-generation-index',
      version: 1,
      updatedAt: nowIso(),
      generations: [],
    };
  }
}

function readStoryboardIndex(storage: CreativeAssetStorage): StoryboardIndex {
  const indexPath = getStoryboardIndexPath(storage);
  if (!fs.existsSync(indexPath)) {
    return { kind: 'prometheus-creative-storyboard-index', version: 1, updatedAt: nowIso(), storyboards: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return {
      kind: 'prometheus-creative-storyboard-index',
      version: Math.max(1, Number(parsed?.version) || 1),
      updatedAt: String(parsed?.updatedAt || nowIso()),
      storyboards: Array.isArray(parsed?.storyboards) ? parsed.storyboards : [],
    };
  } catch {
    return { kind: 'prometheus-creative-storyboard-index', version: 1, updatedAt: nowIso(), storyboards: [] };
  }
}

function writeStoryboardIndex(storage: CreativeAssetStorage, index: StoryboardIndex): void {
  index.updatedAt = nowIso();
  fs.writeFileSync(getStoryboardIndexPath(storage), JSON.stringify(index, null, 2), 'utf-8');
}

function readProjectIndex(storage: CreativeAssetStorage): ProjectIndex {
  const indexPath = getProjectIndexPath(storage);
  if (!fs.existsSync(indexPath)) {
    return { kind: 'prometheus-creative-project-index', version: 1, updatedAt: nowIso(), projects: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return {
      kind: 'prometheus-creative-project-index',
      version: Math.max(1, Number(parsed?.version) || 1),
      updatedAt: String(parsed?.updatedAt || nowIso()),
      projects: Array.isArray(parsed?.projects) ? parsed.projects : [],
    };
  } catch {
    return { kind: 'prometheus-creative-project-index', version: 1, updatedAt: nowIso(), projects: [] };
  }
}

function writeProjectIndex(storage: CreativeAssetStorage, index: ProjectIndex): void {
  index.updatedAt = nowIso();
  fs.writeFileSync(getProjectIndexPath(storage), JSON.stringify(index, null, 2), 'utf-8');
}

function writeProject(storage: CreativeAssetStorage, project: CreativeProjectDoc): { path: string; absPath: string } {
  project.updatedAt = nowIso();
  const absPath = projectPath(storage, project.id);
  ensureInside(storage.rootAbsPath, absPath);
  fs.writeFileSync(absPath, JSON.stringify(project, null, 2), 'utf-8');
  const relPath = buildWorkspaceRelativePath(storage.workspacePath, absPath);
  const index = readProjectIndex(storage);
  index.projects = [
    { id: project.id, title: project.title, path: relPath, updatedAt: project.updatedAt, brief: project.brief },
    ...index.projects.filter((item) => item.id !== project.id),
  ];
  writeProjectIndex(storage, index);
  return { path: relPath, absPath };
}

function writeStoryboard(storage: CreativeAssetStorage, storyboard: CreativeStoryboardDoc): { path: string; absPath: string } {
  storyboard.updatedAt = nowIso();
  const absPath = storyboardPath(storage, storyboard.id);
  ensureInside(storage.rootAbsPath, absPath);
  fs.writeFileSync(absPath, JSON.stringify(storyboard, null, 2), 'utf-8');
  const relPath = buildWorkspaceRelativePath(storage.workspacePath, absPath);
  const index = readStoryboardIndex(storage);
  index.storyboards = [
    { id: storyboard.id, title: storyboard.title, path: relPath, shotCount: storyboard.shots.length, updatedAt: storyboard.updatedAt },
    ...index.storyboards.filter((item) => item.id !== storyboard.id),
  ];
  writeStoryboardIndex(storage, index);
  return { path: relPath, absPath };
}

export function creativeListStoryboards(storage: CreativeAssetStorage, input: { limit?: number } = {}): StoryboardIndex['storyboards'] {
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
  return readStoryboardIndex(storage).storyboards.slice(0, limit);
}

export function creativeGetStoryboard(storage: CreativeAssetStorage, input: { storyboardId?: string; path?: string }): CreativeStoryboardDoc {
  let absPath = '';
  if (input.path) {
    const resolved = resolveCreativeAssetPath(storage, input.path);
    absPath = resolved.absPath || '';
  } else if (input.storyboardId) {
    absPath = storyboardPath(storage, input.storyboardId);
  }
  if (!absPath || !fs.existsSync(absPath)) throw new Error('Storyboard not found.');
  return JSON.parse(fs.readFileSync(absPath, 'utf-8')) as CreativeStoryboardDoc;
}

export function creativeListProjects(storage: CreativeAssetStorage, input: { limit?: number } = {}): ProjectIndex['projects'] {
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
  return readProjectIndex(storage).projects.slice(0, limit);
}

export function creativeGetProject(storage: CreativeAssetStorage, input: { projectId?: string; path?: string }): CreativeProjectDoc {
  let absPath = '';
  if (input.path) {
    const resolved = resolveCreativeAssetPath(storage, input.path);
    absPath = resolved.absPath || '';
  } else if (input.projectId) {
    absPath = projectPath(storage, input.projectId);
  }
  if (!absPath || !fs.existsSync(absPath)) throw new Error('Creative project not found.');
  return JSON.parse(fs.readFileSync(absPath, 'utf-8')) as CreativeProjectDoc;
}

function writeGenerationIndex(storage: CreativeAssetStorage, index: GenerationIndex): void {
  index.updatedAt = nowIso();
  fs.writeFileSync(getGenerationIndexPath(storage), JSON.stringify(index, null, 2), 'utf-8');
}

function resolveLocalSource(storage: CreativeAssetStorage, source: string): { absPath: string; relPath: string } {
  const resolved = resolveCreativeAssetPath(storage, source);
  if (!resolved.absPath || !fs.existsSync(resolved.absPath) || !fs.statSync(resolved.absPath).isFile()) {
    throw new Error(`Media source not found: ${source}`);
  }
  return {
    absPath: resolved.absPath,
    relPath: resolved.path || buildWorkspaceRelativePath(storage.workspacePath, resolved.absPath),
  };
}

async function probeDurationMs(absPath: string, fallbackMs?: number | null): Promise<number | null> {
  const ffprobeCandidates = [
    process.env.FFPROBE_PATH,
    'ffprobe',
  ].filter(Boolean) as string[];
  for (const ffprobe of ffprobeCandidates) {
    try {
      const { stdout } = await execFileAsync(ffprobe, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        absPath,
      ], { windowsHide: true, maxBuffer: 1024 * 1024 });
      const seconds = Number(String(stdout || '').trim());
      if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
    } catch {
      // Try next candidate.
    }
  }
  return Number.isFinite(Number(fallbackMs)) && Number(fallbackMs) > 0 ? Math.round(Number(fallbackMs)) : null;
}

function normalizePercent(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num > 0 && num <= 1 ? num * 100 : num));
}

async function selectorToSeconds(
  selector: ExtractFrameSelector,
  durationMs: number | null,
): Promise<{ seconds: number | null; sseof?: string; label: string }> {
  const frame = String(selector.frame || '').trim().toLowerCase();
  if (Number.isFinite(Number(selector.timestampMs))) {
    const seconds = Math.max(0, Number(selector.timestampMs) / 1000);
    return { seconds, label: `${Math.round(seconds * 1000)}ms` };
  }
  if (Number.isFinite(Number(selector.timestamp))) {
    const seconds = Math.max(0, Number(selector.timestamp));
    return { seconds, label: `${Math.round(seconds * 1000)}ms` };
  }
  if (Number.isFinite(Number(selector.percent))) {
    if (!durationMs) throw new Error('Percent frame extraction requires video duration, but duration could not be probed.');
    const percent = normalizePercent(selector.percent);
    const seconds = Math.max(0, Math.min(Math.max(0, durationMs - 80), durationMs * (percent / 100)) / 1000);
    return { seconds, label: `${Math.round(percent)}pct` };
  }
  if (frame === 'last') return { seconds: null, sseof: '-0.05', label: 'last' };
  if (frame === 'middle') {
    if (!durationMs) throw new Error('Middle frame extraction requires video duration, but duration could not be probed.');
    return { seconds: Math.max(0, durationMs / 2000), label: 'middle' };
  }
  if (frame === 'best_continuity_frame') return { seconds: null, sseof: '-0.20', label: 'best-continuity' };
  return { seconds: 0, label: 'first' };
}

async function extractSingleFrame(
  storage: CreativeAssetStorage,
  sourceAbsPath: string,
  selector: ExtractFrameSelector,
  outputAbsPath: string,
  durationMs: number | null,
): Promise<{ selector: ExtractFrameSelector; timestampMs: number | null; outputAbsPath: string; outputPath: string }> {
  ensureDir(path.dirname(outputAbsPath));
  const resolved = await selectorToSeconds(selector, durationMs);
  const args = ['-y'];
  if (resolved.sseof) args.push('-sseof', resolved.sseof);
  else if (resolved.seconds !== null) args.push('-ss', Math.max(0, resolved.seconds).toFixed(3));
  args.push('-i', sourceAbsPath, '-frames:v', '1', '-update', '1', outputAbsPath);
  await execFileAsync(ffmpegInstaller.path, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
  if (!fs.existsSync(outputAbsPath) || !fs.statSync(outputAbsPath).isFile()) {
    throw new Error('FFmpeg completed but no frame image was produced.');
  }
  return {
    selector,
    timestampMs: resolved.seconds === null ? null : Math.round(resolved.seconds * 1000),
    outputAbsPath,
    outputPath: buildWorkspaceRelativePath(storage.workspacePath, outputAbsPath),
  };
}

async function makeContactSheet(input: {
  storage: CreativeAssetStorage;
  framePaths: string[];
  outputAbsPath: string;
}): Promise<{ path: string; absPath: string } | null> {
  if (input.framePaths.length < 2) return null;
  const listPath = path.join(path.dirname(input.outputAbsPath), 'contact-sheet-inputs.txt');
  fs.writeFileSync(listPath, input.framePaths.map((frame) => `file '${path.resolve(frame).replace(/'/g, "'\\''").replace(/\\/g, '/')}'`).join('\n'), 'utf-8');
  const cols = Math.ceil(Math.sqrt(input.framePaths.length));
  const rows = Math.ceil(input.framePaths.length / cols);
  await execFileAsync(ffmpegInstaller.path, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-vf', `scale=320:-1,tile=${cols}x${rows}`,
    '-frames:v', '1',
    input.outputAbsPath,
  ], { windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
  if (!fs.existsSync(input.outputAbsPath)) return null;
  return {
    absPath: input.outputAbsPath,
    path: buildWorkspaceRelativePath(input.storage.workspacePath, input.outputAbsPath),
  };
}

export async function creativeExtractVideoFrame(
  storage: CreativeAssetStorage,
  input: ExtractFrameInput,
): Promise<{ frame: any; asset: CreativeAssetRecord | null; source: any; durationMs: number | null }> {
  const source = resolveLocalSource(storage, input.source);
  const sourceAsset = await analyzeCreativeAsset(storage, { source: source.absPath, tags: ['video-frame-source'], upsert: true });
  const durationMs = await probeDurationMs(source.absPath, sourceAsset.durationMs);
  const frameKind = input.frame || (Number.isFinite(Number(input.timestampMs ?? input.timestamp)) ? 'timestamp' : Number.isFinite(Number(input.percent)) ? 'percent' : 'last');
  const outDir = mediaFrameDir(storage, source.absPath);
  const outName = sanitizeSegment(input.outputName || `${String(frameKind)}_${Date.now().toString(36)}.png`, 'frame.png');
  const outputAbsPath = path.join(outDir, outName.toLowerCase().endsWith('.png') ? outName : `${outName}.png`);
  const frame = await extractSingleFrame(storage, source.absPath, input, outputAbsPath, durationMs);
  const asset = input.registerAsAsset === false
    ? null
    : await importCreativeAsset(storage, {
      source: frame.outputAbsPath,
      tags: ['extracted-frame', ...(Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(',').filter(Boolean))],
      copy: true,
    });
  return {
    source: {
      path: source.relPath,
      absPath: source.absPath,
      asset: sourceAsset,
    },
    durationMs,
    frame: {
      ...frame,
      path: frame.outputPath,
      absPath: frame.outputAbsPath,
    },
    asset,
  };
}

export async function creativeExtractVideoFrames(
  storage: CreativeAssetStorage,
  input: ExtractFramesInput,
): Promise<{ frames: any[]; assets: CreativeAssetRecord[]; contactSheet: any | null; source: any; durationMs: number | null }> {
  const source = resolveLocalSource(storage, input.source);
  const sourceAsset = await analyzeCreativeAsset(storage, { source: source.absPath, tags: ['video-frame-source'], upsert: true });
  const durationMs = await probeDurationMs(source.absPath, sourceAsset.durationMs);
  const selectors: ExtractFrameSelector[] = [];
  for (const item of Array.isArray(input.frames) ? input.frames : []) {
    if (typeof item === 'string') selectors.push({ frame: item as any });
    else if (typeof item === 'number') selectors.push({ timestamp: item });
    else if (item && typeof item === 'object') selectors.push(item);
  }
  for (const timestamp of Array.isArray(input.timestamps) ? input.timestamps : []) selectors.push({ timestamp });
  for (const percent of Array.isArray(input.percents) ? input.percents : []) selectors.push({ percent });
  if (!selectors.length) {
    const count = Math.max(2, Math.min(24, Math.round(Number(input.count) || 6)));
    const start = normalizePercent(input.rangeStartPercent ?? 0);
    const end = normalizePercent(input.rangeEndPercent ?? 100);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (let i = 0; i < count; i += 1) {
      const percent = count === 1 ? lo : lo + ((hi - lo) * i) / (count - 1);
      selectors.push({ percent });
    }
  }
  const outDir = path.join(mediaFrameDir(storage, source.absPath), id('sequence'));
  const prefix = sanitizeSegment(input.outputNamePrefix || 'frame', 'frame');
  const frames = [];
  for (let i = 0; i < selectors.length; i += 1) {
    const outputAbsPath = path.join(outDir, `${prefix}_${String(i + 1).padStart(2, '0')}.png`);
    frames.push(await extractSingleFrame(storage, source.absPath, selectors[i], outputAbsPath, durationMs));
  }
  const assets = [];
  if (input.registerAsAssets !== false) {
    for (const frame of frames) {
      assets.push(await importCreativeAsset(storage, {
        source: frame.outputAbsPath,
        tags: ['extracted-frame', ...(Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(',').filter(Boolean))],
        copy: true,
      }));
    }
  }
  const contactSheet = input.contactSheet === false
    ? null
    : await makeContactSheet({
      storage,
      framePaths: frames.map((frame) => frame.outputAbsPath),
      outputAbsPath: path.join(outDir, 'contact_sheet.jpg'),
    });
  return {
    source: { path: source.relPath, absPath: source.absPath, asset: sourceAsset },
    durationMs,
    frames: frames.map((frame) => ({ ...frame, path: frame.outputPath, absPath: frame.outputAbsPath })),
    assets,
    contactSheet,
  };
}

export function creativeListGenerations(storage: CreativeAssetStorage, input: { shotId?: string; limit?: number } = {}): CreativeGenerationRecord[] {
  const shotId = String(input.shotId || '').trim();
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
  return readGenerationIndex(storage).generations
    .filter((generation) => !shotId || generation.shotId === shotId)
    .slice(0, limit);
}

function normalizeShot(input: any, index: number): CreativeStoryboardShot {
  const shotId = String(input?.shotId || input?.id || `shot-${String(index + 1).padStart(2, '0')}`).trim();
  const qaCriteria = Array.isArray(input?.qaCriteria)
    ? input.qaCriteria.map((item: any) => String(item)).filter(Boolean)
    : String(input?.qaCriteria || '').split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean);
  return {
    shotId,
    title: input?.title ? String(input.title) : null,
    duration: Number.isFinite(Number(input?.duration)) ? Number(input.duration) : null,
    prompt: String(input?.prompt || input?.action || '').trim(),
    action: input?.action ? String(input.action) : null,
    camera: input?.camera ? String(input.camera) : null,
    openingFrame: input?.openingFrame || input?.opening_frame ? String(input.openingFrame || input.opening_frame) : null,
    endingFrameGoal: input?.endingFrameGoal || input?.ending_frame_goal ? String(input.endingFrameGoal || input.ending_frame_goal) : null,
    transition: input?.transition ? String(input.transition) : null,
    generationMode: input?.generationMode || input?.generation_mode ? String(input.generationMode || input.generation_mode) : null,
    qaCriteria,
    status: ['planned', 'generated', 'approved', 'needs_retry'].includes(String(input?.status || '')) ? input.status : 'planned',
    metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}

export function creativeCreateStoryboard(
  storage: CreativeAssetStorage,
  input: {
    title?: string;
    brief?: string;
    styleGuide?: string;
    characterBible?: string;
    shots?: any[];
    metadata?: Record<string, any>;
  },
): { storyboard: CreativeStoryboardDoc; path: string; absPath: string } {
  const storyboard: CreativeStoryboardDoc = {
    kind: 'prometheus-creative-storyboard',
    version: 1,
    id: id('storyboard'),
    title: String(input.title || 'Creative storyboard').trim() || 'Creative storyboard',
    brief: input.brief ? String(input.brief) : null,
    styleGuide: input.styleGuide ? String(input.styleGuide) : null,
    characterBible: input.characterBible ? String(input.characterBible) : null,
    shots: (Array.isArray(input.shots) ? input.shots : []).map(normalizeShot),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
  const written = writeStoryboard(storage, storyboard);
  return { storyboard, ...written };
}

export function creativeCreateProject(
  storage: CreativeAssetStorage,
  input: {
    title?: string;
    brief?: string;
    targetFormat?: string;
    targetDurationSec?: number;
    aspectRatio?: string;
    resolution?: string;
    width?: number;
    height?: number;
    frameRate?: number;
    storyboardId?: string;
    storyboardPath?: string;
    storyboard?: { title?: string; shots?: any[]; styleGuide?: string; characterBible?: string };
    sourceAssets?: string[] | string;
    notes?: Record<string, any>;
  },
): { project: CreativeProjectDoc; path: string; absPath: string; storyboard?: CreativeStoryboardDoc | null; storyboardPath?: string | null } {
  let storyboardId = input.storyboardId || null;
  let storyboardRelPath = input.storyboardPath || null;
  let storyboard: CreativeStoryboardDoc | null = null;
  if (!storyboardId && !storyboardRelPath && input.storyboard) {
    const createdStoryboard = creativeCreateStoryboard(storage, {
      title: input.storyboard.title || input.title || 'Creative storyboard',
      brief: input.brief,
      styleGuide: input.storyboard.styleGuide,
      characterBible: input.storyboard.characterBible,
      shots: input.storyboard.shots || [],
      metadata: { projectSeed: true },
    });
    storyboard = createdStoryboard.storyboard;
    storyboardId = storyboard.id;
    storyboardRelPath = createdStoryboard.path;
  } else if (storyboardId || storyboardRelPath) {
    storyboard = creativeGetStoryboard(storage, { storyboardId: storyboardId || undefined, path: storyboardRelPath || undefined });
    storyboardId = storyboard.id;
    storyboardRelPath = storyboardPath(storage, storyboard.id);
    storyboardRelPath = buildWorkspaceRelativePath(storage.workspacePath, storyboardRelPath);
  }
  const project: CreativeProjectDoc = {
    kind: 'prometheus-creative-project',
    version: 1,
    id: id('project'),
    title: String(input.title || storyboard?.title || 'Creative project').trim() || 'Creative project',
    brief: input.brief ? String(input.brief) : null,
    target: {
      format: input.targetFormat ? String(input.targetFormat) : null,
      durationSec: Number.isFinite(Number(input.targetDurationSec)) ? Number(input.targetDurationSec) : null,
      aspectRatio: input.aspectRatio ? String(input.aspectRatio) : null,
      resolution: input.resolution ? String(input.resolution) : null,
      width: Number.isFinite(Number(input.width)) ? Number(input.width) : null,
      height: Number.isFinite(Number(input.height)) ? Number(input.height) : null,
      frameRate: Number.isFinite(Number(input.frameRate)) ? Number(input.frameRate) : null,
    },
    storyboard: { id: storyboardId, path: storyboardRelPath },
    generationIds: [],
    selectedTakes: {},
    sourceAssets: normalizeReferenceList(input.sourceAssets),
    extractedLayers: [],
    roughCuts: [],
    exports: [],
    qaReports: [],
    audioTracks: [],
    captions: [],
    notes: input.notes && typeof input.notes === 'object' ? input.notes : {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const written = writeProject(storage, project);
  return { project, ...written, storyboard, storyboardPath: storyboardRelPath };
}

export function creativeWriteShotPrompt(input: {
  subject?: string;
  action?: string;
  setting?: string;
  camera?: string;
  lighting?: string;
  style?: string;
  continuity?: string;
  endingFrameGoal?: string;
  negatives?: string[] | string;
  duration?: number;
}): { prompt: string; negativePrompt: string | null; qaCriteria: string[] } {
  const parts = [
    input.subject && `Subject: ${String(input.subject).trim()}.`,
    input.action && `Action: ${String(input.action).trim()}.`,
    input.setting && `Setting: ${String(input.setting).trim()}.`,
    input.camera && `Camera: ${String(input.camera).trim()}.`,
    input.lighting && `Lighting: ${String(input.lighting).trim()}.`,
    input.style && `Style: ${String(input.style).trim()}.`,
    input.continuity && `Continuity: ${String(input.continuity).trim()}.`,
    input.endingFrameGoal && `End frame: ${String(input.endingFrameGoal).trim()}.`,
    Number.isFinite(Number(input.duration)) && `Duration: about ${Number(input.duration)} seconds.`,
  ].filter(Boolean) as string[];
  const negatives = Array.isArray(input.negatives)
    ? input.negatives.map(String).filter(Boolean)
    : String(input.negatives || '').split(/[\r\n,;]+/).map((item) => item.trim()).filter(Boolean);
  const qaCriteria = [
    input.subject ? `Subject remains recognizable: ${String(input.subject).trim()}` : '',
    input.action ? `Action is visible: ${String(input.action).trim()}` : '',
    input.endingFrameGoal ? `Ending frame supports next scene: ${String(input.endingFrameGoal).trim()}` : '',
    'No severe blur, warping, watermarks, or unreadable generated text.',
  ].filter(Boolean);
  return {
    prompt: parts.join(' ').trim(),
    negativePrompt: negatives.length ? negatives.join(', ') : null,
    qaCriteria,
  };
}

export async function creativeRegisterGeneration(
  storage: CreativeAssetStorage,
  input: Partial<CreativeGenerationRecord> & {
    outputPath?: string | null;
    outputAsset?: CreativeAssetRecord | null;
    tags?: any;
  },
): Promise<{ generation: CreativeGenerationRecord; asset: CreativeAssetRecord | null; indexPath: string }> {
  let asset = input.outputAsset || null;
  const outputPath = String(input.outputPath || '').trim();
  if (!asset && outputPath) {
    asset = await importCreativeAsset(storage, {
      source: outputPath,
      tags: input.tags || ['generation'],
      copy: true,
    });
  }
  const index = readGenerationIndex(storage);
  const shotId = input.shotId ? String(input.shotId) : null;
  const attempt = Number.isFinite(Number(input.attempt))
    ? Math.max(1, Number(input.attempt))
    : (shotId ? index.generations.filter((generation) => generation.shotId === shotId).length + 1 : 1);
  const generation: CreativeGenerationRecord = {
    id: input.id || id('gen'),
    kind: (['image', 'video', 'frame', 'audio', 'other'].includes(String(input.kind || '')) ? input.kind : (asset?.kind === 'video' ? 'video' : asset?.kind === 'image' ? 'image' : 'other')) as CreativeGenerationRecord['kind'],
    shotId,
    attempt,
    prompt: input.prompt ? String(input.prompt) : null,
    provider: input.provider ? String(input.provider) : null,
    model: input.model ? String(input.model) : null,
    mode: input.mode ? String(input.mode) : null,
    parentGenerationId: input.parentGenerationId ? String(input.parentGenerationId) : null,
    parentAssetId: input.parentAssetId ? String(input.parentAssetId) : null,
    sourceImage: input.sourceImage ? String(input.sourceImage) : null,
    sourceVideo: input.sourceVideo ? String(input.sourceVideo) : null,
    referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages.map(String).filter(Boolean) : [],
    outputPath: asset?.path || asset?.relativePath || outputPath || null,
    outputAssetId: asset?.id || input.outputAssetId || null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    createdAt: input.createdAt || nowIso(),
  };
  index.generations = [generation, ...index.generations.filter((item) => item.id !== generation.id)];
  writeGenerationIndex(storage, index);
  return { generation, asset, indexPath: getGenerationIndexPath(storage) };
}

export async function creativeGenerateVideoShot(
  storage: CreativeAssetStorage,
  input: {
    prompt: string;
    shotId?: string;
    image?: string;
    referenceImages?: string[] | string;
    video?: string;
    mode?: string;
    aspectRatio?: string;
    duration?: number;
    resolution?: string;
    provider?: string;
    model?: string;
    outputDir?: string;
    parentGenerationId?: string;
    parentAssetId?: string;
    importToCreative?: boolean;
    pollIntervalMs?: number;
    timeoutMs?: number;
  },
): Promise<{ video: any; asset: CreativeAssetRecord | null; generation: CreativeGenerationRecord | null; toolResult: ToolResult }> {
  const referenceImages = Array.isArray(input.referenceImages)
    ? input.referenceImages.map(String)
    : (input.referenceImages != null ? [String(input.referenceImages)] : undefined);
  const toolResult = await executeGenerateVideo({
    prompt: String(input.prompt || ''),
    image: input.image ? String(input.image) : undefined,
    reference_images: referenceImages,
    video: input.video ? String(input.video) : undefined,
    mode: input.mode ? String(input.mode) : undefined,
    aspect_ratio: input.aspectRatio ? String(input.aspectRatio) : undefined,
    duration: Number.isFinite(Number(input.duration)) ? Number(input.duration) : undefined,
    resolution: input.resolution ? String(input.resolution) : undefined,
    provider: input.provider ? String(input.provider) : undefined,
    model: input.model ? String(input.model) : undefined,
    output_dir: input.outputDir ? String(input.outputDir) : undefined,
    save_to_workspace: true,
    poll_interval_ms: Number.isFinite(Number(input.pollIntervalMs)) ? Number(input.pollIntervalMs) : undefined,
    timeout_ms: Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : undefined,
  });
  if (!toolResult.success) {
    return { video: null, asset: null, generation: null, toolResult };
  }
  const video = (toolResult.data as any)?.video || toolResult.data;
  let asset: CreativeAssetRecord | null = null;
  let generation: CreativeGenerationRecord | null = null;
  if (input.importToCreative !== false && video?.path) {
    asset = await importCreativeAsset(storage, {
      source: video.path,
      tags: ['generated-video', input.shotId ? `shot:${input.shotId}` : 'shot'],
      copy: true,
    });
  }
  const registered = await creativeRegisterGeneration(storage, {
    kind: 'video',
    shotId: input.shotId || null,
    prompt: input.prompt,
    provider: (toolResult.data as any)?.provider,
    model: (toolResult.data as any)?.model,
    mode: (toolResult.data as any)?.mode,
    parentGenerationId: input.parentGenerationId || null,
    parentAssetId: input.parentAssetId || null,
    sourceImage: input.image || null,
    sourceVideo: input.video || null,
    referenceImages: referenceImages || [],
    outputPath: video?.path || video?.rel_path || null,
    outputAsset: asset,
    metadata: {
      requestId: (toolResult.data as any)?.request_id || null,
      aspectRatio: (toolResult.data as any)?.aspect_ratio || input.aspectRatio || null,
      duration: (toolResult.data as any)?.duration || input.duration || null,
      resolution: (toolResult.data as any)?.resolution || input.resolution || null,
      sourceUrl: video?.source_url || null,
    },
  });
  generation = registered.generation;
  return { video, asset: registered.asset || asset, generation, toolResult };
}

export async function creativeGenerateImageShot(
  storage: CreativeAssetStorage,
  input: {
    prompt: string;
    shotId?: string;
    styleGuide?: string;
    aspectRatio?: string;
    referenceImages?: string[] | string;
    characterReferences?: string[] | string;
    locationReferences?: string[] | string;
    negativePrompt?: string;
    seed?: string | number;
    continuityId?: string;
    outputRole?: 'opening_frame' | 'keyframe' | 'ending_frame' | 'asset' | 'background_plate';
    provider?: string;
    model?: string;
    count?: number;
    outputDir?: string;
    parentGenerationId?: string;
    parentAssetId?: string;
    importToCreative?: boolean;
  },
): Promise<{ images: any[]; primary: any | null; assets: CreativeAssetRecord[]; generations: CreativeGenerationRecord[]; toolResult: ToolResult }> {
  const references = [
    ...normalizeReferenceList(input.referenceImages),
    ...normalizeReferenceList(input.characterReferences),
    ...normalizeReferenceList(input.locationReferences),
  ];
  const promptParts = [
    String(input.prompt || '').trim(),
    input.styleGuide ? `Style guide: ${String(input.styleGuide).trim()}` : '',
    input.negativePrompt ? `Avoid: ${String(input.negativePrompt).trim()}` : '',
    input.continuityId ? `Continuity ID: ${String(input.continuityId).trim()}` : '',
    input.seed != null ? `Seed/variation note: ${String(input.seed).trim()}` : '',
    input.outputRole ? `Shot asset role: ${input.outputRole}.` : '',
  ].filter(Boolean);
  const toolResult = await executeGenerateImage({
    prompt: promptParts.join('\n'),
    reference_images: references,
    aspect_ratio: input.aspectRatio,
    count: Number.isFinite(Number(input.count)) ? Number(input.count) : 1,
    provider: input.provider,
    model: input.model,
    output_dir: input.outputDir,
    save_to_workspace: true,
  });
  if (!toolResult.success) return { images: [], primary: null, assets: [], generations: [], toolResult };
  const data: any = toolResult.data || {};
  const images = Array.isArray(data.images) && data.images.length ? data.images : [data].filter((item) => item?.path || item?.rel_path);
  const assets: CreativeAssetRecord[] = [];
  const generations: CreativeGenerationRecord[] = [];
  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    let asset: CreativeAssetRecord | null = null;
    if (input.importToCreative !== false && (image.path || image.rel_path)) {
      asset = await importCreativeAsset(storage, {
        source: image.path || image.rel_path,
        tags: ['generated-image', input.outputRole || 'shot-image', input.shotId ? `shot:${input.shotId}` : 'shot'],
        copy: true,
      });
      assets.push(asset);
    }
    const registered = await creativeRegisterGeneration(storage, {
      kind: 'image',
      shotId: input.shotId || null,
      attempt: i + 1,
      prompt: input.prompt,
      provider: data.provider || image.provider || input.provider || null,
      model: data.model || image.model || input.model || null,
      mode: input.outputRole || 'image_shot',
      parentGenerationId: input.parentGenerationId || null,
      parentAssetId: input.parentAssetId || null,
      referenceImages: references,
      outputPath: image.path || image.rel_path || null,
      outputAsset: asset,
      metadata: {
        outputRole: input.outputRole || 'keyframe',
        styleGuide: input.styleGuide || null,
        negativePrompt: input.negativePrompt || null,
        seed: input.seed || null,
        continuityId: input.continuityId || null,
        revisedPrompt: image.revised_prompt || data.revised_prompt || null,
        aspectRatio: data.aspect_ratio || input.aspectRatio || null,
      },
      tags: ['generated-image', input.outputRole || 'shot-image'],
    });
    generations.push(registered.generation);
  }
  return { images, primary: images[0] || null, assets, generations, toolResult };
}

function scoreExtractedFrame(frame: any, ordinal = 0): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const fileSize = fs.existsSync(frame.absPath) ? fs.statSync(frame.absPath).size : 0;
  if (fileSize <= 0) reasons.push('missing or empty frame');
  if (fileSize > 25000) reasons.push('non-trivial image detail');
  const percent = Number((frame.selector || {}).percent);
  const timestampMs = Number(frame.timestampMs);
  const lateBias = Number.isFinite(percent) ? percent / 100 : Number.isFinite(timestampMs) ? Math.min(1, timestampMs / 10000) : ordinal / 10;
  const sizeScore = Math.min(60, fileSize / 20000);
  return { score: Math.round((sizeScore + lateBias * 30) * 10) / 10, reasons };
}

async function analyzeFramesWithVision(input: {
  frames: any[];
  prompt: string;
  mode?: string;
}): Promise<{ raw: ToolResult; parsed: any | null }> {
  const visionFrames = input.frames
    .filter((frame) => frame?.absPath && fs.existsSync(frame.absPath))
    .slice(0, 6)
    .map((frame) => imageToVisionFrame(frame.absPath, frame.timestampMs));
  if (!visionFrames.length) {
    return { raw: { success: false, error: 'No frames available for vision analysis.' }, parsed: null };
  }
  const raw = await executeAnalyzeVisionFrames({
    frames: visionFrames,
    mode: input.mode || 'video',
    prompt: `${input.prompt}

Return a compact JSON object only, with this shape:
{
  "score": 0-100,
  "verdict": "pass|review|fail",
  "subjectIdentityScore": 0-100,
  "actionComplianceScore": 0-100,
  "faceBodyHandsScore": 0-100,
  "blurScore": 0-100,
  "watermarkTextArtifactScore": 0-100,
  "cameraStabilityScore": 0-100,
  "continuityScore": 0-100,
  "bestFrameIndex": 0,
  "failureReasons": ["..."],
  "recommendedRetryPrompt": "..."
}
Judge only what is visible in the supplied frames. Penalize warped faces, bad hands, motion blur, watermarks, wrong subject, weak action, bad framing, and unusable start/end continuity.`,
  });
  return { raw, parsed: raw.success ? parseJsonObject(String(raw.stdout || (raw.data as any)?.analysis || '')) : null };
}

export async function creativeAnalyzeGeneratedVideo(
  storage: CreativeAssetStorage,
  input: {
    source: string;
    intendedPrompt?: string;
    continuityTarget?: string;
    qaCriteria?: string[] | string;
    frameCount?: number;
    useVision?: boolean;
  },
): Promise<{ asset: CreativeAssetRecord; score: number; passed: boolean; warnings: string[]; recommendations: string[]; failureReasons: string[]; retryPrompt: string | null; frames: any[]; contactSheet: any | null; vision: any | null; metadata: Record<string, any> }> {
  const asset = await analyzeCreativeAsset(storage, { source: input.source, tags: ['generated-video-qa'], upsert: true });
  if (asset.kind !== 'video') throw new Error(`creative_analyze_generated_video requires video, received ${asset.kind}.`);
  const extracted = await creativeExtractVideoFrames(storage, {
    source: input.source,
    count: Math.max(3, Math.min(12, Number(input.frameCount) || 6)),
    outputNamePrefix: 'qa',
    registerAsAssets: false,
    contactSheet: true,
  });
  const frames = extracted.frames.map((frame, index) => {
    const scored = scoreExtractedFrame(frame, index);
    return { ...frame, score: scored.score, scoreReasons: scored.reasons };
  });
  const warnings: string[] = [];
  const recommendations: string[] = [];
  if (!asset.durationMs || asset.durationMs < 1000) warnings.push('Video duration could not be confirmed or is very short.');
  if (!asset.width || !asset.height) warnings.push('Video dimensions could not be confirmed.');
  if (asset.width && asset.height && Math.min(asset.width, asset.height) < 360) warnings.push('Video resolution is low for polished export.');
  if (!frames.length) warnings.push('No QA frames could be extracted.');
  if (frames.some((frame) => Number(frame.score) < 5)) warnings.push('One or more sampled frames appear empty or too low-detail.');
  const qaCriteria = Array.isArray(input.qaCriteria)
    ? input.qaCriteria.map(String).filter(Boolean)
    : String(input.qaCriteria || '').split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean);
  if (input.intendedPrompt) recommendations.push('Review the contact sheet against the intended prompt; semantic prompt compliance still needs human/model vision review.');
  if (input.continuityTarget) recommendations.push('Check selected ending frames against the continuity target before chaining.');
  if (!qaCriteria.length) recommendations.push('Add per-shot QA criteria for stronger retry decisions.');
  const averageFrameScore = frames.length ? frames.reduce((total, frame) => total + Number(frame.score || 0), 0) / frames.length : 0;
  let score = 70 + Math.min(20, averageFrameScore / 5) - warnings.length * 8;
  if (asset.durationMs && asset.durationMs >= 3000) score += 5;
  let vision: any | null = null;
  let retryPrompt: string | null = null;
  const failureReasons: string[] = [];
  if (input.useVision !== false) {
    const visionResult = await analyzeFramesWithVision({
      frames: frames.sort((a, b) => Number(a.timestampMs || 0) - Number(b.timestampMs || 0)),
      mode: 'generated-video-qa',
      prompt: [
        `Analyze this generated video take for production usability.`,
        input.intendedPrompt ? `Intended prompt: ${input.intendedPrompt}` : '',
        input.continuityTarget ? `Continuity target: ${input.continuityTarget}` : '',
        qaCriteria.length ? `QA criteria:\n${qaCriteria.map((item) => `- ${item}`).join('\n')}` : '',
      ].filter(Boolean).join('\n'),
    });
    vision = { success: visionResult.raw.success, error: visionResult.raw.error || null, parsed: visionResult.parsed, analysis: (visionResult.raw.data as any)?.analysis || visionResult.raw.stdout || null };
    if (visionResult.parsed && Number.isFinite(Number(visionResult.parsed.score))) {
      score = Math.round(score * 0.35 + Number(visionResult.parsed.score) * 0.65);
      retryPrompt = visionResult.parsed.recommendedRetryPrompt ? String(visionResult.parsed.recommendedRetryPrompt) : null;
      if (Array.isArray(visionResult.parsed.failureReasons)) failureReasons.push(...visionResult.parsed.failureReasons.map(String));
    } else if (!visionResult.raw.success) {
      recommendations.push(`Vision QA unavailable: ${visionResult.raw.error || 'unknown error'}`);
    }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (score < 78) recommendations.push('Regenerate or retry with a tighter shot prompt.');
  return {
    asset,
    score,
    passed: score >= 78 && warnings.length <= 1,
    warnings,
    recommendations,
    failureReasons,
    retryPrompt,
    frames: frames.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)),
    contactSheet: extracted.contactSheet,
    vision,
    metadata: {
      intendedPrompt: input.intendedPrompt || null,
      continuityTarget: input.continuityTarget || null,
      qaCriteria,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
      frameRate: asset.frameRate,
    },
  };
}

export async function creativeCompareShots(
  storage: CreativeAssetStorage,
  input: {
    videos: string[];
    intendedPrompt?: string;
    continuityTarget?: string;
    qaCriteria?: string[] | string;
    frameCount?: number;
  },
): Promise<{ winner: any | null; analyses: any[]; recommendation: string }> {
  const videos = (Array.isArray(input.videos) ? input.videos : []).map(String).filter(Boolean);
  if (videos.length < 2) throw new Error('creative_compare_shots requires at least two videos.');
  const analyses = [];
  for (const video of videos) {
    const analysis = await creativeAnalyzeGeneratedVideo(storage, {
      source: video,
      intendedPrompt: input.intendedPrompt,
      continuityTarget: input.continuityTarget,
      qaCriteria: input.qaCriteria,
      frameCount: input.frameCount,
    });
    analyses.push({ source: video, ...analysis });
  }
  analyses.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const winner = analyses[0] || null;
  return {
    winner,
    analyses,
    recommendation: winner?.passed
      ? `Use ${winner.source}; it has the strongest QA score.`
      : 'No take clearly passed QA; retry with a tighter prompt or stronger reference image.',
  };
}

export async function creativeSelectBestTake(
  storage: CreativeAssetStorage,
  input: {
    shotId: string;
    intendedPrompt?: string;
    continuityTarget?: string;
    qaCriteria?: string[] | string;
    limit?: number;
    useVision?: boolean;
  },
): Promise<{ selected: any | null; analyses: any[]; generationHistory: CreativeGenerationRecord[]; recommendation: string }> {
  const generationHistory = creativeListGenerations(storage, {
    shotId: input.shotId,
    limit: Math.max(1, Math.min(100, Number(input.limit) || 20)),
  }).filter((generation) => generation.kind === 'video' && !!generation.outputPath);
  const analyses = [];
  for (const generation of generationHistory) {
    if (!generation.outputPath) continue;
    try {
      const analysis = await creativeAnalyzeGeneratedVideo(storage, {
        source: generation.outputPath,
        intendedPrompt: input.intendedPrompt || generation.prompt || undefined,
        continuityTarget: input.continuityTarget,
        qaCriteria: input.qaCriteria,
        useVision: input.useVision,
      });
      analyses.push({ generation, source: generation.outputPath, ...analysis });
    } catch (err: any) {
      analyses.push({ generation, source: generation.outputPath, score: 0, passed: false, error: String(err?.message || err) });
    }
  }
  analyses.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const selected = analyses[0] || null;
  return {
    selected,
    analyses,
    generationHistory,
    recommendation: selected
      ? `Selected ${selected.generation?.id || selected.source} with score ${selected.score || 0}.`
      : `No video takes found for shotId ${input.shotId}.`,
  };
}

export async function creativeRetryShotUntilPass(
  storage: CreativeAssetStorage,
  input: Parameters<typeof creativeGenerateVideoShot>[1] & {
    maxRetries?: number;
    passScore?: number;
    qaCriteria?: string[] | string;
    continuityTarget?: string;
  },
): Promise<{ selected: any | null; attempts: any[]; passed: boolean; recommendation: string }> {
  const maxRetries = Math.max(1, Math.min(5, Number(input.maxRetries) || 2));
  const passScore = Math.max(1, Math.min(100, Number(input.passScore) || 78));
  const attempts = [];
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const prompt = attempt === 1
      ? input.prompt
      : `${input.prompt}\n\nRetry note: ${attempts[0]?.analysis?.retryPrompt || 'preserve the subject and setting, make the intended action clearer, avoid blur, warped anatomy, watermarks, and unusable ending frames.'}`;
    const generated = await creativeGenerateVideoShot(storage, { ...input, prompt });
    let analysis: any = null;
    if (generated.video?.path) {
      analysis = await creativeAnalyzeGeneratedVideo(storage, {
        source: generated.video.path,
        intendedPrompt: prompt,
        continuityTarget: input.continuityTarget,
        qaCriteria: input.qaCriteria,
      });
    }
    attempts.push({ attempt, generated, analysis });
    if (analysis && analysis.score >= passScore && analysis.passed) {
      return { selected: attempts[attempts.length - 1], attempts, passed: true, recommendation: `Attempt ${attempt} passed QA.` };
    }
  }
  attempts.sort((a, b) => Number(b.analysis?.score || 0) - Number(a.analysis?.score || 0));
  return {
    selected: attempts[0] || null,
    attempts,
    passed: false,
    recommendation: attempts[0]?.analysis
      ? `Best attempt scored ${attempts[0].analysis.score}; consider manual review or a stronger reference.`
      : 'All generation attempts failed before QA could run.',
  };
}

export async function creativeRefineVideoShot(
  storage: CreativeAssetStorage,
  input: {
    sourceVideo: string;
    issueMode?: 'motion_too_weak' | 'wrong_character' | 'bad_hands' | 'bad_face' | 'camera_drift' | 'not_following_action' | 'style_mismatch' | 'extend_action' | 'replace_ending' | 'make_loopable' | 'make_more_cinematic';
    issueDescription?: string;
    desiredCorrection?: string;
    shotId?: string;
    keyframe?: string;
    frameStrategy?: 'last' | 'best_ending_frame' | 'timestamp' | 'percent';
    timestamp?: number;
    percent?: number;
    preserveStyle?: boolean;
    preserveCharacter?: boolean;
    preserveLocation?: boolean;
    duration?: number;
    resolution?: string;
    aspectRatio?: string;
    provider?: string;
    model?: string;
    maxRetries?: number;
    passScore?: number;
  },
): Promise<{ keyframe: any; keyframeAsset: CreativeAssetRecord | null; prompt: string; result: any }> {
  const mode = input.issueMode || 'make_more_cinematic';
  let keyframe: any = null;
  let keyframeAsset: CreativeAssetRecord | null = null;
  if (input.keyframe) {
    const asset = await importCreativeAsset(storage, { source: input.keyframe, tags: ['video-refine-keyframe'], copy: true });
    keyframe = { path: asset.path || asset.relativePath || input.keyframe, absPath: asset.absPath || null };
    keyframeAsset = asset;
  } else {
    const continuity = await creativePickContinuityFrame(storage, {
      source: input.sourceVideo,
      strategy: input.frameStrategy === 'best_ending_frame' || !input.frameStrategy ? 'ending' : 'uniform',
      candidatePercents: input.frameStrategy === 'timestamp' || input.frameStrategy === 'percent' ? [Number(input.percent) || 90] : undefined,
      registerAsAsset: true,
      continuityPrompt: input.desiredCorrection || input.issueDescription,
    });
    keyframe = continuity.selected;
    keyframeAsset = continuity.asset;
  }
  const modeInstruction: Record<string, string> = {
    motion_too_weak: 'Increase motion clarity and energy while preserving the same subject and setting.',
    wrong_character: 'Restore the intended character identity and keep the character consistent throughout the shot.',
    bad_hands: 'Repair hand anatomy and keep hands natural, clear, and not distorted.',
    bad_face: 'Repair facial structure, expression, and identity; avoid melted or unstable facial features.',
    camera_drift: 'Stabilize camera movement and keep framing intentional.',
    not_following_action: 'Make the intended action visibly happen in the shot.',
    style_mismatch: 'Match the original visual style, lighting, palette, and cinematic language.',
    extend_action: 'Continue the action naturally from the keyframe.',
    replace_ending: 'Create a stronger ending frame that supports the next scene.',
    make_loopable: 'Create motion that can loop cleanly from the ending back to the beginning.',
    make_more_cinematic: 'Improve cinematic quality, lighting, camera intent, and production polish.',
  };
  const preserve = [
    input.preserveCharacter !== false ? 'preserve the same character identity' : '',
    input.preserveStyle !== false ? 'preserve the same visual style' : '',
    input.preserveLocation !== false ? 'preserve the same location and spatial continuity' : '',
  ].filter(Boolean).join(', ');
  const prompt = [
    modeInstruction[mode],
    input.issueDescription ? `Issue to fix: ${input.issueDescription}` : '',
    input.desiredCorrection ? `Desired correction: ${input.desiredCorrection}` : '',
    preserve ? `Continuity constraints: ${preserve}.` : '',
    'Avoid warped faces, bad hands, watermarks, text artifacts, flicker, and muddy motion.',
  ].filter(Boolean).join('\n');
  const result = await creativeRetryShotUntilPass(storage, {
    prompt,
    shotId: input.shotId,
    image: keyframeAsset?.path || keyframe?.path,
    duration: input.duration,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    provider: input.provider,
    model: input.model,
    parentAssetId: keyframeAsset?.id || undefined,
    maxRetries: input.maxRetries || 1,
    passScore: input.passScore || 78,
    qaCriteria: [
      modeInstruction[mode],
      input.desiredCorrection || '',
      preserve || '',
    ].filter(Boolean),
    continuityTarget: input.desiredCorrection || modeInstruction[mode],
  });
  return { keyframe, keyframeAsset, prompt, result };
}

export async function creativeGenerateSequence(
  storage: CreativeAssetStorage,
  input: {
    projectId?: string;
    storyboardId?: string;
    storyboardPath?: string;
    generationMode?: 'image-first' | 'video-only' | 'chained-continuity';
    maxRetriesPerShot?: number;
    qaThreshold?: number;
    provider?: string;
    model?: string;
    duration?: number;
    resolution?: string;
    aspectRatio?: string;
    outputDir?: string;
    dryRun?: boolean;
    useVision?: boolean;
  },
): Promise<{ project: CreativeProjectDoc | null; storyboard: CreativeStoryboardDoc; shotResults: any[]; failures: any[]; selectedTakes: Record<string, any>; dryRun: boolean }> {
  let project: CreativeProjectDoc | null = null;
  if (input.projectId) project = creativeGetProject(storage, { projectId: input.projectId });
  const storyboard = input.storyboardId || input.storyboardPath
    ? creativeGetStoryboard(storage, { storyboardId: input.storyboardId, path: input.storyboardPath })
    : project?.storyboard?.id || project?.storyboard?.path
      ? creativeGetStoryboard(storage, { storyboardId: project.storyboard.id || undefined, path: project.storyboard.path || undefined })
      : (() => { throw new Error('creative_generate_sequence requires projectId with storyboard or storyboardId/storyboardPath.'); })();
  const mode = input.generationMode || 'image-first';
  const shotResults: any[] = [];
  const failures: any[] = [];
  const selectedTakes: Record<string, any> = {};
  let previousVideo: string | null = null;
  let previousGenerationId: string | null = null;
  for (const shot of storyboard.shots) {
    const prompt = shot.prompt || shot.action || shot.title || '';
    const duration = Number.isFinite(Number(shot.duration)) ? Number(shot.duration) : input.duration;
    const plan = {
      shotId: shot.shotId,
      mode,
      prompt,
      duration,
      resolution: input.resolution || project?.target.resolution || null,
      aspectRatio: input.aspectRatio || project?.target.aspectRatio || null,
      willChainFromPrevious: mode === 'chained-continuity' && !!previousVideo,
      willGenerateImage: mode === 'image-first' && !shot.openingFrame,
    };
    if (input.dryRun === true) {
      shotResults.push({ shot, plan, skipped: true });
      continue;
    }
    try {
      let startImage = shot.openingFrame || undefined;
      let imageGeneration: any = null;
      if (mode === 'image-first' && !startImage) {
        imageGeneration = await creativeGenerateImageShot(storage, {
          prompt,
          shotId: shot.shotId,
          styleGuide: storyboard.styleGuide || undefined,
          aspectRatio: input.aspectRatio || project?.target.aspectRatio || undefined,
          outputRole: 'opening_frame',
          provider: undefined,
          outputDir: input.outputDir,
          parentGenerationId: previousGenerationId || undefined,
        });
        startImage = imageGeneration.assets[0]?.path || imageGeneration.primary?.path || imageGeneration.primary?.rel_path;
      }
      let videoAttempt: any = null;
      if (mode === 'chained-continuity' && previousVideo) {
        const chained = await creativeChainScene(storage, {
          previousVideo,
          nextPrompt: prompt,
          shotId: shot.shotId,
          frameStrategy: 'best_ending_frame',
          duration,
          resolution: input.resolution || project?.target.resolution || undefined,
          aspectRatio: input.aspectRatio || project?.target.aspectRatio || undefined,
          provider: input.provider,
          model: input.model,
          parentGenerationId: previousGenerationId || undefined,
          outputDir: input.outputDir,
        });
        videoAttempt = {
          generated: chained.shot,
          analysis: chained.shot?.video?.path
            ? await creativeAnalyzeGeneratedVideo(storage, {
              source: chained.shot.video.path,
              intendedPrompt: prompt,
              continuityTarget: shot.endingFrameGoal || undefined,
              qaCriteria: shot.qaCriteria,
              useVision: input.useVision,
            })
            : null,
          chained,
        };
      } else {
        videoAttempt = await creativeRetryShotUntilPass(storage, {
          prompt,
          shotId: shot.shotId,
          image: startImage,
          duration,
          resolution: input.resolution || project?.target.resolution || undefined,
          aspectRatio: input.aspectRatio || project?.target.aspectRatio || undefined,
          provider: input.provider,
          model: input.model,
          outputDir: input.outputDir,
          parentGenerationId: previousGenerationId || undefined,
          maxRetries: input.maxRetriesPerShot || 1,
          passScore: input.qaThreshold || 78,
          qaCriteria: shot.qaCriteria,
          continuityTarget: shot.endingFrameGoal || undefined,
        });
      }
      const selected = videoAttempt.selected || videoAttempt;
      const generated = selected?.generated || videoAttempt.generated || videoAttempt.shot || null;
      const generation = generated?.generation || generated?.shot?.generation || selected?.generated?.generation || null;
      const videoPath = generated?.video?.path || generated?.shot?.video?.path || selected?.generated?.video?.path || null;
      const analysis = selected?.analysis || videoAttempt.analysis || null;
      if (!videoPath) throw new Error('Shot generation did not produce a video path.');
      previousVideo = videoPath;
      previousGenerationId = generation?.id || previousGenerationId;
      const passed = analysis ? Number(analysis.score || 0) >= Number(input.qaThreshold || 78) : true;
      shot.status = passed ? 'approved' : 'needs_retry';
      shot.metadata = {
        ...shot.metadata,
        imageGeneration: imageGeneration ? { generations: imageGeneration.generations, primary: imageGeneration.primary } : null,
        selectedGenerationId: generation?.id || null,
        selectedVideoPath: videoPath,
        qaScore: analysis?.score || null,
      };
      const result = { shotId: shot.shotId, plan, imageGeneration, videoAttempt, selectedGeneration: generation, videoPath, analysis, passed };
      shotResults.push(result);
      selectedTakes[shot.shotId] = { generationId: generation?.id || '', outputPath: videoPath, score: analysis?.score || null, selectedAt: nowIso(), qa: analysis };
      if (!passed) failures.push({ shotId: shot.shotId, reason: 'QA threshold not met', score: analysis?.score || null });
      if (project) {
        if (generation?.id && !project.generationIds.includes(generation.id)) project.generationIds.push(generation.id);
        project.selectedTakes[shot.shotId] = selectedTakes[shot.shotId];
        if (analysis) project.qaReports.push({ shotId: shot.shotId, generationId: generation?.id || null, score: analysis.score, passed: analysis.passed, at: nowIso() });
      }
    } catch (err: any) {
      shot.status = 'needs_retry';
      const failure = { shotId: shot.shotId, error: String(err?.message || err), plan };
      failures.push(failure);
      shotResults.push({ shot, plan, error: failure.error });
    }
  }
  writeStoryboard(storage, storyboard);
  if (project) writeProject(storage, project);
  return { project, storyboard, shotResults, failures, selectedTakes, dryRun: input.dryRun === true };
}

export async function creativeExtractLayersForGeneration(
  storage: CreativeAssetStorage,
  input: {
    source: string;
    prompt?: string;
    shotId?: string;
    parentGenerationId?: string;
    mode?: CreativeLayerExtractionMode;
    textEditable?: boolean;
    extractObjects?: boolean;
    maxTextLayers?: number;
    maxShapeLayers?: number;
    useVision?: boolean;
    useOcr?: boolean;
    useSam?: boolean;
    inpaintBackground?: boolean;
    vectorTraceShapes?: boolean;
  },
): Promise<{ extraction: any; registeredLayers: CreativeGenerationRecord[]; generation: CreativeGenerationRecord; referenceAssets: any[]; startImageCandidates: any[]; backgroundPlate: any | null }> {
  const extraction = await extractCreativeLayers(storage, {
    source: input.source,
    mode: input.mode,
    prompt: input.prompt,
    textEditable: input.textEditable === true,
    extractObjects: input.extractObjects !== false,
    preserveOriginal: true,
    copySource: true,
    maxTextLayers: input.maxTextLayers,
    maxShapeLayers: input.maxShapeLayers,
    useVision: input.useVision !== false,
    useOcr: input.useOcr === true,
    useSam: input.useSam !== false,
    inpaintBackground: input.inpaintBackground !== false,
    vectorTraceShapes: input.vectorTraceShapes !== false,
  });
  const root = await creativeRegisterGeneration(storage, {
    kind: 'image',
    shotId: input.shotId || null,
    prompt: input.prompt || null,
    mode: 'extract_layers',
    parentGenerationId: input.parentGenerationId || null,
    outputPath: extraction.scenePath,
    outputAsset: null,
    metadata: {
      extractionId: extraction.id,
      scenePath: extraction.scenePath,
      layerCount: extraction.layers.length,
      diagnostics: extraction.diagnostics,
    },
    tags: ['layer-extraction-scene'],
  });
  const registeredLayers: CreativeGenerationRecord[] = [];
  const referenceAssets: any[] = [];
  let backgroundPlate: any | null = null;
  for (const layer of extraction.layers || []) {
    const layerPath = layer?.cutoutPath || layer?.source || layer?.vectorPath || null;
    if (!layerPath) continue;
    const registered = await creativeRegisterGeneration(storage, {
      kind: layer.type === 'image' ? 'image' : 'other',
      shotId: input.shotId || null,
      prompt: layer.description || layer.content || input.prompt || null,
      mode: 'extracted_layer',
      parentGenerationId: root.generation.id,
      outputPath: layerPath,
      metadata: { layer },
      tags: ['extracted-layer', layer.type ? `layer:${layer.type}` : 'layer'],
    });
    registeredLayers.push(registered.generation);
    referenceAssets.push({
      layerId: layer.id || null,
      type: layer.type || null,
      role: layer.role || null,
      description: layer.description || layer.content || null,
      path: registered.asset?.path || registered.asset?.relativePath || registered.generation.outputPath,
      assetId: registered.asset?.id || registered.generation.outputAssetId || null,
      generationId: registered.generation.id,
      usableAs: layer.type === 'image' ? ['reference_image', 'start_image', 'character_reference'] : ['reference_image'],
      bbox: {
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
      },
    });
  }
  const cleanPlatePath = extraction.diagnostics?.inpaint?.cleanPlatePath || (extraction.scene as any)?.background?.source || null;
  if (cleanPlatePath) {
    backgroundPlate = await creativeRegisterGeneration(storage, {
      kind: 'image',
      shotId: input.shotId || null,
      prompt: input.prompt || 'Extracted background plate',
      mode: 'background_plate',
      parentGenerationId: root.generation.id,
      outputPath: cleanPlatePath,
      metadata: { sourceExtractionId: extraction.id },
      tags: ['extracted-layer', 'background-plate'],
    });
  }
  const startImageCandidates = referenceAssets
    .filter((asset) => asset.usableAs.includes('start_image'))
    .sort((a, b) => Number((b.bbox?.width || 0) * (b.bbox?.height || 0)) - Number((a.bbox?.width || 0) * (a.bbox?.height || 0)));
  return { extraction, registeredLayers, generation: root.generation, referenceAssets, startImageCandidates, backgroundPlate };
}

export async function creativePickContinuityFrame(
  storage: CreativeAssetStorage,
  input: {
    source: string;
    strategy?: 'ending' | 'uniform';
    candidatePercents?: number[];
    registerAsAsset?: boolean;
    continuityPrompt?: string;
    useVision?: boolean;
  },
): Promise<{ selected: any; candidates: any[]; asset: CreativeAssetRecord | null; contactSheet: any | null; vision: any | null }> {
  const percents = Array.isArray(input.candidatePercents) && input.candidatePercents.length
    ? input.candidatePercents
    : (input.strategy === 'uniform' ? [0, 20, 40, 60, 80, 100] : [72, 82, 90, 95, 98]);
  const extracted = await creativeExtractVideoFrames(storage, {
    source: input.source,
    percents,
    outputNamePrefix: 'continuity',
    registerAsAssets: false,
    contactSheet: true,
  });
  let scored = extracted.frames.map((frame) => {
    const frameScore = scoreExtractedFrame(frame);
    return {
      ...frame,
      score: frameScore.score,
      scoreReasons: frameScore.reasons,
    };
  }).sort((a, b) => b.score - a.score);
  let vision: any | null = null;
  if (input.useVision !== false) {
    const visionResult = await analyzeFramesWithVision({
      frames: extracted.frames,
      mode: 'continuity-frame-selection',
      prompt: [
        'Pick the best continuity frame for continuing an AI-generated video shot.',
        input.continuityPrompt ? `Next action / continuity target: ${input.continuityPrompt}` : '',
        'Prefer a clean, sharp frame where the subject is visible, anatomy is not warped, the composition has room for the next action, and the ending can plausibly continue into another generated shot.',
      ].filter(Boolean).join('\n'),
    });
    vision = { success: visionResult.raw.success, error: visionResult.raw.error || null, parsed: visionResult.parsed, analysis: (visionResult.raw.data as any)?.analysis || visionResult.raw.stdout || null };
    const bestIndex = Number(visionResult.parsed?.bestFrameIndex);
    if (Number.isInteger(bestIndex) && bestIndex >= 0 && bestIndex < extracted.frames.length) {
      scored = scored.map((frame) => {
        const originalIndex = extracted.frames.findIndex((candidate) => candidate.absPath === frame.absPath);
        return originalIndex === bestIndex
          ? { ...frame, score: Number(frame.score || 0) + 100, scoreReasons: [...(frame.scoreReasons || []), 'vision-selected continuity frame'] }
          : frame;
      }).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    }
  }
  const selected = scored[0] || extracted.frames[extracted.frames.length - 1];
  const asset = input.registerAsAsset === false || !selected
    ? null
    : await importCreativeAsset(storage, {
      source: selected.absPath,
      tags: ['continuity-frame', 'extracted-frame'],
      copy: true,
    });
  return { selected, candidates: scored, asset, contactSheet: extracted.contactSheet, vision };
}

export async function creativeChainScene(
  storage: CreativeAssetStorage,
  input: {
    previousVideo: string;
    nextPrompt: string;
    shotId?: string;
    frameStrategy?: 'last' | 'best_ending_frame' | 'timestamp' | 'percent';
    timestamp?: number;
    percent?: number;
    duration?: number;
    resolution?: string;
    aspectRatio?: string;
    provider?: string;
    model?: string;
    parentGenerationId?: string;
    stitch?: boolean;
    outputDir?: string;
  },
): Promise<{ continuityFrame: any; continuityAsset: CreativeAssetRecord | null; shot: any; stitched: any | null }> {
  const strategy = String(input.frameStrategy || 'best_ending_frame');
  let continuity: { selected?: any; asset?: CreativeAssetRecord | null };
  if (strategy === 'best_ending_frame') {
    continuity = await creativePickContinuityFrame(storage, {
      source: input.previousVideo,
      strategy: 'ending',
      registerAsAsset: true,
    });
  } else {
    const extracted = await creativeExtractVideoFrame(storage, {
      source: input.previousVideo,
      frame: strategy === 'last' ? 'last' : undefined,
      timestamp: strategy === 'timestamp' ? input.timestamp : undefined,
      percent: strategy === 'percent' ? input.percent : undefined,
      registerAsAsset: true,
      tags: ['continuity-frame'],
    });
    continuity = { selected: extracted.frame, asset: extracted.asset };
  }
  const framePath = continuity.asset?.path || continuity.asset?.relativePath || continuity.selected?.path;
  if (!framePath) throw new Error('Could not produce a continuity frame for scene chaining.');
  const shot = await creativeGenerateVideoShot(storage, {
    prompt: input.nextPrompt,
    shotId: input.shotId,
    image: framePath,
    duration: input.duration,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    provider: input.provider,
    model: input.model,
    parentGenerationId: input.parentGenerationId,
    parentAssetId: continuity.asset?.id || undefined,
    outputDir: input.outputDir,
  });
  let stitched = null;
  if (input.stitch === true && shot.video?.path) {
    stitched = await creativeRenderGeneratedSequence(storage, {
      videos: [input.previousVideo, shot.video.path],
      filename: input.shotId ? `${sanitizeSegment(input.shotId)}-chain.mp4` : undefined,
    });
  }
  return {
    continuityFrame: continuity.selected,
    continuityAsset: continuity.asset || null,
    shot,
    stitched,
  };
}

export async function creativeWrapVideoAsHtmlMotionClip(
  storage: CreativeAssetStorage,
  input: {
    source: string;
    title?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    frameRate?: number;
    fit?: 'cover' | 'contain' | 'fill';
    filename?: string;
    importToCreative?: boolean;
  },
): Promise<{ clipPath: string; absClipPath: string; asset: CreativeAssetRecord; durationMs: number; width: number; height: number; html: string }> {
  const asset = input.importToCreative === false
    ? await analyzeCreativeAsset(storage, { source: input.source, tags: ['wrapped-video'], upsert: true })
    : await importCreativeAsset(storage, { source: input.source, tags: ['wrapped-video', 'html-motion-source'], copy: true });
  if (asset.kind !== 'video') throw new Error(`creative_wrap_video_as_html_motion_clip requires a video asset, received ${asset.kind}.`);
  const absVideo = asset.absPath || resolveLocalSource(storage, asset.path || asset.relativePath || input.source).absPath;
  const width = Math.max(120, Math.round(Number(input.width) || Number(asset.width) || 1280));
  const height = Math.max(120, Math.round(Number(input.height) || Number(asset.height) || 720));
  const durationMs = Math.max(100, Math.round(Number(input.durationMs) || Number(asset.durationMs) || 6000));
  const frameRate = Math.max(1, Math.round(Number(input.frameRate) || Number(asset.frameRate) || 30));
  const fit = input.fit || 'cover';
  const compositionId = sanitizeSegment(input.title || path.basename(absVideo, path.extname(absVideo)), 'generated-video-clip');
  const html = `<!doctype html>
<html data-composition-id="${escapeHtml(compositionId)}" data-composition-duration="${durationMs / 1000}" data-width="${width}" data-height="${height}">
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#000}
#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#000}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:${fit === 'fill' ? 'fill' : fit};background:#000}
</style>
</head>
<body>
<main id="stage" data-composition-id="${escapeHtml(compositionId)}" data-width="${width}" data-height="${height}" data-duration="${durationMs}ms" data-frame-rate="${frameRate}">
<video class="generated-video" data-start="0s" data-duration="${durationMs / 1000}s" data-track-index="0" src="${escapeHtml(fileUrl(absVideo))}" muted playsinline preload="auto"></video>
</main>
<script>
(() => {
  const video = document.querySelector("video");
  function seek(ms) {
    const seconds = Math.max(0, ms / 1000);
    if (video && Number.isFinite(seconds)) video.currentTime = seconds;
  }
  window.addEventListener("prometheus-html-motion-seek", (event) => seek(event.detail?.timeMs || 0));
  window.__hf = { duration: ${durationMs / 1000}, seek: (seconds) => seek(seconds * 1000) };
})();
</script>
</body>
</html>`;
  const outDir = path.join(storage.creativeDir, 'html-motion', 'generated-video-clips');
  ensureDir(outDir);
  const fileName = sanitizeSegment(input.filename || `${compositionId}.html`, 'generated-video-clip.html');
  const absClipPath = path.join(outDir, fileName.toLowerCase().endsWith('.html') ? fileName : `${fileName}.html`);
  ensureInside(storage.rootAbsPath, absClipPath);
  fs.writeFileSync(absClipPath, html, 'utf-8');
  return {
    clipPath: buildWorkspaceRelativePath(storage.workspacePath, absClipPath),
    absClipPath,
    asset,
    durationMs,
    width,
    height,
    html,
  };
}

type StitchClipInput = string | {
  source: string;
  trimStartMs?: number;
  trimEndMs?: number;
  durationMs?: number;
  label?: string;
};

function normalizeStitchClip(input: StitchClipInput): { source: string; trimStartMs: number; trimEndMs: number; durationMs?: number; label?: string } {
  if (typeof input === 'string') return { source: input, trimStartMs: 0, trimEndMs: 0 };
  return {
    source: String(input?.source || '').trim(),
    trimStartMs: Math.max(0, Number(input?.trimStartMs) || 0),
    trimEndMs: Math.max(0, Number(input?.trimEndMs) || 0),
    durationMs: Number.isFinite(Number(input?.durationMs)) ? Math.max(1, Number(input.durationMs)) : undefined,
    label: input?.label ? String(input.label) : undefined,
  };
}

export async function creativeStitchClips(
  storage: CreativeAssetStorage,
  input: {
    clips: StitchClipInput[];
    filename?: string;
    width?: number;
    height?: number;
    frameRate?: number;
    transition?: 'cut' | 'crossfade' | 'fade' | 'dip_to_black';
    transitionDurationMs?: number;
    audioHandling?: 'mute' | 'first';
    format?: 'mp4' | 'webm';
  },
): Promise<{ outputPath: string; outputRelPath: string; clipPlan: any[]; ffmpeg: any; asset: CreativeAssetRecord | null }> {
  const clips = (Array.isArray(input.clips) ? input.clips : []).map(normalizeStitchClip).filter((clip) => clip.source);
  if (!clips.length) throw new Error('creative_stitch_clips requires at least one clip.');
  const format = input.format || 'mp4';
  const width = Math.max(120, Math.round(Number(input.width) || 1280));
  const height = Math.max(120, Math.round(Number(input.height) || 720));
  const fps = Math.max(1, Math.round(Number(input.frameRate) || 30));
  const transition = input.transition || 'cut';
  let actualTransition = transition;
  let fallbackReason: string | null = null;
  const requestedTransitionDurationMs = Number.isFinite(Number(input.transitionDurationMs)) ? Number(input.transitionDurationMs) : 500;
  const transitionSec = transition === 'cut' ? 0 : Math.max(0.05, Math.min(3, requestedTransitionDurationMs / 1000));
  const outDir = path.join(storage.creativeDir, 'exports');
  ensureDir(outDir);
  const fileName = sanitizeSegment(input.filename || `stitched-${Date.now().toString(36)}.${format}`, `stitched.${format}`);
  const outputPath = path.join(outDir, fileName.toLowerCase().endsWith(`.${format}`) ? fileName : `${fileName}.${format}`);
  ensureInside(storage.rootAbsPath, outputPath);
  const resolved: any[] = [];
  for (const clip of clips) {
    const source = resolveLocalSource(storage, clip.source);
    const asset = await analyzeCreativeAsset(storage, { source: source.absPath, tags: ['stitch-source'], upsert: true });
    const probedMs = await probeDurationMs(source.absPath, asset.durationMs);
    const activeMs = Math.max(1, Number(clip.durationMs) || Math.max(1, Number(probedMs || 0) - clip.trimStartMs - clip.trimEndMs));
    resolved.push({ ...clip, absPath: source.absPath, path: source.relPath, asset, durationMs: activeMs });
  }
  const buildArgs = (transitionMode: typeof transition): string[] => {
  const args: string[] = ['-y'];
  for (const clip of resolved) args.push('-i', clip.absPath);
  const filters: string[] = [];
  for (let i = 0; i < resolved.length; i += 1) {
    const clip = resolved[i];
    const start = clip.trimStartMs / 1000;
    const end = (clip.trimStartMs + clip.durationMs) / 1000;
    filters.push(`[${i}:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p[v${i}]`);
  }
  let videoLabel = '';
  if (resolved.length === 1) {
    videoLabel = '[v0]';
  } else if (transitionMode === 'cut') {
    videoLabel = '[vout]';
    filters.push(`${resolved.map((_, i) => `[v${i}]`).join('')}concat=n=${resolved.length}:v=1:a=0${videoLabel}`);
  } else {
    let previous = '[v0]';
    let elapsed = resolved[0].durationMs / 1000;
    for (let i = 1; i < resolved.length; i += 1) {
      const out = i === resolved.length - 1 ? '[vout]' : `[vx${i}]`;
      const offset = Math.max(0.1, elapsed - transitionSec);
      const xfade = transitionMode === 'dip_to_black' ? 'fadeblack' : 'fade';
      filters.push(`${previous}[v${i}]xfade=transition=${xfade}:duration=${transitionSec.toFixed(3)}:offset=${offset.toFixed(3)}${out}`);
      previous = out;
      elapsed += resolved[i].durationMs / 1000 - transitionSec;
    }
    videoLabel = '[vout]';
  }
  const filterComplex = filters.join(';');
  args.push('-filter_complex', filterComplex, '-map', videoLabel);
  if (input.audioHandling === 'first' && resolved.length) {
    // Keep the full stitched video duration. The first clip's audio is useful as
    // a scratch bed, but it must not truncate the concatenated visual timeline.
    args.push('-map', '0:a?', '-c:a', format === 'mp4' ? 'aac' : 'libopus');
  } else {
    args.push('-an');
  }
  args.push('-c:v', format === 'mp4' ? 'libx264' : 'libvpx-vp9', '-pix_fmt', 'yuv420p', ...(format === 'mp4' ? ['-movflags', '+faststart'] : []), outputPath);
  return args;
  };
  try {
    await execFileAsync(ffmpegInstaller.path, buildArgs(transition), { windowsHide: true, maxBuffer: 1024 * 1024 * 32 });
  } catch (err: any) {
    if (transition !== 'cut' && /No such filter:\s*'xfade'|xfade/i.test(String(err?.stderr || err?.message || err))) {
      actualTransition = 'cut';
      fallbackReason = 'Bundled FFmpeg does not include xfade; rendered normalized cuts instead.';
      await execFileAsync(ffmpegInstaller.path, buildArgs('cut'), { windowsHide: true, maxBuffer: 1024 * 1024 * 32 });
    } else {
      throw err;
    }
  }
  const asset = await importCreativeAsset(storage, { source: outputPath, tags: ['stitched-video', 'generated-sequence'], copy: false });
  return {
    outputPath,
    outputRelPath: buildWorkspaceRelativePath(storage.workspacePath, outputPath),
    clipPlan: resolved.map(({ absPath, asset, ...clip }) => ({ ...clip, assetId: asset?.id || null })),
    ffmpeg: { transitionRequested: transition, transition: actualTransition, transitionDurationMs: Math.round(transitionSec * 1000), width, height, frameRate: fps, audioHandling: input.audioHandling || 'mute', fallbackReason },
    asset,
  };
}

export async function creativeAutoAssembleRoughCut(
  storage: CreativeAssetStorage,
  input: {
    projectId?: string;
    storyboardId?: string;
    storyboardPath?: string;
    selectedTakes?: Record<string, { outputPath: string; score?: number | null }>;
    videos?: Array<string | { source: string; shotId?: string; trimStartMs?: number; trimEndMs?: number; durationMs?: number; label?: string }>;
    filename?: string;
    width?: number;
    height?: number;
    frameRate?: number;
    transition?: 'cut' | 'crossfade' | 'fade' | 'dip_to_black';
    transitionDurationMs?: number;
    defaultTrimStartMs?: number;
    defaultTrimEndMs?: number;
    format?: 'mp4' | 'webm';
    audioHandling?: 'mute' | 'first';
  },
): Promise<{ project: CreativeProjectDoc | null; storyboard: CreativeStoryboardDoc | null; timeline: any; stitched: any }> {
  let project: CreativeProjectDoc | null = input.projectId ? creativeGetProject(storage, { projectId: input.projectId }) : null;
  const storyboard = input.storyboardId || input.storyboardPath
    ? creativeGetStoryboard(storage, { storyboardId: input.storyboardId, path: input.storyboardPath })
    : project?.storyboard?.id || project?.storyboard?.path
      ? creativeGetStoryboard(storage, { storyboardId: project.storyboard.id || undefined, path: project.storyboard.path || undefined })
      : null;
  const clips: any[] = [];
  const selectedTakes = input.selectedTakes || project?.selectedTakes || {};
  if (Array.isArray(input.videos) && input.videos.length) {
    for (let i = 0; i < input.videos.length; i += 1) {
      const item: any = input.videos[i];
      const source = typeof item === 'string' ? item : String(item.source || '');
      if (!source) continue;
      clips.push({
        source,
        shotId: typeof item === 'string' ? `clip-${i + 1}` : (item.shotId || `clip-${i + 1}`),
        trimStartMs: Math.max(0, Number(item.trimStartMs ?? input.defaultTrimStartMs) || 0),
        trimEndMs: Math.max(0, Number(item.trimEndMs ?? input.defaultTrimEndMs) || 0),
        durationMs: Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : undefined,
        label: typeof item === 'string' ? `Clip ${i + 1}` : (item.label || item.shotId || `Clip ${i + 1}`),
      });
    }
  } else if (storyboard) {
    for (const shot of storyboard.shots) {
      const take = selectedTakes[shot.shotId];
      if (!take?.outputPath) continue;
      const qaScore = Number(take.score);
      clips.push({
        source: take.outputPath,
        shotId: shot.shotId,
        trimStartMs: Number.isFinite(qaScore) && qaScore < 78 ? Math.max(150, Number(input.defaultTrimStartMs) || 0) : Math.max(0, Number(input.defaultTrimStartMs) || 0),
        trimEndMs: Number.isFinite(qaScore) && qaScore < 78 ? Math.max(150, Number(input.defaultTrimEndMs) || 0) : Math.max(0, Number(input.defaultTrimEndMs) || 0),
        label: shot.title || shot.shotId,
      });
    }
  }
  if (!clips.length) throw new Error('creative_auto_assemble_rough_cut found no selected takes or videos to assemble.');
  const stitched = await creativeStitchClips(storage, {
    clips,
    filename: input.filename || `${project ? sanitizeSegment(project.title) : 'rough-cut'}-${Date.now().toString(36)}.${input.format || 'mp4'}`,
    width: input.width || project?.target.width || undefined,
    height: input.height || project?.target.height || undefined,
    frameRate: input.frameRate || project?.target.frameRate || undefined,
    transition: input.transition || 'cut',
    transitionDurationMs: input.transitionDurationMs,
    audioHandling: input.audioHandling || 'mute',
    format: input.format || 'mp4',
  });
  const timeline: any = {
    kind: 'prometheus-creative-rough-cut-timeline',
    version: 1,
    id: id('roughcut'),
    projectId: project?.id || null,
    storyboardId: storyboard?.id || null,
    clips,
    outputPath: stitched.outputRelPath,
    transition: stitched.ffmpeg,
    createdAt: nowIso(),
  };
  const timelineDir = path.join(storage.creativeDir, 'rough-cuts');
  ensureDir(timelineDir);
  const timelineAbsPath = path.join(timelineDir, `${timeline.id}.json`);
  ensureInside(storage.rootAbsPath, timelineAbsPath);
  fs.writeFileSync(timelineAbsPath, JSON.stringify(timeline, null, 2), 'utf-8');
  timeline.path = buildWorkspaceRelativePath(storage.workspacePath, timelineAbsPath);
  if (project) {
    project.roughCuts.push({ id: timeline.id, path: timeline.path, outputPath: stitched.outputRelPath, clipCount: clips.length, createdAt: timeline.createdAt });
    project.exports.push({ kind: 'rough_cut', outputPath: stitched.outputRelPath, assetId: stitched.asset?.id || null, createdAt: timeline.createdAt });
    writeProject(storage, project);
  }
  return { project, storyboard, timeline, stitched };
}

export async function creativeRenderGeneratedSequence(
  storage: CreativeAssetStorage,
  input: {
    videos: Array<string | { source: string; trimStartMs?: number; trimEndMs?: number; durationMs?: number; label?: string }>;
    filename?: string;
    width?: number;
    height?: number;
    frameRate?: number;
    fit?: 'cover' | 'contain' | 'fill';
    format?: 'mp4' | 'webm';
    transition?: 'cut' | 'crossfade' | 'fade' | 'dip_to_black';
    transitionDurationMs?: number;
    audioHandling?: 'mute' | 'first';
    renderMode?: 'ffmpeg' | 'html-motion';
  },
): Promise<{ outputPath: string; outputRelPath: string; composition: any; clips: any[]; render: any }> {
  const videos = (Array.isArray(input.videos) ? input.videos : []).filter(Boolean);
  if (!videos.length) throw new Error('creative_render_generated_sequence requires at least one video.');
  if (input.renderMode !== 'html-motion') {
    const stitched = await creativeStitchClips(storage, {
      clips: videos as StitchClipInput[],
      filename: input.filename,
      width: input.width,
      height: input.height,
      frameRate: input.frameRate,
      transition: input.transition,
      transitionDurationMs: input.transitionDurationMs,
      audioHandling: input.audioHandling,
      format: input.format,
    });
    return {
      outputPath: stitched.outputPath,
      outputRelPath: stitched.outputRelPath,
      composition: { kind: 'ffmpeg-stitch', transition: stitched.ffmpeg.transition },
      clips: stitched.clipPlan,
      render: stitched,
    };
  }
  const wrapped = [];
  for (let i = 0; i < videos.length; i += 1) {
    wrapped.push(await creativeWrapVideoAsHtmlMotionClip(storage, {
      source: typeof videos[i] === 'string' ? videos[i] as string : (videos[i] as any).source,
      width: input.width,
      height: input.height,
      frameRate: input.frameRate,
      fit: input.fit,
      title: `generated-sequence-${i + 1}`,
      filename: `generated-sequence-${Date.now().toString(36)}-${i + 1}.html`,
    }));
  }
  const width = Math.max(120, Math.round(Number(input.width) || wrapped[0].width || 1280));
  const height = Math.max(120, Math.round(Number(input.height) || wrapped[0].height || 720));
  const frameRate = Math.max(1, Math.round(Number(input.frameRate) || 30));
  const composition = createEmptyComposition({
    width,
    height,
    frameRate,
    durationMs: wrapped.reduce((total, clip) => total + clip.durationMs, 0),
    background: '#000000',
  });
  const trackId = composition.tracks.find((track) => track.kind === 'video')?.id;
  let atMs = 0;
  for (const clip of wrapped) {
    addClip(composition, {
      trackId,
      lane: 'html-motion',
      source: { kind: 'html-motion', clipPath: clip.clipPath, compositionId: path.basename(clip.clipPath, '.html') },
      atMs,
      durationMs: clip.durationMs,
      label: clip.asset.name || 'Generated clip',
    });
    atMs += clip.durationMs;
  }
  const format = input.format || 'mp4';
  const outDir = path.join(storage.creativeDir, 'exports');
  ensureDir(outDir);
  const fileName = sanitizeSegment(input.filename || `generated-sequence-${Date.now().toString(36)}.${format}`, `generated-sequence.${format}`);
  const outputPath = path.join(outDir, fileName.toLowerCase().endsWith(`.${format}`) ? fileName : `${fileName}.${format}`);
  ensureInside(storage.rootAbsPath, outputPath);
  const render = await renderComposition({
    composition,
    workspacePath: storage.workspacePath,
    outputPath,
    format,
  });
  return {
    outputPath,
    outputRelPath: buildWorkspaceRelativePath(storage.workspacePath, outputPath),
    composition,
    clips: wrapped,
    render,
  };
}
