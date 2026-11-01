import assert from 'node:assert/strict';
import {
  MAIN_CHAT_ABORT_SETTLE_GRACE_MS,
  MAIN_CHAT_ORPHAN_GRACE_MS,
  isMainChatExecutionAgeExceeded,
  isLiveBackgroundJoin,
  isMainChatAbortSettleExpired,
  resolveMainChatAbortSettlement,
  isMainChatSemanticProgressEvent,
  isMainChatSemanticProgressStalled,
  isMainChatStreamOwnerOrphaned,
} from './main-chat-execution-owner';

const now = 1_000_000;

assert.equal(isMainChatSemanticProgressEvent('heartbeat'), false, 'transport heartbeat must not count as semantic progress');
assert.equal(isMainChatSemanticProgressEvent('token'), true, 'model output must count as semantic progress');
assert.equal(isMainChatSemanticProgressEvent('tool_result'), true, 'tool results must count as semantic progress');
assert.equal(isMainChatSemanticProgressEvent('ui_preflight'), false, 'preflight must not reset the semantic watchdog');
assert.equal(isMainChatSemanticProgressEvent('info'), false, 'informational progress must not reset the semantic watchdog');
assert.equal(isMainChatSemanticProgressEvent('tool_progress'), true, 'active tool progress must reset the semantic watchdog');
assert.equal(isMainChatSemanticProgressEvent('process_run_output'), true, 'process output must reset the semantic watchdog');

assert.equal(isMainChatStreamOwnerOrphaned({
  now,
  startedAt: now - MAIN_CHAT_ORPHAN_GRACE_MS - 1,
  lastSemanticProgressAt: now - MAIN_CHAT_ORPHAN_GRACE_MS - 1,
  streamActive: true,
  runtimePresent: false,
}), true, 'an ownerless active stream must expire after the grace period');

assert.equal(isMainChatStreamOwnerOrphaned({
  now,
  startedAt: now - MAIN_CHAT_ORPHAN_GRACE_MS - 1,
  // A heartbeat would update transport activity, but must not extend this.
  lastSemanticProgressAt: now - MAIN_CHAT_ORPHAN_GRACE_MS - 1,
  streamActive: true,
  runtimePresent: false,
}), true, 'heartbeats must not keep an ownerless stream alive');

assert.equal(isMainChatSemanticProgressStalled({
  now,
  lastSemanticProgressAt: now - 60_001,
  streamActive: true,
  runtimePresent: true,
  runtimeStatus: 'running',
  stallMs: 60_000,
}), true, 'a live owner without semantic progress must trip the watchdog');

assert.equal(isMainChatSemanticProgressStalled({
  now,
  lastSemanticProgressAt: now - 60_001,
  streamActive: true,
  runtimePresent: true,
  runtimeStatus: 'running',
  abortRequestedAt: now - 1,
  stallMs: 60_000,
}), false, 'an owner already being aborted must not be aborted twice');

assert.equal(isMainChatSemanticProgressStalled({
  now,
  lastSemanticProgressAt: now - 60_001,
  streamActive: true,
  runtimePresent: true,
  runtimeStatus: 'interrupted',
  stallMs: 60_000,
}), false, 'interrupted owners are handled by restart recovery, not the live watchdog');

assert.equal(isMainChatAbortSettleExpired({
  now,
  abortRequestedAt: now - MAIN_CHAT_ABORT_SETTLE_GRACE_MS,
}), false, 'an abort at the settle boundary still gets time to unwind');
assert.equal(isMainChatAbortSettleExpired({
  now,
  abortRequestedAt: now - MAIN_CHAT_ABORT_SETTLE_GRACE_MS - 1,
}), true, 'a deferred abort must be reconciled even after its stream has closed');
assert.equal(isMainChatAbortSettleExpired({
  now,
  abortRequestedAt: undefined,
}), false, 'runtimes without an abort request are not force-settled');
assert.equal(resolveMainChatAbortSettlement({
  now,
  abortRequestedAt: now - MAIN_CHAT_ABORT_SETTLE_GRACE_MS - 1,
  abortSource: 'main_chat_owner_watchdog',
}), 'recover', 'a closed stream must not prevent watchdog work from becoming durable recovery');
assert.equal(resolveMainChatAbortSettlement({
  now,
  abortRequestedAt: now - MAIN_CHAT_ABORT_SETTLE_GRACE_MS - 1,
  abortSource: 'mobile_stop_button',
}), 'finish', 'an explicit stop must terminalize even when its request finalizer never arrives');

assert.equal(isMainChatExecutionAgeExceeded({
  now,
  startedAt: now - 10 * 60 * 1000 - 1,
  maxAgeMs: 10 * 60 * 1000,
  streamActive: true,
}), true, 'a foreground execution beyond its absolute age bound must be contained');
assert.equal(isMainChatExecutionAgeExceeded({
  now,
  startedAt: now - 10 * 60 * 1000 - 1,
  maxAgeMs: 10 * 60 * 1000,
  streamActive: false,
}), false, 'completed streams must not be age-aborted');

assert.equal(isLiveBackgroundJoin({ now, lastSemanticEvent: 'background_wait', lastSemanticProgressAt: now - 30_000, activeBackgroundCount: 2 }), true, 'live joined workers suppress the absolute age watchdog');
assert.equal(isLiveBackgroundJoin({ now, lastSemanticEvent: 'active_tool_wait', lastSemanticProgressAt: now - 5_000, activeBackgroundCount: 2 }), true, 'the five-second foreground tool heartbeat must not mask a live join');
assert.equal(isLiveBackgroundJoin({ now, lastSemanticEvent: 'background_wait', lastSemanticProgressAt: now - 130_000, activeBackgroundCount: 2 }), false, 'a stale join cannot mask a dead owner');
assert.equal(isLiveBackgroundJoin({ now, lastSemanticEvent: 'background_wait', lastSemanticProgressAt: now - 30_000, activeBackgroundCount: 0 }), false, 'a completed worker cannot indefinitely mask a stuck foreground');
assert.equal(isLiveBackgroundJoin({ now, lastSemanticEvent: 'heartbeat', lastSemanticProgressAt: now, activeBackgroundCount: 2 }), false, 'transport heartbeats are not join liveness');

console.log('main chat execution owner regression passed');

// Intentional waits have fixed deadlines; transport frames cannot extend them.
import { effectiveBlockingWaitDeadline, isBlockingWaitInFlight, updateBlockingWaits } from './main-chat-execution-owner';
const waitStart = 1_000_000;
for (const [name, args] of [
  ['background_ops', { action: 'wait', timeout_ms: 900_000 }],
  ['background_ops', { action: 'join', wait_ms: 900_000 }],
  ['workspace_run', { action: 'wait', timeoutMs: 900_000 }],
  ['video_project', { action: 'wait' }], ['process_wait', {}],
  ['ask_prometheus_questions', {}], ['await_prometheus_question_response', {}],
  ['request_browser_login', {}], ['request_final_action_approval', {}],
] as Array<[string, Record<string, any>]>) {
  const waits = updateBlockingWaits([], 'tool_call', { action: name, args, toolCallId: name }, waitStart);
  assert.equal(isBlockingWaitInFlight(waits, waitStart + 900_000), true, name);
  assert.equal(isBlockingWaitInFlight(waits, waitStart + 1_020_001), false, `${name} expires`);
  assert.equal(updateBlockingWaits(waits, 'tool_result', { action: name, toolCallId: name }, waitStart + 1).length, 0);
}
assert.equal(effectiveBlockingWaitDeadline({ name: 'process_wait', startedAt: waitStart, args: { timeout_ms: 9e9 } }), waitStart + 1_920_000);
assert.equal(effectiveBlockingWaitDeadline({ name: 'workspace_run', startedAt: waitStart, args: { action: 'run' } }), 0);
let joined = updateBlockingWaits([], 'background_wait', { pending: 2, waitedMs: 0 }, waitStart);
joined = updateBlockingWaits(joined, 'background_wait', { pending: 2, waitedMs: 900_000 }, waitStart + 900_000);
assert.equal(isBlockingWaitInFlight(joined, waitStart + 1_020_001), false, 'join keepalives cannot renew the deadline');
assert.equal(updateBlockingWaits(joined, 'background_wait', { pending: 0, finished: true }, waitStart + 1).length, 0);
console.log('blocking-wait watchdog regressions passed');

import { isQuestionWaitInFlight } from './main-chat-execution-owner';
const questionWait = [{ name: 'ask_prometheus_questions', startedAt: waitStart }];
const pendingCard = { id: 'q1', sessionId: 'session', status: 'pending', createdAt: new Date(waitStart + 10).toISOString(), expiresAt: waitStart + 24 * 60 * 60_000 };
const afterSevenHours = waitStart + 7 * 60 * 60_000;
assert.equal(isQuestionWaitInFlight(questionWait, 'session', () => [pendingCard], afterSevenHours), true, 'real 24h card survives both 17min and 6h watchdog limits');
for (const changed of [{ status: 'answered' }, { status: 'cancelled' }, { expiresAt: afterSevenHours }, { expiresAt: NaN }, { sessionId: 'other' }, { createdAt: new Date(waitStart - 1).toISOString() }]) {
  assert.equal(isQuestionWaitInFlight(questionWait, 'session', () => [{ ...pendingCard, ...changed }], afterSevenHours), false, JSON.stringify(changed));
}
assert.equal(isQuestionWaitInFlight(questionWait, 'session', () => [], afterSevenHours), false, 'missing or detached card cannot suppress watchdog');
const resumeWait = [{ name: 'await_prometheus_question_response', startedAt: afterSevenHours, args: { question_id: 'q1' } }];
assert.equal(isQuestionWaitInFlight(resumeWait, 'session', () => [pendingCard], afterSevenHours), true, 'resume matches exact prior card');
assert.equal(isQuestionWaitInFlight(resumeWait, 'session', () => [{ ...pendingCard, id: 'other' }], afterSevenHours), false, 'unrelated card cannot suppress watchdog');
assert.equal(isQuestionWaitInFlight([], 'session', () => { throw new Error('unexpected queue read'); }), false, 'no disk reads for normal work');
assert.equal(isQuestionWaitInFlight(updateBlockingWaits(questionWait, 'done', {}, afterSevenHours), 'session', () => [pendingCard], afterSevenHours), false);
console.log('durable question watchdog regressions passed');
