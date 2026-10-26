import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

// --root lets the same observable tests demonstrate the failure on main.
const root = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : process.cwd();
const shared = fs.readFileSync(path.join(root, 'web-ui/src/tool-activity.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'web-ui/src/pages/ChatPage.js'), 'utf8');
function declaration(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const sandbox = vm.createContext({});
vm.runInContext(`var scanned = 0; const replace = String.prototype.replace;
String.prototype.replace = function(...args) { scanned += this.length; return replace.apply(this, args); };
${declaration(shared, 'compact')}`, sandbox);
const compact = (value, max) => { sandbox.value = value; sandbox.max = max; return vm.runInContext('compact(value, max)', sandbox); };
const oldCompact = (value, max) => { const s = String(value ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, Math.max(1, max - 3))}...` : s; };
for (const max of [1, 2, 3, 72, 120, 180]) {
  for (const value of ['', null, 0, 'hello', '\t  hello\nworld  ', 'x'.repeat(max), 'x'.repeat(max + 1), ' '.repeat(5000) + 'a b c', ('abc\r\n\t  中文🙂  ').repeat(500), 'x'.repeat(max - 1) + ' '.repeat(5000) + 'y']) {
    assert.equal(compact(value, max), oldCompact(value, max), `equivalent compact max=${max}`);
  }
}
sandbox.scanned = 0;
compact('large tool source\n'.repeat(100000), 120);
assert.ok(sandbox.scanned < 1024, `short label scanned ${sandbox.scanned} chars, not megabyte tail`);

const { applyToolActivityEvent, coalesceToolActivityEntries, toolActivitySummary } = await import(pathToFileURL(path.join(root, 'web-ui/src/tool-activity.js')).href);
for (const failed of [false, true]) {
  const entries = [];
  applyToolActivityEvent(entries, 'call', { callId: 'edit1', action: 'workspace_run', args: { command: 'npm test' } });
  applyToolActivityEvent(entries, 'progress', { callId: 'edit1', action: 'workspace_run', message: 'Testing now' });
  const running = coalesceToolActivityEntries(entries);
  for (const live of [false, true]) assert.equal(toolActivitySummary(running, { live, coalesced: true }), toolActivitySummary(entries, { live }));
  running[0].activity.progress = 'Changed progress';
  assert.match(toolActivitySummary(running, { live: true, coalesced: true }), /Changed progress/, 'no stale progress cache');
  applyToolActivityEvent(entries, 'result', { callId: 'edit1', action: 'workspace_run', args: { command: 'npm test' }, result: failed ? 'ERROR: failed' : 'passed', error: failed, durationMs: 100 });
  const presented = coalesceToolActivityEntries(entries);
  assert.equal(presented.length, 1, 'call/result pairing preserved');
  for (const live of [false, true]) assert.equal(toolActivitySummary(presented, { live, coalesced: true }), toolActivitySummary(entries, { live }));
  let replayReads = 0;
  presented[0].activity = new Proxy(presented[0].activity, { get(target, key) { if (key === 'updatedAt') replayReads++; return target[key]; } });
  toolActivitySummary(presented, { live: true, coalesced: true });
  assert.equal(replayReads, 0, 'presented summary must not reconstruct transport events');
}
const waiting = [];
applyToolActivityEvent(waiting, 'call', { callId: 'wait1', action: 'background_ops', args: { action: 'wait', wait_ms: 1 }, startedAt: Date.now() - 100 });
assert.equal(coalesceToolActivityEntries(waiting).at(-1).activity.kind, 'result', 'raw waits still expire');

let presentations = 0;
const ctx = vm.createContext({ visibleLiveTraceEntries: entries => { presentations++; return entries; }, renderLiveTraceEntry: e => `<b>${e.text}</b>` });
vm.runInContext(declaration(chat, 'renderLiveTraceList'), ctx);
const list = [{ text: 'result remains visible' }];
assert.equal(ctx.renderLiveTraceList(list, { presented: true }), '<div class="live-turn-trace"><b>result remains visible</b></div>');
assert.equal(presentations, 0, 'presented body does not replay coalescing');
ctx.renderLiveTraceList(list);
assert.equal(presentations, 1, 'raw callers still use visibility filtering');
console.log('PASS desktop stream-lag: label equivalence/bounded work, raw/presented summaries, progress/results/waits, trace reuse');

// Actual desktop scheduling entry: token bursts coalesce, reader gets a bounded
// low-rate update, and hidden/switched sessions never get stale DOM writes.
const pending = new Map(); const hooks = new Map(); let patches = 0; let notified = 0;
const view = { activeChatSessionId: 'a', chatMessagesUserScrolledUp: true };
const doc = { hidden: false };
const stream = vm.createContext({ window: view, document: doc, streamingChatFlushHooks: hooks,
  desktopStreamRenderScheduler: { schedule(key, fn, options) { pending.set(key, { fn, options }); } },
  isSessionVisibleInChatSurface: sid => sid === view.activeChatSessionId,
  patchStreamingChatBubble: () => { patches++; return true; },
  redrawSideChatStreamPane: () => false, renderChatMessages: () => { throw new Error('unexpected fallback'); },
});
vm.runInContext(declaration(chat, 'renderStreamingChatUpdate'), stream);
for (let i = 0; i < 20; i++) stream.renderStreamingChatUpdate('a', () => notified++);
assert.equal(pending.size, 1, 'token burst has one pending paint');
assert.equal(pending.get('desktop-bubble:a').options.minimumDelay, 250, 'reader paints bounded to 4Hz');
pending.get('desktop-bubble:a').fn();
assert.equal(patches, 1); assert.equal(notified, 20, 'first-visible hooks preserved');
view.chatMessagesUserScrolledUp = false; stream.renderStreamingChatUpdate('a');
assert.equal(pending.get('desktop-bubble:a').options.minimumDelay, 0, 'tail reader uses adaptive cadence');
doc.hidden = true; pending.get('desktop-bubble:a').fn(); assert.equal(patches, 1, 'hidden callback does not paint');
doc.hidden = false; stream.renderStreamingChatUpdate('a'); view.activeChatSessionId = 'b'; pending.get('desktop-bubble:a').fn();
assert.equal(patches, 1, 'switched chat never gets stale callback');
console.log('PASS desktop stream scheduling: burst coalescing, input/read-up budget, hooks, hidden/switch guards');
