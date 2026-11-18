// Regression: a delivery_send row appended mid-turn (e.g. a login link sent
// right before a question card) must never be treated as the run's live row.
// Before the fix, recovery after answering the card adopted/blocked on the
// delivery row and allocated a fresh empty "Working for" row, orphaning the
// real tool stream (IMG_2060-2063, Nov 17 2026).
import assert from 'node:assert/strict';
import { canReviveRecoveryTurn, noteRowStreamSeq, liveRowMissingStreamHead } from '../web-ui/src/mobile/mobile-restart-continuity.js';
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

// Second half (IMG_2065-2068): a live frame (seq 6306) reached the fresh row
// before recovery, so the replay cursor skipped the whole earlier tool stream.
{
  const row = { role: 'ai', streaming: true, processEntries: [], liveTraceEntries: [] };
  noteRowStreamSeq(row, { streamId: 's1', seq: 6306 });
  row._streamId = 's1';
  assert.equal(liveRowMissingStreamHead(row, { replayStreamId: 's1', firstSeq: 1 }), true, 'tail-only row must be rebuilt');
  row._pmHeadVerified = 's1';
  assert.equal(liveRowMissingStreamHead(row, { replayStreamId: 's1', firstSeq: 1 }), false, 'rebuilt once per stream');
}
{
  // A row that saw its stream from the start is left alone.
  const row = { role: 'ai', streaming: true };
  noteRowStreamSeq(row, { streamId: 's1', seq: 3 });
  row._streamId = 's1';
  noteRowStreamSeq(row, { streamId: 's1', seq: 900 });
  assert.equal(liveRowMissingStreamHead(row, { replayStreamId: 's1', firstSeq: 1 }), false);
  // Cache-restored rows (no seq tracking) keep the existing preserve path.
  assert.equal(liveRowMissingStreamHead({ role: 'ai', _streamId: 's1' }, { replayStreamId: 's1', firstSeq: 1 }), false);
}
{
  // Gateway restart: a row with content from stream A that continues on B is
  // never wiped by a B replay.
  const row = { role: 'ai', streaming: true, liveTraceEntries: [{ type: 'tool' }] };
  noteRowStreamSeq(row, { streamId: 'A', seq: 5 });
  row._streamId = 'A';
  noteRowStreamSeq(row, { streamId: 'B', seq: 400 });
  row._streamId = 'B';
  assert.equal(liveRowMissingStreamHead(row, { replayStreamId: 'B', firstSeq: 1 }), false, 'multi-stream rows are preserved');
}
{
  // Steer continuation: its head is the steer boundary, not seq 1.
  const steer = { workflowStreamId: 's1', workflowBoundarySeq: 500 };
  const row = { role: 'ai', streaming: true, workflowPart: 'interruption_response' };
  noteRowStreamSeq(row, { streamId: 's1', seq: 505 });
  row._streamId = 's1';
  assert.equal(liveRowMissingStreamHead(row, { replayStreamId: 's1', firstSeq: 1, steer }), false);
  const late = { role: 'ai', streaming: true, workflowPart: 'interruption_response' };
  noteRowStreamSeq(late, { streamId: 's1', seq: 900 });
  late._streamId = 's1';
  assert.equal(liveRowMissingStreamHead(late, { replayStreamId: 's1', firstSeq: 1, steer }), true);
}

console.log('test-mobile-delivery-live-row: PASS');
