// Behavioral regression: after a mobile reconnect, entries restored from the
// server (which start with the pre-restart work) were appended AFTER the
// post-restart entries the phone already had, so the newest commentary showed
// at the top of the turn. The merge must follow the source order.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

async function main() {
  const root = path.resolve(__dirname, '..', '..');
  const pages = path.join(root, 'web-ui', 'src', 'mobile', 'mobile-pages.js');
  const entry = path.join(path.dirname(pages), `__regression_entry_${process.pid}.js`);
  fs.writeFileSync(entry, fs.readFileSync(pages, 'utf8')
    + '\nexport { _mergeMobileAssistantTurnDetails as __merge };\n');
  const stub: any = () => new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : stub()),
    apply: () => stub(), construct: () => stub(),
  });
  for (const k of ['document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'matchMedia', 'CustomEvent', 'Event', 'EventTarget', 'WebSocket', 'indexedDB', 'history', 'screen', 'visualViewport', 'getComputedStyle']) {
    if (!(k in globalThis)) (globalThis as any)[k] = stub();
  }
  // window must hold real state: the module stores __pmChat on it.
  const winTarget: any = {};
  (globalThis as any).window = new Proxy(winTarget, { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && k.startsWith('__') ? undefined : stub())), set: (o, k, v) => { o[k] = v; return true; } });
  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}), text: async () => '' });
  const origError = console.error; const origWarn = console.warn; const origLog = console.log;
  const out = path.join(os.tmpdir(), `mobile-pages-regression-${process.pid}.mjs`);
  let mod: any;
  try {
    await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'error', loader: { '.css': 'empty', '.svg': 'text', '.png': 'empty' } });
    console.error = () => {}; console.warn = () => {}; console.log = () => {};
    mod = await import('file:///' + out.replace(/\\/g, '/'));
  } finally {
    fs.rmSync(entry, { force: true });
    console.error = origError; console.warn = origWarn; console.log = origLog;
  }
  const merge = mod.__merge;
  assert.equal(typeof merge, 'function');
  const e = (text: string, id: string) => ({ type: 'commentary', text, callId: id });
  // Phone only saw the post-restart stream.
  const target: any = { role: 'ai', _clientRequestId: 'r1', liveTraceEntries: [e('post restart A', 'p1'), e('post restart B', 'p2')] };
  // Server copy: full turn in order, pre-restart first.
  const source: any = { role: 'ai', _clientRequestId: 'r1', liveTraceEntries: [e('pre restart 1', 'a1'), e('pre restart 2', 'a2'), e('post restart A', 'p1'), e('post restart B', 'p2'), e('post restart C', 'p3')] };
  merge(target, source);
  const order = target.liveTraceEntries.map((x: any) => x.text);
  assert.deepEqual(order, ['pre restart 1', 'pre restart 2', 'post restart A', 'post restart B', 'post restart C'],
    'restored pre-restart entries must come before post-restart ones, not after');
  // No duplicates when the same source merges twice.
  merge(target, source);
  assert.equal(target.liveTraceEntries.length, 5, 'repeat merge must not duplicate rows');
  console.log('mobile-reconnect-trace-order regression: ok');
}
main().catch((err) => { console.error(err); process.exit(1); });