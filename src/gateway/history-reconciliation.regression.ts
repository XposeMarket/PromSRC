import assert from 'node:assert/strict';

import { mergeHistoryWithExistingMessageMetadata } from './history-reconciliation';

const requestId = 'mobile_session_request_1';
const userAt = 10_002;
const existing = [
  { role: 'user', content: 'Earlier user message', timestamp: 8_000, clientRequestId: 'earlier-request' },
  { role: 'assistant', content: 'Earlier Prometheus reply', timestamp: 9_000, clientRequestId: 'earlier-request' },
  { role: 'user', content: 'Hi', timestamp: userAt, clientRequestId: requestId },
  { role: 'assistant', content: 'Hey Raul. What are we working on?', timestamp: 14_900 },
];
const mobileSnapshot = [
  { role: 'user', content: 'Hi', timestamp: userAt, _clientRequestId: requestId },
  {
    role: 'assistant',
    content: 'Hey Raul. What are we working on?',
    timestamp: userAt + 1,
    workStartedAt: 10_000,
    workEndedAt: 14_800,
    _clientRequestId: requestId,
    processEntries: [{ type: 'info', content: 'Request received.' }],
  },
];

const merged = mergeHistoryWithExistingMessageMetadata(existing, mobileSnapshot, { preserveAllExisting: true });
assert.deepEqual(merged.map((message) => message.role), ['user', 'assistant', 'user', 'assistant']);
assert.equal(merged[0].content, 'Earlier user message', 'a shorter mobile snapshot must not erase earlier user turns');
assert.equal(merged[1].content, 'Earlier Prometheus reply', 'a shorter mobile snapshot must not erase earlier assistant turns');
assert.equal(merged.filter((message) => message.role === 'assistant' && message._clientRequestId === requestId).length, 1, 'canonical and optimistic assistant echoes must collapse');
assert.equal(merged[3]._clientRequestId, requestId);
assert.equal(merged[3].processEntries?.length, 1, 'mobile process metadata must survive canonical reconciliation');

console.log('history reconciliation mobile assistant echo regression passed');
