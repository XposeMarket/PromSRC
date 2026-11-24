// Manual /compact frontend proof (desktop + mobile native chat).
// Run: node scripts/test-manual-compact-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const mod = (name) => import(pathToFileURL(path.join(root, name)).href);

const mc = await mod('web-ui/src/features/chat/core/manual-compact.js');
const { getChatSlashCommands } = await mod('web-ui/src/features/chat/core/slash-commands.js');

// --- Command list on both surfaces -------------------------------------------
for (const surface of ['desktop', 'mobile']) {
  assert.ok(getChatSlashCommands(surface).some((item) => item.command === '/compact'), `${surface} lists /compact`);
}

// --- Syntax: standalone only; arguments/attachments get feedback --------------
assert.equal(mc.classifyManualCompactInput('/compact').kind, 'compact');
assert.equal(mc.classifyManualCompactInput('  /COMPACT  ').kind, 'compact');
assert.equal(mc.classifyManualCompactInput('/compact now please').kind, 'syntax');
assert.equal(mc.classifyManualCompactInput('/compact\nkeep the plan').kind, 'syntax');
assert.equal(mc.classifyManualCompactInput('/compact', { attachmentCount: 1 }).kind, 'syntax');
assert.equal(mc.classifyManualCompactInput('/compact', { external: true }).kind, 'unsupported');
assert.equal(mc.classifyManualCompactInput('/compacted').kind, 'none');
assert.equal(mc.classifyManualCompactInput('what does /compact do?').kind, 'none', 'mentioning the command is ordinary text');
assert.equal(mc.classifyManualCompactInput('hello again').kind, 'none');
assert.equal(mc.isManualCompactExternalSession({ sessionId: 'x', binding: { agentId: 'codex' } }), true);
assert.equal(mc.isManualCompactExternalSession({ sessionId: 'x', binding: { agentId: 'prometheus' } }), false);
assert.equal(mc.isManualCompactExternalSession({ sessionId: 'x', session: { externalImport: { source: 'claude' } } }), true);
assert.equal(mc.isManualCompactExternalSession({ sessionId: 'subagent_chat_1' }), true);
assert.equal(mc.isManualCompactExternalSession({ sessionId: 'x', isDot: true }), true);
assert.equal(mc.isManualCompactExternalSession({ sessionId: 'chat_1' }), false);

// --- Tagged transcript helpers use the gateway's compactStatus -----------------
const statusRow = (id, compactStatus, content = mc.MANUAL_COMPACT_LABELS[compactStatus]) => ({
  role: 'assistant', messageKind: mc.MANUAL_COMPACT_STATUS_KIND, messageId: `manual_compact:${id}:status`, compactStatus, content,
});
assert.equal(mc.manualCompactRowStatus(statusRow('a', 'success', 'Anything at all')), 'success', 'compactStatus wins over text');
assert.equal(mc.manualCompactRowStatus({ messageKind: mc.MANUAL_COMPACT_STATUS_KIND, content: 'Compacting context…' }), 'running');
assert.deepEqual(
  ['running', 'success', 'skipped', 'failed'].map((s) => mc.manualCompactTraceEntry(statusRow('a', s)).status),
  ['compacting', 'compacted', 'skipped', 'failed'],
);
const trace = mc.manualCompactTraceEntry(statusRow('a', 'success'));
assert.equal(trace.type, 'compaction');
assert.equal(trace.extra.action, 'context_compaction');
assert.equal(trace.text, mc.MANUAL_COMPACT_LABELS.success);
assert.equal(mc.findRunningManualCompact([statusRow('a', 'running'), statusRow('b', 'success')]), null, 'latest status decides');
assert.equal(mc.findRunningManualCompact([statusRow('a', 'success'), { role: 'user', content: 'hi' }, statusRow('b', 'running')]).clientMessageId, 'b');
assert.equal(mc.isManualCompactRowPersistable(statusRow('a', 'running')), false, 'never echo a running status back to the gateway');
assert.equal(mc.isManualCompactRowPersistable({ ...statusRow('a', 'success'), _manualCompactLocal: true }), false);
assert.equal(mc.isManualCompactRowPersistable(statusRow('a', 'success')), true);
assert.equal(mc.isManualCompactRowPersistable({ role: 'user', content: 'hi' }), true);
assert.notEqual(mc.manualCompactMergeKey(statusRow('a', 'success')), mc.manualCompactMergeKey(statusRow('b', 'success')),
  'two compactions with identical text never collapse');

// --- Request contract ----------------------------------------------------------
{
  const calls = [];
  const result = await mc.requestManualCompact({
    sessionId: 's1', clientMessageId: 'c1',
    request: async (url, opts) => { calls.push({ url, opts }); return { status: 'success', message: 'Context compacted.' }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/chat/manual-compact');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { sessionId: 's1', message: '/compact', clientMessageId: 'c1' });
  assert.ok(calls[0].opts.timeoutMs >= 10 * 60_000, 'plain HTTP stays pending while compaction runs');
  assert.deepEqual(result, { outcome: 'success', message: 'Context compacted.' });
  const busy = await mc.requestManualCompact({ sessionId: 's1', clientMessageId: 'c2', request: async () => { throw new Error('API 409: This chat is busy.'); } });
  assert.deepEqual(busy, { outcome: 'refused', httpStatus: 409, message: 'This chat is busy.' });
  const down = await mc.requestManualCompact({ sessionId: 's1', clientMessageId: 'c3', request: async () => { throw new Error('Failed to fetch'); } });
  assert.equal(down.outcome, 'error');
}
assert.match(mc.newManualCompactClientMessageId('chat_1'), /^[\w.:~-]{1,160}$/, 'id matches the gateway pattern');

// --- Shared lifecycle on both surface row shapes --------------------------------
function harness(surface, { respond } = {}) {
  const threads = { s1: [{ role: 'user', content: 'earlier' }, { role: surface === 'mobile' ? 'ai' : 'assistant', content: 'answer' }] };
  const log = { requests: [], toasts: [], commits: 0, restored: [], sends: 0 };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const controller = mc.createManualCompactController({
    request: async (url, opts) => { log.requests.push({ url, body: JSON.parse(opts.body) }); await gate; return respond ? respond() : { status: 'success', message: 'Context compacted. Send a message when you’re ready.' }; },
    getThread: (sid) => (threads[sid] ||= []),
    makeRow: surface === 'mobile'
      ? (fields) => ({ ...fields, role: fields.role === 'user' ? 'user' : 'ai', body: { sender: fields.role === 'user' ? '' : 'Prometheus', text: fields.content } })
      : (fields) => ({ ...fields }),
    commit: () => { log.commits += 1; },
    toast: (message, tone) => log.toasts.push({ message, tone }),
    restoreDraft: (sid, text) => log.restored.push(text),
  });
  // Stand-in for the surface's ordinary send path: it must consult the gate first.
  const explicitSend = (text) => {
    if (controller.handleComposerSend('s1', text).handled) return 'command';
    if (controller.sendBlockReason('s1')) return 'blocked-draft-kept';
    log.sends += 1;
    return 'sent';
  };
  return { threads, log, controller, release, explicitSend };
}

for (const surface of ['desktop', 'mobile']) {
  const h = harness(surface);
  const started = h.controller.handleComposerSend('s1', '/compact');
  assert.equal(started.handled, true);
  assert.equal(started.keepDraft, false);
  const rows = h.threads.s1.slice(2);
  assert.equal(rows.length, 2, `${surface}: receipt + one status row, immediately`);
  assert.equal(rows[0].messageKind, 'manual_compact_command');
  assert.equal(rows[0].content, '/compact');
  assert.equal(rows[1].messageKind, 'manual_compact_status');
  assert.equal(rows[1].compactStatus, 'running');
  assert.equal(rows[1].messageId, `manual_compact:${h.log.requests[0].body.clientMessageId}:status`);
  if (surface === 'mobile') assert.equal(rows[1].role, 'ai');

  // While compacting: no send, queue or steer; draft stays; a second /compact is refused.
  assert.equal(h.explicitSend('follow-up question'), 'blocked-draft-kept');
  const again = h.controller.handleComposerSend('s1', '/compact');
  assert.equal(again.keepDraft, true);
  assert.equal(h.log.requests.length, 1, 'no duplicate request');

  h.release();
  const result = await started.promise;
  assert.equal(result.outcome, 'success');
  assert.equal(rows[1].compactStatus, 'success');
  assert.equal(rows[1].content, 'Context compacted. Send a message when you’re ready.');
  if (surface === 'mobile') assert.equal(rows[1].body.text, rows[1].content);
  assert.equal(h.threads.s1.length, 4, `${surface}: no synthetic assistant reply`);
  assert.ok(!h.threads.s1.some((row) => row._manualCompactLocal), 'settled rows are server-shaped');
  assert.equal(h.log.sends, 0, 'completion never starts a turn');
  assert.equal(h.log.requests.length, 1, 'completion makes no further requests');

  // Only a new explicit send starts the next turn, exactly once.
  assert.equal(h.controller.sendBlockReason('s1'), '');
  assert.equal(h.explicitSend('Now continue with step 2'), 'sent');
  assert.equal(h.log.sends, 1);
}

// Syntax/attachments/external/busy never post and keep the draft.
{
  const h = harness('desktop');
  for (const [text, options] of [['/compact please', {}], ['/compact', { attachmentCount: 2 }], ['/compact', { external: true }], ['/compact', { busyReason: 'Prometheus is still working.' }]]) {
    const verdict = h.controller.handleComposerSend('s1', text, options);
    assert.equal(verdict.handled, true);
    assert.equal(verdict.keepDraft, true);
  }
  assert.equal(h.log.requests.length, 0);
  assert.equal(h.threads.s1.length, 2);
  assert.equal(h.log.toasts.length, 4);
}

// 409 from the gateway: rows removed, '/compact' restored to an empty composer.
{
  const h = harness('mobile', { respond: () => { throw new Error('API 409: This chat is busy. Send your message again when it is idle.'); } });
  const started = h.controller.handleComposerSend('s1', '/compact');
  h.release();
  const result = await started.promise;
  assert.equal(result.outcome, 'refused');
  assert.equal(h.threads.s1.length, 2);
  assert.deepEqual(h.log.restored, ['/compact']);
  assert.equal(h.controller.sendBlockReason('s1'), '');
}

// Failed/skipped are statuses, not answers.
for (const status of ['skipped', 'failed']) {
  const h = harness('desktop', { respond: () => ({ status, message: mc.MANUAL_COMPACT_LABELS[status] }) });
  const started = h.controller.handleComposerSend('s1', '/compact');
  h.release();
  await started.promise;
  assert.equal(h.threads.s1.at(-1).compactStatus, status);
  assert.equal(h.threads.s1.length, 4);
}

// Reload during compaction: the tagged transcript blocks sends and joins by id.
{
  const h = harness('desktop');
  h.threads.s1.push(
    { role: 'user', messageKind: 'manual_compact_command', messageId: 'manual_compact:rq1:command', content: '/compact' },
    statusRow('rq1', 'running'),
  );
  assert.ok(h.controller.sendBlockReason('s1'));
  const joined = h.controller.resumeFromTranscript('s1');
  assert.ok(joined);
  assert.equal(h.controller.resumeFromTranscript('s1'), null, 'one join at a time');
  assert.equal(h.log.requests[0].body.clientMessageId, 'rq1');
  h.release();
  await joined;
  assert.equal(h.threads.s1.length, 4, 'join does not duplicate rows');
  assert.equal(h.threads.s1.at(-1).compactStatus, 'success');
  assert.equal(h.controller.sendBlockReason('s1'), '');
}

// --- Desktop send runtime: real sendChat honours the gate before queue/steer ----
{
  globalThis.window = { activeChatSessionId: 's1', api: async () => ({}) };
  globalThis.document = { getElementById: () => null };
  const { createDesktopSendChatRuntime } = await mod('web-ui/src/features/chat/runtime/desktop-send-chat-runtime.js');
  const h = harness('desktop');
  let composer = '';
  const trail = [];
  const sendChat = createDesktopSendChatRuntime(() => ({
    getChatComposerValue: () => composer,
    hasPendingPrometheusQuestion: () => false,
    handleImmediateChatSlashCommand: (message) => h.controller.handleComposerSend('s1', message).handled,
    manualCompactSendBlockReason: (sid) => h.controller.sendBlockReason(sid),
    showToast: (title, message) => trail.push(`toast:${message}`),
    getSessionQueuedPrompts: () => { trail.push('queue'); return []; },
    updateQueuedPromptUI: () => {},
    getSkillTriggerExcludedIds: () => [],
    mergeSlashCommandSkillIds: () => [],
    normalizeSelectedSkillIds: () => [],
    selectedComposerSkillIds: [],
    desktopNewChatContext: {},
    isDesktopNewChatDraft: () => false,
    ensureActiveChatSessionExists: () => {},
    getChatSessionById: () => ({ id: 's1', history: h.threads.s1 }),
    // Reaching the send lock proves the ordinary send path was entered.
    acquireChatSendLock: (sid, message) => { trail.push(`send:${message}`); return null; },
  }));
  composer = '/compact';
  await sendChat();
  assert.equal(h.log.requests.length, 1);
  composer = 'draft typed while compacting';
  await sendChat();
  assert.ok(trail.some((item) => item.startsWith('toast:')), 'blocked with feedback');
  assert.ok(!trail.some((item) => item === 'queue' || item.startsWith('send:')), 'not queued, steered or sent');
  h.release();
  await h.controller._active.get('s1')?.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(!trail.some((item) => item.startsWith('send:')), 'completion does not send');
  composer = 'next explicit message';
  await sendChat();
  assert.deepEqual(trail.filter((item) => item.startsWith('send:')), ['send:next explicit message']);
}

// --- Mobile renderer: status row is only the existing compaction break ---------------
{
  const { createMobileChatMessageRenderer } = await mod('web-ui/src/mobile/mobile-chat-message-renderer.js');
  const grouped = [];
  const render = createMobileChatMessageRenderer(() => ({
    __pmChat: { editingMessageIndex: -1 },
    escapeHtml: (v) => String(v ?? ''),
    chatTimelineRowSignature: () => 'sig',
    _mobileWorkflowTransitionLabel: () => '',
    _isMobileVoiceAgentWorkerHandoff: () => false,
    _renderChatAttachmentPreviews: () => '',
    _renderMobileSkillReferencedMarkdown: (text) => `<p>${text}</p>`,
    _renderMobileMessageActions: () => '<div class="pm-msg-actions"></div>',
    _renderMobileGroupedTrace: (entries, opts) => { grouped.push({ entries, opts }); return `<div class="pm-trace-timeline"><details class="pm-trace-compaction" data-status="${entries[0].status}">${entries[0].text}</details></div>`; },
  }));
  const row = { role: 'ai', messageKind: 'manual_compact_status', messageId: 'manual_compact:m1:status', compactStatus: 'success',
    content: mc.MANUAL_COMPACT_LABELS.success, body: { sender: 'Prometheus', text: mc.MANUAL_COMPACT_LABELS.success } };
  const html = render(row, 4, 'k4', 'sig');
  assert.match(html, /class="pm-msg from-ai manual-compact-status"/);
  assert.match(html, /<details class="pm-trace-compaction" data-status="compacted">/);
  assert.doesNotMatch(html, /pm-final-answer|pm-msg-actions|pm-bubble/, 'no answer bubble or actions');
  assert.equal(grouped[0].entries[0].type, 'compaction');
  const command = render({ role: 'user', messageKind: 'manual_compact_command', messageId: 'manual_compact:m1:command', content: '/compact', body: { text: '/compact' } }, 3, 'k3', 'sig');
  assert.match(command, /from-user/);
  assert.match(command, /\/compact/);
  assert.doesNotMatch(command, /pm-msg-actions/, 'no edit/rerun on the receipt');
}

// --- Source contracts: wiring on both surfaces -------------------------------------
const desktopPage = read('web-ui/src/pages/ChatPage.js');
const desktopSend = read('web-ui/src/features/chat/runtime/desktop-send-chat-runtime.js');
const mobileRuntime = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const mobilePages = read('web-ui/src/mobile/mobile-pages.js');
const mobileRenderer = read('web-ui/src/mobile/mobile-chat-message-renderer.js');

assert.match(desktopPage, /if \(isManualCompactStatusRow\(msg\)\) return desktopManualCompact\.renderStatusRow\(/);
assert.match(desktopPage, /\.filter\(isManualCompactRowPersistable\)/);
assert.match(desktopPage, /desktopManualCompact\.resumeFromTranscript\(id\)/);
assert.match(desktopPage, /if \(desktopManualCompact\.handleCommand\(raw, input\)\) return true;/);
assert.match(desktopPage, /if \(source === 'server' && isManualCompactRow\(msg\)\)/, 'gateway copy wins on merge');

// --- Desktop wiring module: renders only the compaction break; skip/busy keep state --
{
  const { createDesktopManualCompact } = await mod('web-ui/src/features/chat/runtime/desktop-manual-compact.js');
  const sessions = { s1: { id: 's1', history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] } };
  const seen = { toasts: [], cleared: 0, requests: 0, breaks: [] };
  let thinking = true;
  const desktop = createDesktopManualCompact(() => ({
    api: async () => { seen.requests += 1; return { status: 'success', message: 'ok' }; },
    getChatSessionById: (id) => sessions[id],
    persistSession: () => {}, renderChatMessages: () => {},
    showToast: (title, message) => seen.toasts.push(message),
    restoreDesktopComposerAfterFailedSend: () => {},
    loadSessionFromServer: async () => ({ ok: true }),
    isSessionThinking: () => thinking, isActiveMainGoalRunning: () => false,
    getSessionQueuedPrompts: () => [], hasPendingPrometheusQuestion: () => false,
    pendingChatFiles: [], clearChatComposerAfterSend: () => { seen.cleared += 1; },
    escHtml: (v) => String(v), desktopTimelineRowSignature: () => 'sig',
    renderLiveTraceCompactionBreak: (entry) => { seen.breaks.push(entry); return `<details class="live-turn-compaction" data-status="${entry.status}">${entry.text}</details>`; },
  }));
  globalThis.window.activeChatSessionId = 's1';
  assert.equal(desktop.handleCommand('/compact', null), true);
  assert.equal(seen.requests, 0, 'busy: refused locally, draft kept');
  assert.equal(seen.cleared, 0);
  assert.equal(desktop.handleCommand('/compact', null) && desktop.handleCommand('/compact extra', null), true);
  assert.equal(seen.requests, 0, 'syntax feedback never posts');
  thinking = false;
  assert.equal(desktop.handleCommand('/compact', null), true);
  assert.equal(seen.requests, 1, 'idle: one request');
  assert.equal(seen.cleared, 1, 'started command clears the composer');
  assert.equal(sessions.s1.history.at(-1).compactStatus, 'running', 'status row shows immediately');
  assert.ok(desktop.sendBlockReason('s1'), 'next send waits while compacting');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(desktop.handleCommand('tell me about /compact', null), false, 'ordinary text falls through');
  const html = desktop.renderStatusRow(statusRow('r9', 'running'), 3, 'k', '');
  assert.match(html, /class="msg-shell assistant manual-compact-status"/);
  assert.match(html, /<details class="live-turn-compaction" data-status="compacting">Compacting context…<\/details>/);
  assert.doesNotMatch(html, /msg-actions|assistant-work-timer|markdown/i, 'no answer bubble, timer or actions');
  assert.notEqual(desktop.renderStatusRow(statusRow('r9', 'success'), 3, 'k', ''), html, 'row signature changes with status');
}
assert.ok(desktopSend.indexOf('manualCompactSendBlockReason(') < desktopSend.indexOf('if (isSessionThinking(thisSessionId))'),
  'desktop gate runs before queue/steer');
assert.ok(mobileRuntime.indexOf('if (handleMobileManualCompactSubmit(text, activeSid)) return;') < mobileRuntime.indexOf('sendMessage(text, { selectedSkillIds, selectedSkillRefs })'));
assert.match(mobileRuntime, /if \(!options\.fromQueue && mobileManualCompact\(\)\.sendBlockReason\(busySessionId\)\)/);
assert.ok(mobileRuntime.indexOf('mobileManualCompact().sendBlockReason(busySessionId)') < mobileRuntime.indexOf('const enqueueDurably = async'),
  'mobile gate runs before durable queue/steer');
assert.match(mobileRuntime, /mobileManualCompact\(\)\.resumeFromTranscript\(requestedSession\)/);
assert.match(mobileRenderer, /_renderMobileGroupedTrace\(\[manualCompactTraceEntry\(m\)\], \{ streaming: false \}\)/, 'mobile reuses the compaction visual');
assert.equal((mobilePages.match(/compactStatus: String\(m\?\.compactStatus/g) || []).length, 2, 'mobile keeps compactStatus from server + cache');
assert.match(mobilePages, /\.filter\(isManualCompactRowPersistable\)/);

console.log('[test-manual-compact-ui] passed');
