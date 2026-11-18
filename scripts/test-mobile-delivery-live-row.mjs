// Regression: a delivery_send row appended mid-turn (e.g. a login link sent
// right before a question card) must never be treated as the run's live row.
// Before the fix, recovery after answering the card adopted/blocked on the
// delivery row and allocated a fresh empty "Working for" row, orphaning the
// real tool stream (IMG_2060-2063, Nov 17 2026).
import assert from 'node:assert/strict';
import { canReviveRecoveryTurn } from '../web-ui/src/mobile/mobile-restart-continuity.js';
import { findMobileQuestionHostRow } from '../web-ui/src/mobile/mobile-question-rows.js';
import { isMobileDeliveryRow } from '../web-ui/src/mobile/mobile-thread-order.js';

const user = { role: 'user', timestamp: 1000, _clientRequestId: 'req1' };
const live = {
  role: 'ai', streaming: false, timestamp: 1100, _clientRequestId: 'req1',
  body: { text: '' }, liveTraceEntries: [{ type: 'tool' }], processEntries: [{ type: 'tool' }],
};
const delivery = {
  role: 'ai', messageKind: 'delivery', channelLabel: 'delivery', timestamp: 1200,
  body: { text: 'Claude Code sign-in link' }, content: 'Claude Code sign-in link',
};
const thread = [user, live, delivery];

assert.equal(isMobileDeliveryRow(delivery), true);
// The delivery row itself is never revivable as the live row.
assert.equal(canReviveRecoveryTurn(thread, delivery, 'req1'), false, 'delivery row must not become the live row');
// The frozen live row stays revivable even with a delivery row after it.
assert.equal(canReviveRecoveryTurn(thread, live, 'req1'), true, 'delivery row after the live row must not end the request');
// Question cards attach to the live row, not to the delivery bubble.
const host = findMobileQuestionHostRow([user, { ...live, streaming: true }, delivery], { id: 'q1', clientRequestId: 'req1' });
assert.equal(host?.liveTraceEntries?.length, 1, 'question host must be the live row');
assert.notEqual(host?.messageKind, 'delivery');

console.log('test-mobile-delivery-live-row: PASS');
