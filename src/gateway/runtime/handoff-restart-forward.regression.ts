import assert from 'node:assert/strict';
import {
  HANDOFF_RESTART_REQUEST, HANDOFF_RESTART_RESULT, acceptHandoffRestart,
  handoffRestartTarget, isHandoffRestartResult, shouldForwardHandoffRestart,
} from './handoff-restart-forward';

const oldHost = { pid: 101 };
const replacement = { pid: 202 };
const request = {
  type: HANDOFF_RESTART_REQUEST, id: 'one-hop-1', forwarded: true as const,
  context: { reason: 'manual' as const, timestamp: Date.now(), forwardedFromHandoff: true },
};
assert.equal(shouldForwardHandoffRestart(true, false), true, 'draining host initiates one hop');
assert.equal(handoffRestartTarget(oldHost, replacement, true, request), replacement, 'supervisor targets active replacement');
assert.equal(acceptHandoffRestart(false, request), true, 'active replacement accepts forwarded request');
const acknowledgement = { type: HANDOFF_RESTART_RESULT, id: request.id, accepted: true, pid: replacement.pid };
assert.equal(isHandoffRestartResult(acknowledgement), true);
assert.equal(acknowledgement.pid, 202, 'successful relay reports replacement PID');
assert.equal(handoffRestartTarget(oldHost, null, true, request), null, 'missing replacement refuses');
assert.equal(handoffRestartTarget(replacement, replacement, false, request), null, 'active host cannot relay itself');
assert.equal(acceptHandoffRestart(true, request), false, 'draining replacement refuses');
assert.equal(shouldForwardHandoffRestart(true, request.context.forwardedFromHandoff), false, 'no second hop');
assert.equal(acceptHandoffRestart(false, { ...request, context: { ...request.context, forwardedFromHandoff: false } }), false);
console.log('handoff restart forwarding regression passed');
