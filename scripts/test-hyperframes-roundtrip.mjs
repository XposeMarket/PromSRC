#!/usr/bin/env node
/**
 * HyperFrames round-trip identity test.
 *
 * Imports a HyperFrames composition (or fixture HTML), parses it with the
 * official @hyperframes/core parsers, and re-generates the HTML. The two
 * sides must match modulo asset rewrites — anything else means our import
 * is destroying information that downstream editing/export cannot recover.
 *
 * Usage:
 *   node scripts/test-hyperframes-roundtrip.mjs [path/to/composition.html ...]
 *
 * If no paths given, runs against a built-in fixture so the test always works.
 */

import fs from 'node:fs';
import path from 'node:path';
// @hyperframes/core uses DOMParser at runtime; provide it via linkedom in Node.
import { parseHTML, DOMParser as LinkedomDOMParser } from 'linkedom';
if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = LinkedomDOMParser;
}
if (typeof globalThis.document === 'undefined') {
  const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.HTMLElement = dom.HTMLElement;
  globalThis.Element = dom.Element;
  globalThis.Node = dom.Node;
}
import {
  parseHtml,
  generateHyperframesHtml,
  extractCompositionMetadata,
  validateCompositionHtml,
} from '@hyperframes/core';

// Native HyperFrames convention: metadata on <html>, #stage root, duration in seconds.
const HF_NATIVE_FIXTURE = `<!doctype html>
<html data-composition-id="rt-fixture" data-composition-duration="6" data-composition-width="1080" data-composition-height="1920">
<head>
<meta charset="utf-8">
<style>html,body{margin:0;width:1080px;height:1920px;background:#000;color:#fff;font-family:Inter,sans-serif}</style>
</head>
<body>
  <main id="stage" data-composition-id="rt-fixture" data-start="0" data-duration="6" data-width="1080" data-height="1920">
    <h1 id="title" class="clip" data-role="caption" data-track-index="1" data-start="0" data-duration="3" data-end="3" style="position:absolute;left:80px;top:160px;font-size:96px">Hello HyperFrames</h1>
    <img id="logo" data-role="media" data-track-index="2" data-start="0.5" data-duration="5.5" data-end="6" src="{{asset.logo}}" style="position:absolute;left:80px;top:1640px;width:200px;height:200px">
  </main>
</body>
</html>`;

// Prometheus convention: <main id="stage" data-duration="6000ms"> — must be normalized.
const PROM_STAGE_FIXTURE = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<main id="stage" data-composition-id="rt-fixture-prom" data-width="1080" data-height="1920" data-duration="6000ms" data-frame-rate="60">
  <h1 id="title" data-role="caption" data-track-index="1" data-start="0ms" data-duration="3000ms" style="position:absolute;left:80px;top:160px;font-size:96px">Hello HyperFrames</h1>
</main>
</body>
</html>`;

// Mirror of normalizeForHyperframes from src/gateway/creative/hyperframes-bridge.ts —
// kept inline so this script doesn't depend on the gateway build.
function normalizeForHyperframes(source) {
  let html = String(source || '').trim();
  if (!/<html\b/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  html = html.replace(/\b(data-(?:start|duration|end|media-start|media-offset|trim-start|offset|from))=(["'])(-?\d+(?:\.\d+)?)(ms|s)?\2/gi, (_m, attr, quote, value, unit) => {
    const n = Number(value);
    return `${attr}=${quote}${Number(((unit || '').toLowerCase() === 'ms' ? n / 1000 : n).toFixed(6))}${quote}`;
  });
  if (!/\bid=(["'])stage\1/i.test(html)) {
    const root = /<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-composition-id\s*=\s*(["']).*?\3[^<>]*)>/i;
    if (root.test(html)) {
      html = html.replace(root, (_m, tag, attrs) => {
        const nextAttrs = /(?:^|\s)id\s*=/.test(attrs) ? attrs.replace(/(^|\s)id\s*=\s*(["']).*?\2/i, '$1id="stage"') : `${attrs} id="stage"`;
        return `<${tag}${nextAttrs}>`;
      });
    }
    else html = html.replace(/(<body\b[^>]*>)([\s\S]*?)(<\/body>)/i, '$1<main id="stage">$2</main>$3');
  }
  const stageAttrs = /<([a-z][a-z0-9:-]*)\b([^<>]*\bid=["']stage["'][^<>]*)>/i.exec(html)?.[2] || '';
  const htmlAttrs = /<html\b([^>]*)>/i.exec(html)?.[1] || '';
  const read = (attrs, name) => new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs)?.[2] || null;
  const sec = (v) => {
    if (!v) return null;
    const m = String(v).match(/^(-?\d+(?:\.\d+)?)(ms|s)?$/i);
    if (!m) return null;
    return (m[2] || '').toLowerCase() === 'ms' ? Number(m[1]) / 1000 : Number(m[1]);
  };
  const id = read(htmlAttrs, 'data-composition-id') || read(stageAttrs, 'data-composition-id') || 'rt-fixture';
  const duration = sec(read(htmlAttrs, 'data-composition-duration')) || sec(read(stageAttrs, 'data-duration')) || 6;
  const width = read(htmlAttrs, 'data-composition-width') || read(stageAttrs, 'data-width') || '1080';
  const height = read(htmlAttrs, 'data-composition-height') || read(stageAttrs, 'data-height') || '1920';
  const upsert = (attrs, map) => {
    let next = attrs || '';
    for (const [k, v] of Object.entries(map)) {
      const r = new RegExp(`\\b${k}\\s*=\\s*(["']).*?\\1`, 'i');
      if (r.test(next)) next = next.replace(r, `${k}="${v}"`);
      else next += ` ${k}="${v}"`;
    }
    return next;
  };
  html = html.replace(/<html\b([^>]*)>/i, (_m, attrs) => `<html${upsert(attrs, {
    'data-composition-id': id,
    'data-composition-duration': String(duration),
    'data-composition-width': width,
    'data-composition-height': height,
  })}>`);
  html = html.replace(/<([a-z][a-z0-9:-]*)\b([^<>]*\bid=["']stage["'][^<>]*)(\/?)>/i, (_m, tag, attrs, close) => `<${tag}${upsert(attrs, {
    'data-composition-id': id,
    'data-start': '0',
    'data-duration': String(duration),
    'data-width': width,
    'data-height': height,
  })}${close}>`);
  html = html.replace(/<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-start\s*=\s*(["']).*?\3[^<>]*)(\/?)>/gi, (full, tag, attrs, _q, close) => {
    const start = sec(read(attrs, 'data-start')) ?? 0;
    const durationAttr = sec(read(attrs, 'data-duration'));
    let next = attrs;
    if (durationAttr !== null && !/\bdata-end\s*=/.test(attrs)) next = upsert(next, { 'data-end': String(Number((start + durationAttr).toFixed(6))) });
    if (!['html', 'body', 'main', 'section', 'video', 'audio', 'img', 'source'].includes(String(tag).toLowerCase()) && !/\bclass=(["'])(?:(?!\1).)*\bclip\b/i.test(next)) {
      next = /\bclass\s*=/.test(next)
        ? next.replace(/\bclass\s*=\s*(["'])(.*?)\1/i, (_m, q, v) => `class=${q}${v} clip${q}`)
        : `${next} class="clip"`;
    }
    return `<${tag}${next}${close}>`;
  });
  return html;
}

function compareElements(a, b) {
  const diffs = [];
  if (a.length !== b.length) diffs.push(`element count: ${a.length} vs ${b.length}`);
  const byId = new Map(b.map((el) => [el.id, el]));
  for (const el of a) {
    const other = byId.get(el.id);
    if (!other) {
      diffs.push(`missing element ${el.id}`);
      continue;
    }
    for (const key of ['type', 'startTime', 'duration', 'zIndex']) {
      if (JSON.stringify(el[key]) !== JSON.stringify(other[key])) {
        diffs.push(`${el.id}.${key}: ${JSON.stringify(el[key])} vs ${JSON.stringify(other[key])}`);
      }
    }
  }
  return diffs;
}

function runOne(label, rawHtml) {
  const html = normalizeForHyperframes(rawHtml);
  const validation = validateCompositionHtml(html);
  const metadata = extractCompositionMetadata(html);
  const totalDuration = metadata.compositionDuration ?? 6;
  const parsed = parseHtml(html);
  const regenerated = generateHyperframesHtml(parsed.elements, totalDuration, {
    styles: parsed.styles || undefined,
    resolution: parsed.resolution,
    keyframes: parsed.keyframes,
    stageZoomKeyframes: parsed.stageZoomKeyframes,
    compositionId: metadata.compositionId || undefined,
    includeScripts: true,
    includeStyles: true,
  });
  const reparsed = parseHtml(regenerated);
  const elementDiffs = compareElements(parsed.elements, reparsed.elements);
  const ok = elementDiffs.length === 0;

  console.log(`\n=== ${label} ===`);
  console.log(`  validation.valid: ${validation.valid} (errors: ${validation.errors?.length || 0}, warnings: ${validation.warnings?.length || 0})`);
  console.log(`  composition: id=${metadata.compositionId} duration=${metadata.compositionDuration}s variables=${metadata.variables.length}`);
  console.log(`  parsed elements: ${parsed.elements.length}, reparsed elements: ${reparsed.elements.length}`);
  console.log(`  element identity diffs: ${elementDiffs.length}`);
  for (const diff of elementDiffs.slice(0, 20)) console.log(`    - ${diff}`);
  console.log(`  RESULT: ${ok ? 'OK' : 'FAIL'}`);
  return ok;
}

// Real-catalog blocks fetched at run time. Roundtrip can only assert element
// identity here because the catalog's source HTML often includes GSAP/canvas
// internals that the parser deliberately doesn't model — the "elements" list
// is what HF treats as authoritative.
const REAL_CATALOG_SAMPLES = [
  { id: 'apple-money-count',      section: 'blocks' },
  { id: 'reddit-post',            section: 'blocks' },
  { id: 'shimmer-sweep',          section: 'components' },
];
const HF_RAW = 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry';

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return await res.text();
}

async function runRealCatalog() {
  let ok = true;
  for (const sample of REAL_CATALOG_SAMPLES) {
    try {
      const itemUrl = `${HF_RAW}/${sample.section}/${sample.id}/registry-item.json`;
      const item = JSON.parse(await fetchText(itemUrl));
      const htmlFile = (item.files || []).find((f) => /\.html?$/i.test(f.path));
      if (!htmlFile) { console.log(`\n=== catalog:${sample.id} === skipped (no html)`); continue; }
      const html = await fetchText(`${HF_RAW}/${sample.section}/${sample.id}/${htmlFile.path}`);
      ok = runOne(`catalog:${sample.id}`, html) && ok;
    } catch (err) {
      console.error(`\n=== catalog:${sample.id} === ERROR: ${err?.message || err}`);
      ok = false;
    }
  }
  return ok;
}

const args = process.argv.slice(2);
let allOk = true;
if (args.includes('--real-catalog')) {
  allOk = (await runRealCatalog()) && allOk;
} else if (args.length === 0) {
  allOk = runOne('HF-native fixture', HF_NATIVE_FIXTURE) && allOk;
  allOk = runOne('Prometheus-stage fixture (normalized)', PROM_STAGE_FIXTURE) && allOk;
} else {
  for (const arg of args) {
    const abs = path.resolve(arg);
    if (!fs.existsSync(abs)) {
      console.error(`File not found: ${abs}`);
      allOk = false;
      continue;
    }
    const html = fs.readFileSync(abs, 'utf8');
    allOk = runOne(path.basename(abs), html) && allOk;
  }
}
process.exit(allOk ? 0 : 1);
