import assert from 'node:assert/strict';

import { createMobileChatRuntimeAdapter } from '../web-ui/src/features/chat/runtime/mobile-chat-adapter.js';
import { resetChatRuntimeRegistryForTests } from '../web-ui/src/features/chat/runtime/chat-runtime.js';

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
assert.deepEqual(
  runtime.getTurns().map((turn) => turn.role),
  ['user', 'assistant'],
  'sync must keep the optimistic user row distinct from the speculative assistant row',
);
assert.deepEqual(
  runtime.snapshot.history.order,
  [
    `id:mobile-request:${clientRequestId}:user`,
    `id:mobile-request:${clientRequestId}:assistant`,
  ],
  'shared clientRequestId rows must receive role-scoped runtime identities',
);

adapter.observeStreamEvent(sessionId, assistantTurn, {
  type: 'reasoning_summary',
  clientRequestId,
});
assert.equal(
  runtime.snapshot.stream.turnKey,
  `id:mobile-request:${clientRequestId}:assistant`,
  'stream ownership must bind to the assistant row, never the user row',
);

adapter.appendStreamEvent(runtime, assistantTurn, { type: 'text_delta', clientRequestId }, 'Hey Raul.');
const history = runtime.getSourceHistory();
assert.equal(history.length, 2, 'starting the stream must not allocate a duplicate assistant row');
assert.equal(history[0].role, 'user', 'stream start must not rewrite the user row as assistant');
assert.equal(history[0].content, 'Hi', 'stream start must preserve optimistic user text');
assert.equal(history[1].role, 'assistant');
assert.equal(history[1].content, 'Hey Raul.');

console.log('mobile chat runtime request identity regression passed');
