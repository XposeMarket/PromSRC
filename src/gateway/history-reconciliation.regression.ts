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

const groupedReplies = [
  { role: 'user', content: 'First', timestamp: 100, clientRequestId: 'one', messageId: 'mobile-request:one:user' },
  { role: 'user', content: 'First', timestamp: 100, clientRequestId: 'one' },
  { role: 'assistant', content: 'First answer', timestamp: 300, clientRequestId: 'one' },
  { role: 'assistant', content: 'Second answer', timestamp: 300, clientRequestId: 'two' },
  { role: 'assistant', content: 'Third answer', timestamp: 300, clientRequestId: 'three' },
  { role: 'user', content: 'Second', timestamp: 200, clientRequestId: 'two', messageId: 'mobile-request:two:user' },
  { role: 'user', content: 'Second', timestamp: 200, clientRequestId: 'two' },
  { role: 'user', content: 'Third', timestamp: 201, clientRequestId: 'three' },
];
const repaired = mergeHistoryWithExistingMessageMetadata(groupedReplies, [
  { role: 'user', content: 'Second', timestamp: 900, _clientRequestId: 'two' },
], { preserveAllExisting: true });
assert.deepEqual(repaired.map((row) => `${row.role}:${row.content}`), [
  'user:First', 'assistant:First answer',
  'user:Second', 'assistant:Second answer',
  'user:Third', 'assistant:Third answer',
]);
assert.equal(repaired[2].timestamp, 200, 'mobile clock must not replace canonical server time');
assert.equal(repaired[2].messageId, undefined, 'temporary runtime ID must not replace canonical identity');
const canonicalUser = mergeHistoryWithExistingMessageMetadata(
  [{ role: 'user', content: 'Prompt', timestamp: 50, clientRequestId: 'canonical' }],
  [{ role: 'user', content: 'Prompt', timestamp: 55, clientRequestId: 'canonical', messageId: 'mobile-request:canonical:user' }],
  { preserveAllExisting: true },
);
assert.equal(canonicalUser.length, 1);
assert.equal(canonicalUser[0].messageId, undefined, 'a temporary mobile runtime ID must never become durable');

const repeated = mergeHistoryWithExistingMessageMetadata([
  { role: 'user', content: 'Yes', timestamp: 1000 },
  { role: 'user', content: 'Yes', timestamp: 2000 },
], [{ role: 'user', content: 'Yes', timestamp: 3000 }], { preserveAllExisting: true });
assert.equal(repeated.length, 3, 'identical text sent at different times represents distinct turns');
const corrected = mergeHistoryWithExistingMessageMetadata(
  [{ role: 'assistant', messageId: 'mobile-request:repair:assistant', content: 'New answer\n\nOld answer', body: { text: 'New answer\n\nOld answer' } }],
  [{ role: 'assistant', messageId: 'mobile-request:repair:assistant', content: 'New answer', body: { text: 'New answer' } }],
  { preferIncomingContent: true },
);
assert.equal(corrected.length, 1);
assert.equal(corrected[0].content, 'New answer', 'explicit transcript repair must replace corrupted durable text');
assert.equal(corrected[0].body.text, 'New answer');
const duplicateRepair = mergeHistoryWithExistingMessageMetadata([
  { role: 'assistant', _clientRequestId: 'repair', workEndedAt: 500, content: 'New answer', processEntries: [{ type: 'info' }] },
  { role: 'assistant', _clientRequestId: 'repair', workEndedAt: 500, content: 'New answer\n\nOld answer', processEntries: [{ type: 'info' }, { type: 'tool' }] },
], [
  { role: 'assistant', _clientRequestId: 'repair', workEndedAt: 500, content: 'New answer', body: { text: 'New answer' } },
], { preferIncomingContent: true });
assert.equal(duplicateRepair.length, 1, 'repair must not append the old corrupted row as a server-only artifact');
assert.equal(duplicateRepair[0].content, 'New answer');
assert.equal(duplicateRepair[0].processEntries?.length, 2, 'repair must retain the richer saved trace');
const traceRepair = mergeHistoryWithExistingMessageMetadata(
  [{ role: 'assistant', messageId: 'trace-row', content: 'Answer', processEntries: [{ id: 'own' }, { id: 'foreign' }], liveTraceEntries: [{ id: 'foreign-live' }] }],
  [{ role: 'assistant', messageId: 'trace-row', content: 'Answer', processEntries: [{ id: 'own' }], liveTraceEntries: [] }],
  { preferIncomingContent: true, preferIncomingTrace: true },
);
assert.deepEqual(traceRepair[0].processEntries, [{ id: 'own' }], 'explicit trace repair must remove copied tools');
assert.deepEqual(traceRepair[0].liveTraceEntries, []);
const ownershipRepair = mergeHistoryWithExistingMessageMetadata([
  { role: 'user', content: 'First prompt', timestamp: 1 },
  { role: 'assistant', content: 'First answer', timestamp: 2, _clientRequestId: 'first', processEntries: [{ id: 'first-tool' }] },
  { role: 'user', content: 'Second prompt', timestamp: 3 },
  {
    role: 'assistant', content: 'Second answer', timestamp: 4, _clientRequestId: 'second',
    processEntries: [{ id: 'first-tool' }, { id: 'second-tool' }],
    liveTraceEntries: [{ id: 'first-tool' }, { id: 'second-live' }],
  },
], [
  { role: 'user', content: 'First prompt', timestamp: 1 },
  { role: 'assistant', content: 'First answer', timestamp: 2, _clientRequestId: 'first', processEntries: [{ id: 'first-tool' }] },
  { role: 'user', content: 'Second prompt', timestamp: 3 },
  {
    role: 'assistant', content: 'Second answer', timestamp: 4, _clientRequestId: 'second',
    processEntries: [{ id: 'first-tool' }, { id: 'second-tool' }],
    liveTraceEntries: [{ id: 'first-tool' }, { id: 'second-live' }],
  },
], { preserveAllExisting: true });
assert.deepEqual(ownershipRepair[3].processEntries?.map((entry: any) => entry.id), ['second-tool'],
  'a stale mobile sync must not attach an earlier turn’s tool to the next answer');
assert.deepEqual(ownershipRepair[3].liveTraceEntries?.map((entry: any) => entry.id), ['second-live']);
console.log('history reconciliation order, dedupe, and repeat regressions passed');

// Desktop snapshot rows omit the request id the durable server row carries.
// The server copy used to be re-appended at the end: old replies showed up
// after newer turns and three assistant messages appeared in a row.
const desktopServer = [
  { role: 'user', content: 'Q1', timestamp: 1_000, clientRequestId: 'web:s:1' },
  { role: 'assistant', content: 'A1', timestamp: 2_000, clientRequestId: 'web:s:1', processEntries: [{ id: 't1' }] },
  { role: 'user', content: 'Q2', timestamp: 3_000, clientRequestId: 'web:s:2' },
  { role: 'assistant', content: 'A2', timestamp: 4_000, clientRequestId: 'web:s:2', processEntries: [{ id: 't2' }] },
];
const desktopSnapshot = [
  { role: 'user', content: 'Q1', timestamp: 1_000 },
  { role: 'assistant', content: 'A1', timestamp: 2_000, processEntries: [{ id: 't1' }] },
  { role: 'user', content: 'Q2', timestamp: 3_000 },
  { role: 'assistant', content: 'A2', timestamp: 4_000, processEntries: [{ id: 't2' }] },
  { role: 'user', content: 'Q3', timestamp: 5_000 },
];
const desktopMerged = mergeHistoryWithExistingMessageMetadata(desktopServer, desktopSnapshot);
assert.deepEqual(
  desktopMerged.map((m) => `${m.role}:${m.content}`),
  ['user:Q1', 'assistant:A1', 'user:Q2', 'assistant:A2', 'user:Q3'],
  'desktop snapshot without request ids must not re-append server replies after newer turns',
);
assert.equal(desktopMerged[3].clientRequestId, 'web:s:2', 'server request id is adopted by the matching desktop row');
const desktopAgain = mergeHistoryWithExistingMessageMetadata(desktopMerged, desktopSnapshot);
assert.equal(desktopAgain.length, 5, 'repeat saves stay stable');
console.log('history reconciliation desktop snapshot regression passed');
