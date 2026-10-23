// Regression: after a reconnect/session reload, the mobile chat merge must keep
// ONE live assistant row, placed after its prompt. A fresh recovery placeholder
// (streaming, no request id, no text yet) used to fail the reflexive identity
// check, so _mergeMobileThreadLocalArtifacts pushed the SAME object a second
// time and the live turn painted twice (above and below the first prompt).
// Usage: node scripts/test-mobile-reconnect-live-row-identity.regression.mjs [--ref=origin/main]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

const FILE = 'web-ui/src/mobile/mobile-pages.js';
const refArg = process.argv.find((arg) => arg.startsWith('--ref='));
const text = refArg
  ? execFileSync('git', ['show', `${refArg.slice(6)}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  : fs.readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile('mobile-pages.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fns = sf.statements
  .filter((s) => ts.isFunctionDeclaration(s) && s.name)
  .map((s) => s.getText(sf).replace(/^export\s+(default\s+)?/, ''));
const sandbox = {
  console, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Array, Object, String, Number, RegExp, Boolean, Symbol, Promise, Error,
  __pmChat: { threads: {}, sessionId: 's1' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  window: {}, document: { querySelector: () => null, querySelectorAll: () => [] },
};
// Unresolved module-level imports/constants resolve to a no-op function.
const ctx = vm.createContext(new Proxy(sandbox, {
  has: () => true,
  get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : (globalThis[k] ?? (() => undefined)))),
}));
vm.runInContext(fns.join('\n'), ctx);
// Voice/pin helpers depend on lazy runtime modules; neutral for this shape.
vm.runInContext('_mobileVoiceRuntimeInvoke = () => undefined; _repairMobileRealtimeExchangeOrder = (l) => l; _mergeMobilePinnedCompletedTurn = (s, l) => l;', ctx);
const merge = vm.runInContext('_mergeMobileSessionThreadWithLocal', ctx);
const reconcile = vm.runInContext('_reconcileMobileThreadOrder', ctx);

const now = Date.now();
const rid = 'mobile_mvk8e9ss_lgrbud_mvk8e9yc_quqldklg';
const typed = 'Thid alwwys happens with inline videos';
const previews = (extra) => [
  { id: 'a1', name: 'IMG_0967.png', mimeType: 'image/jpeg', kind: 'image', ...extra },
  { id: 'a2', name: 'IMG_0968.png', mimeType: 'image/jpeg', kind: 'image', ...extra },
];
// Real server shape: only the user row while the turn runs.
const serverUser = () => ({
  role: 'user',
  content: `${typed}\n\n[UPLOADED FILES]\n  - "IMG_0967.png" -> saved to: C:\\u\\IMG_0967.png\n  - "IMG_0968.png" -> saved to: C:\\u\\IMG_0968.png`,
  timestamp: now - 60_000, clientRequestId: rid, channel: 'mobile',
  attachmentPreviews: previews({ uploadState: 'uploaded' }),
});
const localUser = () => ({ role: 'user', content: typed, timestamp: now - 61_000, _clientRequestId: rid, _pmOptimistic: true, attachmentPreviews: previews({}) });
const shape = (thread) => thread.map((m) => `${m.role}${m.streaming ? '*' : ''}`).join(' ');
const assertUnique = (thread, label) => assert.equal(new Set(thread).size, thread.length, `${label}: a row object occupies two thread slots (${shape(thread)})`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok   - ${name}`); } catch (err) { failures += 1; console.log(`FAIL - ${name}\n       ${err.message.split('\n')[0]}`); }
};

check('fresh recovery placeholder (no request id, no text) stays one row after its prompt across reconnects', () => {
  const live = { role: 'ai', streaming: true, content: '', body: { sender: '', text: '' }, timestamp: now - 59_000, workStartedAt: now - 59_000, processEntries: [], liveTraceEntries: [] };
  let thread = [localUser(), live];
  for (let pass = 0; pass < 3; pass += 1) {
    thread = merge('s1', [serverUser()], thread, {});
    assertUnique(thread, `pass ${pass}`);
    assert.equal(shape(thread), 'user ai*', `pass ${pass}`);
  }
  // It keeps streaming into the single surviving row.
  live.content = 'Looking at the inline video path.';
  live.liveTraceEntries.push({ id: 't1', text: 'grep' });
  thread = merge('s1', [serverUser()], thread, {});
  assert.equal(shape(thread), 'user ai*');
  assert.equal(thread[1], live);
});

check('request-owned streaming row with trace stays single', () => {
  const live = { role: 'ai', streaming: true, content: 'Working', timestamp: now - 59_000, _clientRequestId: rid, _streamId: 'st1', processEntries: [{ id: 'e1', text: 'read' }], liveTraceEntries: [{ id: 't1', text: 'grep' }] };
  const thread = merge('s1', [serverUser()], [localUser(), live], {});
  assert.equal(shape(thread), 'user ai*');
});

check('invariant: a repeated row reference collapses to the copy after its prompt', () => {
  const user = localUser();
  const live = { role: 'ai', streaming: true, content: '', timestamp: now };
  const thread = reconcile([live, user, live]);
  assert.equal(shape(thread), 'user ai*');
  assert.equal(thread[1], live);
});

check('a legit second turn still renders as its own assistant row', () => {
  const u1 = { role: 'user', content: 'first question', timestamp: now - 120_000, _clientRequestId: 'r1' };
  const a1 = { role: 'ai', content: 'first answer', timestamp: now - 110_000, _clientRequestId: 'r1', workEndedAt: now - 110_000 };
  const u2 = { role: 'user', content: 'second question', timestamp: now - 5_000, _clientRequestId: 'r2', _pmOptimistic: true };
  const a2 = { role: 'ai', streaming: true, content: '', timestamp: now - 4_000, processEntries: [], liveTraceEntries: [] };
  const server = [
    { role: 'user', content: 'first question', timestamp: now - 120_000, clientRequestId: 'r1' },
    { role: 'assistant', content: 'first answer', timestamp: now - 110_000, clientRequestId: 'r1' },
    { role: 'user', content: 'second question', timestamp: now - 5_000, clientRequestId: 'r2' },
  ];
  const thread = merge('s1', server, [u1, a1, u2, a2], {});
  assertUnique(thread, 'second turn');
  assert.equal(shape(thread), 'user ai user ai*');
});

check('steer continuation rows sharing a request id stay separate', () => {
  const group = 'chat_steer_abc';
  const u1 = localUser();
  const source = { role: 'ai', content: 'Checking the player.', timestamp: now - 50_000, _clientRequestId: rid, workflowGroupId: group, workflowPart: 'source' };
  const steer = { role: 'user', content: 'also check saving', timestamp: now - 40_000, workflowGroupId: group, workflowPart: 'steer' };
  const cont = { role: 'ai', streaming: true, content: 'Now the save flow.', timestamp: now - 39_000, _clientRequestId: rid, workflowGroupId: group, workflowPart: 'continuation' };
  const thread = merge('s1', [serverUser()], [u1, source, steer, cont], {});
  assertUnique(thread, 'steer');
  assert.equal(thread.filter((m) => m.role === 'ai').length, 2, shape(thread));
  assert.ok(thread.indexOf(source) < thread.indexOf(cont), 'continuation follows its source');
});

if (failures) {
  console.log(`\n${failures} failing`);
  process.exit(1);
}
console.log('\nall passing');
