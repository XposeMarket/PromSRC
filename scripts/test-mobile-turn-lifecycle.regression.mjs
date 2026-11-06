import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MOBILE_STREAM_IDLE_TIMEOUT_MS,
  readChunkWithIdleTimeout,
  isMobileStreamStallError,
  classifyMobileStreamFailure,
  claimMobileFinalize,
  selectMobileTurnRowsToFinalize,
  isDroppableMobileLivePlaceholder,
  MOBILE_PLACEHOLDER_INERT_KEYS,
  reconcileMobileStaleRuns,
  resolveDrawerActiveRun,
  createMobileSilenceBackstop,
} from '../web-ui/src/mobile/mobile-turn-lifecycle.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const api = read('web-ui/src/mobile/mobile-api.js');
const runtime = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const shell = read('web-ui/src/mobile/mobile-shell.js');
const router = read('src/gateway/routes/chat.router.ts');
const enc = new TextEncoder();

// Fake timers: manual clock driving setTimeout-like handles.
function fakeTimers() {
  let now = 0; let seq = 0; const timers = new Map();
  return {
    setTimer(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
        await new Promise((r) => setImmediate(r));
      }
      now = end;
      await new Promise((r) => setImmediate(r));
    },
    get pending() { return timers.size; },
  };
}

// Fake SSE reader: chunks are queued by the test; read() resolves on push.
function fakeReader() {
  const queue = []; let waiter = null; let cancelled = false;
  return {
    push(text) { const item = { value: enc.encode(text), done: false }; if (waiter) { waiter(item); waiter = null; } else queue.push(item); },
    read() { return queue.length ? Promise.resolve(queue.shift()) : new Promise((res) => { waiter = res; }); },
    cancel() { cancelled = true; return Promise.resolve(); },
    get cancelled() { return cancelled; },
  };
}

// The stall classification mirrors streamChat's read loop.
async function runLoop(reader, timers, { idleMs = MOBILE_STREAM_IDLE_TIMEOUT_MS, userAborted = () => false } = {}) {
  const events = []; let outcome = 'pending';
  const p = (async () => {
    try {
      for (;;) {
        const { value, done } = await readChunkWithIdleTimeout(reader, { idleMs, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
        if (done) { outcome = 'done'; return; }
        events.push(new TextDecoder().decode(value));
      }
    } catch (err) {
      outcome = classifyMobileStreamFailure(err, { userAborted: userAborted() });
      events.err = err;
    }
  })();
  return { events, p, get outcome() { return outcome; } };
}

// --- gateway heartbeat comfortably below the idle limit ---
{
  const m = router.match(/res\.write\(': ping\\n\\n'\);[\s\S]{0,80}sendSSE\('heartbeat', payload\);\s*\}, (\d+)\);/);
  assert.ok(m, 'gateway main-chat heartbeat interval located');
  assert.ok(Number(m[1]) * 3 <= MOBILE_STREAM_IDLE_TIMEOUT_MS, 'idle limit is at least 3x the gateway ping interval');
  assert.equal(MOBILE_STREAM_IDLE_TIMEOUT_MS, 45_000);
}

// --- Must: one tool_call frame then hang → stall error flagged disconnected ---
{
  const t = fakeTimers(); const rd = fakeReader();
  const loop = await runLoop(rd, t);
  rd.push('data: {"type":"tool_call","name":"x"}\n\n');
  await t.advance(1);
  assert.equal(loop.events.length, 1);
  await t.advance(MOBILE_STREAM_IDLE_TIMEOUT_MS - 2);
  assert.equal(loop.outcome, 'pending', 'not aborted before the idle limit');
  await t.advance(5);
  await loop.p;
  assert.equal(loop.outcome, 'stalled');
  assert.equal(loop.events.err.mobileStreamDisconnected, true);
  assert.equal(loop.events.err.mobileStreamDisconnectReason, 'stalled');
  assert.notEqual(loop.events.err.name, 'AbortError', 'stall is not swallowed by the AbortError branch');
  assert.ok(isMobileStreamStallError(loop.events.err));
  assert.equal(t.pending, 0, 'no leaked watchdog timers');
}

// --- Must: pings/heartbeats more often than the limit keep the stream alive ---
{
  const t = fakeTimers(); const rd = fakeReader();
  const loop = await runLoop(rd, t);
  for (let i = 0; i < 40; i += 1) {
    await t.advance(5_000);
    rd.push(i % 2 ? ': ping\n\n' : 'event: heartbeat\ndata: {"type":"heartbeat"}\n\n');
    await t.advance(0);
  }
  assert.equal(loop.outcome, 'pending', '200s of heartbeats never trip the watchdog');
  assert.equal(loop.events.length, 40);
}

// --- Must: user Stop stays a stop (no disconnect recovery) ---
{
  const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.equal(classifyMobileStreamFailure(abortErr, { userAborted: true }), 'user_abort');
  assert.equal(classifyMobileStreamFailure(abortErr), 'user_abort');
  // Even a stall racing a user Stop is reported as the user's stop.
  const t = fakeTimers(); const rd = fakeReader(); let stopped = false;
  const loop = await runLoop(rd, t, { userAborted: () => stopped });
  stopped = true;
  await t.advance(MOBILE_STREAM_IDLE_TIMEOUT_MS + 1);
  await loop.p;
  assert.equal(loop.outcome, 'user_abort');
  assert.equal(classifyMobileStreamFailure(new Error('load failed')), 'error');
}

// --- streamChat wiring (source contract) ---
{
  const fn = api.slice(api.indexOf('export function streamChat('), api.indexOf('export function streamChat(') + 9000);
  assert.match(fn, /idleTimeoutMs = MOBILE_STREAM_IDLE_TIMEOUT_MS/, 'idle limit overridable via option');
  assert.match(fn, /readChunkWithIdleTimeout\(reader, \{ idleMs: idleTimeoutMs \}\)/, 'every read is raced against the watchdog');
  assert.match(fn, /classifyMobileStreamFailure\(err, \{ userAborted \}\)/);
  assert.match(fn, /failure === 'stalled'[\s\S]{0,400}ctrl\.abort\(\)[\s\S]{0,120}cb\('onError', toChatStreamError\(err\)\)/, 'stall aborts then surfaces onError');
  assert.match(fn, /signal\.addEventListener\('abort', \(\) => \{ userAborted = true; ctrl\.abort\(\); \}/);
  assert.match(fn, /return \{ abort: \(\) => \{ userAborted = true; ctrl\.abort\(\); \} \};/, 'Stop handle marks a user abort');
  assert.match(runtime, /if \(err\?\.mobileStreamDisconnected\) \{[\s\S]{0,900}scheduleMobileRunRecovery\(plannedRestart \? 250 : \(err\?\.mobileStreamStalled \? 0 : 2500\), \{ force: true \}\)/, 'stall schedules forced recovery');
  assert.match(runtime, /if \(stoppedByUser \|\| err\?\.name === 'AbortError'\) return;/, 'Stop path still returns before recovery');
}

// --- Must: POST final closes the row; Must-not: double finalize side effects ---
{
  // Simulated finalize using the shared guard, counting side effects.
  const effects = { plan: 0, complete: 0 };
  const runs = { s: { busy: true } };
  const finalize = (row) => {
    if (!claimMobileFinalize(row)) return false;
    row._pmLiveActivityCompleted = true; row.streaming = false; row._pmFinalized = true;
    row.liveTraceEntries.forEach((e) => { e.open = false; });
    effects.complete += 1; effects.plan += 1; delete runs.s;
    return true;
  };
  const row = { role: 'ai', streaming: true, liveTraceEntries: [{ kind: 'thought', open: true }] };
  assert.equal(finalize(row), true, 'POST final finalizes');
  assert.equal(finalize(row), false, 'WS terminal frame after POST finish is a no-op');
  assert.deepEqual(effects, { plan: 1, complete: 1 }, 'plan dock + completeStream ran once');
  assert.equal(row._pmFinalized, true); assert.equal(row._pmLiveActivityCompleted, true);
  assert.equal(row.streaming, false); assert.ok(row.liveTraceEntries.every((e) => !e.open), 'no open thoughts');
  assert.equal(runs.s, undefined, 'session run cleared');
  row.streaming = true; // a revived row (restart continuity) may finalize again
  assert.equal(claimMobileFinalize(row), true);
  assert.equal(claimMobileFinalize(null), false);
}

// finishAiTurn / finalize wiring (source contract)
{
  const start = runtime.indexOf('const finishAiTurn = () => {');
  const finish = runtime.slice(start, runtime.indexOf('const runNextQueuedMobilePrompt', start));
  assert.match(finish, /finalizeMobileLiveAiTurn\(targetAiTurn, \{ sessionId: actualSessionId, commit: false, markRead: !stoppedByUser \}\)/, 'finishAiTurn delegates to the canonical finalize');
  assert.ok(finish.indexOf('finalizeMobileLiveAiTurn(') < finish.indexOf('_mergeMobileFileChangesWithBackground'), 'finalize runs before send-specific extras');
  assert.match(finish, /_saveActiveMobilePromptVariant|updateMobileChatSessionHistory/, 'send-specific extras kept');
  const fz = runtime.slice(runtime.indexOf('function finalizeMobileLiveAiTurn('), runtime.indexOf('function addCommandTurn('));
  assert.match(fz, /if \(!claimMobileFinalize\(aiTurn\)\) return false;/, 'finalize is idempotent');
  assert.ok(fz.indexOf('claimMobileFinalize') < fz.indexOf('completeStream') && fz.indexOf('claimMobileFinalize') < fz.indexOf('_finalizeMobileMainPlanForTurn'), 'guard precedes side effects');
  assert.match(fz, /_closeMobileTraceThoughts\(aiTurn\);\s*aiTurn\._pmLiveActivityCompleted = true;/);
  assert.match(runtime, /applied === 'final' \|\| applied === 'done' \|\| applied === 'error'\) finishAiTurn\(\);/, 'POST final reaches finishAiTurn');
}

// --- Must: stale-active-status merge leaves no streaming row of that turn ---
{
  const thread = [
    { role: 'user', content: 'q' },
    { role: 'ai', streaming: true, body: { text: '' }, liveTraceEntries: [{ kind: 'tool' }] },
    { role: 'ai', streaming: true, body: { text: '' }, liveTraceEntries: [] },
    { role: 'ai', streaming: false, _pmFinalized: true, body: { text: 'answer' } },
    { role: 'ai', streaming: false, body: { text: 'durable server row' } },
  ];
  const { finalize, drop } = selectMobileTurnRowsToFinalize(thread, { hasVisibleAnswer: (r) => !!r.body?.text });
  assert.deepEqual(finalize, [thread[1]], 'live row with trace is finalized');
  assert.deepEqual(drop, [thread[2]], 'empty live placeholder is dropped');
  finalize.forEach((r) => { r.streaming = false; r._pmFinalized = true; });
  const after = thread.filter((r) => !drop.includes(r));
  assert.ok(after.every((r) => r.streaming !== true), 'no assistant row still streaming');
  const older = [{ role: 'ai', streaming: true }, { role: 'user' }, { role: 'ai', body: { text: 'x' }, _pmFinalized: true }];
  assert.equal(selectMobileTurnRowsToFinalize(older).finalize.length, 0, 'only rows after the last user row');
  const i = runtime.indexOf('if (staleActiveStatusAfterCompletedAnswer) {');
  const branch = runtime.slice(i, runtime.indexOf('return;', i));
  assert.match(branch, /selectMobileTurnRowsToFinalize\(mergedThread/);
  assert.match(branch, /finalizeMobileLiveAiTurn\(row, \{ commit: false, planFinalize: false \}\)/);
  assert.ok(branch.indexOf('_mergeMobileSessionThreadWithLocal') < branch.indexOf('selectMobileTurnRowsToFinalize'), 'finalize after the merge');
}


// --- Must-not: a live row carrying any content kind is never dropped during recovery finalize ---
{
  const noText = () => false; // _mobileAssistantHasVisibleAnswer is text-only; content must still protect the row
  const contentRows = {
    media_attachments: { body: { text: '', attachments: [{ id: 'a1', name: 'x.png' }] } },
    generated_images: { body: { text: '' }, generatedImages: [{ url: 'https://x/y.png' }] },
    files: { body: { text: '' }, files: [{ name: 'report.pdf' }] },
    rich_artifacts: { body: { text: '' }, richArtifacts: [{ type: 'products' }] },
    product_carousel: { body: { text: '' }, productCarousel: { items: [{ title: 'Lamp' }] } },
    question_request: { body: { text: '' }, questionRequest: { id: 'q1', status: 'pending' } },
    approval_request: { body: { text: '' }, approvalRequest: { id: 'ap1' } },
    file_changes: { body: { text: '' }, fileChanges: { files: [] } },
    error_presentation: { body: { text: '' }, errorPresentation: { key: 'some-other-error' } },
    before_interruption: { body: { text: '' }, workflowPart: 'before_interruption' },
    text_in_content: { body: { text: '' }, content: 'answer kept in content' },
  };
  for (const [name, extra] of Object.entries(contentRows)) {
    const row = { role: 'ai', streaming: true, liveTraceEntries: [], ...extra };
    const thread = [{ role: 'user', content: 'q' }, row];
    const { finalize, drop } = selectMobileTurnRowsToFinalize(thread, { hasVisibleAnswer: noText });
    assert.deepEqual(drop, [], `${name}: content-bearing live row is never dropped`);
    assert.deepEqual(finalize, [row], `${name}: content-bearing live row lands in finalize`);
    assert.equal(isDroppableMobileLivePlaceholder(row, { hasVisibleAnswer: noText }), false, `${name}: helper refuses to drop`);
  }
}

// --- Must: a truly empty streaming placeholder is still dropped (incl. connection-drop notice only) ---
{
  const noText = () => false;
  const empty = { role: 'ai', streaming: true, body: { text: '' }, liveTraceEntries: [] };
  const dropped = { role: 'ai', streaming: true, body: { text: '' }, errorPresentation: { key: 'chat-connection-dropped' } };
  assert.equal(isDroppableMobileLivePlaceholder(empty, { hasVisibleAnswer: noText }), true, 'empty placeholder is droppable');
  assert.equal(isDroppableMobileLivePlaceholder(dropped, { hasVisibleAnswer: noText }), true, 'connection-drop-only placeholder is droppable');
  const { drop, finalize } = selectMobileTurnRowsToFinalize([{ role: 'user' }, empty, dropped], { hasVisibleAnswer: noText });
  assert.deepEqual(drop, [empty, dropped], 'both empty placeholders are dropped');
  assert.deepEqual(finalize, [], 'nothing finalized for empty placeholders');
  // Finalized / server-authored / aborted rows are never droppable.
  for (const flag of ['_pmFinalReceived', '_pmServerAuthoredFinal', '_pmAbortAcknowledged']) {
    assert.equal(isDroppableMobileLivePlaceholder({ ...empty, [flag]: true }, { hasVisibleAnswer: noText }), false, `${flag} protects the row`);
  }
}

// --- Review round 2: allowlist. Any non-bookkeeping payload (incl. ones added later) protects the row ---
{
  const noText = () => false;
  const protectedRows = {
    voice_workgroup: { voiceWorkgroup: { workers: [{ id: 'w1', status: 'running' }] } },
    attachment_previews: { attachmentPreviews: [{ name: 'shot.png' }] },
    visual_stream_full: { _pmVisualStreamFull: 'buffered answer text' },
    visual_stream_pending: { _pmVisualStreamPending: 'pending chunk' },
    final_response_started: { finalResponseStarted: true },
    pending_thinking: { _pendingThinkingBurst: { text: 'thinking' } },
    future_payload: { someFutureCard: { id: 'x' } },
    body_extra: { body: { sender: '', text: '', actions: [{ id: 'a' }] } },
  };
  for (const [name, extra] of Object.entries(protectedRows)) {
    const row = { role: 'ai', streaming: true, body: { sender: '', text: '' }, content: '', processEntries: [], liveTraceEntries: [], ...extra };
    assert.equal(isDroppableMobileLivePlaceholder(row, { hasVisibleAnswer: noText }), false, `${name}: protects the row`);
    const { drop, finalize } = selectMobileTurnRowsToFinalize([{ role: 'user', content: 'q' }, row], { hasVisibleAnswer: noText });
    assert.deepEqual(drop, [], `${name}: never dropped`);
    assert.deepEqual(finalize, [row], `${name}: finalized instead of removed`);
  }
  // Real empty placeholder shapes (constructors in mobile-chat-page-runtime.js) stay droppable.
  const now = Date.now();
  const placeholders = {
    send: { role: 'ai', streaming: true, time: '', timestamp: now, workStartedAt: now, body: { sender: '', text: '' }, content: '', processEntries: [], liveTraceEntries: [], agentExecutionMode: 'execute', _pmAdmissionPending: true, _pmAdmissionClientRequestId: 'c1', _clientRequestId: 'c1' },
    recovery: { role: 'ai', streaming: true, time: '', timestamp: now, workStartedAt: now, body: { sender: '', text: '' }, content: '', processEntries: [], liveTraceEntries: [], activeRunKind: 'main', agentRuntimeKind: 'main', messageKind: undefined, _clientRequestId: 'c1' },
    ws_adopted: { role: 'ai', streaming: true, timestamp: now, body: { sender: '', text: '' }, content: '', processEntries: [], liveTraceEntries: [], _clientRequestId: 'c1', _streamId: 's1' },
    revived_with_bookkeeping: { role: 'ai', streaming: true, timestamp: now, workEndedAt: now + 5, workDurationMs: 5, body: { sender: 'Prometheus', text: '' }, content: '', liveTraceEntries: [], _pmVisualStreamTimer: 12, _pmVisualStreamFull: '', toolActivityStarted: true, _pmRecoveryReplay: true },
  };
  for (const [name, row] of Object.entries(placeholders)) {
    assert.equal(isDroppableMobileLivePlaceholder(row, { hasVisibleAnswer: noText }), true, `${name}: real empty placeholder is still droppable`);
  }
  // Drift guard: every key the runtime's live-placeholder constructors write must be inert bookkeeping
  // or an (empty) content holder, so a new constructor field forces a conscious decision here.
  const contentHolders = new Set(['body', 'sender', 'text', 'content', 'processEntries', 'liveTraceEntries']);
  const literals = runtime.match(/\{\s*role: 'ai',\s*streaming: true,[\s\S]*?\};/g) || [];
  // send, recovery, WS, WS adoption and side chat: losing one silently would weaken the guard.
  assert.ok(literals.length >= 5, `found every live placeholder constructor (got ${literals.length})`);
  for (const literal of literals) {
    // Explicit `key:` pairs plus shorthand properties (`activeRunKind,`).
    const keys = [
      ...[...literal.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((match) => match[1]),
      ...[...literal.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?=,|\n\s*\})/gm)].map((match) => match[1]),
    ];
    for (const key of keys) {
      assert.ok(MOBILE_PLACEHOLDER_INERT_KEYS.has(key) || contentHolders.has(key),
        `placeholder constructor key "${key}" must be classified in MOBILE_PLACEHOLDER_INERT_KEYS`);
    }
  }
}


// --- Must-not: an answer visible to the predicate is never dropped ---
{
  const answered = { role: 'ai', streaming: true, body: { text: 'hi' } };
  assert.equal(isDroppableMobileLivePlaceholder(answered, { hasVisibleAnswer: (r) => !!r.body?.text }), false, 'text answer is not droppable');
}


// --- Must: drawer Working disappears after 2 polls; Unread shows ---
{
  const now = 100_000;
  const misses = {};
  const localRuns = { s: { busy: true, startedAt: now - 60_000 } };
  let res = reconcileMobileStaleRuns({ localRuns, serverIds: [], misses, now });
  assert.deepEqual(res.clear, [], 'first miss keeps the run');
  assert.ok(res.keep.has('s'));
  res = reconcileMobileStaleRuns({ localRuns, serverIds: [], misses, now: now + 5_000 });
  assert.deepEqual(res.clear, ['s'], 'second consecutive miss clears');
  // After clearing, state precedence with server activeRun:false + mobileUnread.
  const working = resolveDrawerActiveRun({ serverActiveRun: false, activeRunKnown: true, liveActiveRun: false, now });
  assert.equal(working, false);
  const stateName = working ? 'working' : (true /* mobileUnread */ ? 'unread' : 'idle');
  assert.equal(stateName, 'unread');
  // The old OR without the activeRunKnown guard: a stale live run must not win.
  assert.equal(resolveDrawerActiveRun({ activeRunKnown: true, liveActiveRun: true, foreground: false, now }), false);
  assert.equal(resolveDrawerActiveRun({ activeRunKnown: true, liveActiveRun: true, foreground: true, liveEventAt: now - 20_000, now }), false, 'quiet foreground run loses to server');
  assert.equal(resolveDrawerActiveRun({ activeRunKnown: true, liveActiveRun: true, foreground: true, liveEventAt: now - 3_000, now }), true, 'fresh foreground stream may still show Working');
  assert.equal(resolveDrawerActiveRun({ activeRunKnown: false, localRunFresh: true, now }), true, 'unknown server state keeps local hint');
  assert.equal(resolveDrawerActiveRun({ serverActiveRun: true, activeRunKnown: true, now }), true);
}

// --- Must-not: clear a listed run or one inside the grace window ---
{
  const now = 500_000; const misses = {};
  const localRuns = { listed: { busy: true, startedAt: now - 600_000 }, young: { busy: true, startedAt: now - 2_000 }, unknown: { busy: true } };
  for (let poll = 0; poll < 5; poll += 1) {
    const { clear, keep } = reconcileMobileStaleRuns({ localRuns, serverIds: ['listed'], misses, now: now + poll * 1_000 });
    assert.ok(!clear.includes('listed') && keep.has('listed'), 'server-listed run never cleared');
    assert.ok(!clear.includes('young'), 'young run never cleared inside grace');
    assert.ok(!clear.includes('unknown'), 'unknown-age run waits a grace window from its first miss');
  }
  const later = reconcileMobileStaleRuns({ localRuns, serverIds: ['listed'], misses, now: now + 20_000 });
  assert.ok(later.clear.includes('unknown'), 'unknown-age run: 2+ misses spanning the grace window clears');
  assert.ok(!later.clear.includes('young'), 'young run: first miss after leaving grace only counts once');
  const later2 = reconcileMobileStaleRuns({ localRuns, serverIds: ['listed'], misses, now: now + 25_000 });
  assert.deepEqual(later2.clear, ['young'], 'second consecutive miss outside grace clears');
  // A server listing in between resets the counter.
  const m2 = {}; const lr = { s: { busy: true, startedAt: 1 } };
  reconcileMobileStaleRuns({ localRuns: lr, serverIds: [], misses: m2, now: 50_000 });
  reconcileMobileStaleRuns({ localRuns: lr, serverIds: ['s'], misses: m2, now: 51_000 });
  assert.deepEqual(reconcileMobileStaleRuns({ localRuns: lr, serverIds: [], misses: m2, now: 52_000 }).clear, [], 'misses must be consecutive');
}

// drawer wiring (source contract)
{
  const en = pages.slice(pages.indexOf('async function enrichMobileSessionGroupsForDrawer('), pages.indexOf('function _startMobileNewChat('));
  assert.match(en, /_applyMobileStaleRunReconcile\(status\.activeSessionIds\)/, 'enrich reconciles instead of re-seeding all local busy runs');
  assert.doesNotMatch(en, /Object\.entries\(__pmChat\.activeRuns \|\| \{\}\)\.filter\(\(\[, run\]\) => run\?\.busy\)/);
  assert.match(pages, /_clearMobileLiveRunForSession\(sid\)/);
  const view = shell.slice(shell.indexOf('function _drawerSessionStateView('), shell.indexOf('function _storeDrawerSessionState('));
  assert.match(view, /resolveDrawerActiveRun\(\{/);
  assert.doesNotMatch(view, /\|\| _drawerLiveActiveRun\(sessionIds\)\n/, 'no unguarded OR of the live run');
  assert.match(runtime, /const runRecoveryOnVisibility = \(\) => \{[\s\S]{0,200}reconcileMobileStaleRunsFromServer/, 'visible → reconcile');
  assert.match(runtime, /const runRecoveryOnWsOpen = \(\) => \{[\s\S]{0,120}reconcileMobileStaleRunsFromServer/, 'WS reopen → reconcile');
}

// --- silence backstop: fires once per window, skips pending questions ---
{
  let now = 0; let fired = 0; let busy = true; let question = false; let intervalFn = null; let cleared = false;
  const bs = createMobileSilenceBackstop({
    isBusy: () => busy, hasPendingQuestion: () => question, onSilence: () => { fired += 1; }, now: () => now,
    setIntervalFn: (fn) => { intervalFn = fn; return 7; }, clearIntervalFn: (id) => { cleared = id === 7; },
  });
  bs.start();
  const tick = (ms) => { for (let t = 0; t < ms; t += 10_000) { now += 10_000; intervalFn(); } };
  tick(40_000); assert.equal(fired, 0, 'no recovery before 45s');
  tick(10_000); assert.equal(fired, 1, 'recovery after 45s silence');
  tick(200_000); assert.equal(fired, 1, 'at most once per silence window');
  bs.noteEvent(); tick(50_000); assert.equal(fired, 2, 'new event re-arms the window');
  bs.noteEvent(); question = true; tick(300_000); assert.equal(fired, 2, 'never fires while a question card is pending');
  question = false; tick(40_000); assert.equal(fired, 2, 'question answered: silence window restarts');
  busy = false; tick(100_000); assert.equal(fired, 2, 'idle session never fires');
  bs.stop(); assert.equal(cleared, true); assert.equal(bs.running, false);
  assert.match(runtime, /mobilePageDisposed = true;\s*mobileSilenceBackstop\.stop\(\);/, 'timer cleared on page cleanup/session switch');
  assert.match(runtime, /hasPendingQuestion: \(\) => !!_getPendingQuestionForSession\(requestedSession\)/);
  assert.match(runtime, /onSilence: \(\) => \{[\s\S]{0,80}scheduleMobileRunRecovery\(0, \{ force: true \}\)/);
  assert.match(runtime, /onEvent: \(evt\) => \{\s*hideReconnectingStatus\(\);\s*noteMobileLiveStreamActivity\(actualSessionId\);/, 'POST events re-arm');
  assert.match(runtime, /hideReconnectingStatus\(\);\s*noteMobileLiveStreamActivity\(requestedSession\);/, 'WS events re-arm');
}

console.log('mobile turn lifecycle regression: ok');
