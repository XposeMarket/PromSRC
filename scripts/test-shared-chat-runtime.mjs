import assert from 'node:assert/strict';
import {
  acquireChatRuntime,
  chatRuntimeRegistryStats,
  getChatRuntime,
  resetChatRuntimeRegistryForTests,
  sweepChatRuntimes,
} from '../web-ui/src/features/chat/runtime/chat-runtime.js';
import {
  buildChatHistoryPagePath,
  createChatHistoryClient,
} from '../web-ui/src/features/chat/runtime/history-client.js';
import { createDesktopChatRuntimeAdapter } from '../web-ui/src/features/chat/runtime/desktop-chat-adapter.js';
import { createMobileChatRuntimeAdapter } from '../web-ui/src/features/chat/runtime/mobile-chat-adapter.js';
import { createQueuedPromptTools } from '../web-ui/src/features/chat/runtime/queued-prompt.js';

resetChatRuntimeRegistryForTests();
let now = 1_000;
const clock = () => now;
const identity = { gatewayId: 'gateway-a', sessionId: 'session-1' };
const { runtime, release } = acquireChatRuntime(identity, 'test-view', { now: clock });
const isolated = getChatRuntime({ gatewayId: 'gateway-b', sessionId: 'session-1' }, { now: clock });
assert.notEqual(runtime, isolated, 'the same session id on two gateways must not share state');

let queueNotifications = 0;
let historyNotifications = 0;
runtime.subscribe((state) => state.queue, () => { queueNotifications += 1; });
runtime.subscribe((state) => state.history.revision, () => { historyNotifications += 1; });

runtime.replaceHistory([
  { messageId: 'u1', role: 'user', content: 'hello', timestamp: 10 },
  { messageId: 'a1', role: 'ai', content: 'hi', timestamp: 11 },
  { messageId: 'u2', role: 'user', content: 'continue', timestamp: 12 },
], {
  source: 'test',
  pageInfo: { olderCursor: 'cursor-1', hasOlder: true, totalCount: 20, loadedCount: 3 },
});
assert.equal(historyNotifications, 1);
assert.equal(queueNotifications, 0, 'history changes must not wake queue subscribers');
assert.deepEqual(runtime.getTurns().map((turn) => turn.role), ['user', 'assistant', 'user']);
assert.equal(runtime.snapshot.paging.olderCursor, 'cursor-1');

const queue = runtime.getQueueBridge();
queue.push({ id: 'q1', message: 'next' });
assert.equal(runtime.snapshot.queue.length, 1);
assert.equal(queueNotifications, 1);
assert.equal(historyNotifications, 1, 'queue changes must not wake history subscribers');
runtime.replaceAttachments([{ id: 'file-1', name: 'notes.txt' }]);
assert.equal(runtime.snapshot.attachments[0].name, 'notes.txt');

runtime.upsertApproval({ id: 'approval-1', status: 'pending', summary: 'Run command' });
runtime.upsertQuestion({ id: 'question-1', status: 'pending', label: 'Choose one' });
runtime.upsertBackground({ id: 'bg-1', status: 'running', sessionId: 'session-1' });
assert.equal(runtime.snapshot.approvals.length, 1);
assert.equal(runtime.snapshot.questions.length, 1);
assert.equal(runtime.snapshot.background.length, 1);

runtime.beginStreaming({ clientRequestId: 'request-1', startedAt: now });
const frozenStreamSource = runtime.getSourceHistory().at(-1);
Object.freeze(frozenStreamSource);
runtime.appendStreamDelta('hel');
runtime.appendStreamDelta('lo');
assert.equal(runtime.snapshot.stream.text, 'hello');
assert.notEqual(runtime.getTurns().at(-1).source, frozenStreamSource, 'a frozen compatibility record must be cloned before streaming updates');
assert.equal(runtime.snapshot.lifecycle.phase, 'streaming');
assert.equal(runtime.completeStream('hello!'), 'hello!');
assert.equal(runtime.snapshot.stream.active, false);
assert.equal(runtime.snapshot.stream.text, 'hello!');

runtime.requestInterruption('test');
assert.equal(runtime.snapshot.interruption.requested, true);
runtime.markRetry({ reason: 'network', nextAt: 5_000 });
assert.equal(runtime.snapshot.retry.attempt, 1);
assert.equal(runtime.snapshot.lifecycle.phase, 'retrying');

const older = [
  { messageId: 'u0', role: 'user', content: 'older', timestamp: 1 },
  { messageId: 'a0', role: 'assistant', content: 'older reply', timestamp: 2 },
];
runtime.prependHistoryPage(older, { olderCursor: null, hasOlder: false, totalCount: 5 });
assert.deepEqual(runtime.getTurns().slice(0, 2).map((turn) => turn.messageId), ['u0', 'a0']);
assert.equal(runtime.snapshot.paging.hasOlder, false);

const path = buildChatHistoryPagePath({ sessionId: 'session/a', before: 'opaque.cursor', limit: 40, mobile: true });
assert.match(path, /^\/api\/sessions\/session%2Fa\/history-page\?/);
assert.match(path, /before=opaque.cursor/);
assert.match(path, /mobile=1/);

let requestCount = 0;
let releaseRequest;
const responsePromise = new Promise((resolve) => { releaseRequest = resolve; });
const client = createChatHistoryClient({
  request: async () => {
    requestCount += 1;
    await responsePromise;
    return {
      sessionId: 'session-1',
      items: older,
      pageInfo: { olderCursor: null, hasOlder: false, totalCount: 5 },
    };
  },
});
const first = client.loadOlder({ sessionId: 'session-1', before: 'cursor', limit: 2 });
const second = client.loadOlder({ sessionId: 'session-1', before: 'cursor', limit: 2 });
assert.equal(requestCount, 1, 'identical unsignalled page requests should coalesce');
releaseRequest();
assert.deepEqual(await first, await second);

const promptTools = createQueuedPromptTools({
  normalizeSkillIds: (value) => [...new Set(Array.isArray(value) ? value : [])],
  normalizeSkillRefs: (value) => Array.isArray(value) ? value : [],
  createId: () => 'queued-1',
  now: () => 123,
});
assert.deepEqual(promptTools.create(' next ', [{ name: 'a.txt' }], {
  excludedSkillIds: [' one ', ''],
  selectedSkillIds: ['skill-a', 'skill-a'],
  selectedSkillRefs: [{ id: 'skill-a' }],
}), {
  message: 'next',
  files: [{ name: 'a.txt' }],
  excludedSkillIds: ['one'],
  selectedSkillIds: ['skill-a'],
  selectedSkillRefs: [{ id: 'skill-a' }],
  id: 'queued-1',
  createdAt: 123,
});

const desktopSession = {
  id: 'desktop-session',
  history: [{ messageId: 'desktop-1', role: 'user', content: 'desktop', timestamp: 1 }],
  historyPage: { olderCursor: 'desktop-cursor', hasOlder: true, totalCount: 2 },
};
let desktopRawFetchCalls = 0;
let desktopSharedRequestCalls = 0;
const desktopWindow = {
  activeChatSessionId: desktopSession.id,
  location: { origin: 'https://desktop.test' },
  fetch: async () => {
    desktopRawFetchCalls += 1;
    throw new Error('desktop history must not bypass the shared API transport');
  },
  document: { getElementById: () => null },
  addEventListener: () => {},
  _sessionQueuedPrompts: {},
  _sessionStreamState: {},
  _sessionThinking: {},
};
const desktopAdapter = createDesktopChatRuntimeAdapter({
  windowRef: desktopWindow,
  getSession: () => desktopSession,
  request: async (requestPath) => {
    desktopSharedRequestCalls += 1;
    assert.match(requestPath, /^\/api\/sessions\/desktop-session\/history-page\?/);
    return {
      sessionId: desktopSession.id,
      items: [{ messageId: 'desktop-0', role: 'assistant', content: 'older desktop', timestamp: 0 }],
      pageInfo: { olderCursor: null, hasOlder: false, totalCount: 2 },
    };
  },
});
assert.equal(desktopAdapter.sync(desktopSession).getTurns()[0].content, 'desktop');
desktopAdapter.queue(desktopSession.id).push({ message: 'queued' });
assert.equal(desktopAdapter.runtimeFor(desktopSession.id).snapshot.queue.length, 1);
desktopAdapter.activate(desktopSession);
const sideRuntime = desktopAdapter.retainSecondary('desktop-side-session');
assert.equal(sideRuntime, desktopAdapter.runtimeFor('desktop-side-session'), 'secondary panes must reuse the keyed runtime');
assert.deepEqual(desktopAdapter.diagnostics().secondarySessionIds, ['desktop-side-session']);
assert.equal(desktopAdapter.diagnostics().primarySessionId, desktopSession.id);
desktopAdapter.setSecondaryVisible('desktop-other-side');
assert.deepEqual(desktopAdapter.diagnostics().secondarySessionIds, ['desktop-other-side'], 'only the visible secondary lease should remain retained');
assert.equal(desktopAdapter.releaseSecondary('desktop-other-side'), true);
assert.deepEqual(desktopAdapter.diagnostics().secondarySessionIds, []);
assert.equal(await desktopAdapter.loadOlder(desktopSession.id), true, 'desktop cursor paging should succeed through the injected transport');
assert.equal(desktopSharedRequestCalls, 1, 'desktop cursor paging must use the shared API transport exactly once');
assert.equal(desktopRawFetchCalls, 0, 'desktop cursor paging must never call raw window.fetch');
assert.deepEqual(desktopSession.history.map((message) => message.messageId), ['desktop-0', 'desktop-1']);

const mobileState = {
  activeSessionId: 'mobile-session',
  activeRuns: {},
  attachments: {},
  backgroundSpawnLanes: {},
  drawerRunSessionIds: new Set(),
  historyPagination: {
    'mobile-session': { loadedHistoryCount: 1, totalHistoryCount: 2, historyTruncated: true, loading: true },
  },
  pendingApprovals: {},
  queuedPrompts: {},
  threads: {
    'mobile-session': [{ messageId: 'new', role: 'assistant', content: 'new', timestamp: 2 }],
  },
};
const mobileAdapter = createMobileChatRuntimeAdapter({
  windowRef: {},
  defaultSessionId: 'mobile-default',
  getState: () => mobileState,
  getActiveGatewayId: () => 'gateway-mobile',
  loadHistoryPage: async () => ({
    items: [{ messageId: 'old', role: 'user', content: 'old', timestamp: 1 }],
    pageInfo: { olderCursor: null, hasOlder: false, totalCount: 2 },
  }),
  mergeHistory: (_sid, older, current) => [...older, ...current],
});
mobileAdapter.setRunning('mobile-session', true);
assert.ok(mobileState.drawerRunSessionIds.has('mobile-session'));
const mobilePage = await mobileAdapter.loadOlderPage('mobile-session', { before: 'cursor', limit: 1 });
assert.equal(mobilePage.applied, true);
assert.deepEqual(mobileState.threads['mobile-session'].map((message) => message.messageId), ['old', 'new']);
assert.equal(mobileState.historyPagination['mobile-session'].historyTruncated, false);

runtime.resolveApproval('approval-1', 'approved');
runtime.resolveQuestion('question-1', 'answered');
runtime.removeBackground('bg-1');
runtime.replaceQueue([]);
runtime.setLifecycle({ settled: true, phase: 'idle', background: false });
release();
assert.equal(runtime.referenceCount, 0);
now += 120_001;
const sweep = sweepChatRuntimes({ now, idleTtlMs: 900_000, settledTtlMs: 120_000 });
assert.ok(sweep.evicted >= 1, 'a settled, unreferenced, inactive runtime should expire');
assert.ok(!chatRuntimeRegistryStats().runtimes.some((entry) => entry.key === runtime.key));

resetChatRuntimeRegistryForTests();
console.log('Shared chat runtime behavioral tests passed.');
