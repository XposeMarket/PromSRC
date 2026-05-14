/**
 * Bridges scene-graph `hyperframes` elements to the existing html-motion
 * render pipeline (composition_renderer.ts:renderHtmlMotionFrames).
 *
 * That renderer drives `__PROMETHEUS_HTML_MOTION_TIME_MS__` and dispatches
 * `prometheus-html-motion-seek` events. Our HF runtime bridge (added to
 * hyperframesRuntimeShim() in hyperframes-catalog.ts) forwards those events
 * into the official HF runtime's timelines via postMessage. So as long as
 * the HF clip is materialized as an .html file with the runtime inlined,
 * the existing renderer "just works" — we don't need a new code path.
 *
 * This module materializes the HTML to a deterministic on-disk path inside
 * the workspace and returns the descriptor the renderer expects.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { wrapForIframePreview } from './hyperframes-bridge';
import type { CreativeClip } from './contracts';

export type HyperframesClipMaterializeInput = {
  workspacePath: string;
  elementId: string;
  html: string;
  compositionId?: string | null;
};

export type HyperframesClipMaterialized = {
  clipPath: string;        // workspace-relative path the renderer will load
  absClipPath: string;
  compositionId: string;
  contentHash: string;
};

const TIMING_ATTR_PATTERN = /\b(data-(?:start|duration|end|media-start|media-offset|trim-start|offset|from))=(["'])(-?\d+(?:\.\d+)?)(ms|s)?\2/gi;

function escapeAttr(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readAttr(attrs: string, name: string): string | null {
  const exact = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs);
  if (exact) return exact[2] || '';
  const bare = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*([^\\s"'=<>` + '`' + `]+)`, 'i').exec(attrs);
  return bare ? (bare[1] || '') : null;
}

function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}(?:\\s*=|\\b)`, 'i').test(attrs);
}

function upsertAttr(attrs: string, name: string, value: unknown): string {
  const escaped = escapeAttr(value);
  const quoted = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["']).*?\\1`, 'i');
  if (quoted.test(attrs)) return attrs.replace(quoted, `${name}="${escaped}"`);
  const bare = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*[^\\s"'=<>` + '`' + `]+`, 'i');
  if (bare.test(attrs)) return attrs.replace(bare, `${name}="${escaped}"`);
  return `${attrs}${attrs.trim() ? ' ' : ''}${name}="${escaped}"`;
}

function removeAttr(attrs: string, name: string): string {
  return attrs
    .replace(new RegExp(`\\s*\\b${escapeRegExp(name)}\\s*=\\s*(["']).*?\\1`, 'ig'), '')
    .replace(new RegExp(`\\s*\\b${escapeRegExp(name)}\\s*=\\s*[^\\s"'=<>` + '`' + `]+`, 'ig'), '')
    .trim();
}

function parseHyperframesMs(raw: unknown): number | null {
  const match = String(raw ?? '').trim().match(/^(-?\d+(?:\.\d+)?)(ms|s)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = String(match[2] || '').toLowerCase();
  return Math.round(unit === 'ms' ? value : value * 1000);
}

function readRootMetadata(html: string, fallbackCompositionId: string) {
  const htmlAttrs = html.match(/<html\b([^>]*)>/i)?.[1] || '';
  const stageAttrs = html.match(/<([a-z][a-z0-9:-]*)\b([^<>]*\bid=["']stage["'][^<>]*)>/i)?.[2] || '';
  const compositionId = readAttr(stageAttrs, 'data-composition-id')
    || readAttr(htmlAttrs, 'data-composition-id')
    || fallbackCompositionId;
  const width = Math.round(Number(readAttr(stageAttrs, 'data-width') || readAttr(htmlAttrs, 'data-composition-width') || 0)) || 1080;
  const height = Math.round(Number(readAttr(stageAttrs, 'data-height') || readAttr(htmlAttrs, 'data-composition-height') || 0)) || 1920;
  const durationMs = parseHyperframesMs(readAttr(stageAttrs, 'data-duration') || readAttr(htmlAttrs, 'data-composition-duration')) || 6000;
  const frameRate = Math.round(Number(readAttr(stageAttrs, 'data-frame-rate') || readAttr(stageAttrs, 'data-fps') || 0)) || 60;
  return { compositionId, width, height, durationMs, frameRate };
}

function trimNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function toHtmlMotionTime(_match: string, attr: string, quote: string, value: string, unit = ''): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return _match;
  const seconds = String(unit || '').toLowerCase() === 'ms' ? numeric / 1000 : numeric;
  return `${attr}=${quote}${trimNumber(seconds)}s${quote}`;
}

function convertHyperframesTimingToHtmlMotion(html: string): string {
  return String(html || '').replace(TIMING_ATTR_PATTERN, toHtmlMotionTime);
}

function inferHtmlMotionRole(tag: string, attrs: string): string {
  const classes = String(readAttr(attrs, 'class') || '').toLowerCase();
  const src = String(readAttr(attrs, 'src') || readAttr(attrs, 'href') || '').toLowerCase();
  if (tag === 'video' || tag === 'audio' || tag === 'img' || /\b(media|image|video|avatar|logo|photo)\b/.test(classes) || src) return 'media';
  if (tag === 'svg' || /\b(chart|graph|axis|bar|line)\b/.test(classes)) return 'chart';
  if (/\b(cta|button|url|pill|subscribe|follow)\b/.test(classes)) return 'cta';
  if (/^(h[1-6]|p|span|strong|em|small)$/.test(tag) || /\b(title|subtitle|headline|eyebrow|caption|text|tagline)\b/.test(classes)) return 'caption';
  if (/\b(transition|wipe|blur|glitch|grain|shader)\b/.test(classes)) return 'transition';
  return 'overlay';
}

function normalizeHtmlMotionTimedTags(html: string): string {
  let generatedId = 0;
  let timedIndex = 0;
  return String(html || '').replace(/<([a-z][a-z0-9:-]*)\b([^<>]*?)>/gi, (match, rawTag, rawAttrs) => {
    const tag = String(rawTag || '').toLowerCase();
    if (tag === 'html' || tag === 'head' || tag === 'body' || tag === 'script' || tag === 'style' || match.endsWith('/>')) return match;
    let attrs = String(rawAttrs || '');
    const isStage = readAttr(attrs, 'id') === 'stage';
    const hasTiming = ['data-start', 'data-duration', 'data-end', 'data-track-index'].some((name) => hasAttr(attrs, name));
    if (!isStage && !hasTiming) return match;
    if (!isStage) timedIndex += 1;
    if (!hasAttr(attrs, 'id')) {
      generatedId += 1;
      const className = String(readAttr(attrs, 'class') || '').split(/\s+/).find(Boolean) || tag;
      attrs = upsertAttr(attrs, 'id', `hf-${className.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || tag}-${timedIndex || generatedId}`);
    }
    if (!hasAttr(attrs, 'data-role')) attrs = upsertAttr(attrs, 'data-role', isStage ? 'scene' : inferHtmlMotionRole(tag, attrs));
    if (!hasAttr(attrs, 'data-track-index')) attrs = upsertAttr(attrs, 'data-track-index', isStage ? -1 : timedIndex);
    return `<${rawTag}${attrs ? ` ${attrs.trim()}` : ''}>`;
  });
}

function prepareHyperframesHtmlMotionFallback(html: string, fallbackCompositionId: string): string {
  let source = wrapForIframePreview(String(html || ''));
  const metadata = readRootMetadata(source, fallbackCompositionId);
  source = source.replace(/<([a-z][a-z0-9:-]*)\b([^<>]*\bid=["']stage["'][^<>]*)>/i, (match, tag, rawAttrs) => {
    let attrs = String(rawAttrs || '');
    attrs = upsertAttr(attrs, 'data-composition-id', metadata.compositionId);
    attrs = upsertAttr(attrs, 'data-width', metadata.width);
    attrs = upsertAttr(attrs, 'data-height', metadata.height);
    attrs = upsertAttr(attrs, 'data-duration', `${trimNumber(metadata.durationMs / 1000)}s`);
    attrs = upsertAttr(attrs, 'data-frame-rate', metadata.frameRate);
    attrs = upsertAttr(attrs, 'data-role', 'scene');
    attrs = upsertAttr(attrs, 'data-track-index', -1);
    return `<${tag}${attrs ? ` ${attrs.trim()}` : ''}>`;
  });
  source = source.replace(/<html\b([^>]*)>/i, (match, rawAttrs) => {
    let attrs = String(rawAttrs || '');
    attrs = removeAttr(attrs, 'data-width');
    attrs = removeAttr(attrs, 'data-height');
    attrs = removeAttr(attrs, 'data-duration');
    return `<html${attrs ? ` ${attrs}` : ''}>`;
  });
  source = convertHyperframesTimingToHtmlMotion(source);
  source = normalizeHtmlMotionTimedTags(source);
  return source;
}

export function materializeHyperframesClip(input: HyperframesClipMaterializeInput): HyperframesClipMaterialized {
  const compositionId = String(input.compositionId || `hyperframes-${input.elementId}`);
  const html = prepareHyperframesHtmlMotionFallback(String(input.html || ''), compositionId);
  const contentHash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);
  const dir = path.join(input.workspacePath, '.prometheus', 'creative', 'hyperframes-clips');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${compositionId}-${contentHash}.html`;
  const absClipPath = path.join(dir, filename);
  // Write only if absent (deterministic by content hash).
  if (!fs.existsSync(absClipPath)) {
    fs.writeFileSync(absClipPath, html, 'utf8');
  }
  const clipPath = path.relative(input.workspacePath, absClipPath).replace(/\\/g, '/');
  return { clipPath, absClipPath, compositionId, contentHash };
}

/**
 * Adapt a hyperframes scene element into a CreativeClip-shaped descriptor
 * the existing renderer accepts. Caller provides timing context (start/end
 * within the parent composition).
 */
export function buildHyperframesRenderClip(
  element: any,
  workspacePath: string,
  timing: { startMs: number; endMs: number; trimStartMs?: number },
): CreativeClip & { type: 'hyperframes'; startMs: number; endMs: number; materialized: HyperframesClipMaterialized } {
  if (!element || element.type !== 'hyperframes') {
    throw new Error('buildHyperframesRenderClip requires element.type === "hyperframes"');
  }
  const html = String(element.meta?.html || '');
  if (!html.trim()) throw new Error('HyperFrames element has no html source.');
  const materialized = materializeHyperframesClip({
    workspacePath,
    elementId: element.id,
    html,
    compositionId: element.meta?.compositionId,
  });
  const startMs = Math.max(0, Number(timing.startMs) || 0);
  const endMs = Math.max(startMs + 1, Number(timing.endMs) || 0);
  return {
    id: element.id,
    type: 'hyperframes' as const,
    trackId: String(element.trackId || 'track_hyperframes'),
    label: String(element.label || element.meta?.compositionId || 'HyperFrames clip'),
    inMs: startMs,
    outMs: endMs,
    startMs,
    endMs,
    trimStartMs: Math.max(0, Number(timing.trimStartMs) || 0),
    trimEndMs: 0,
    lane: 'html-motion' as const,
    source: {
      kind: 'html-motion' as const,
      clipPath: materialized.clipPath,
      compositionId: materialized.compositionId,
    },
    transitionIn: null,
    transitionOut: null,
    locked: false,
    meta: {
      sourceType: 'hyperframes',
      compositionId: materialized.compositionId,
      contentHash: materialized.contentHash,
    },
    materialized,
  };
}
