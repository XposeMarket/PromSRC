import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { ChatStore } from '../web-ui/src/mobile-v2/core/chat-store.js';

const source = readFileSync(new URL('../web-ui/src/mobile/mobile-pages.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(`function ${start}(`);
  const to = source.indexOf(`function ${end}(`, from + 1);
  assert.ok(from >= 0 && to > from, `could not load ${start}`);
  return source.slice(from, to);
}

const legacy = {
  __pmChat: { completedAssistantTurns: {} },
  _mobileMessageCopyText: (message) => String(message?.content || message?.body?.text || '').trim(),
  _isMobileAssistantMessage: (message) => message?.role === 'ai',
  _mobileAssistantTurnIdentity: (message) => message?.messageId || '',
  _mergeMobileAssistantTurnDetails: () => {},
  _mergeMobileUserTurnDetails: () => {},
  _mergeMobileMediaIntoMessage: () => {},
  _collectMessageMedia: () => [],
  _mergeMobileProductCarouselIntoMessage: () => {},
  _pruneMobileRoleGroupedDuplicateTail: () => {},
  _dedupeMobileAssistantTurns: () => {},
  _repairMobileRealtimeExchangeOrder: () => {},
  _reindexMobileThread: () => {},
  _pruneMobileStaleStreamingTraceTurns: () => {},
  _mobileAssistantContentKey: (message) => message?.role === 'ai' ? String(message.content || '').toLowerCase() : '',
  _mobileAssistantRichnessScore: () => 0,
};
runInNewContext([
  section('_reconcileMobileThreadOrder', '_isMobileChatSteerWorkflowGroup'),
  section('_dedupeMobileAssistantTurns', '_newMobileClientRequestId'),
  section('_mobileMessagesRepresentSameTurn', '_mobileUserAttachmentSignature'),
  section('_mobileHistoryTurnsRepresentSameTurn', '_mergeMobileHistoryRecords'),
  section('_mergeMobileHistoryRecords', '_mobileHistoryPageIsPartial'),
  section('_mergeMobilePinnedCompletedTurn', '_mergeMobileAssistantTurnDetails'),
  'globalThis.mergeHistory = _mergeMobileHistoryRecords;',
  'globalThis.sameTurn = _mobileHistoryTurnsRepresentSameTurn;',
  'globalThis.reconcileOrder = _reconcileMobileThreadOrder;',
  'globalThis.dedupeAssistant = _dedupeMobileAssistantTurns;',
  'globalThis.mergePin = _mergeMobilePinnedCompletedTurn;',
].join('\n'), legacy);

const older = [
  { role: 'user', sourceIndex: 0, timestamp: 1_000, content: 'old prompt' },
  { role: 'ai', sourceIndex: 1, timestamp: 1_001, content: 'old answer' },
];
const current = [
  { role: 'user', sourceIndex: 0, timestamp: 100_000, content: 'new prompt' },
  { role: 'ai', sourceIndex: 1, timestamp: 100_001, content: 'new answer' },
];
const merged = legacy.mergeHistory(older, current);
assert.deepEqual(Array.from(merged, (message) => message.content),
  ['old prompt', 'old answer', 'new prompt', 'new answer'],
  'page-relative source indexes must not replace newer transcript rows');
const cachedAnswer = {
  role: 'ai', _clientRequestId: 'current-request',
  messageId: 'mobile-request:current-request:assistant',
  content: 'Current answer\n\nOld answer', body: { text: 'Current answer\n\nOld answer' },
};
const canonicalAnswer = {
  role: 'ai', _clientRequestId: 'current-request',
  messageId: 'mobile-request:current-request:assistant',
  content: 'Current answer', body: { text: 'Current answer' },
};
const repaired = legacy.mergeHistory([cachedAnswer], [canonicalAnswer], { serverAuthoritativeText: true });
assert.equal(repaired[0].content, 'Current answer',
  'a completed server answer must correct stale cached text for the same request');
assert.equal(repaired[0].body.text, 'Current answer');
const liveAnswer = { ...cachedAnswer, content: 'Current answer\n\nOld answer', body: { text: 'Current answer\n\nOld answer' }, streaming: true };
const keptLive = legacy.mergeHistory([liveAnswer], [canonicalAnswer], { serverAuthoritativeText: true });
assert.equal(keptLive[0].content, 'Current answer\n\nOld answer',
  'a server snapshot must not erase a still-streaming local answer');
const artifactMerge = {
  _clearRecoveredMobileChatError: () => {},
  _mobileMessageCopyText: (message) => String(message?.content || message?.body?.text || ''),
  _mergeMobileMediaIntoMessage: () => {},
  _collectMessageMedia: () => [],
  _mergeMobileProductCarouselIntoMessage: () => {},
  _mergeMobileRichArtifacts: () => {},
  _mobileAssistantHasVisibleAnswer: (message) => !!String(message?.content || message?.body?.text || '').trim(),
  _mobileAssistantWorkStartedAt: () => 1,
};
runInNewContext([
  section('_mergeMobileAssistantTurnDetails', '_isMobileGatewayRestartContinuityCandidate'),
  'globalThis.mergeDetails = _mergeMobileAssistantTurnDetails;',
].join('\n'), artifactMerge);
const canonicalTarget = { role: 'ai', content: 'Current answer', body: { text: 'Current answer' }, timestamp: 1000 };
artifactMerge.mergeDetails(canonicalTarget, { role: 'ai', content: 'Current answer\n\nOld answer', timestamp: 1000 }, { preserveTargetText: true });
assert.equal(canonicalTarget.content, 'Current answer',
  'local visual metadata must not reattach stale cached text to a completed server answer');
assert.equal(legacy.sameTurn(
  { role: 'user', content: 'yes', timestamp: 10_000 },
  { role: 'user', content: 'yes', timestamp: 11_000 },
), false, 'repeating the same text must remain a distinct user turn');
const grouped = [
  { role: 'ai', content: 'reply one', _clientRequestId: 'one' },
  { role: 'ai', content: 'reply two', _clientRequestId: 'two' },
  { role: 'user', content: 'prompt one', _clientRequestId: 'one' },
  { role: 'user', content: 'prompt two', _clientRequestId: 'two' },
];
assert.deepEqual(Array.from(legacy.reconcileOrder(grouped), (row) => row.content),
  ['prompt one', 'reply one', 'prompt two', 'reply two'],
  'recovery must restore exact request pairs even when replies are grouped ahead of prompts');
const repeatedReply = [
  { role: 'ai', content: 'Done', timestamp: 10_000, _clientRequestId: 'first' },
  { role: 'user', content: 'Again', timestamp: 10_500 },
  { role: 'ai', content: 'Done', timestamp: 11_000, _clientRequestId: 'second' },
];
assert.equal(legacy.dedupeAssistant(repeatedReply).length, 3,
  'an identical reply to a later user message must remain visible');

const painted = [
  { role: 'user', messageId: 'first', timestamp: 500, content: 'first' },
  { role: 'ai', messageId: 'last', timestamp: 501, content: 'last' },
];
const skewedPage = [
  { role: 'user', messageId: 'first', timestamp: 500, content: 'first' },
  { role: 'user', messageId: 'middle', timestamp: 900, content: 'middle' },
  { role: 'ai', messageId: 'last', timestamp: 501, content: 'last' },
];
assert.deepEqual(Array.from(legacy.mergeHistory(painted, skewedPage, { appendOnlyNewer: true }), (row) => row.content),
  ['first', 'middle', 'last'],
  'recovery must insert omitted rows between transcript anchors despite clock skew');

const completedAt = Date.now();
legacy.__pmChat.completedAssistantTurns.session = {
  key: 'old-answer',
  at: completedAt,
  turn: { role: 'ai', messageId: 'old-answer', timestamp: completedAt - 500, content: 'old answer' },
};
const newTurn = [
  { role: 'user', timestamp: completedAt + 1, content: 'new prompt' },
  { role: 'ai', timestamp: completedAt + 2, content: 'new answer' },
];
assert.equal(legacy.mergePin('session', newTurn).length, 2,
  'a previous completed response must not be appended after a newer prompt');
assert.equal(legacy.mergePin('session', []).length, 1,
  'the pin must still bridge a temporarily empty durable snapshot');

const store = new ChatStore();
const gateway = 'gateway';
const session = 'session';
const tail = {
  history: [
    { role: 'user', timestamp: 100_000, content: 'new prompt' },
    { role: 'assistant', timestamp: 100_001, content: 'new answer' },
  ],
  historyPage: { olderCursor: 'before-tail', hasOlder: true },
};
store.hydrate(gateway, session, tail);
store.prependHistory(gateway, session, {
  items: [
    { role: 'user', timestamp: 1_000, content: 'old prompt' },
    { role: 'assistant', timestamp: 1_001, content: 'old answer' },
  ],
  pageInfo: { olderCursor: 'before-older', hasOlder: true },
});
assert.deepEqual(store.get(gateway, session).messages.map((message) => message.text),
  ['old prompt', 'old answer', 'new prompt', 'new answer'],
  'newer mobile route must prepend older rows without index collisions');
store.hydrate(gateway, session, tail);
assert.deepEqual(store.get(gateway, session).messages.map((message) => message.text),
  ['old prompt', 'old answer', 'new prompt', 'new answer'],
  'reconnection must retain previously unlocked history');
assert.equal(store.get(gateway, session).olderCursor, 'before-older',
  'reconnection must retain the cursor for the oldest loaded page');

console.log('Mobile chat history pagination regression passed.');
