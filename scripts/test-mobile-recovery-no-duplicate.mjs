// Every reconnect (WS snapshot or run recovery) must reuse the live assistant
// row, even when the connection gap froze it, instead of pushing a second row
// and replaying the whole tool stream into it.
import assert from 'node:assert/strict';
import { canReviveRecoveryTurn, reviveRecoveryTurn } from '../web-ui/src/mobile/mobile-restart-continuity.js';

const cid = 'sess_abc_req1';
const user = { role: 'user', _clientRequestId: cid, content: 'go' };
const frozen = { role: 'ai', streaming: false, workEndedAt: 5, workDurationMs: 4, _clientRequestId: cid,
  body: { text: '' }, processEntries: [{ type: 'tool' }], liveTraceEntries: [{ type: 'tool' }] };
assert.equal(canReviveRecoveryTurn([user, frozen], frozen, cid), true, 'frozen owned row is revived');
assert.equal(canReviveRecoveryTurn([user, frozen], frozen, ''), true, 'snapshot without request id still revives the trailing unfinished row');
reviveRecoveryTurn(frozen);
assert.equal(frozen.streaming, true);
assert.equal(frozen.workEndedAt, undefined);

const done = { role: 'ai', streaming: false, _pmFinalReceived: true, _clientRequestId: cid, body: { text: 'answer' } };
assert.equal(canReviveRecoveryTurn([user, done], done, cid), false, 'a finished answer is never revived');
const serverFinal = { role: 'ai', streaming: false, _pmServerAuthoredFinal: true, body: { text: 'x' } };
assert.equal(canReviveRecoveryTurn([user, serverFinal], serverFinal, ''), false);
const stopped = { role: 'ai', streaming: false, _pmAbortAcknowledged: true, _clientRequestId: cid };
assert.equal(canReviveRecoveryTurn([user, stopped], stopped, cid), false, 'stopped turns stay stopped');

const old = { role: 'ai', streaming: false, _clientRequestId: 'other', body: { text: '' } };
assert.equal(canReviveRecoveryTurn([user, old], old, cid), false, 'another request never adopts this row');
const older = { role: 'ai', streaming: false, _clientRequestId: cid, body: { text: '' } };
assert.equal(canReviveRecoveryTurn([older, { role: 'user' }], older, cid), false, 'a row before a newer user turn is not revived');
const historyAnswer = { role: 'ai', streaming: false, workEndedAt: 9, body: { text: 'previous reply' } };
assert.equal(canReviveRecoveryTurn([user, historyAnswer], historyAnswer, ''), false, 'a completed history reply without identity is not revived');
const before = { role: 'ai', streaming: false, workflowPart: 'before_interruption', _clientRequestId: cid };
assert.equal(canReviveRecoveryTurn([user, before], before, cid), false, 'steer before-rows stay frozen');
const errored = { role: 'ai', streaming: false, workEndedAt: 9, errorPresentation: { kind: 'network' }, body: { text: 'Connection lost' } };
assert.equal(canReviveRecoveryTurn([user, errored], errored, ''), true, 'a connection-error row is revived, not duplicated');

console.log('mobile recovery no-duplicate: ok');
