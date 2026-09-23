// Behavioral regression: executes the real mobile history mapper/dedupe
// (web-ui/src/mobile/mobile-pages.js, bundled with esbuild, DOM stubbed)
// against the exact row shapes a restart-spanning turn leaves in a session.
//
// Observed defect: after a mid-turn gateway restart the phone showed its own
// synced partial ("Both edits went in. Restarting...") and never the gateway's
// final answer or its file-changes card, even after a cold reopen.
// Causes: (1) the server-final marker compared the mapped role to 'assistant'
// (mobile maps it to 'ai') so it was never set; (2) folding a restart
// checkpoint relabelled the real answer as `restart_checkpoint`; (3) the
// partial and the final for one request were kept as two turns.
// Also covers the steer "JSON.stringify cannot serialize cyclic structures"
// failure: a steered turn must stay serializable.
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
    + '\nexport { _mapServerHistoryToMobile as __map, _dedupeMobileAssistantTurns as __dedupe, _appendMobileQueuedSteerTurn as __steer, __pmChat as __chat };\n');
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
  }

  const cid = 'mobile_test_session_abc_req1';
  const t0 = 1_790_000_000_000;
  const entries = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ type: 'tool', content: `${prefix} step ${i}`, t: t0 + i }));
  const history = [
    { role: 'user', _clientRequestId: cid, content: 'Build a page then restart', timestamp: t0 },
    // phone-synced partial written mid-turn
    { role: 'assistant', _clientRequestId: cid, content: 'Both edits went in. Restarting now.The restart completed.', timestamp: t0 + 10, processEntries: entries(30, 'pre'), liveTraceEntries: entries(8, 'pre') },
    { role: 'assistant', _clientRequestId: cid, content: 'Both edits went in. Restarting now.', timestamp: t0 + 10, processEntries: entries(29, 'pre'), liveTraceEntries: entries(8, 'pre') },
    // gateway restart checkpoints (no request id)
    { role: 'assistant', messageKind: 'restart_checkpoint', content: '[Hot restart checkpoint: planned by this chat]\nGateway Restart Initiated', timestamp: t0 + 20, processEntries: entries(30, 'pre'), liveTraceEntries: entries(8, 'pre'), fileChanges: { files: [{ path: 'old.txt' }] } },
    { role: 'assistant', messageKind: 'restart_checkpoint', content: '[Hot restart checkpoint: planned by this chat]\nGateway restart successful.', timestamp: t0 + 21, processEntries: entries(5, 'post'), liveTraceEntries: entries(5, 'post') },
    // gateway-authored final answer
    { role: 'assistant', clientRequestId: cid, content: 'The page and both edits made it through the restart.', timestamp: t0 + 60, liveTraceEntries: entries(3, 'post'), fileChanges: { files: [{ path: 'test-restart/landing.html' }] } },
  ];

  const turns = mod.__dedupe(mod.__map(history));
  const ai = turns.filter((m: any) => m.role === 'ai');
  assert.equal(ai.length, 1, `restart-spanning turn must render as ONE assistant turn, got ${ai.length}`);
  const text = String(ai[0].body?.text || ai[0].content || '');
  assert.ok(text.startsWith('The page and both edits made it through the restart.'), `final answer must win, got: ${text.slice(0, 80)}`);
  assert.notEqual(ai[0].messageKind, 'restart_checkpoint', 'the real answer must not be relabelled as a restart checkpoint (hidden row)');
  const files = (ai[0].fileChanges?.files || []).map((f: any) => f.path);
  assert.deepEqual(files, ['test-restart/landing.html'], 'file-changes card must come from the gateway final');
  const traceCount = (ai[0].processEntries || []).length + (ai[0].liveTraceEntries || []).length;
  assert.ok(traceCount >= 30, `pre-restart tool stream must survive the merge (got ${traceCount} entries)`);

  // Steer on a live turn must leave the thread JSON-serializable.
  const sid = 'mobile_test_steer';
  mod.__chat.threads = mod.__chat.threads || {};
  const steerThread: any[] = [
    { role: 'user', content: 'go', timestamp: t0 },
    { role: 'ai', streaming: true, content: 'working', body: { text: 'working' }, processEntries: [], timestamp: t0 + 1, workStartedAt: t0 + 1 },
  ];
  mod.__chat.threads[sid] = steerThread;
  const steerOk = mod.__steer(sid, 'also do this', { workflowBoundarySeq: 3, workflowStreamId: 's1' });
  assert.doesNotThrow(() => JSON.stringify(steerThread), 'steered thread must stay serializable');
  assert.equal(steerOk, true, 'steer append must run against the live thread');
  const steered = steerThread;
  assert.equal(steered.length, 4, 'steer must split into before-trace, steer message, and continuation');
  assert.equal(steered[1].workflowPart, 'before_interruption');
  assert.equal(steered[2].workflowPart, 'interruption');
  assert.equal(steered[3].workflowPart, 'interruption_response');

  console.error = origError; console.warn = origWarn; console.log = origLog;
  fs.rmSync(out, { force: true });
  process.stdout.write('mobile-restart-history-behavior regression: ok\n');
  process.exit(0);
}

main().catch((err) => { process.stderr.write('FAIL: ' + String(err?.stack || err) + '\n'); process.exit(1); });
