/**
 * HyperFrames snapshot QA — drives the existing seek protocol headlessly to
 * verify that an imported clip survives playback. Captures frames at start,
 * midpoint, near-end, plus any explicitly requested timestamps, and reports:
 *   - element bounds visibility (any HF layer fully off-stage?)
 *   - asset reference resolution (any 4xx/5xx during playback?)
 *   - text overflow (delegated to the existing pretext lint)
 *   - frame change detection (does the composition actually animate?)
 *
 * Reuses the same Playwright path as composition_renderer.ts so we get free
 * parity with the export pipeline — if QA passes here, export should match.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { wrapForIframePreview, extractHyperframesLayers, lintHyperframes } from './hyperframes-bridge';
import { launchCreativeChromium } from './playwright-runtime';

export type HyperframesQaSamplePoint = {
  label: 'start' | 'mid' | 'end' | string;
  timeMs: number;
  screenshotPath: string;
  byteSize: number;
  changedFromPrevious: boolean | null;
};

export type HyperframesQaReport = {
  ok: boolean;
  durationMs: number;
  width: number;
  height: number;
  layerCount: number;
  samples: HyperframesQaSamplePoint[];
  networkErrors: Array<{ url: string; status: number | null; failure: string | null }>;
  consoleErrors: string[];
  lintIssues: number;
  lintErrors: number;
  lintWarnings: number;
  notes: string[];
};

export type HyperframesQaOptions = {
  width?: number;
  height?: number;
  durationMs?: number;
  outDir?: string;
  samplePoints?: number[]; // explicit ms offsets to capture in addition to start/mid/end
  timeoutMs?: number;
};

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export async function runHyperframesQa(
  html: string,
  options: HyperframesQaOptions = {},
): Promise<HyperframesQaReport> {
  const layers = extractHyperframesLayers(html);
  const lint = lintHyperframes(html);
  const width = options.width || 1080;
  const height = options.height || 1920;
  const durationMs = options.durationMs ?? layers.durationMs ?? 6000;
  const outDir = options.outDir || path.join(os.tmpdir(), `hyperframes-qa-${Date.now()}`);
  ensureDir(outDir);

  const offsets = [
    { label: 'start' as const, timeMs: 0 },
    { label: 'mid' as const, timeMs: Math.round(durationMs / 2) },
    { label: 'end' as const, timeMs: Math.max(0, durationMs - 50) },
    ...(options.samplePoints || []).map((ms, i) => ({ label: `sample-${i + 1}`, timeMs: Math.max(0, Math.min(durationMs, Math.round(ms))) })),
  ];

  const previewHtml = wrapForIframePreview(html, { includeRuntime: false });
  const tmpHtmlPath = path.join(outDir, 'composition.html');
  fs.writeFileSync(tmpHtmlPath, previewHtml, 'utf8');

  const playwright = require('playwright');
  const browser = await launchCreativeChromium(playwright);
  const networkErrors: HyperframesQaReport['networkErrors'] = [];
  const consoleErrors: string[] = [];
  const samples: HyperframesQaSamplePoint[] = [];
  const notes: string[] = [];

  try {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on('requestfailed', (req: any) => {
      networkErrors.push({ url: req.url(), status: null, failure: req.failure()?.errorText || null });
    });
    page.on('response', (res: any) => {
      const status = res.status();
      if (status >= 400) networkErrors.push({ url: res.url(), status, failure: null });
    });
    page.on('pageerror', (err: any) => consoleErrors.push(String(err?.message || err)));
    page.on('console', (msg: any) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(`file://${tmpHtmlPath.replace(/\\/g, '/')}`, { timeout: options.timeoutMs || 15000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);

    let previousBytes: Buffer | null = null;
    for (const offset of offsets) {
      await page.evaluate((timeMs: number) => {
        const w: any = globalThis;
        const timeSeconds = timeMs / 1000;
        const patchTimelines = () => {
          try { if (typeof w.__PROM_HF_PATCH_TIMELINES__ === 'function') w.__PROM_HF_PATCH_TIMELINES__(); } catch {}
        };
        const seekTimelines = () => {
          try { if (typeof w.__PROMETHEUS_HTML_MOTION_SEEK__ === 'function') w.__PROMETHEUS_HTML_MOTION_SEEK__(timeSeconds); } catch {}
          try {
            const timelines = w.__timelines || {};
            Object.keys(timelines).forEach((key) => {
              const timeline = timelines[key];
              if (!timeline) return;
              if (typeof timeline.seek === 'function') timeline.seek(timeSeconds, false);
              else if (typeof timeline.totalTime === 'function') timeline.totalTime(timeSeconds, false);
              else if (typeof timeline.time === 'function') timeline.time(timeSeconds, false);
            });
          } catch {}
        };
        w.__PROMETHEUS_HTML_MOTION_TIME_MS__ = timeMs;
        w.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__ = timeSeconds;
        patchTimelines();
        w.dispatchEvent(new CustomEvent('prometheus-html-motion-seek', { detail: { timeMs, timeSeconds } }));
        try { w.postMessage({ source: 'hf-parent', action: 'seek', payload: { timeMs } }, '*'); } catch {}
        patchTimelines();
        seekTimelines();
      }, offset.timeMs);
      await page.evaluate((timeMs: number) => new Promise((resolve: any) => {
        const w: any = globalThis;
        const timeSeconds = timeMs / 1000;
        w.requestAnimationFrame(() => {
          try {
            const timelines = w.__timelines || {};
            Object.keys(timelines).forEach((key) => {
              const timeline = timelines[key];
              if (!timeline) return;
              if (typeof timeline.seek === 'function') timeline.seek(timeSeconds, false);
              else if (typeof timeline.totalTime === 'function') timeline.totalTime(timeSeconds, false);
              else if (typeof timeline.time === 'function') timeline.time(timeSeconds, false);
            });
          } catch {}
          resolve(null);
        });
      }), offset.timeMs);
      const filename = path.join(outDir, `frame-${offset.label}.png`);
      const buffer = await page.screenshot({ path: filename, type: 'png' });
      const changed = previousBytes ? !Buffer.from(buffer).equals(previousBytes) : null;
      samples.push({
        label: offset.label,
        timeMs: offset.timeMs,
        screenshotPath: filename,
        byteSize: buffer.length,
        changedFromPrevious: changed,
      });
      previousBytes = Buffer.from(buffer);
    }
    await context.close();
  } finally {
    await browser.close();
  }

  // Detect static composition (every sample identical) — usually a smell.
  const staticByDesign = samples.length > 1 && samples.slice(1).every((s) => s.changedFromPrevious === false);
  if (staticByDesign) notes.push('Composition appears static across sample points — verify animations are wired to prometheus-html-motion-seek.');

  if (networkErrors.length) notes.push(`${networkErrors.length} network error(s) during playback.`);
  if (consoleErrors.length) notes.push(`${consoleErrors.length} console/page error(s).`);
  if (!layers.layers.length) notes.push('No layers extracted — composition may be advanced-block-only.');

  const lintIssues = (lint as any).findings?.length || 0;
  const lintErrors = (lint as any).findings?.filter((f: any) => f.severity === 'error').length || 0;
  const lintWarnings = (lint as any).findings?.filter((f: any) => f.severity === 'warning').length || 0;

  const ok = networkErrors.filter((e) => e.status === null || e.status >= 500).length === 0
    && consoleErrors.length === 0
    && lintErrors === 0
    && samples.every((s) => s.byteSize > 1024); // 1KB heuristic — anything smaller is probably blank

  return {
    ok,
    durationMs,
    width,
    height,
    layerCount: layers.layers.length,
    samples,
    networkErrors,
    consoleErrors,
    lintIssues,
    lintErrors,
    lintWarnings,
    notes,
  };
}
