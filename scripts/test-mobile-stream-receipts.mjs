import assert from 'node:assert/strict';
import { createMobileStreamReceiptLedger } from '../web-ui/src/features/chat/runtime/mobile-stream-receipts.js';

let now = 1_000;
const ledger = createMobileStreamReceiptLedger({
  now: () => now,
  ttlMs: 100,
});

const frame = (streamId, seq) => ({ type: 'token', streamId, seq });

assert.equal(ledger.accept('chat-a', frame('stream-a', 1)), true, 'first durable frame is accepted');
assert.equal(ledger.has('chat-a', frame('stream-a', 1)), true, 'accepted frame is remembered');
assert.equal(ledger.accept('chat-a', frame('stream-a', 1)), false, 'SSE/WS/replay delivery is idempotent');
assert.equal(ledger.accept('chat-a', frame('stream-a', 2)), true, 'next frame remains independent');
assert.equal(ledger.accept('chat-a', frame('stream-b', 1)), true, 'a new stream can restart its sequence');
assert.equal(ledger.accept('chat-b', frame('stream-a', 1)), true, 'receipts are isolated by session');

assert.equal(ledger.accept('chat-a', frame('stream-zero', 0)), true, 'zero-sequence frames are accepted');
assert.equal(ledger.has('chat-a', frame('stream-zero', 0)), true, 'zero-sequence frames are remembered');
assert.equal(ledger.accept('chat-a', frame('stream-zero', 0)), false, 'zero-sequence replay frames are idempotent');

const identified = { type: 'done', eventId: 'event-42' };
assert.equal(ledger.accept('chat-a', identified), true, 'event-id frames are accepted');
assert.equal(ledger.accept('chat-a', { ...identified }), false, 'event-id frames are also idempotent');

now += 10_001;
assert.equal(ledger.accept('chat-a', frame('stream-a', 1)), true, 'expired receipts do not block a future run');

ledger.clear('chat-a');
assert.equal(ledger.has('chat-a', frame('stream-a', 2)), false, 'clearing a session removes its receipts');

console.log('mobile stream receipt tests passed');
