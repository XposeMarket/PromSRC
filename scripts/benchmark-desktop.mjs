import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const wrappers = await load('dist/gateway/desktop-wrappers.js');
const desktop = await load('dist/gateway/desktop-tools.js');
const platform = await load('dist/gateway/desktop-platform.js');
const win32Helper = process.platform === 'win32'
  ? await load('dist/gateway/desktop-platform-win32-helper.js')
  : null;
const live = process.argv.includes('--live');

async function timed(name, fn, iterations = 1) {
  const samples = [];
  const resultBytes = [];
  let failures = 0;
  let last;
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    try { last = await fn(); } catch (error) { failures += 1; last = `ERROR: ${error?.message || error}`; }
    samples.push(performance.now() - started);
    resultBytes.push(Buffer.byteLength(typeof last === 'string' ? last : JSON.stringify(last ?? null), 'utf8'));
  }
  samples.sort((a, b) => a - b);
  return {
    name,
    iterations,
    min_ms: Number(samples[0].toFixed(3)),
    median_ms: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
    p95_ms: Number(samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))].toFixed(3)),
    max_ms: Number(samples.at(-1).toFixed(3)),
    failures,
    success_rate: Number(((iterations - failures) / iterations).toFixed(4)),
    average_result_bytes: Math.round(resultBytes.reduce((sum, value) => sum + value, 0) / resultBytes.length),
    estimated_result_tokens: Math.round(resultBytes.reduce((sum, value) => sum + value, 0) / resultBytes.length / 4),
    result_preview: typeof last === 'string' ? last.slice(0, 160) : undefined,
  };
}

const results = [];
results.push(await timed('wrapper_normalization', () => wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'click', window_token: 'wt_1_1_0_000000000000', x: 10, y: 10,
}), 25_000));

if (live) {
  results.push(await timed('list_windows', () => desktop.desktopListWindowsCanonical(), 3));
  results.push(await timed('accessibility_tree_active_100', () => desktop.desktopGetAccessibilityTree(undefined, 4, 100), 2));
  results.push(await timed('primary_screenshot', () => desktop.desktopScreenshot('__desktop_benchmark__', { capture: 'primary', skipOcr: true }), 2));
  if (desktop.resolveDesktopCaptureBackend().active === 'graphics_capture') {
    const context = await desktop.gatherDesktopContextInternal();
    if (context.activeWindow?.handle) {
      results.push(await timed('native_window_capture', async () => {
        const shot = await platform.getPlatformDesktopBackend().capture({ kind: 'window', handle: context.activeWindow.handle });
        return `${shot.png.length} PNG bytes, ${shot.bounds.width}x${shot.bounds.height}`;
      }, 3));
    }
  }
} else {
  results.push({ name: 'live_desktop', skipped: true, reason: 'Pass --live to benchmark read-only window enumeration, UIA, and screenshot capture.' });
}

const measured = results.filter((row) => Number.isFinite(row.median_ms));
const aggregate = {
  operations: measured.length,
  iterations: measured.reduce((sum, row) => sum + row.iterations, 0),
  failures: measured.reduce((sum, row) => sum + row.failures, 0),
  median_operation_ms: measured.length ? Number([...measured].sort((a, b) => a.median_ms - b.median_ms)[Math.floor(measured.length / 2)].median_ms.toFixed(3)) : null,
  estimated_result_tokens: measured.reduce((sum, row) => sum + row.estimated_result_tokens * row.iterations, 0),
};

console.log(JSON.stringify({
  benchmark: 'prometheus-desktop',
  captured_at: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  capture_backend: desktop.resolveDesktopCaptureBackend(),
  aggregate,
  results,
}, null, 2));
win32Helper?.getWin32DesktopHelperClient().dispose();
