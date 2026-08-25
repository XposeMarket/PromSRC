import assert from 'node:assert/strict';

import { createMobileChatRuntimeAdapter } from '../web-ui/src/features/chat/runtime/mobile-chat-adapter.js';
import { resetChatRuntimeRegistryForTests } from '../web-ui/src/features/chat/runtime/chat-runtime.js';

resetChatRuntimeRegistryForTests();

const sessionId = 'mobile_runtime_authority_contract';
const requestId = 'request-authority-pair';
const state = {
  activeSessionId: sessionId,
  threads: { [sessionId]: [] },
  activeRuns: {},
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
  getSessionTarget: () => ({ gatewayId: 'gateway:authority-test' }),
  getActiveGatewayId: () => 'gateway:authority-test',
});

const user = {
  role: 'user',
  content: 'Show the rich row',
  body: { text: 'Show the rich row', attachments: [{ id: 'file-1' }] },
  processEntries: [{ kind: 'user-intent' }],
  timestamp: 1_000,
  _clientRequestId: requestId,
};
const assistant = {
  role: 'ai',
  content: '',
  body: { text: '' },
  processEntries: [{ kind: 'tool', status: 'running' }],
  liveTraceEntries: [{ kind: 'trace' }],
  toolMetadata: (() => {
    const leaf = { value: 'original' };
    let nested = leaf;
    for (let depth = 0; depth < 12; depth += 1) nested = { nested };
    return nested;
  })(),
  timestamp: 1_001,
  streaming: true,
  _clientRequestId: requestId,
};

const runtime = adapter.replaceTranscript(sessionId, [user, assistant], { source: 'authority-test' });
const rows = adapter.getTranscriptRows(sessionId);
assert.equal(rows.length, 2);
assert.deepEqual(rows.map((row) => row.turn.role), ['user', 'assistant']);
assert.deepEqual(rows.map((row) => row.key), [
  `id:mobile-request:${requestId}:user`,
  `id:mobile-request:${requestId}:assistant`,
]);
assert.equal(rows[0].msg.body.attachments[0].id, 'file-1', 'row descriptors must retain rich source data');
assert.equal(rows[1].msg.processEntries[0].status, 'running');
assert.equal(rows[0].turn.source, rows[0].msg, 'the normalized turn and row descriptor must share the rich source record');

assistant.body.text = 'compatibility-only mutation';
assert.equal(
  adapter.getTranscriptRows(sessionId)[1].msg.body.text,
  '',
  'runtime history must be detached from compatibility cache object mutations',
);
let compatibilityLeaf = assistant.toolMetadata;
for (let depth = 0; depth < 12; depth += 1) compatibilityLeaf = compatibilityLeaf.nested;
compatibilityLeaf.value = 'compatibility-only deep mutation';
let runtimeLeaf = adapter.getTranscriptRows(sessionId)[1].msg.toolMetadata;
for (let depth = 0; depth < 12; depth += 1) runtimeLeaf = runtimeLeaf.nested;
assert.equal(
  runtimeLeaf.value,
  'original',
  'runtime history must clone metadata beyond the legacy depth limit',
);

adapter.replaceTranscriptRow(sessionId, {
  ...assistant,
  body: { text: 'streamed through runtime' },
  content: 'streamed through runtime',
});
assert.equal(adapter.getTranscriptRows(sessionId).length, 2, 'row replacement must not duplicate the assistant turn');
assert.equal(adapter.getTranscriptRows(sessionId)[1].msg.body.text, 'streamed through runtime');

const extra = adapter.appendTranscriptRow(sessionId, {
  role: 'assistant',
  messageId: 'assistant-extra',
  content: 'Extra',
  body: { text: 'Extra' },
  timestamp: 1_002,
});
assert.equal(extra.key, 'id:assistant-extra');

adapter.patchTranscriptRow(sessionId, extra.key, {
  content: 'Patched',
  body: { text: 'Patched' },
  processEntries: [{ kind: 'complete' }],
});
const patched = adapter.getTranscriptRows(sessionId).at(-1);
assert.equal(patched.msg.content, 'Patched');
assert.equal(patched.msg.body.text, 'Patched');
assert.equal(patched.msg.processEntries[0].kind, 'complete');

const replacement = {
  role: 'assistant',
  messageId: 'assistant-extra',
  content: 'Replaced',
  body: { text: 'Replaced' },
  timestamp: 1_003,
};
adapter.replaceTranscriptRow(sessionId, replacement);
assert.equal(adapter.getTranscriptRows(sessionId).at(-1).msg.content, 'Replaced');

adapter.prependTranscriptPage(sessionId, [{
  role: 'user',
  messageId: 'older-user',
  content: 'Older',
  timestamp: 999,
}], { olderCursor: null, hasOlder: false, totalCount: 4 });
assert.equal(adapter.getTranscriptRows(sessionId)[0].msg.messageId, 'older-user');
assert.equal(runtime.snapshot.paging.hasOlder, false);

console.log('Mobile chat runtime authority contract passed.');
