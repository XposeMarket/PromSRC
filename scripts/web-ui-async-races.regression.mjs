// Plain Node behavioral regression runner; --baseline executes exact origin/main functions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const baseline = process.argv.includes('--baseline');
const read = (path) => baseline ? execFileSync('git', ['show', `origin/main:${path}`], { encoding: 'utf8', maxBuffer: 8e6 }) : fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const parse = (text) => ts.createSourceFile('fixture.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(text, name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText();
    if (!found) ts.forEachChild(node, visit);
  }
  visit(parse(text));
  return found || '';
}
function subscription(text, event) {
  let found;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText() === 'wsEventBus.on' && node.arguments[0]?.text === event) found = node.arguments[1].getText();
    if (!found) ts.forEachChild(node, visit);
  }
  visit(parse(text));
  return found;
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const metrics = {};
let failures = 0;
async function test(name, run) {
  try { await run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}

await test('A8 deletes only the requested identity after concurrent insertion', async () => {
  const source = read('web-ui/src/pages/ChatPage.js');
  let wrong = 0, retained = 0;
  for (const mutation of ['insert', 'reorder', 'already-removed']) {
    const gate = deferred();
    const window = { chatSessions: [{ id: 'A' }, { id: 'B' }], activeChatSessionId: 'A' };
    const context = vm.createContext({ window, deleteSessionFromServer: () => gate.promise, showToast() {}, saveChatSessions() {}, syncActiveChat() {}, saveComposerDraft() {}, composerDraftKey() {}, dispatchDesktopChatLifecycle() {}, setAgentSessionId() {}, generateSessionId: () => 'new' });
    vm.runInContext(declaration(source, 'deleteChatSession'), context);
    const pending = context.deleteChatSession('B');
    if (mutation === 'insert') window.chatSessions.unshift({ id: 'C' });
    if (mutation === 'reorder') window.chatSessions.reverse();
    if (mutation === 'already-removed') window.chatSessions = [{ id: 'C' }, { id: 'A' }];
    gate.resolve(); await pending;
    wrong += Number(!window.chatSessions.some((s) => s.id === 'A'));
    retained += Number(window.chatSessions.some((s) => s.id === 'B'));
  }
  metrics.A8 = { wrongSessionsRemoved: wrong, deletedSessionsRetained: retained, scenarios: 3 };
  assert.equal(wrong, 0); assert.equal(retained, 0);
});

function subagentFixture() {
  const source = read('web-ui/src/pages/SubagentsPage.js');
  const gates = [], renders = [], polls = [];
  const element = { style: {} };
  const context = vm.createContext({ console, setTimeout: () => 0, document: { getElementById: () => element, querySelectorAll: () => [] },
    api: (url) => { if (url === '/api/skills') return Promise.resolve({ skills: [] }); const gate = deferred(); gates.push({ url, ...gate }); return gate.promise; },
    getSubagentStreamingState: () => null, syncSubagentSourcePanelContext() {}, syncActiveSubagentStreamingState() {}, renderSubagentsCanvas() {}, restoreSubagentChatScroll() {}, stopSubagentPolling() {},
    renderSubagentBoard: (id) => renders.push(id), startSubagentPolling: (id) => polls.push(id), normalizeSubagentChatMessages: (x) => x, preserveSubagentProcessMetadata: (x) => x,
  });
  vm.runInContext(`var activeSubagentId=null, subagentSelectionGeneration=0, subagentDetailTab='', subagentRuns=[], activeSubagentRunId='', subagentRunDetails={}, subagentChatHistory=[], subagentSystemPrompt='', subagentContextRefs=[], subagentMemoryNotes='', subagentMemoryExists=false, subagentHbConfig={}, subagentHbMd='', subagentWorkspaceFiles=[], subagentWorkspaceTree=[], subagentWorkspaceData=null, subagentWorkspaceOpenFile=null, subagentWorkspaceFolderExpanded=new Set(), subagentSkillsCache=[];\n` + ['isCurrentSubagentSelection', 'openSubagentDetail', 'closeSubagentDetail', 'loadSubagentBoardData'].map((name) => declaration(source, name)).join('\n'), context);
  context.refresh = vm.runInContext(`(${subscription(source, 'subagent_run_updated')})`, context);
  function settle(id, from = 0) {
    gates.slice(from).filter((g) => g.url.includes(`/agents/${id}/`)).forEach((g) => g.resolve({ runs: [id], messages: [id], refs: [id], task: { id } }));
  }
  return { context, gates, renders, polls, settle };
}
await test('A9 stale A cannot replace/render/poll B; current B applies', async () => {
  const f = subagentFixture();
  const a = f.context.openSubagentDetail('A'); const b = f.context.openSubagentDetail('B');
  f.settle('B'); await b; const currentApplied = f.context.subagentRuns[0] === 'B';
  f.settle('A'); await a;
  metrics.A9 = { staleARenders: f.renders.filter((id) => id === 'A').length, staleAPolls: f.polls.filter((id) => id === 'A').length, currentBApplied: Number(currentApplied), staleStateWrites: Number(f.context.subagentRuns[0] !== 'B') };
  assert.equal(currentApplied, true); assert.equal(f.context.subagentRuns[0], 'B'); assert.deepEqual(f.renders, ['B']); assert.deepEqual(f.polls, ['B']);
});
await test('A9 same-agent reselection, close, and WS await boundaries', async () => {
  const f = subagentFixture();
  const a1 = f.context.openSubagentDetail('A'); const old = f.gates.slice();
  const b = f.context.openSubagentDetail('B'); f.settle('B'); await b;
  const start = f.gates.length; const a2 = f.context.openSubagentDetail('A'); f.settle('A', start); await a2;
  old.forEach((g) => g.resolve({ runs: ['stale'], messages: ['stale'], refs: [] })); await a1;
  assert.equal(f.context.subagentRuns[0], 'A'); assert.deepEqual(f.renders, ['B', 'A']);
  const pending = f.context.openSubagentDetail('C'); f.context.closeSubagentDetail(); f.settle('C'); await pending;
  assert.deepEqual(f.renders, ['B', 'A']);
  const current = f.context.openSubagentDetail('B'); f.settle('B'); await current;
  f.context.subagentDetailTab = 'runs'; f.context.subagentRunDetails.task = { task: {} };
  const refresh = f.context.refresh({ agentId: 'B', taskId: 'task' });
  const first = f.gates.at(-1); first.resolve({ runs: ['B-refresh'] }); await tick();
  const detail = f.gates.at(-1); const next = f.context.openSubagentDetail('D'); f.settle('D'); await next;
  detail.resolve({ task: { id: 'stale' } }); await refresh;
  assert.equal(f.context.subagentRunDetails.task, undefined); assert.equal(f.renders.at(-1), 'D');
  const refreshD = f.context.refresh({ agentId: 'D' }); const runD = f.gates.at(-1);
  const e = f.context.openSubagentDetail('E'); f.settle('E'); await e;
  runD.resolve({ runs: ['stale-D'] }); await refreshD; assert.equal(f.context.subagentRuns[0], 'E');
  const refreshE = f.context.refresh({ agentId: 'E' }); f.gates.at(-1).resolve({ runs: ['E-refresh'] }); await refreshE;
  assert.equal(f.context.subagentRuns[0], 'E-refresh');
});

await test('A9 refresh and in-flight polling cannot mutate a new selection', async () => {
  const source = read('web-ui/src/pages/SubagentsPage.js');
  for (const tab of ['memory', 'heartbeat']) {
    const f = subagentFixture();
    vm.runInContext(['refreshSubagentDetail', 'reloadSubagentMemory'].map((name) => declaration(source, name)).join('\n'), f.context);
    const open = f.context.openSubagentDetail('A'); f.settle('A'); await open;
    f.context.subagentDetailTab = tab;
    const refresh = f.context.refreshSubagentDetail('A'); f.settle('A'); await tick();
    const pending = f.gates.slice();
    const next = f.context.openSubagentDetail('B'); f.settle('B'); await next;
    pending.forEach((g) => g.resolve({ content: 'stale-A', config: { enabled: true } })); await refresh;
    assert.equal(f.context.subagentSystemPrompt, ''); assert.equal(f.context.subagentHbMd, ''); assert.equal(f.renders.at(-1), 'B');
  }
  for (const phase of ['runs', 'chat']) {
    const f = subagentFixture(); let callback;
    f.context.setInterval = (fn) => { callback = fn; return 1; };
    vm.runInContext(`var _subagentDetailPolling; ${declaration(source, 'startSubagentPolling')}`, f.context);
    const open = f.context.openSubagentDetail('A'); f.settle('A'); await open;
    f.context.subagentDetailTab = 'chat';
    const poll = callback();
    if (phase === 'chat') { f.gates.at(-1).resolve({ runs: ['A'] }); await tick(); }
    const old = f.gates.at(-1);
    const next = f.context.openSubagentDetail('B'); f.settle('B'); await next;
    old.resolve({ runs: ['stale-A'], messages: ['stale-A'] }); await poll;
    assert.equal(f.context.subagentRuns[0], 'B'); assert.equal(f.context.subagentChatHistory[0], 'B'); assert.equal(f.renders.at(-1), 'B');
  }
});

let createVoiceWorkerRecovery;
try { ({ createVoiceWorkerRecovery } = await import('../web-ui/src/mobile/mobile-voice-worker-recovery.js')); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
function mobileFixture(fetchGroup) {
  const source = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
  const context = vm.createContext({ createVoiceWorkerRecovery, mobileGatewayFetch: fetchGroup, _mobileBackgroundSpawnIsVoiceWorker: () => true, _mobileBackgroundSpawnId: (e) => e.taskId, _mobileBackgroundVoiceWorkgroupId: (e) => e.workgroupId, _findMobileVoiceWorkerByTaskId: () => null, _upsertMobileVoiceWorkgroup() {} });
  let recovery = '';
  const match = source.indexOf('const _mobileVoiceWorkerRecovery =');
  if (match >= 0) {
    // Read the exact variable statement through the parser, not a copied implementation.
    const root = parse(source); function visit(n) { if (ts.isVariableStatement(n) && n.getText().startsWith('const _mobileVoiceWorkerRecovery =')) recovery = n.getText().replace('const ', 'var '); else ts.forEachChild(n, visit); } visit(root);
  }
  vm.runInContext(`var _pendingMobileVoiceBackgroundEvents = new Map();\n${recovery}\n${declaration(source, '_routeMobileVoiceBackgroundEvent')}`, context);
  return context;
}
await test('A10 missing-worker burst is single-flight and failed queue map is bounded', async () => {
  let fetches = 0; const gate = deferred();
  const f = mobileFixture(() => { fetches++; return gate.promise; });
  for (let i = 0; i < 50; i++) f._routeMobileVoiceBackgroundEvent({ taskId: 'T', workgroupId: 'G', sessionId: 'S' });
  await tick(); const burstFetches = fetches;
  gate.reject(Object.assign(new Error('missing'), { status: 404 })); await tick(); await tick();
  const dead = mobileFixture(() => Promise.reject(Object.assign(new Error('missing'), { status: 404 })));
  for (let i = 0; i < 500; i++) dead._routeMobileVoiceBackgroundEvent({ taskId: `T${i}`, workgroupId: `G${i}`, sessionId: 'S' });
  const peak = dead._mobileVoiceWorkerRecovery?.pendingSize ?? dead._pendingMobileVoiceBackgroundEvents.size;
  await tick(); await tick();
  const retained = dead._mobileVoiceWorkerRecovery?.pendingSize ?? dead._pendingMobileVoiceBackgroundEvents.size;
  metrics.A10 = { fetchesFor50Events: burstFetches, peakTasksFor500Groups: peak, retainedTasksAfter404: retained };
  assert.equal(burstFetches, 1); assert.ok(peak <= 128); assert.equal(retained, 0);
});
await test('A10 imported recovery: backoff, bounded cache, resolved drain, invalidation', async () => {
  assert.equal(typeof createVoiceWorkerRecovery, 'function');
  let now = 0, calls = 0; const delivered = [];
  const recovery = createVoiceWorkerRecovery({ now: () => now, fetchGroup: async () => { calls++; if (calls < 3) throw new Error('temporary'); return { id: 'G', workers: [{ taskId: 'T' }] }; }, onGroup: (group) => delivered.push(group.id) });
  recovery.enqueue('T', 'G', { event: {}, done: false });
  await recovery.fetch('G', 'S'); await recovery.fetch('G', 'S'); assert.equal(calls, 1); assert.equal(recovery.pendingSize, 1);
  now = 1000; await recovery.fetch('G', 'S'); assert.equal(calls, 2);
  now = 2000; await recovery.fetch('G', 'S'); assert.equal(calls, 2);
  now = 3000; await recovery.fetch('G', 'S'); assert.equal(calls, 3); assert.equal(recovery.pendingSize, 0);
  await recovery.fetch('G', 'S'); assert.equal(calls, 3);
  recovery.invalidate('G'); await recovery.fetch('G', 'S'); assert.equal(calls, 4); assert.deepEqual(delivered, ['G', 'G']);
  for (let i = 0; i < 500; i++) recovery.enqueue(`T${i}`, '', { event: {}, done: false });
  assert.ok(recovery.pendingSize <= 128); now += 61000; assert.equal(recovery.pendingSize, 0);
  for (let i = 0; i < 500; i++) await recovery.fetch(`G${i}`, 'S');
  assert.ok(recovery.groupSize <= 128);
  const deliveredItems = [];
  const drain = createVoiceWorkerRecovery({ fetchGroup: async () => ({ id: 'G', workers: [{ taskId: 'T' }] }), onGroup: () => deliveredItems.push(...drain.take('T')) });
  for (let i = 0; i < 50; i++) drain.enqueue('T', 'G', i);
  drain.enqueue('orphan', 'G', 'drop'); await drain.fetch('G', 'S');
  assert.deepEqual(deliveredItems, Array.from({ length: 40 }, (_, i) => i + 10)); assert.equal(drain.pendingSize, 0);
  const permanent = createVoiceWorkerRecovery({ fetchGroup: async () => null, onGroup() {} });
  permanent.enqueue('T', 'G', {}); await permanent.fetch('G', 'S'); assert.equal(permanent.pendingSize, 0);
  const wait = deferred(); let applied = 0;
  const invalidated = createVoiceWorkerRecovery({ fetchGroup: () => wait.promise, onGroup: () => applied++ });
  const pending = invalidated.fetch('G', 'S'); invalidated.invalidate('G'); wait.resolve({ id: 'G' }); await pending;
  assert.equal(applied, 0);
});

await test('A22 rejects safely without serializing exact/wildcard subscribers', async () => {
  const source = read('web-ui/src/ws.js').split('// ─── WebSocket Connection')[0];
  const { wsEventBus: bus } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let unhandled = 0; const errors = [], order = []; const original = console.error;
  const onUnhandled = () => unhandled++;
  process.on('unhandledRejection', onUnhandled); console.error = (...args) => errors.push(args);
  try {
    const slow = deferred(); const removable = () => order.push('removed');
    bus.on('test', async () => { throw new Error('async-exact'); });
    bus.on('te*', async () => { throw new Error('async-prefix'); });
    bus.on('test', () => { throw new Error('sync'); });
    bus.on('test', () => ({ then(resolve, reject) { reject(new Error('thenable')); } }));
    bus.on('test', async () => { await slow.promise; order.push('slow'); });
    bus.on('test', () => order.push('later')); bus.on('test', removable); bus.off('test', removable);
    bus._dispatch({ type: 'test' }); assert.deepEqual(order, ['later']);
    slow.resolve(); await tick(); await tick();
    metrics.A22 = { unhandledRejections: unhandled, centrallyReportedErrors: errors.length, expectedErrors: 4 };
    assert.equal(unhandled, 0); assert.equal(errors.length, 4); assert.deepEqual(order, ['later', 'slow']);
  } finally { console.error = original; process.off('unhandledRejection', onUnhandled); }
});
console.log(JSON.stringify({ baseline, metrics, failures }, null, 2));
process.exitCode = failures ? 1 : 0;
