#!/usr/bin/env node
/**
 * Production-ish HyperFrames catalog smoke test.
 *
 * Fetches real registry blocks/components, normalizes them to the native
 * HyperFrames contract, lints/parses them with @hyperframes/core, screenshots
 * a few previews, and renders one short video with @hyperframes/producer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML, DOMParser as LinkedomDOMParser } from 'linkedom';
import { chromium } from 'playwright';
import {
  extractCompositionMetadata,
  getHyperframeRuntimeScript,
  lintHyperframeHtml,
  parseHtml,
  validateCompositionHtml,
} from '@hyperframes/core';
import { createRenderJob, executeRenderJob } from '@hyperframes/producer';

if (typeof globalThis.DOMParser === 'undefined') globalThis.DOMParser = LinkedomDOMParser;
if (typeof globalThis.document === 'undefined') {
  const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.HTMLElement = dom.HTMLElement;
  globalThis.Element = dom.Element;
  globalThis.Node = dom.Node;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, '.prometheus', 'creative', 'hyperframes-test');
const registryBase = 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry';

const SAMPLES = [
  ['blocks', 'app-showcase'],
  ['blocks', 'apple-money-count'],
  ['blocks', 'data-chart'],
  ['blocks', 'flowchart'],
  ['blocks', 'instagram-follow'],
  ['blocks', 'macos-notification'],
  ['blocks', 'reddit-post'],
  ['blocks', 'spotify-card'],
  ['blocks', 'tiktok-follow'],
  ['blocks', 'ui-3d-reveal'],
  ['blocks', 'yt-lower-third'],
  ['components', 'grain-overlay'],
  ['components', 'grid-pixelate-wipe'],
  ['components', 'shimmer-sweep'],
];

const args = new Set(process.argv.slice(2));
const limitArg = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1]);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.min(SAMPLES.length, limitArg) : 12;
const previewCount = args.has('--no-preview') ? 0 : Number(process.argv.find((arg) => arg.startsWith('--preview='))?.split('=')[1] || 3);
const renderSample = !args.has('--no-render');

function seconds(raw) {
  if (!raw) return null;
  const match = String(raw).trim().match(/^(-?\d+(?:\.\d+)?)(ms|s)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return (match[2] || '').toLowerCase() === 'ms' ? value / 1000 : value;
}

function attr(attrs, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs || '')?.[2] || null;
}

function upsert(attrs, map) {
  let next = attrs || '';
  for (const [name, value] of Object.entries(map)) {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(["']).*?\\1`, 'i');
    if (pattern.test(next)) next = next.replace(pattern, `${name}="${value}"`);
    else next += ` ${name}="${value}"`;
  }
  return next;
}

function normalizeHtml(raw, { id, width = 1080, height = 1920, duration = 6 }) {
  let html = String(raw || '').trim();
  if (!/<html\b/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  if (!/<body\b/i.test(html)) html = html.replace(/<\/head>/i, '</head><body>').replace(/<\/html>/i, '</body></html>');
  html = html.replace(/\b(data-(?:start|duration|end|media-start|media-offset|trim-start|offset|from))=(["'])(-?\d+(?:\.\d+)?)(ms|s)?\2/gi, (_m, name, quote, value, unit) => {
    const n = Number(value);
    return `${name}=${quote}${Number((((unit || '').toLowerCase() === 'ms' ? n / 1000 : n)).toFixed(6))}${quote}`;
  });
  if (!/\bid=(["'])stage\1/i.test(html)) {
    html = /<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-composition-id\s*=\s*(["']).*?\3[^<>]*)>/i.test(html)
      ? html.replace(/<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-composition-id\s*=\s*(["']).*?\3[^<>]*)>/i, (_m, tag, attrs) => {
          const nextAttrs = /(?:^|\s)id\s*=/.test(attrs) ? attrs.replace(/(^|\s)id\s*=\s*(["']).*?\2/i, '$1id="stage"') : `${attrs} id="stage"`;
          return `<${tag}${nextAttrs}>`;
        })
      : html.replace(/(<body\b[^>]*>)([\s\S]*?)(<\/body>)/i, '$1<main id="stage">$2</main>$3');
  }
  const htmlAttrs = /<html\b([^>]*)>/i.exec(html)?.[1] || '';
  const stageAttrs = /<([a-z][a-z0-9:-]*)\b([^<>]*\bid=["']stage["'][^<>]*)>/i.exec(html)?.[2] || '';
  const compositionId = attr(htmlAttrs, 'data-composition-id') || attr(stageAttrs, 'data-composition-id') || `catalog-${id}`;
  const compositionDuration = seconds(attr(htmlAttrs, 'data-composition-duration')) || seconds(attr(stageAttrs, 'data-duration')) || duration;
  html = html.replace(/<html\b([^>]*)>/i, (_m, attrs) => `<html${upsert(attrs, {
    'data-composition-id': compositionId,
    'data-composition-duration': compositionDuration,
    'data-composition-width': attr(htmlAttrs, 'data-composition-width') || attr(stageAttrs, 'data-width') || width,
    'data-composition-height': attr(htmlAttrs, 'data-composition-height') || attr(stageAttrs, 'data-height') || height,
  })}>`);
  html = html.replace(/<([a-z][a-z0-9:-]*)\b([^<>]*\bid=["']stage["'][^<>]*)(\/?)>/i, (_m, tag, attrs, close) => `<${tag}${upsert(attrs, {
    'data-composition-id': compositionId,
    'data-start': 0,
    'data-duration': compositionDuration,
    'data-width': width,
    'data-height': height,
  })}${close}>`);
  html = html.replace(/<([a-z][a-z0-9:-]*)\b([^<>]*\bdata-start\s*=\s*(["']).*?\3[^<>]*)(\/?)>/gi, (full, tag, attrs, _q, close) => {
    const start = seconds(attr(attrs, 'data-start')) ?? 0;
    const durationAttr = seconds(attr(attrs, 'data-duration'));
    let next = attrs;
    if (durationAttr !== null && !/\bdata-end\s*=/.test(attrs)) next = upsert(next, { 'data-end': Number((start + durationAttr).toFixed(6)) });
    if (!['html', 'body', 'main', 'section', 'video', 'audio', 'img', 'source'].includes(String(tag).toLowerCase()) && !/\bclass\s*=/.test(next)) {
      next += ' class="clip"';
    }
    return `<${tag}${next}${close}>`;
  });
  return html;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return await res.text();
}

async function fetchCatalogHtml(section, id) {
  const item = JSON.parse(await fetchText(`${registryBase}/${section}/${id}/registry-item.json`));
  const htmlFile = (item.files || []).find((file) => /\.html?$/i.test(file.path));
  if (!htmlFile) throw new Error('no html file in registry item');
  const html = await fetchText(`${registryBase}/${section}/${id}/${htmlFile.path}`);
  return {
    item,
    html,
    width: Number(item.dimensions?.width) || 1080,
    height: Number(item.dimensions?.height) || 1920,
    duration: Number(item.duration) || 6,
  };
}

function withRuntime(html) {
  const runtime = `<script data-hyperframes-runtime="inline">\n${getHyperframeRuntimeScript()}\n</script>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${runtime}\n</head>`) : html;
}

async function screenshotPreview(browser, label, html, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const file = path.join(outDir, `${label}.png`);
  await page.setContent(withRuntime(html), { waitUntil: 'networkidle', timeout: 20000 });
  await page.evaluate(() => {
    window.postMessage({ source: 'hf-parent', action: 'seek', payload: { timeMs: 500 } }, '*');
    window.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', { detail: { timeSeconds: 0.5, timeMs: 500 } }));
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: file, fullPage: false });
  await page.close();
  const bytes = fs.statSync(file).size;
  if (bytes < 2000) throw new Error(`preview screenshot looks blank (${bytes} bytes)`);
  return file;
}

async function renderFixture() {
  const projectDir = path.join(outDir, 'producer-fixture');
  fs.mkdirSync(projectDir, { recursive: true });
  const html = normalizeHtml(`<!doctype html><html><head><meta charset="utf-8"><style>
html,body,#stage{margin:0;width:320px;height:180px;overflow:hidden;background:#111;color:white;font-family:Arial}
.clip{position:absolute;left:30px;top:70px;font-size:30px;transform:translateX(calc(var(--t, 0) * 180px))}
</style></head><body><main id="stage" data-composition-id="producer-fixture" data-width="320" data-height="180" data-duration="1">
<div id="moving" class="clip" data-start="0" data-duration="1">HyperFrames</div>
</main><script>window.__player={getDuration:function(){return 1},renderSeek:function(t){document.documentElement.style.setProperty('--t', Math.max(0,Math.min(1,t)).toString())}}</script></body></html>`, {
    id: 'producer-fixture',
    width: 320,
    height: 180,
    duration: 1,
  });
  fs.writeFileSync(path.join(projectDir, 'index.html'), html, 'utf8');
  const outputPath = path.join(outDir, 'producer-fixture.mp4');
  const job = createRenderJob({ fps: 24, quality: 'draft', format: 'mp4', entryFile: 'index.html' });
  await executeRenderJob(job, projectDir, outputPath);
  const bytes = fs.statSync(outputPath).size;
  if (bytes < 5000) throw new Error(`producer output looks empty (${bytes} bytes)`);
  return outputPath;
}

fs.mkdirSync(outDir, { recursive: true });

let ok = true;
const normalizedItems = [];
for (const [section, id] of SAMPLES.slice(0, limit)) {
  try {
    const fetched = await fetchCatalogHtml(section, id);
    const html = normalizeHtml(fetched.html, { id, width: fetched.width, height: fetched.height, duration: fetched.duration });
    const validation = validateCompositionHtml(html);
    const lint = lintHyperframeHtml(html);
    const parsed = parseHtml(html);
    const metadata = extractCompositionMetadata(html);
    const structuralErrors = (validation.errors || []).filter((error) => /Missing #stage|Missing data-composition|duration must/i.test(String(error?.message || error)));
    if (structuralErrors.length) throw new Error(`validation failed: ${structuralErrors.map((e) => e.message || e).join('; ')}`);
    const blockingLintErrors = (lint.findings || []).filter((f) => {
      if (f.severity !== 'error') return false;
      if (section === 'components' && f.code === 'missing_timeline_registry') return false;
      return true;
    });
    if (blockingLintErrors.length) throw new Error(`lint errors: ${blockingLintErrors.map((f) => f.code).join(', ')}`);
    normalizedItems.push({ section, id, html, parsed, metadata, width: fetched.width, height: fetched.height });
    console.log(`OK catalog:${section}/${id} elements=${parsed.elements.length} duration=${metadata.compositionDuration}s warnings=${lint.warningCount || 0}`);
  } catch (err) {
    ok = false;
    console.error(`FAIL catalog:${section}/${id}: ${err?.message || err}`);
  }
}

if (previewCount > 0 && normalizedItems.length) {
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    try {
      for (const sample of normalizedItems.slice(0, previewCount)) {
        try {
          const file = await screenshotPreview(browser, `${sample.section}-${sample.id}`, sample.html, Math.min(sample.width, 1080), Math.min(sample.height, 1920));
          console.log(`OK preview:${sample.id} ${path.relative(repoRoot, file)}`);
        } catch (err) {
          ok = false;
          console.error(`FAIL preview:${sample.id}: ${err?.message || err}`);
        }
      }
    } finally {
      await browser.close();
    }
  } catch (err) {
    if (/Executable doesn't exist|playwright install/i.test(String(err?.message || err))) {
      console.log('SKIP preview: Playwright Chromium is not installed locally. Run `npx playwright install chromium` to enable screenshot checks.');
    } else {
      ok = false;
      console.error(`FAIL preview-launch: ${err?.message || err}`);
    }
  }
}

if (renderSample) {
  try {
    const file = await renderFixture();
    console.log(`OK producer-render ${path.relative(repoRoot, file)}`);
  } catch (err) {
    ok = false;
    console.error(`FAIL producer-render: ${err?.message || err}`);
  }
}

process.exit(ok ? 0 : 1);
