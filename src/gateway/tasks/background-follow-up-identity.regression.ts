/**
 * Follow-up admission identity: stable parent turn + tool-call id + normalized
 * message digest. Pure, no storage.
 */
import assert from 'node:assert/strict';
import { followUpAdmissionKey, normalizeFollowUpMessage } from './background-follow-up-identity';

const key = (parentTurnId: string, toolCallId: string, message: string) =>
  followUpAdmissionKey({ parentTurnId, toolCallId, message });

// Genuine retry: same turn, same tool call, same message (whitespace-normalized) -> same key.
assert.equal(key('turn-2', 'call-a', 'WHY  object?\n'), key('turn-2', 'call-a', '  WHY object? '), 'retry with normalized whitespace is the same admission');
assert.equal(normalizeFollowUpMessage('  a\t b\n\nc  '), 'a b c');

// Distinct question in the same turn and same tool-call id must not alias.
assert.notEqual(key('turn-2', 'call-a', 'first question'), key('turn-2', 'call-a', 'second question'), 'distinct question is a distinct admission');

// Same message, different tool-call id in the same turn: distinct tool call.
assert.notEqual(key('turn-2', 'call-a', 'same'), key('turn-2', 'call-b', 'same'));

// Repeated local_text_0 across rounds: the id is per-round, so the turn is what separates them.
assert.notEqual(key('turn-2', 'local_text_0', 'Q'), key('turn-3', 'local_text_0', 'Q'), 'local_text_0 in a later turn is not a retry');
assert.equal(key('turn-2', 'local_text_0', 'Q'), key('turn-2', 'local_text_0', 'Q'), 'local_text_0 retry in the same turn is the same admission');

// Missing tool-call id: identity falls back to turn + digest (retry dedupes, distinct question does not).
assert.equal(key('turn-2', '', 'Q'), key('turn-2', '', 'Q'), 'missing-id retry is stable');
assert.notEqual(key('turn-2', '', 'Q1'), key('turn-2', '', 'Q2'), 'missing-id distinct question is distinct');
assert.notEqual(key('turn-2', '', 'Q'), key('turn-3', '', 'Q'), 'missing-id in another turn is distinct');
assert.notEqual(key('turn-2', '', 'Q'), key('turn-2', 'call-a', 'Q'), 'missing id is not the same identity as a present id');

// Missing parent turn has no stable identity: refuse to derive a key.
assert.equal(followUpAdmissionKey({ parentTurnId: '', toolCallId: 'call-a', message: 'Q' }), null);

console.log('PASS background follow-up identity: turn+tool-call+digest admission keys; retries alias, distinct questions do not');
