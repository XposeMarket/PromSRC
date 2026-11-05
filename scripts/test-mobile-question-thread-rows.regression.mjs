// Regression: returning to a mobile thread with a pending ask_prometheus_questions
// card showed empty duplicated "Working for..." rows; the tool stream and the
// preamble Prom wrote before asking were hidden (the renderer returned '' for
// the whole row). After connection trouble, result-only tool frames rendered
// "Tool completed" (Raul, 2026-11-05).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.window = globalThis.window || {};

const imp = (rel) => import(pathToFileURL(path.resolve(rel)).href);
const rows = await imp('web-ui/src/mobile/mobile-question-rows.js');
const continuity = await imp('web-ui/src/mobile/mobile-restart-continuity.js');
const { createMobileChatMessageRenderer } = await imp('web-ui/src/mobile/mobile-chat-message-renderer.js');
const activity = await imp('web-ui/src/tool-activity.js');
const lookup = await imp('web-ui/src/tool-call-action-lookup.js');

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ctx = {
  ICONS: {}, __pmChat: { editingMessageIndex: -1, activeSessionId: 's1' },
  _collectMessageMedia: () => [], _getPendingApprovalsForSession: () => [], _hasPendingImageGeneration: () => false,
  _isMobileVoiceAgentWorkerHandoff: () => false, _isMobileVoiceTraceTurn: () => false,
  _mobileHasCompletedTrace: (entries) => Array.isArray(entries) && entries.length > 0,
  _mobileWorkflowTraceEntriesForMessage: (m) => [...(m.liveTraceEntries || []), ...(m.processEntries || [])],
  _mobileWorkflowTransitionLabel: () => '', _normalizeMobileMedia: (x) => x, _renderBrowseCard: () => '',
  _renderChatAttachmentPreviews: () => '', _renderMobileApprovalCard: () => '<div class="approval"></div>',
  _renderMobileChatErrorPresentation: () => '', _renderMobileFileChanges: () => '',
  _renderMobileGeneratedImageLoadingCard: () => '', _renderMobileGoalCompletionReport: () => '',
  _renderMobileGroupedTrace: (entries) => `<div class="trace">${entries.map((e) => esc(e.text)).join('|')}</div>`,
  _renderMobileMarkdown: (t) => esc(t), _renderMobileMediaGallery: () => '', _renderMobileMessageActions: () => '',
  _renderMobileProductCarousel: () => '', _renderMobileQuestionCard: () => '<div class="INLINE-QUESTION-CARD"></div>',
  _renderMobileRichArtifacts: () => '', _renderMobileSkillReferencedMarkdown: (t) => esc(t),
  _renderMobileThreadLinkArtifacts: () => '', _renderMobileUserEditComposer: () => '', _renderMobileVoiceLyrics: () => '',
  _renderMobileVoiceWorkgroup: () => '', _renderMobileWorkTimer: () => '<span class="timer">Working for 4s</span>',
  chatTimelineRowSignature: () => 'sig', escapeHtml: esc,
};
const render = createMobileChatMessageRenderer(() => ctx);

const cid = 'mobile_req_q1';
const question = { id: 'q1', status: 'pending', clientRequestId: cid };
const user = { role: 'user', content: 'deploy it', _clientRequestId: cid };
const liveRow = (extra = {}) => ({
  role: 'ai', streaming: true, timestamp: 1000, workStartedAt: 1000, _clientRequestId: cid,
  body: { sender: '', text: '' }, content: '', processEntries: [],
  liveTraceEntries: [
    { type: 'preamble', text: 'I need to know which region to deploy to.' },
    { type: 'tool', text: 'Ran command', activity: { kind: 'operation', action: 'workspace_run', status: 'called' } },
  ],
  ...extra,
});
const questionOnly = () => ({ role: 'ai', timestamp: 2000, body: { sender: 'Prometheus', text: '' }, content: '', questionRequest: { ...question } });
const isEmptyWorking = (row) => row?.role === 'ai' && !row.questionRequest
  && !String(row.body?.text || row.content || '').trim()
  && !(row.liveTraceEntries?.length) && !(row.processEntries?.length);

// Must: pending question + trace/preamble -> trace and preamble visible, no inline card.
{
  const html = render(liveRow({ questionRequest: { ...question } }), 1, 'k1');
  assert.ok(html, 'a row carrying trace + pending question is rendered (was hidden)');
  assert.match(html, /which region to deploy to/, 'preamble is visible');
  assert.match(html, /class="trace"/, 'tool stream is visible');
  assert.doesNotMatch(html, /INLINE-QUESTION-CARD/, 'composer popover is the only question card');
}
// Must not: hide a row with trace even when it is not streaming (recovered/frozen).
{
  const html = render(liveRow({ streaming: false, questionRequest: { ...question } }), 1, 'k1b');
  assert.ok(html && /pm-trace-drawer/.test(html) && /Working for/.test(html),
    'frozen trace row with a pending question stays visible (timer + trace drawer)');
  assert.doesNotMatch(html, /INLINE-QUESTION-CARD/);
}
// Question-only placeholder row is still hidden.
assert.equal(render(questionOnly(), 2, 'k2'), '', 'question-only placeholder stays hidden');
// Answered question still renders its card (history), as before.
assert.match(render({ ...questionOnly(), questionRequest: { id: 'q1', status: 'answered' } }, 2, 'k3'), /INLINE-QUESTION-CARD/);

// Must: pending question, nothing streaming -> "Waiting for your answer", no dots.
{
  const html = render(liveRow({ questionRequest: { ...question } }), 1, 'k4');
  assert.match(html, /Waiting for your answer/);
  assert.doesNotMatch(html, /pm-thinking-dots/);
  const row = liveRow({ questionRequest: { ...question }, liveTraceEntries: [] });
  const bare = render(row, 1, 'k4b');
  assert.match(bare, /Waiting for your answer/, 'live row without trace yet also waits');
  assert.doesNotMatch(bare, /pm-thinking-dots/);
}
// Waiting status disappears when the question resolves or new frames arrive.
{
  const resolved = render(liveRow({ liveTraceEntries: [] }), 1, 'k5');
  assert.doesNotMatch(resolved, /Waiting for your answer/, 'gone once questionRequest is removed');
  assert.match(resolved, /pm-thinking-dots/, 'working dots return for a live row');
  const answered = liveRow({ questionRequest: { id: 'q1', status: 'answered' } });
  assert.doesNotMatch(render(answered, 1, 'k5b'), /Waiting for your answer/);
  const newTool = liveRow({ questionRequest: { ...question } });
  newTool.liveTraceEntries.push({ type: 'tool', text: 'Reading file', activity: { kind: 'operation', action: 'read_file', status: 'running' } });
  assert.doesNotMatch(render(newTool, 1, 'k5c'), /Waiting for your answer/, 'a new running tool frame clears it');
  assert.doesNotMatch(render(liveRow({ questionRequest: { ...question }, body: { text: 'Deploying...' } }), 1, 'k5d'), /Waiting for your answer/,
    'streaming answer text clears it');
}

// Question attaches to the same-request live row after the last user row, never an older turn.
{
  const older = { role: 'ai', body: { text: 'old answer' }, content: 'old answer', processEntries: [{ type: 'tool', text: 'x' }], _pmFinalReceived: true };
  const live = liveRow();
  const thread = [{ role: 'user', content: 'earlier' }, older, user, live];
  assert.equal(rows.findMobileQuestionHostRow(thread, question), live);
  assert.equal(rows.findMobileQuestionHostRow([{ role: 'user', content: 'earlier' }, older, user], question), null,
    'no live row of this request -> no host (older completed turn is never used)');
  assert.equal(rows.findMobileQuestionHostRow([user, liveRow({ _clientRequestId: 'other' })], question), null, 'different request is skipped');
}

// Must: recovery with cached live row + question-only row + status.active -> exactly one live row, zero empty rows.
{
  const cached = liveRow({ streaming: false, workEndedAt: 5000 });
  const qRow = questionOnly();
  const emptyA = { role: 'ai', streaming: true, timestamp: 3000, body: { text: '' }, content: '', processEntries: [], liveTraceEntries: [] };
  const thread = [user, cached, qRow, emptyA];
  assert.equal(continuity.canReviveRecoveryTurn(thread, qRow, cid), false, 'question-only row is never adopted');
  assert.equal(continuity.revivableTurn({ active: true }, thread, qRow, cid), null);
  // Recovery's latest-assistant pick skips the question-only row (runtime contract below).
  const latest = [...thread].reverse().find((t) => t?.role === 'ai' && !rows.isMobileQuestionOnlyRow(t) && !isEmptyWorking(t));
  assert.equal(latest, cached);
  thread.pop(); // the stale empty row sits after cached; run the full page sequence instead:
  thread.push(emptyA);
  const found = [...thread].reverse().find((t) => t?.role === 'ai' && t._clientRequestId === cid);
  assert.equal(found, cached);
  continuity.reviveIfFrozen(thread, found, cid);
  assert.equal(found.streaming, true, 'cached live row revived in place');
  continuity.collapseEmptyLiveRows(thread, found);
  const aiRows = thread.filter((t) => t.role === 'ai');
  assert.equal(aiRows.length, 1, 'exactly one row for the turn');
  assert.equal(aiRows[0], cached);
  assert.equal(aiRows[0].questionRequest?.id, 'q1', 'question folded onto the live row');
  assert.equal(thread.filter(isEmptyWorking).length, 0, 'zero empty Working rows');
  const html = render(aiRows[0], 1, 'kr');
  assert.match(html, /which region/);
  assert.match(html, /Waiting for your answer/);

  // Must: after the answer, still exactly one row, trace intact (terminal branch deletes questionRequest).
  delete aiRows[0].questionRequest;
  assert.equal(thread.filter((t) => t.role === 'ai').length, 1);
  assert.equal(aiRows[0].liveTraceEntries.length, 2, 'trace intact after answer');
  assert.doesNotMatch(render(aiRows[0], 1, 'kr2'), /Waiting for your answer/);
}
// canReviveRecoveryTurn: a trailing question-only row does not block reviving the run's row.
{
  const cached = liveRow({ streaming: false, workEndedAt: 5000 });
  assert.equal(continuity.canReviveRecoveryTurn([user, cached, questionOnly()], cached, cid), true);
}
// Recovery with no live row: allocated row + collapse folds the placeholder; no duplicate.
{
  const qRow = questionOnly();
  const thread = [user, qRow];
  const fresh = { role: 'ai', streaming: true, body: { text: '' }, content: '', processEntries: [], liveTraceEntries: [], _clientRequestId: cid };
  thread.push(fresh);
  continuity.collapseEmptyLiveRows(thread, fresh);
  assert.deepEqual(thread.filter((t) => t.role === 'ai'), [fresh]);
  assert.equal(fresh.questionRequest.id, 'q1');
}

// Must: result-only frame whose call is in the turn's checkpoint/process entries -> real label.
{
  const processEntries = [{ type: 'tool', content: 'workspace_run(...)', extra: { toolName: 'workspace_run', toolCallId: 'call-7', args: { command: 'npm test' } } }];
  const payload = lookup.withResolvedToolAction({ toolCallId: 'call-7', result: 'ok' }, [], processEntries);
  assert.equal(payload.action, 'workspace_run');
  const entries = [];
  activity.applyToolActivityEvent(entries, 'result', payload);
  const text = entries.map((e) => e.text).join(' | ');
  assert.doesNotMatch(text, /Tool completed|\bTool\b/);
  assert.match(text, /command/i, 'real command label');
  // Same call already in live entries (different shape): resolved inside applyToolActivityEvent.
  const live = [{ type: 'tool', activity: { kind: 'operation', action: 'read_file', callId: 'call-9', status: 'running', resultAttached: true } }];
  activity.applyToolActivityEvent(live, 'result', { toolCallId: 'call-9', result: 'x' });
  assert.ok(!live.some((e) => /Tool completed/.test(e.text || '')));
  // Coalescing reduced checkpoint rows: name-less result with call id finds its call.
  const coalesced = activity.coalesceToolActivityEntries([
    { type: 'tool', content: 'read_file', extra: { toolName: 'read_file', toolCallId: 'c2', args: { path: 'a.js' } } },
    { type: 'tool', content: 'grep', extra: { toolName: 'grep_files', toolCallId: 'c3' } },
    { type: 'result', content: 'body', extra: { toolCallId: 'c2' } },
  ]);
  const ctext = coalesced.map((e) => e.text).join(' | ');
  assert.match(ctext, /Read a\.js/, 'result-only checkpoint row resolves via call id');
  assert.doesNotMatch(ctext, /Tool completed/);
}
// Must: an unresolvable result never renders "Tool completed" or a bare "Tool".
{
  const entries = [];
  activity.applyToolActivityEvent(entries, 'result', { toolCallId: 'ghost', result: 'done' });
  for (const entry of entries) {
    assert.doesNotMatch(entry.text, /Tool completed/);
    assert.notEqual(entry.text.trim(), 'Tool');
  }
  assert.ok(entries.some((e) => /Finished a step|Running a step/.test(e.text)), entries.map((e) => e.text).join('|'));
}
// Must not: normal call+result pairs keep their labels (desktop + mobile share this module).
{
  const entries = [];
  activity.applyToolActivityEvent(entries, 'call', { action: 'read_file', toolCallId: 'n1', args: { path: 'src/a.ts' } });
  activity.applyToolActivityEvent(entries, 'result', { action: 'read_file', toolCallId: 'n1', result: 'ok' });
  assert.ok(entries.some((e) => e.text === 'Read a.ts' || /^Read .*a\.ts/.test(e.text)), entries.map((e) => e.text).join('|'));
  const custom = [];
  activity.applyToolActivityEvent(custom, 'call', { action: 'my_custom_tool', toolCallId: 'n2' });
  activity.applyToolActivityEvent(custom, 'result', { action: 'my_custom_tool', toolCallId: 'n2', result: 'ok' });
  assert.ok(custom.some((e) => /^My Custom Tool completed/.test(e.text)), 'named unknown tools unchanged');
}

// Source contracts for DOM-bound modules.
const src = (rel) => fs.readFileSync(path.resolve(rel), 'utf8');
const pages = src('web-ui/src/mobile/mobile-pages.js');
const runtime = src('web-ui/src/mobile/mobile-chat-page-runtime.js');
const rendererRuntime = src('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
assert.match(pages, /const host = _mobileQuestionHostRow\(thread, question\);/, 'projection attaches to the live row first');
assert.match(pages, /applyToolActivityEvent\(message\.liveTraceEntries, phase, payload, message\.processEntries\)/, 'live results resolve by call id');
// The eager mobile-pages copy of the host finder must agree with the pure helper.
{
  const start = pages.indexOf('function _mobileQuestionHostRow(');
  const end = pages.indexOf('\nfunction _projectMobileQuestionToLegacy', start);
  const eager = new Function(`${pages.slice(start, end)}; return _mobileQuestionHostRow;`)();
  // Table-driven matrix: every combination of request, turn, finalization,
  // steer capture, streaming and trace must give identical results.
  const finals = [{}, { _pmFinalReceived: true }, { _pmServerAuthoredFinal: true }, { _pmAbortAcknowledged: true }];
  const steers = [{}, { workflowPart: 'before_interruption' }, { _steerFrozenTrace: true }];
  let matrixCases = 0;
  for (const sameRequest of [true, false]) for (const currentTurn of [true, false])
    for (const fin of finals) for (const steer of steers)
      for (const streaming of [true, false]) for (const hasTrace of [true, false]) {
        const host = {
          role: 'ai', timestamp: 1000, _clientRequestId: sameRequest ? cid : 'other', streaming, content: '',
          body: { sender: '', text: '' }, processEntries: [],
          liveTraceEntries: hasTrace ? [{ type: 'preamble', text: 'x' }] : [], ...fin, ...steer,
        };
        const thread = currentTurn ? [user, host] : [host, { role: 'user', content: 'later', _clientRequestId: cid }];
        const label = JSON.stringify({ sameRequest, currentTurn, fin, steer, streaming, hasTrace });
        assert.equal(eager(thread, question), rows.findMobileQuestionHostRow(thread, question), label);
        matrixCases += 1;
      }
  assert.equal(matrixCases, 192);
}
assert.match(runtime, /find\(\(turn\) => turn\?\.role === 'ai' && !isQuestionOnly\(turn\)\)/, 'recovery latest turn skips question-only rows');
assert.doesNotMatch(rendererRuntime, /: type === 'error' \? 'Tool error' : 'Tool';/, 'no plain Tool label');

// Must: collapseEmptyLiveRows folds only into an eligible explicit host; an ineligible host keeps the placeholder.
{
  const placeholderFor = () => questionOnly();
  for (const [name, host] of [
    ['different request', liveRow({ _clientRequestId: 'other' })],
    ['finalized host', liveRow({ _pmFinalReceived: true })],
    ['steer-captured host (before_interruption)', liveRow({ workflowPart: 'before_interruption' })],
    ['steer-captured host (_steerFrozenTrace)', liveRow({ _steerFrozenTrace: true })],
  ]) {
    const placeholder = placeholderFor();
    const thread = [user, placeholder, host];
    continuity.collapseEmptyLiveRows(thread, host);
    assert.ok(thread.includes(placeholder), `${name}: placeholder kept`);
    assert.equal(host.questionRequest, undefined, `${name}: question not moved onto the host`);
  }
  // Earlier-turn host: a real user row after the host closes its turn.
  {
    const host = liveRow();
    const placeholder = placeholderFor();
    const thread = [host, { role: 'user', content: 'next', _clientRequestId: cid }, placeholder];
    continuity.collapseEmptyLiveRows(thread, host);
    assert.ok(thread.includes(placeholder), 'earlier-turn host: placeholder kept');
    assert.equal(host.questionRequest, undefined, 'earlier-turn host: question not moved');
  }
  // Happy path: same request, current turn -> folded and placeholder removed.
  {
    const host = liveRow();
    const placeholder = placeholderFor();
    const thread = [user, placeholder, host];
    const removed = continuity.collapseEmptyLiveRows(thread, host);
    assert.equal(removed, 1, 'happy path folds one placeholder');
    assert.ok(!thread.includes(placeholder), 'happy path removes the placeholder');
    assert.equal(host.questionRequest.id, 'q1', 'happy path attaches the question to the host');
  }
}

// Must (review round 2): explicit-host validation is linear. Many rejected
// placeholders (wrong-request host) must not rescan the thread per placeholder.
{
  const readsFor = (n) => {
    let reads = 0;
    const base = [user, ...Array.from({ length: n }, () => questionOnly()), liveRow({ _clientRequestId: 'other' })];
    const host = base[base.length - 1];
    const thread = new Proxy(base, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const folded = rows.foldMobileQuestionOnlyRows(thread, host);
    assert.equal(folded, 0, 'wrong-request host folds nothing');
    assert.equal(base.length, n + 2, 'every rejected placeholder is kept');
    return reads;
  };
  const small = readsFor(100);
  const large = readsFor(800);
  assert.ok(large / small < 16, `explicit-host validation scales linearly (${small} -> ${large} reads)`);
}


// Must: a reused call id resolves within its own stream; ambiguous ids with no scope give no name.
{
  const entries = [
    { type: 'tool', streamId: 's1', extra: { toolName: 'read_file', toolCallId: 'same', args: { path: 'a.js' } } },
    { type: 'tool', streamId: 's2', extra: { toolName: 'web_search', toolCallId: 'same', args: { query: 'x' } } },
  ];
  assert.equal(lookup.withResolvedToolAction({ toolCallId: 'same', streamId: 's1', result: 'ok' }, entries).action, 'read_file');
  assert.equal(lookup.withResolvedToolAction({ toolCallId: 'same', streamId: 's2', result: 'ok' }, entries).action, 'web_search');
  assert.equal(lookup.withResolvedToolAction({ toolCallId: 'same', result: 'ok' }, entries).action, undefined, 'ambiguous without scope: no name');
  // Unscoped ambiguous result: no stream tool name is borrowed; neutral label instead.
  const standalone = [];
  activity.applyToolActivityEvent(standalone, 'result', { toolCallId: 'same', result: 'ok' });
  assert.match(standalone.map((e) => e.text).join(' | '), /Finished a step/, 'neutral fallback label');
  // Absent call id: payload untouched.
  const plain = { result: 'ok' };
  assert.equal(lookup.withResolvedToolAction(plain, entries), plain, 'absent id unchanged');
}

// Must: coalescing stays near-linear for unnamed results (one index per pass, O(1) lookups).
{
  const readsAt = (n) => {
    let reads = 0;
    const source = Array.from({ length: n }, (_, i) => {
      const entry = { type: 'result', content: 'body', streamId: 's1' };
      Object.defineProperty(entry, 'extra', { enumerable: true, get() { reads += 1; return { callId: `u${i}` }; } });
      return entry;
    });
    activity.coalesceToolActivityEntries(source);
    return reads;
  };
  const small = readsAt(100);
  const large = readsAt(1600);
  assert.ok(large / small < 40, `unnamed-result reads scale near-linearly (${small} -> ${large})`);
}

console.log('mobile question thread rows regression passed');
