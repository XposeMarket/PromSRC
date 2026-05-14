/**
 * @hyperframes/player evaluation (2026-05-07):
 *
 * The player package ships a `<hyperframes-player>` custom element that wraps
 * an iframe with its own controls (play/pause/seek/speed bar), poster,
 * shader-loading UI, and a parent-frame audio proxy for mobile autoplay
 * fallback. It's a heavier abstraction than we need: Prometheus owns the
 * timeline UI, scrubber, and export, so the player's controls would either
 * be hidden (wasting bytes) or compete with ours.
 *
 * Decision: stick with our minimal createHyperframesPreview driving the
 * runtime via postMessage. Revisit the player package if we hit mobile
 * autoplay issues — its audio proxy logic is non-trivial and worth borrowing
 * (not depending on) if we extend Prometheus to mobile clients.
 */

/**
 * HyperFrames bridge — thin Prometheus-shaped layer over @hyperframes/core.
 *
 * Replaces the regex-based logic in hyperframes-catalog.ts with the official
 * parsers, generators, linter, and runtime. Exposes patch operations the
 * canvas can call to mutate imported HyperFrames HTML while keeping source
 * as the editing source of truth.
 */

import fs from 'fs';
import path from 'path';

type ParsedHtml = any;
type CompositionMetadata = any;
type GsapAnimation = any;

function installServerDomParser(): void {
  const globalRef = globalThis as any;
  if (typeof globalRef.DOMParser === 'function') return;
  try {
    // @hyperframes/core's parser path expects the browser DOMParser global.
    // Creative tools execute in Node, so provide a small WHATWG-compatible DOM
    // implementation before loading the core bundle.
    const { DOMParser } = require('linkedom');
    if (typeof DOMParser === 'function') {
      globalRef.DOMParser = DOMParser;
    }
  } catch (err: any) {
    throw new Error(`HyperFrames server DOMParser unavailable: ${err?.message || err}`);
  }
}

installServerDomParser();

const hyperframesCore = require(path.resolve(__dirname, '../../../node_modules/@hyperframes/core/dist/index.js'));

const {
  parseHtml,
  updateElementInHtml,
  addElementToHtml,
  removeElementFromHtml,
  validateCompositionHtml,
  extractCompositionMetadata,
  generateHyperframesHtml,
  lintHyperframeHtml,
  getHyperframeRuntimeScript,
  HYPERFRAME_BRIDGE_SOURCES,
  HYPERFRAME_CONTROL_ACTIONS,
  parseGsapScript,
  addAnimationToScript,
  updateAnimationInScript,
  removeAnimationFromScript,
  validateCompositionGsap,
} = hyperframesCore;

/**
 * Patch op taxonomy:
 *
 *   Typed ops (route through @hyperframes/core's updateElementInHtml — safe,
 *   schema-validated, work without IDs because the HF parser identifies
 *   elements by their internal id):
 *     set-text, set-position, set-size, set-opacity, set-color, set-font-size,
 *     set-src, set-timing, update-element, add-element, remove-element
 *
 *   Raw ops (regex fallback for arbitrary HTML attributes/styles HF doesn't
 *   model — safe ONLY for ID-anchored elements; warns otherwise):
 *     set-attribute, set-style
 *
 *   Convenience:
 *     set-asset (rewrites src to {{asset.<id>}} placeholder)
 */
export type HyperframesPatchOp =
  | { op: 'set-text'; elementId: string; text: string }
  | { op: 'set-position'; elementId: string; x?: number; y?: number }
  | { op: 'set-size'; elementId: string; scale?: number }
  | { op: 'set-opacity'; elementId: string; opacity: number }
  | { op: 'set-color'; elementId: string; color: string }
  | { op: 'set-font-size'; elementId: string; fontSize: number }
  | { op: 'set-src'; elementId: string; src: string }
  | { op: 'set-timing'; elementId: string; startMs?: number; durationMs?: number; zIndex?: number }
  | { op: 'set-asset'; elementId: string; assetPlaceholderId: string }
  | { op: 'add-element'; element: any }
  | { op: 'remove-element'; elementId: string }
  | { op: 'update-element'; elementId: string; updates: Record<string, any> }
  | { op: 'set-attribute'; elementId: string; name: string; value: string }
  | { op: 'set-style'; elementId: string; property: string; value: string }
  | { op: 'set-variable'; name: string; value: any }
  | { op: 'set-variables'; values: Record<string, any> }
  // GSAP animation patches (Stretch — operate on the embedded script tag).
  | { op: 'add-animation'; animation: Omit<GsapAnimation, 'id'> }
  | { op: 'update-animation'; animationId: string; updates: Partial<GsapAnimation> }
  | { op: 'remove-animation'; animationId: string };

export type HyperframesPatchResult = {
  html: string;
  ops: HyperframesPatchOp[];
  warnings: string[];
};

export type HyperframesParseResult = {
  parsed: ParsedHtml;
  metadata: CompositionMetadata;
};

export const BRIDGE_SOURCES = HYPERFRAME_BRIDGE_SOURCES;
export const BRIDGE_ACTIONS = HYPERFRAME_CONTROL_ACTIONS;

export function parseHyperframesHtml(html: string): HyperframesParseResult {
  const normalized = normalizeForHyperframes(String(html || ''));
  return {
    parsed: parseHtml(normalized),
    metadata: extractCompositionMetadata(normalized),
  };
}

export function lintHyperframes(html: string) {
  const original = String(html || '');
  const hasPrometheusGsapShim = /data-prometheus-hyperframes-runtime=(["'])legacy\1/.test(original);
  const source = original
    .replace(/<script\b[^>]*data-hyperframes-runtime[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*data-hyperframes-gsap[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*data-hyperframes-timeline-compat[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b(?=[^>]*data-prometheus-hyperframes-runtime=(["'])true\1)[^>]*>[\s\S]*?<\/script>/gi, '');
  const lint = lintHyperframeHtml(source);
  if (!hasPrometheusGsapShim || !Array.isArray((lint as any).findings)) return lint;
  const findings = (lint as any).findings.filter((finding: any) => finding?.code !== 'missing_gsap_script');
  const errorCount = findings.filter((finding: any) => finding?.severity === 'error').length;
  const warningCount = findings.filter((finding: any) => finding?.severity === 'warning').length;
  const infoCount = findings.filter((finding: any) => finding?.severity === 'info').length;
  return {
    ...(lint as any),
    ok: errorCount === 0,
    valid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    findings,
  };
}

export function validateHyperframes(html: string) {
  return validateCompositionHtml(String(html || ''));
}

export function applyHyperframesPatch(html: string, ops: HyperframesPatchOp[]): HyperframesPatchResult {
  const warnings: string[] = [];
  let next = String(html || '');
  for (const op of ops) {
    try {
      if (op.op === 'remove-element') {
        next = removeElementFromHtml(next, op.elementId);
        continue;
      }
      if (op.op === 'add-element') {
        const result = addElementToHtml(next, op.element);
        next = result.html;
        continue;
      }
      if (op.op === 'update-element') {
        next = updateElementInHtml(next, op.elementId, op.updates as any);
        continue;
      }
      if (op.op === 'set-text') {
        next = updateElementInHtml(next, op.elementId, { content: op.text } as any);
        continue;
      }
      if (op.op === 'set-position') {
        const updates: Record<string, any> = {};
        if (typeof op.x === 'number') updates.x = op.x;
        if (typeof op.y === 'number') updates.y = op.y;
        next = updateElementInHtml(next, op.elementId, updates as any);
        continue;
      }
      if (op.op === 'set-size') {
        if (typeof op.scale === 'number') {
          next = updateElementInHtml(next, op.elementId, { scale: op.scale } as any);
        }
        continue;
      }
      if (op.op === 'set-opacity') {
        next = updateElementInHtml(next, op.elementId, { opacity: op.opacity } as any);
        continue;
      }
      if (op.op === 'set-color') {
        next = updateElementInHtml(next, op.elementId, { color: op.color } as any);
        continue;
      }
      if (op.op === 'set-font-size') {
        next = updateElementInHtml(next, op.elementId, { fontSize: op.fontSize } as any);
        continue;
      }
      if (op.op === 'set-src') {
        next = updateElementInHtml(next, op.elementId, { src: op.src } as any);
        continue;
      }
      if (op.op === 'set-timing') {
        // HF TimelineElementBase uses startTime + duration in seconds. Translate.
        const updates: Record<string, any> = {};
        if (typeof op.startMs === 'number') updates.startTime = op.startMs / 1000;
        if (typeof op.durationMs === 'number') updates.duration = op.durationMs / 1000;
        if (typeof op.zIndex === 'number') updates.zIndex = op.zIndex;
        next = updateElementInHtml(next, op.elementId, updates as any);
        next = writeTimingAttributes(next, op.elementId, {
          startSeconds: updates.startTime,
          durationSeconds: updates.duration,
          zIndex: updates.zIndex,
        });
        continue;
      }
      if (op.op === 'set-asset') {
        // Asset placeholders aren't part of the HF schema; route through src.
        next = updateElementInHtml(next, op.elementId, { src: `{{asset.${op.assetPlaceholderId}}}` } as any);
        continue;
      }
      if (op.op === 'set-variable') {
        const existing = readExistingVariableValues(next);
        existing[op.name] = op.value;
        next = applyHyperframesVariableValues(next, existing);
        continue;
      }
      if (op.op === 'set-variables') {
        const existing = readExistingVariableValues(next);
        next = applyHyperframesVariableValues(next, { ...existing, ...op.values });
        continue;
      }
      if (op.op === 'add-animation' || op.op === 'update-animation' || op.op === 'remove-animation') {
        next = patchEmbeddedGsapScript(next, op);
        continue;
      }
      if (op.op === 'set-attribute') {
        warnings.push(`set-attribute is a raw fallback (no HF API equivalent). Element: ${op.elementId}, attr: ${op.name}.`);
        next = patchAttribute(next, op.elementId, op.name, op.value);
        continue;
      }
      if (op.op === 'set-style') {
        warnings.push(`set-style is a raw fallback (no HF API equivalent). Element: ${op.elementId}, prop: ${op.property}.`);
        next = patchStyleProperty(next, op.elementId, op.property, op.value);
        continue;
      }
      warnings.push(`Unknown patch op: ${(op as any).op}`);
    } catch (err: any) {
      warnings.push(`Patch op failed (${op.op} on ${(op as any).elementId || ''}): ${err?.message || err}`);
    }
  }
  return { html: next, ops, warnings };
}

function patchAttribute(html: string, elementId: string, name: string, value: string): string {
  const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagPattern = new RegExp(`<([a-z][a-z0-9:-]*)\\b([^<>]*?\\bid=["']${escapedId}["'][^<>]*?)(\\/?)>`, 'i');
  return html.replace(tagPattern, (_match, tag, attrs, selfClose) => {
    const attrPattern = new RegExp(`\\b${escapedName}\\s*=\\s*(["']).*?\\1`, 'i');
    let nextAttrs = attrs;
    if (attrPattern.test(attrs)) {
      nextAttrs = attrs.replace(attrPattern, `${name}="${escapeAttr(value)}"`);
    } else {
      nextAttrs = `${attrs.replace(/\s*$/, '')} ${name}="${escapeAttr(value)}"`;
    }
    return `<${tag}${nextAttrs}${selfClose}>`;
  });
}

function patchStyleProperty(html: string, elementId: string, property: string, value: string): string {
  const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagPattern = new RegExp(`<([a-z][a-z0-9:-]*)\\b([^<>]*?\\bid=["']${escapedId}["'][^<>]*?)(\\/?)>`, 'i');
  return html.replace(tagPattern, (_match, tag, attrs, selfClose) => {
    const stylePattern = /\bstyle\s*=\s*(["'])(.*?)\1/i;
    let nextAttrs = attrs;
    if (stylePattern.test(attrs)) {
      nextAttrs = attrs.replace(stylePattern, (_full: string, quote: string, body: string) => {
        const filtered = body
          .split(';')
          .map((decl: string) => decl.trim())
          .filter((decl: string) => decl && !decl.toLowerCase().startsWith(`${property.toLowerCase()}:`))
          .concat([`${property}: ${value}`])
          .join('; ');
        return `style=${quote}${filtered}${quote}`;
      });
    } else {
      nextAttrs = `${attrs.replace(/\s*$/, '')} style="${property}: ${escapeAttr(value)}"`;
    }
    return `<${tag}${nextAttrs}${selfClose}>`;
  });
}

function escapeAttr(value: string): string {
  return String(value || '').replace(/"/g, '&quot;');
}

/**
 * GSAP animations live inside an embedded <script> tag. We extract the
 * largest such script, run the requested mutation through @hyperframes/core's
 * gsapParser, and stitch it back. Multiple GSAP scripts in one document is
 * not common in HF compositions; if it happens, we operate on the first.
 */
function patchEmbeddedGsapScript(
  html: string,
  op:
    | { op: 'add-animation'; animation: Omit<GsapAnimation, 'id'> }
    | { op: 'update-animation'; animationId: string; updates: Partial<GsapAnimation> }
    | { op: 'remove-animation'; animationId: string },
): string {
  const source = String(html || '');
  // Look for inline scripts containing gsap. or .timeline(.
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  let chosen: { full: string; attrs: string; body: string; index: number } | null = null;
  while ((match = scriptPattern.exec(source)) !== null) {
    const body = match[2] || '';
    if (/\bgsap\.|\.timeline\(/.test(body) && !/data-prometheus-hyperframes-runtime/.test(match[1] || '')) {
      chosen = { full: match[0], attrs: match[1] || '', body, index: match.index };
      break;
    }
  }
  if (!chosen) return source; // nothing to patch
  let nextBody = chosen.body;
  try {
    if (op.op === 'add-animation') {
      const result = addAnimationToScript(chosen.body, op.animation as any);
      nextBody = (result && typeof result === 'object' && 'script' in result) ? (result as any).script : (result as any);
    } else if (op.op === 'update-animation') {
      nextBody = updateAnimationInScript(chosen.body, op.animationId, op.updates as any);
    } else if (op.op === 'remove-animation') {
      nextBody = removeAnimationFromScript(chosen.body, op.animationId);
    }
  } catch {
    return source;
  }
  return source.replace(chosen.full, `<script${chosen.attrs}>${nextBody}</script>`);
}

export function listHyperframesAnimations(html: string): GsapAnimation[] {
  const source = String(html || '');
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(source)) !== null) {
    const body = match[1] || '';
    if (/\bgsap\.|\.timeline\(/.test(body)) {
      try {
        const parsed = parseGsapScript(body);
        if (parsed && Array.isArray(parsed.animations) && parsed.animations.length) {
          return parsed.animations;
        }
      } catch {
        /* fall through to next script */
      }
    }
  }
  return [];
}

export function validateHyperframesGsap(html: string) {
  const source = String(html || '');
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(source)) !== null) {
    const body = match[1] || '';
    if (/\bgsap\.|\.timeline\(/.test(body)) {
      return validateCompositionGsap(body);
    }
  }
  return { valid: true, errors: [], warnings: [] };
}

function readExistingVariableValues(html: string): Record<string, any> {
  const match = /<html\b[^>]*\bdata-composition-variable-values\s*=\s*(["'])(.*?)\1/i.exec(String(html || ''));
  if (!match) return {};
  try {
    const raw = match[2].replace(/&quot;/g, '"');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Returns the official HyperFrames runtime IIFE. This replaces our hand-rolled
 * GSAP shim in hyperframes-catalog.ts. The runtime exposes:
 *   window.__player, window.__playerReady, window.__renderReady, window.__timelines,
 *   window.__HF_PICKER_API (hit-testing for click-to-select)
 * and listens to postMessage with source: 'hf-parent' for control actions.
 */
export function getHyperframesRuntimeScript(): string {
  return getHyperframeRuntimeScript();
}

export function escapeInlineScriptText(script: string): string {
  return String(script || '')
    .replace(/<\/script/gi, '<\\/script');
}

export function getHyperframesTimelineCompatScript(): string {
  return `(function(){
    if (window.__PROM_HF_TIMELINE_COMPAT__) return;
    window.__PROM_HF_TIMELINE_COMPAT__ = true;
    function number(value, fallback){
      var n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }
    function patchTimeline(key, timeline){
      if (!timeline || typeof timeline !== 'object') return timeline;
      if (timeline.__promHfCompatPatched) return timeline;
      var originalSeek = typeof timeline.seek === 'function' ? timeline.seek.bind(timeline) : null;
      var originalTime = typeof timeline.time === 'function' ? timeline.time.bind(timeline) : null;
      var originalDuration = timeline.duration;
      if (typeof originalDuration === 'function' && originalSeek && originalTime) {
        Object.defineProperty(timeline, '__promHfCompatPatched', { value: true, configurable: true });
        return timeline;
      }
      var durationSeconds = typeof originalDuration === 'function'
        ? number(originalDuration.call(timeline), 0)
        : number(originalDuration, number(timeline.durationSeconds, number(timeline.totalDuration, 0)));
      Object.defineProperty(timeline, '__promHfCompatPatched', { value: true, configurable: true });
      timeline.duration = function(){ return durationSeconds; };
      timeline.time = function(value){
        if (arguments.length === 0) return number(timeline.__promHfCurrentTime, 0);
        var seconds = number(value, 0);
        timeline.__promHfCurrentTime = seconds;
        if (originalTime) return originalTime(seconds, false);
        if (originalSeek) originalSeek(seconds);
        return timeline;
      };
      timeline.totalTime = timeline.time;
      timeline.seek = function(value){
        var seconds = number(value, 0);
        timeline.__promHfCurrentTime = seconds;
        if (originalSeek) originalSeek(seconds);
        else if (originalTime) originalTime(seconds, false);
        return timeline;
      };
      if (typeof timeline.pause !== 'function') timeline.pause = function(){ return timeline; };
      if (typeof timeline.play !== 'function') timeline.play = function(){ return timeline; };
      if (typeof timeline.timeScale !== 'function') timeline.timeScale = function(){ return timeline; };
      return timeline;
    }
    function patchRegistry(){
      var registry = window.__timelines || {};
      Object.keys(registry).forEach(function(key){ registry[key] = patchTimeline(key, registry[key]); });
    }
    window.__PROM_HF_PATCH_TIMELINES__ = patchRegistry;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchRegistry, { once: false });
    else setTimeout(patchRegistry, 0);
    window.addEventListener('prometheus-html-motion-seek', patchRegistry, true);
  })();`;
}

export function getHyperframesProducerBridgeScript(): string {
  return `(function(){
    if (window.__PROM_HF_PRODUCER_BRIDGE__) return;
    window.__PROM_HF_PRODUCER_BRIDGE__ = true;
    function number(value, fallback){
      var n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }
    function parseSeconds(value, fallback){
      if (value === undefined || value === null || value === '') return fallback;
      var raw = String(value).trim();
      var match = raw.match(/^(-?\\d+(?:\\.\\d+)?)(ms|s)?$/i);
      if (!match) return fallback;
      var n = Number(match[1]);
      if (!Number.isFinite(n)) return fallback;
      return String(match[2] || '').toLowerCase() === 'ms' ? n / 1000 : n;
    }
    function compositionRoot(){
      return document.querySelector('#stage,[data-composition-id]') || document.documentElement || document.body;
    }
    function compositionId(){
      var root = compositionRoot();
      return (root && root.getAttribute && root.getAttribute('data-composition-id'))
        || (document.documentElement && document.documentElement.getAttribute('data-composition-id'))
        || '';
    }
    function inferDuration(){
      var root = compositionRoot();
      var htmlDuration = document.documentElement && document.documentElement.getAttribute('data-composition-duration');
      var rootDuration = root && root.getAttribute && root.getAttribute('data-duration');
      var duration = parseSeconds(htmlDuration, parseSeconds(rootDuration, 0));
      if (duration > 0) return duration;
      var max = 0;
      Array.prototype.forEach.call(document.querySelectorAll('[data-start]'), function(el){
        var start = parseSeconds(el.getAttribute('data-start'), 0);
        var ownDuration = parseSeconds(el.getAttribute('data-duration'), null);
        var end = parseSeconds(el.getAttribute('data-end'), null);
        if (ownDuration !== null) max = Math.max(max, start + ownDuration);
        else if (end !== null) max = Math.max(max, end);
      });
      return max > 0 ? max : 6;
    }
    function seekTimeline(timeline, seconds){
      if (!timeline) return false;
      try { if (typeof timeline.pause === 'function') timeline.pause(); } catch (_) {}
      try {
        if (typeof timeline.totalTime === 'function') {
          timeline.totalTime(seconds, false);
          return true;
        }
      } catch (_) {}
      try {
        if (typeof timeline.time === 'function') {
          timeline.time(seconds, false);
          return true;
        }
      } catch (_) {}
      try {
        if (typeof timeline.seek === 'function') {
          timeline.seek(seconds, false);
          return true;
        }
      } catch (_) {}
      return false;
    }
    function seekTimelines(seconds){
      try {
        if (typeof window.__PROM_HF_PATCH_TIMELINES__ === 'function') window.__PROM_HF_PATCH_TIMELINES__();
      } catch (_) {}
      var registry = window.__timelines || {};
      var id = compositionId();
      var primary = id && registry[id] ? registry[id] : null;
      if (seekTimeline(primary, seconds)) return;
      Object.keys(registry).some(function(key){ return seekTimeline(registry[key], seconds); });
    }
    function seekMedia(seconds){
      Array.prototype.forEach.call(document.querySelectorAll('video,audio'), function(media){
        try {
          var offset = parseSeconds(media.getAttribute('data-media-start') || media.getAttribute('data-offset'), 0);
          media.pause && media.pause();
          media.currentTime = Math.max(0, seconds - offset);
        } catch (_) {}
      });
    }
    function seek(seconds){
      seconds = Math.max(0, number(seconds, 0));
      var milliseconds = seconds * 1000;
      window.__PROMETHEUS_HTML_MOTION_TIME_MS__ = milliseconds;
      window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__ = seconds;
      if (document.documentElement && document.documentElement.style) {
        document.documentElement.style.setProperty('--prometheus-time-ms', String(milliseconds));
        document.documentElement.style.setProperty('--prometheus-time', String(seconds));
        document.documentElement.style.setProperty('--hf-time', String(seconds));
      }
      seekTimelines(seconds);
      seekMedia(seconds);
      try {
        window.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', { detail: { timeMs: milliseconds, timeSeconds: seconds } }));
      } catch (_) {}
      try {
        window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time: seconds, timeMs: milliseconds } }));
      } catch (_) {}
      return true;
    }
    function install(){
      var current = window.__hf && typeof window.__hf === 'object' ? window.__hf : {};
      var nativeSeek = typeof current.seek === 'function' ? current.seek.bind(current) : null;
      var duration = number(current.duration, inferDuration());
      var bridge = {
        duration: duration > 0 ? duration : inferDuration(),
        seek: function(seconds){
          if (nativeSeek) {
            try {
              nativeSeek(seconds);
            } catch (_) {}
          }
          return seek(seconds);
        }
      };
      try {
        Object.defineProperty(window, '__hf', {
          value: bridge,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } catch (_) {
        window.__hf = bridge;
      }
      seek(0);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
    setTimeout(install, 0);
    setTimeout(install, 50);
    setTimeout(install, 250);
    setTimeout(install, 1000);
    setTimeout(install, 3000);
  })();`;
}

let cachedGsapScript: string | null | undefined;

export function getInlineGsapScript(): string | null {
  if (cachedGsapScript !== undefined) return cachedGsapScript;
  const candidates = [
    path.resolve(__dirname, '../../../node_modules/gsap/dist/gsap.min.js'),
    path.resolve(process.cwd(), 'node_modules/gsap/dist/gsap.min.js'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedGsapScript = fs.readFileSync(candidate, 'utf8');
        return cachedGsapScript;
      }
    } catch {
      /* try next candidate */
    }
  }
  cachedGsapScript = null;
  return null;
}

function shouldInlineGsap(html: string): boolean {
  const source = String(html || '');
  if (!/\bgsap\s*\.|window\.gsap\b|\.timeline\(/.test(source)) return false;
  return !/<script\b[^>]*\bsrc=["'][^"']*gsap[^"']*["'][^>]*>\s*<\/script>/i.test(source)
    && !/<script\b[^>]*data-hyperframes-gsap[^>]*>/i.test(source);
}

function injectGsapIfNeeded(html: string): string {
  if (!shouldInlineGsap(html)) return html;
  const gsap = getInlineGsapScript();
  if (!gsap) return html;
  const inline = `<script data-hyperframes-gsap="inline">\n${escapeInlineScriptText(gsap)}\n</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `${inline}\n</head>`);
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${inline}`);
  return html.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${inline}</head>`);
}

/**
 * Wraps a HyperFrames composition HTML for iframe preview by inlining the
 * official runtime so the parent can drive seek/play/pick via postMessage.
 */
export function wrapForIframePreview(html: string, options: { includeRuntime?: boolean; includeProducerBridge?: boolean } = {}): string {
  let normalized = injectGsapIfNeeded(normalizeForHyperframes(String(html || '')));
  if (options.includeRuntime === false) {
    normalized = normalized
      .replace(/<script\b[^>]*data-hyperframes-runtime[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b(?=[^>]*data-prometheus-hyperframes-runtime)[^>]*>[\s\S]*?<\/script>/gi, '');
  }
  const compat = escapeInlineScriptText(getHyperframesTimelineCompatScript());
  const runtime = options.includeRuntime === false ? '' : escapeInlineScriptText(getHyperframesRuntimeScript());
  const producerBridge = options.includeProducerBridge ? escapeInlineScriptText(getHyperframesProducerBridgeScript()) : '';
  const inline = [
    `<script data-hyperframes-timeline-compat="inline">\n${compat}\n</script>`,
    runtime ? `<script data-hyperframes-runtime="inline">\n${runtime}\n</script>` : '',
    producerBridge ? `<script data-hyperframes-producer-bridge="inline">\n${producerBridge}\n</script>` : '',
  ].filter(Boolean).join('\n');
  if (/<\/head>/i.test(normalized)) {
    return normalized.replace(/<\/head>/i, () => `${inline}\n</head>`);
  }
  if (/<head\b[^>]*>/i.test(normalized)) {
    return normalized.replace(/<head\b[^>]*>/i, (m) => `${m}\n${inline}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${inline}</head><body>${normalized}</body></html>`;
}

/**
 * HyperFrames puts composition metadata on the <html> element:
 *   <html data-composition-id="..." data-composition-duration="6" data-composition-variables='[...]'>
 * Note: data-composition-duration is in SECONDS, not milliseconds.
 *
 * Prometheus puts the same metadata on a stage element:
 *   <main id="stage" data-composition-id="..." data-width="1080" data-height="1920" data-duration="6000ms">
 *
 * normalizeForHyperframes() reads stage metadata and mirrors it onto <html>
 * so HF parsers (extractCompositionMetadata, lintHyperframeHtml, etc.) see
 * the composition correctly. Idempotent — if <html> already has the
 * attributes, they win.
 */
export function normalizeForHyperframes(html: string): string {
  let source = String(html || '').trim();
  if (!source) return source;
  if (!/<html\b/i.test(source)) {
    source = `<!doctype html><html><head><meta charset="utf-8"></head><body>${source}</body></html>`;
  }
  if (!/<body\b/i.test(source)) {
    source = source.replace(/<\/head>/i, '</head><body>').replace(/<\/html>/i, '</body></html>');
  }

  source = normalizeTimeAttributes(source);
  source = ensureStageElement(source);

  const stageMatch = source.match(/<([a-z][a-z0-9:-]*)\b([^<>]*\bid=["']stage["'][^<>]*)>/i);
  const stageAttrs = stageMatch ? stageMatch[2] || '' : '';
  const htmlTagMatch = source.match(/<html\b([^>]*)>/i);
  const htmlAttrs = htmlTagMatch ? htmlTagMatch[1] || '' : '';

  const compositionId = readAttr(htmlAttrs, 'data-composition-id')
    || readAttr(stageAttrs, 'data-composition-id')
    || 'prometheus-hyperframes-composition';
  const durationSeconds = readDurationSecondsFromAttrs(htmlAttrs, 'data-composition-duration')
    ?? readDurationSecondsFromAttrs(stageAttrs, 'data-duration')
    ?? inferTimelineDurationSeconds(source)
    ?? 6;
  const width = readNumberAttr(htmlAttrs, 'data-composition-width')
    ?? readNumberAttr(stageAttrs, 'data-width')
    ?? readCssDimension(source, 'width')
    ?? 1080;
  const height = readNumberAttr(htmlAttrs, 'data-composition-height')
    ?? readNumberAttr(stageAttrs, 'data-height')
    ?? readCssDimension(source, 'height')
    ?? 1920;

  source = upsertAttrsOnHtml(source, {
    'data-composition-id': compositionId,
    'data-composition-duration': trimNumber(durationSeconds),
    'data-composition-width': String(width),
    'data-composition-height': String(height),
  });
  source = upsertAttrsById(source, 'stage', {
    'data-composition-id': compositionId,
    'data-composition-src': readAttr(stageAttrs, 'data-composition-src') || undefined,
    'data-start': '0',
    'data-duration': trimNumber(durationSeconds),
    'data-width': String(width),
    'data-height': String(height),
  });
  source = ensureParserDurations(source);
  source = ensureClipClasses(source);
  return source;
}

function readAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs);
  return match ? match[2] : null;
}

function readNumberAttr(attrs: string, name: string): number | null {
  const raw = readAttr(attrs, name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readCssDimension(source: string, property: 'width' | 'height'): number | null {
  const pattern = new RegExp(`#stage\\s*\\{[^}]*\\b${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i');
  const match = pattern.exec(source);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readDurationSecondsFromAttrs(attrs: string, name: string): number | null {
  const raw = readAttr(attrs, name);
  if (!raw) return null;
  return parseHyperframesSeconds(raw);
}

function parseHyperframesSeconds(raw: string): number | null {
  const match = String(raw || '').trim().match(/^(-?\d+(?:\.\d+)?)(ms|s)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] || '').toLowerCase();
  return unit === 'ms' ? value / 1000 : value;
}

function trimNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function normalizeTimeAttributes(html: string): string {
  return String(html || '').replace(
    /\b(data-(?:start|duration|end|media-start|media-offset|trim-start|offset|from))=(["'])(-?\d+(?:\.\d+)?)(ms|s)?\2/gi,
    (_match, attr, quote, value, unit) => {
      const numeric = Number(value);
      const seconds = String(unit || '').toLowerCase() === 'ms' ? numeric / 1000 : numeric;
      return `${attr}=${quote}${trimNumber(seconds)}${quote}`;
    },
  );
}

function ensureStageElement(html: string): string {
  if (/\bid=(["'])stage\1/i.test(html)) return html;
  const rootPattern = /<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-composition-id\s*=\s*(["']).*?\3[^<>]*)>/i;
  if (rootPattern.test(html)) {
    return html.replace(rootPattern, (_match, tag, attrs) => {
      const nextAttrs = /(?:^|\s)id\s*=/.test(attrs)
        ? attrs.replace(/(^|\s)id\s*=\s*(["']).*?\2/i, '$1id="stage"')
        : `${attrs} id="stage"`;
      return `<${tag}${nextAttrs}>`;
    });
  }
  const bodyOpen = html.match(/<body\b[^>]*>/i);
  const bodyClose = html.match(/<\/body>/i);
  if (bodyOpen && bodyClose) {
    const start = bodyOpen.index! + bodyOpen[0].length;
    const end = bodyClose.index!;
    const body = html.slice(start, end);
    return `${html.slice(0, start)}<main id="stage">${body}</main>${html.slice(end)}`;
  }
  return html;
}

function upsertAttrsOnHtml(html: string, attrs: Record<string, string | undefined>): string {
  return html.replace(/<html\b([^>]*)>/i, (_match, existing) => `<html${upsertAttrs(existing || '', attrs)}>`);
}

function upsertAttrsById(html: string, id: string, attrs: Record<string, string | undefined>): string {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<([a-z][a-z0-9:-]*)\\b([^<>]*\\bid=(["'])${escapedId}\\3[^<>]*)(\\/?)>`, 'i');
  return html.replace(pattern, (_match, tag, existing, _quote, selfClose) => `<${tag}${upsertAttrs(existing || '', attrs)}${selfClose}>`);
}

function upsertAttrs(existing: string, attrs: Record<string, string | undefined>): string {
  let next = existing || '';
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === '') continue;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escapedName}\\s*=\\s*(["']).*?\\1`, 'i');
    const rendered = `${name}="${escapeAttr(String(value))}"`;
    if (pattern.test(next)) next = next.replace(pattern, rendered);
    else next += ` ${rendered}`;
  }
  return next;
}

function inferTimelineDurationSeconds(html: string): number | null {
  let max = 0;
  const tagPattern = /<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-start\s*=\s*(["']).*?\3[^<>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const attrs = match[2] || '';
    const start = readDurationSecondsFromAttrs(attrs, 'data-start') ?? 0;
    const duration = readDurationSecondsFromAttrs(attrs, 'data-duration')
      ?? Math.max(0, (readDurationSecondsFromAttrs(attrs, 'data-end') ?? start) - start);
    max = Math.max(max, start + duration);
  }
  return max > 0 ? max : null;
}

function ensureParserDurations(html: string): string {
  return html.replace(/<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-start\s*=\s*(["']).*?\3[^<>]*)(\/?)>/gi, (full, tag, attrs, _quote, selfClose) => {
    const start = readDurationSecondsFromAttrs(attrs, 'data-start') ?? 0;
    const duration = readDurationSecondsFromAttrs(attrs, 'data-duration');
    if (duration === null || /\bdata-end\s*=/.test(attrs)) return full;
    const nextAttrs = upsertAttrs(attrs, { 'data-end': trimNumber(start + duration) });
    return `<${tag}${nextAttrs}${selfClose}>`;
  });
}

function ensureClipClasses(html: string): string {
  return html.replace(/<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-start\s*=\s*(["']).*?\3[^<>]*)(\/?)>/gi, (full, tag, attrs, _quote, selfClose) => {
    const lowerTag = String(tag || '').toLowerCase();
    if (['html', 'body', 'main', 'section', 'video', 'audio', 'img', 'source'].includes(lowerTag)) return full;
    const classValue = readAttr(attrs, 'class');
    if (classValue && classValue.split(/\s+/).includes('clip')) return full;
    const nextAttrs = classValue
      ? attrs.replace(/\bclass\s*=\s*(["'])(.*?)\1/i, (_m: string, q: string, v: string) => `class=${q}${v} clip${q}`)
      : `${attrs} class="clip"`;
    return `<${tag}${nextAttrs}${selfClose}>`;
  });
}

function writeTimingAttributes(
  html: string,
  elementId: string,
  timing: { startSeconds?: number; durationSeconds?: number; zIndex?: number },
): string {
  const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<([a-z][a-z0-9:-]*)\\b([^<>]*\\bid=(["'])${escapedId}\\3[^<>]*)(\\/?)>`, 'i');
  return html.replace(pattern, (full, tag, attrs, _quote, selfClose) => {
    const existingStart = readDurationSecondsFromAttrs(attrs, 'data-start') ?? 0;
    const existingDuration = readDurationSecondsFromAttrs(attrs, 'data-duration')
      ?? Math.max(0, (readDurationSecondsFromAttrs(attrs, 'data-end') ?? existingStart) - existingStart);
    const start = typeof timing.startSeconds === 'number' ? timing.startSeconds : existingStart;
    const duration = typeof timing.durationSeconds === 'number' ? timing.durationSeconds : existingDuration;
    const nextAttrs = upsertAttrs(attrs, {
      'data-start': trimNumber(start),
      'data-duration': trimNumber(duration),
      'data-end': trimNumber(start + duration),
      'data-track-index': typeof timing.zIndex === 'number' ? String(timing.zIndex) : undefined,
    });
    return `<${tag}${nextAttrs}${selfClose}>`;
  });
}

/**
 * Layer extraction — turns a HyperFrames composition into Prometheus-shaped
 * layer records the canvas can display in the layers panel. Each layer
 * points back to a HF element id via `elementId`, so inspector edits can
 * round-trip through applyHyperframesPatch.
 *
 * Layers are derived from parseHtml().elements, which already gives us the
 * typed timeline element shape (text/media/composition with timing, x/y,
 * scale, opacity, content/src). We translate seconds -> ms here so the
 * canvas timeline doesn't have to convert.
 */
export type HyperframesLayer = {
  elementId: string;
  name: string;
  kind: 'text' | 'media' | 'composition' | 'unknown';
  mediaType: string | null;
  startMs: number;
  durationMs: number;
  endMs: number;
  zIndex: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  text: string | null;
  src: string | null;
  compositionId: string | null;
  // Editing capabilities — drives which inspector controls show.
  editable: {
    text: boolean;
    position: boolean;
    size: boolean;
    timing: boolean;
    opacity: boolean;
    color: boolean;
    fontSize: boolean;
    src: boolean;
  };
  // Raw element for advanced consumers.
  raw: any;
};

export type HyperframesTrack = {
  index: number;
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  layerIds: string[];
  layers: HyperframesLayer[];
};

export type HyperframesLayerExtraction = {
  compositionId: string | null;
  durationMs: number | null;
  variables: any[];
  layers: HyperframesLayer[];
  tracks: HyperframesTrack[];
  // Session B additions:
  advancedBlock: boolean;
  slots: HyperframesSlot[];
  variableBindings: HyperframesVariableBinding[];
};

function classifyLayer(element: any): HyperframesLayer['kind'] {
  const type = String(element?.type || '').toLowerCase();
  if (type === 'text') return 'text';
  if (type === 'video' || type === 'image' || type === 'audio') return 'media';
  if (type === 'composition') return 'composition';
  return 'unknown';
}

export function extractHyperframesLayers(html: string): HyperframesLayerExtraction {
  const normalized = normalizeForHyperframes(String(html || ''));
  const parsed = parseHtml(normalized);
  const metadata = extractCompositionMetadata(normalized);
  const layers: HyperframesLayer[] = parsed.elements.map((element: any) => {
    const kind = classifyLayer(element);
    const startMs = Math.round((Number(element.startTime) || 0) * 1000);
    const durationMs = Math.round((Number(element.duration) || 0) * 1000);
    return {
      elementId: String(element.id || ''),
      name: String(element.name || element.id || ''),
      kind,
      mediaType: kind === 'media' ? String(element.type || '') : null,
      startMs,
      durationMs,
      endMs: startMs + durationMs,
      zIndex: Number(element.zIndex) || 0,
      x: Number(element.x) || 0,
      y: Number(element.y) || 0,
      scale: Number(element.scale) || 1,
      opacity: Number(element.opacity ?? 1),
      text: kind === 'text' ? String(element.content || '') : null,
      src: kind === 'media' || kind === 'composition' ? String(element.src || '') : null,
      compositionId: kind === 'composition' ? String(element.compositionId || '') : null,
      editable: {
        text: kind === 'text',
        position: true,
        size: true,
        timing: true,
        opacity: true,
        color: kind === 'text',
        fontSize: kind === 'text',
        src: kind === 'media' || kind === 'composition',
      },
      raw: element,
    };
  });
  const slots = extractHyperframesSlots(normalized);
  const tracks = buildHyperframesTracks(layers);
  const advancedBlock = detectAdvancedBlock(normalized);
  const variableValues = readExistingVariableValues(normalized);
  const variableBindings = (metadata.variables || []).map((variable: any) => {
    const variableId = String(variable?.id || '').trim();
    const hasCurrentValue = !!variableId && Object.prototype.hasOwnProperty.call(variableValues, variableId);
    const currentValue = hasCurrentValue ? variableValues[variableId] : variable.default;
    return {
      variable,
      currentValue,
      isDefault: !hasCurrentValue || currentValue === variable.default,
    };
  });
  return {
    compositionId: metadata.compositionId,
    durationMs: typeof metadata.compositionDuration === 'number'
      ? Math.round(metadata.compositionDuration * 1000)
      : null,
    variables: metadata.variables,
    layers,
    tracks,
    advancedBlock,
    slots,
    variableBindings,
  };
}

function buildHyperframesTracks(layers: HyperframesLayer[]): HyperframesTrack[] {
  const byIndex = new Map<number, HyperframesLayer[]>();
  for (const layer of layers) {
    const trackIndex = Number.isFinite(layer.zIndex) ? layer.zIndex : 0;
    const group = byIndex.get(trackIndex) || [];
    group.push(layer);
    byIndex.set(trackIndex, group);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, group]) => {
      const ordered = group.slice().sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
      const startMs = ordered.reduce((min, layer) => Math.min(min, layer.startMs), ordered[0]?.startMs ?? 0);
      const endMs = ordered.reduce((max, layer) => Math.max(max, layer.endMs), ordered[0]?.endMs ?? 0);
      return {
        index,
        name: `Track ${index}`,
        startMs,
        endMs,
        durationMs: Math.max(0, endMs - startMs),
        layerIds: ordered.map((layer) => layer.elementId),
        layers: ordered,
      };
    });
}

/**
 * data-prom-slot-* convention for "advanced" HF blocks (Session B).
 *
 * Some HyperFrames blocks (GSAP timelines, canvas/WebGL, Lottie, nested
 * compositions) cannot be safely flattened into editable Prometheus layers
 * without losing fidelity. Instead, the block author marks specific
 * customization points with data-prom-slot-* attributes and Prometheus
 * surfaces only those — the rest stays opaque.
 *
 * Slot kinds:
 *   data-prom-slot-text="<id>"        -> editable text, default = element.textContent
 *   data-prom-slot-asset="<id>"       -> swappable asset, default = src/href attr
 *   data-prom-slot-color="<id>"       -> color override, default = inline color/fill
 *   data-prom-slot-number="<id>"      -> numeric override, default = inline value
 *   data-prom-slot-timing="<id>"      -> editable start/duration on this element
 *   data-prom-slot-variable="<name>"  -> binds to an HF composition variable
 *
 * Each slot may add data-prom-slot-label="<human label>" and
 * data-prom-slot-default="<value>". data-prom-slot-min/max/step apply to numbers.
 *
 * Block boundary: any element with data-prom-block-root="true" (or the root
 * itself when advancedBlock=true) is the selection unit — picks inside that
 * subtree resolve to the boundary, not the inner element.
 */
export type HyperframesSlot = {
  id: string;
  kind: 'text' | 'asset' | 'color' | 'number' | 'timing' | 'variable';
  selector: string | null;
  variableName: string | null;
  label: string;
  default: string | number | null;
  min: number | null;
  max: number | null;
  step: number | null;
};

const SLOT_KINDS: Array<HyperframesSlot['kind']> = ['text', 'asset', 'color', 'number', 'timing', 'variable'];

export function extractHyperframesSlots(html: string): HyperframesSlot[] {
  const source = String(html || '');
  const tagPattern = /<([a-z][a-z0-9:-]*)\b([^<>]*)>/gi;
  const slots: HyperframesSlot[] = [];
  let match: RegExpExecArray | null;
  let elementIndex = 0;
  while ((match = tagPattern.exec(source)) !== null) {
    const tag = match[1].toLowerCase();
    if (tag === 'script' || tag === 'style' || tag.startsWith('!')) continue;
    const attrs = match[2] || '';
    elementIndex += 1;
    for (const kind of SLOT_KINDS) {
      const attrName = `data-prom-slot-${kind}`;
      const slotIdMatch = new RegExp(`\\b${attrName}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs);
      if (!slotIdMatch) continue;
      const slotId = slotIdMatch[2];
      const idMatch = /\bid\s*=\s*(["'])(.*?)\1/i.exec(attrs);
      const labelMatch = /\bdata-prom-slot-label\s*=\s*(["'])(.*?)\1/i.exec(attrs);
      const defaultMatch = /\bdata-prom-slot-default\s*=\s*(["'])(.*?)\1/i.exec(attrs);
      const minMatch = /\bdata-prom-slot-min\s*=\s*(["'])(.*?)\1/i.exec(attrs);
      const maxMatch = /\bdata-prom-slot-max\s*=\s*(["'])(.*?)\1/i.exec(attrs);
      const stepMatch = /\bdata-prom-slot-step\s*=\s*(["'])(.*?)\1/i.exec(attrs);
      slots.push({
        id: slotId,
        kind,
        selector: idMatch ? `#${idMatch[2]}` : `${tag}:nth-of-type(${elementIndex})`,
        variableName: kind === 'variable' ? slotId : null,
        label: labelMatch ? labelMatch[2] : slotId,
        default: defaultMatch ? defaultMatch[2] : null,
        min: minMatch ? Number(minMatch[2]) : null,
        max: maxMatch ? Number(maxMatch[2]) : null,
        step: stepMatch ? Number(stepMatch[2]) : null,
      });
    }
  }
  return slots;
}

/**
 * Detects whether HTML should be treated as an advanced block (slot-only
 * editing). True when any of:
 *   - root element has data-prom-block-root="true"
 *   - HTML contains GSAP timelines, canvas/WebGL, Lottie, or three.js
 *   - HTML uses data-renderer="three"
 */
export function detectAdvancedBlock(html: string): boolean {
  const source = String(html || '');
  if (/data-prom-block-root\s*=\s*["']true["']/i.test(source)) return true;
  if (/\bgsap\.\w|\.timeline\(\)/.test(source)) return true;
  if (/getContext\(\s*['"]webgl2?['"]|<canvas\b/i.test(source)) return true;
  if (/lottie\.loadAnimation\(|@lottiefiles/.test(source)) return true;
  if (/data-renderer\s*=\s*["']three["']|from\s+["']three["']/.test(source)) return true;
  return false;
}

/**
 * Variable inspector data — pairs HF composition variables (from
 * extractCompositionMetadata) with their current values from a binding map.
 */
export type HyperframesVariableBinding = {
  variable: any;       // CompositionVariable shape from @hyperframes/core
  currentValue: any;
  isDefault: boolean;
};

export function bindHyperframesVariables(
  html: string,
  values: Record<string, any> = {},
): HyperframesVariableBinding[] {
  const metadata = extractCompositionMetadata(normalizeForHyperframes(String(html || '')));
  return (metadata.variables || []).map((variable: any) => {
    const id = variable.id;
    const currentValue = id in values ? values[id] : variable.default;
    return {
      variable,
      currentValue,
      isDefault: !(id in values) || values[id] === variable.default,
    };
  });
}

/**
 * Apply variable values to HTML by writing them onto data-composition-variable-values
 * on <html>. The HF runtime reads this on init and uses it to instantiate
 * compositions with overrides.
 */
export function applyHyperframesVariableValues(html: string, values: Record<string, any>): string {
  const source = normalizeForHyperframes(String(html || ''));
  const json = escapeAttr(JSON.stringify(values || {}));
  const htmlTagMatch = source.match(/<html\b([^>]*)>/i);
  if (!htmlTagMatch) return source;
  const existing = htmlTagMatch[1] || '';
  if (/\bdata-composition-variable-values\s*=/.test(existing)) {
    return source.replace(htmlTagMatch[0], (m) => m.replace(/\bdata-composition-variable-values\s*=\s*(["']).*?\1/i, `data-composition-variable-values="${json}"`));
  }
  return source.replace(htmlTagMatch[0], `<html${existing} data-composition-variable-values="${json}">`);
}

export function regenerateFromParsed(parsed: ParsedHtml, totalDurationMs: number, options: any = {}): string {
  return generateHyperframesHtml(parsed.elements, totalDurationMs, {
    animations: undefined,
    styles: parsed.styles || undefined,
    resolution: parsed.resolution,
    keyframes: parsed.keyframes,
    stageZoomKeyframes: parsed.stageZoomKeyframes,
    includeScripts: true,
    includeStyles: true,
    ...options,
  });
}
