// Live capture: node scripts/bench-mobile-multithread.mjs capture
// Deterministic benchmark: node scripts/bench-mobile-multithread.mjs replay [capture.json]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'reviews/perf-live-2026-10-04');
fs.mkdirSync(OUT, { recursive: true });
const mode = process.argv[2] || 'replay';
if (mode === 'capture') {
  const require = createRequire(process.env.PROMSRC_ROOT ? process.env.PROMSRC_ROOT + '/package.json' : new URL('../package.json', import.meta.url));
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const frames = [];
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    try { const data = JSON.parse(response.payloadData); if (data?.type) frames.push(data); } catch {}
  });
  await page.goto('http://127.0.0.1:32466/?desktop=1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(60000);
  fs.writeFileSync(path.join(OUT, 'ws-60s.json'), JSON.stringify(frames));
  console.log(JSON.stringify({ frames: frames.length, bytes: Buffer.byteLength(JSON.stringify(frames)), types: frames.reduce((counts, frame) => { counts[frame.type] = (counts[frame.type] || 0) + 1; return counts; }, {}) }));
  await browser.close();
} else if (mode === 'replay') {
  const capture = process.argv[3] || path.join(ROOT, 'scripts/fixtures/mobile-multithread-frames.json');
  if (!fs.existsSync(capture)) throw new Error(`Missing capture ${capture}; run capture first`);
  const frames = JSON.parse(fs.readFileSync(capture, 'utf8'));
  const source = process.env.BASELINE === '1'
    ? (await import('node:child_process')).execFileSync('git', ['show', 'HEAD:web-ui/src/mobile/mobile-chat-page-runtime.js'], { cwd: ROOT, encoding: 'utf8' })
    : fs.readFileSync(path.join(ROOT, 'web-ui/src/mobile/mobile-chat-page-runtime.js'), 'utf8');
  const match = source.match(/  const onBackgroundSpawnEvent = \(msg = \{\}\) => \{[\s\S]*?\n  \};/);
  if (!match) throw new Error('Background event handler not found');
  const events = frames.filter(f => f.type === 'bg_agent_event');
  let accepted = 0, rendered = 0;
  const focusedSession = events.find(f => f.spawnerSessionId)?.spawnerSessionId || events.find(f => f.parentSessionId)?.parentSessionId || 'benchmark_focus';
  const sandbox = { __pmChat: { activeSessionId: focusedSession }, requestedSession: focusedSession, _pushMobileBackgroundSpawnEvent: () => { accepted++; return true; }, scheduleMobileBackgroundAgentUiUpdate: () => { rendered++; } };
  // Evaluate the actual source handler against controlled no-DOM dependencies.
  const handler = vm.runInNewContext(`${match[0]}; onBackgroundSpawnEvent`, sandbox);
  const measurements = [];
  // Parentless frames still require the canonical lane matcher; only assert
  // cheap skipping for frames with an explicit offscreen parent.
  const scopedEvents = events.filter(f => (f.spawnerSessionId || f.parentSessionId || f.mainSessionId) === focusedSession);
  for (const focus of ['offscreen', 'focused']) for (const scale of [1, 5]) {
    sandbox.requestedSession = focus === 'focused' ? focusedSession : 'benchmark_offscreen';
    sandbox.__pmChat.activeSessionId = sandbox.requestedSession;
    accepted = 0; rendered = 0;
    const start = performance.now();
    for (let n = 0; n < scale; n++) for (const event of scopedEvents) handler(event);
    measurements.push({ focus, scale, frames: scopedEvents.length * scale, handlerMs: +(performance.now() - start).toFixed(3), accepted, rendered });
  }
  if (measurements.find(m => m.focus === 'focused' && !m.accepted)) throw new Error('Focused background frames were dropped');
  if (process.env.BASELINE !== '1' && measurements.find(m => m.focus === 'offscreen' && m.rendered)) throw new Error('Offscreen background frames reached the UI');
  sandbox.requestedSession = focusedSession;
  sandbox.__pmChat.activeSessionId = focusedSession;
  accepted = 0; rendered = 0;
  events.forEach(handler);
  if (accepted < scopedEvents.length || rendered < scopedEvents.length) throw new Error('Focused frames were not preserved');
  console.log(JSON.stringify({ captureFrames: frames.length, bgFrames: events.length, focusedSession, measurements }));
} else throw new Error(`Unknown mode: ${mode}`);
