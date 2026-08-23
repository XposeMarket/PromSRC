import assert from 'node:assert/strict';
import {
  ChatHistoryCursorError,
  decodeChatHistoryCursor,
  paginateChatHistory,
} from './history-cursor';

const messages = Array.from({ length: 12 }, (_, index) => ({
  messageId: `message-${index}`,
  role: index % 2 ? 'assistant' : 'user',
  content: `turn ${index}`,
  timestamp: 1_000 + index,
}));

const first = paginateChatHistory('session-a', messages, { limit: 4 });
assert.deepEqual(first.items.map((item) => item.messageId), ['message-8', 'message-9', 'message-10', 'message-11']);
assert.equal(first.pageInfo.hasOlder, true);
assert.ok(first.pageInfo.olderCursor);
assert.equal(first.pageInfo.totalCount, 12);

// New turns can land between requests. The cursor anchors to message-8, so
// page two remains message-4..7 instead of shifting and duplicating turns.
const appended = [
  ...messages,
  { messageId: 'message-12', role: 'user', content: 'turn 12', timestamp: 1_012 },
  { messageId: 'message-13', role: 'assistant', content: 'turn 13', timestamp: 1_013 },
];
const second = paginateChatHistory('session-a', appended, { limit: 4, before: first.pageInfo.olderCursor! });
assert.deepEqual(second.items.map((item) => item.messageId), ['message-4', 'message-5', 'message-6', 'message-7']);
assert.equal(second.pageInfo.totalCount, 14);
const third = paginateChatHistory('session-a', appended, { limit: 4, before: second.pageInfo.olderCursor! });
assert.deepEqual(third.items.map((item) => item.messageId), ['message-0', 'message-1', 'message-2', 'message-3']);
assert.equal(third.pageInfo.hasOlder, false);
assert.equal(third.pageInfo.olderCursor, null);

const allIds = [...first.items, ...second.items, ...third.items].map((item) => item.messageId);
assert.equal(new Set(allIds).size, allIds.length, 'adjacent pages must not overlap');

// If an edit removes the exact anchor, the bounded index hint provides a safe
// recovery point; clients still dedupe by turn identity.
const withoutAnchor = appended.filter((item) => item.messageId !== 'message-8');
const recovered = paginateChatHistory('session-a', withoutAnchor, { limit: 4, before: first.pageInfo.olderCursor! });
assert.deepEqual(recovered.items.map((item) => item.messageId), ['message-4', 'message-5', 'message-6', 'message-7']);

assert.throws(
  () => decodeChatHistoryCursor(first.pageInfo.olderCursor!, 'session-b'),
  (error: any) => error instanceof ChatHistoryCursorError && error.code === 'INVALID_CHAT_HISTORY_CURSOR',
  'a cursor must not cross session authority boundaries',
);
assert.throws(
  () => decodeChatHistoryCursor(`${first.pageInfo.olderCursor}tampered`, 'session-a'),
  ChatHistoryCursorError,
  'cursor corruption must fail closed',
);

console.log('Chat history cursor regression tests passed.');
