import assert from 'node:assert/strict';

import { createMobileChatRuntimeAdapter } from '../web-ui/src/features/chat/runtime/mobile-chat-adapter.js';
import { resetChatRuntimeRegistryForTests } from '../web-ui/src/features/chat/runtime/chat-runtime.js';
import { createTimelineEntries } from '../web-ui/src/features/chat/timeline/weighted-timeline.js';

resetChatRuntimeRegistryForTests();

const sessionId = 'mobile_identity_regression';
const clientRequestId = 'req_shared_user_assistant';
const userTurn = {
  role: 'user',
  content: 'Hi',
  body: { text: 'Hi' },
  timestamp: 1000,
  _clientRequestId: clientRequestId,
  _pmOptimistic: true,
};
const assistantTurn = {
  role: 'ai',
  content: '',
  body: { text: '' },
  timestamp: 1000,
  workStartedAt: 1000,
  streaming: true,
  _clientRequestId: clientRequestId,
  _pmAdmissionPending: true,
};

const fallbackEntries = createTimelineEntries([userTurn, assistantTurn]);
assert.deepEqual(
  fallbackEntries.map((entry) => entry.key),
  [`request:user:${clientRequestId}`, `request:assistant:${clientRequestId}`],
  'the compatibility timeline must not collapse the user/assistant pair while runtime keys are briefly stale',
);
const state = {
  activeSessionId: sessionId,
  threads: { [sessionId]: [userTurn, assistantTurn] },
  activeRuns: { [sessionId]: { busy: true, startedAt: 1000, clientRequestId } },
  drawerRunSessionIds: new Set(),
  queuedPrompts: {},
  attachments: {},
  pendingApprovals: {},
  backgroundSpawnLanes: {},
  historyPagination: {},
};

const adapter = createMobileChatRuntimeAdapter({
  windowRef: {},
  defaultSessionId: sessionId,
  getState: () => state,
  getSessionTarget: () => ({ gatewayId: 'gateway:test' }),
  getActiveGatewayId: () => 'gateway:test',
  normalizeSkillIds: (value) => value,
  normalizeSkillRefs: (value) => value,
});

const runtime = adapter.sync(sessionId, { history: state.threads[sessionId], source: 'regression' });
assert.deepEqual(runtime.getTurns().map((turn) => turn.role), ['user', 'assistant']);
assert.deepEqual(runtime.snapshot.history.order, [
  `id:mobile-request:${clientRequestId}:user`,
  `id:mobile-request:${clientRequestId}:assistant`,
]);

adapter.observeStreamEvent(sessionId, assistantTurn, { type: 'reasoning_summary', clientRequestId });
assert.equal(runtime.snapshot.stream.turnKey, `id:mobile-request:${clientRequestId}:assistant`);

adapter.appendStreamEvent(runtime, assistantTurn, { type: 'text_delta', clientRequestId }, 'Hey Raul.');
const history = runtime.getSourceHistory();
assert.equal(history.length, 2, 'stream begin must not allocate a duplicate assistant row');
assert.equal(history[0].role, 'user');
assert.equal(history[0].content, 'Hi');
assert.equal(history[1].role, 'assistant');
assert.equal(history[1].content, 'Hey Raul.');

adapter.completeStream(sessionId, 'Hey Raul.', assistantTurn);
const continuation = {
  role: 'ai',
  messageKind: 'steer_continuation',
  messageId: `mobile-request:${clientRequestId}:assistant:segment:${encodeURIComponent('steer-event-2:interruption_response')}`,
  workflowGroupId: 'steer-event-2',
  workflowPart: 'interruption_response',
  _clientRequestId: clientRequestId,
  timestamp: 2000,
  workStartedAt: 2000,
  streaming: true,
  content: '',
  body: { text: '' },
  processEntries: [{ id: 'continuation-tool' }],
};
state.threads[sessionId] = [
  userTurn,
  { ...assistantTurn, streaming: false, content: 'Hey Raul.', body: { text: 'Hey Raul.' }, processEntries: [{ id: 'original-tool' }] },
  { role: 'user', content: 'Actually, change that', timestamp: 1999 },
  continuation,
];
adapter.sync(sessionId, { history: state.threads[sessionId], source: 'steer-regression' });
const originalKey = `id:mobile-request:${clientRequestId}:assistant`;
const continuationKey = runtime.snapshot.history.order[3];
assert.notEqual(continuationKey, originalKey, 'a steer continuation needs its own stream identity');
adapter.observeStreamEvent(sessionId, continuation, { type: 'reasoning_summary', clientRequestId });
assert.equal(runtime.snapshot.stream.turnKey, continuationKey);
adapter.appendStreamEvent(runtime, continuation, { type: 'text_delta', clientRequestId }, 'Changed answer.');
const steeredHistory = runtime.getSourceHistory();
assert.equal(steeredHistory[1].content, 'Hey Raul.', 'continuation tokens must not overwrite the earlier answer');
assert.deepEqual(steeredHistory[1].processEntries.map((entry) => entry.id), ['original-tool']);
assert.equal(steeredHistory[3].content, 'Changed answer.');
assert.deepEqual(steeredHistory[3].processEntries.map((entry) => entry.id), ['continuation-tool']);
state.threads[sessionId][3] = {
  ...continuation,
  messageKind: undefined,
  workflowGroupId: undefined,
  workflowPart: undefined,
  content: 'Changed answer.',
};
adapter.sync(sessionId, { history: state.threads[sessionId], source: 'steer-settled' });
assert.equal(runtime.snapshot.history.order[3], continuationKey,
  'settling the steer presentation must not change its runtime row identity');

console.log('mobile chat runtime request identity regression passed');
