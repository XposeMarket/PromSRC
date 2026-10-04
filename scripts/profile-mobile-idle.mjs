import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('C:/Users/rafel/PromSRC/package.json');
const { chromium } = require('playwright');
const out = path.resolve('reviews/perf-live-2026-10-04');
const browser = await chromium.launch();
const watchdog = setTimeout(() => { console.error('Mobile profile timed out before metrics could be collected'); browser.close().catch(() => {}); process.exitCode = 1; }, 55000);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.addInitScript(() => {
  window.__perf = { timers: 0, intervals: 0, writes: {}, loaf: [] };
  const interval = window.setInterval;
  window.setInterval = function (...args) { window.__perf.intervals++; return interval.apply(this, args); };
  const timeout = window.setTimeout;
  window.setTimeout = function (...args) { window.__perf.timers++; return timeout.apply(this, args); };
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    const row = (window.__perf.writes[k] ||= { count: 0, bytes: 0, stack: new Error().stack?.split('\n').slice(2,5).join(' | ') });
    row.count++; row.bytes += String(v).length; return orig.call(this,k,v);
  };
  try { new PerformanceObserver(list => list.getEntries().forEach(e => {
    if (e.duration >= 50) window.__perf.loaf.push({ ms: Math.round(e.duration), scripts: e.scripts?.map(s => ({ duration: Math.round(s.duration), fn: s.sourceFunctionName, source: s.sourceURL })).slice(0,3) });
  })).observe({ type: 'long-animation-frame' }); } catch {}
});
await page.goto('http://127.0.0.1:32466/mobile', { waitUntil: 'commit', timeout: 15000 });
await page.waitForTimeout(4000);
await cdp.send('Performance.enable');
const read = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name,m.value]));
const before = await read();
await page.waitForTimeout(30000);
const after = await read();
const perf = await page.evaluate(() => ({ ...window.__perf, dom: document.querySelectorAll('*').length, heapMB: +(performance.memory?.usedJSHeapSize / 1048576).toFixed(1), hash: location.hash, pairOverlay: !!document.querySelector('[class*=pair]') }));
const result = { auth: 'unpaired browser; does not measure active mobile chat', cpuThrottle: 4, windowSeconds: 30, scriptMs: Math.round((after.ScriptDuration-before.ScriptDuration)*1000), styleMs: Math.round((after.RecalcStyleDuration-before.RecalcStyleDuration)*1000), layoutMs: Math.round((after.LayoutDuration-before.LayoutDuration)*1000), recalcCount: after.RecalcStyleCount-before.RecalcStyleCount, layoutCount: after.LayoutCount-before.LayoutCount, ...perf };
fs.writeFileSync(path.join(out,'unpaired-mobile-idle.json'), JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
clearTimeout(watchdog);
await browser.close();
