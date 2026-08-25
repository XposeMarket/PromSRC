import assert from 'node:assert/strict';
import {
  MAIN_CHAT_ABORT_SETTLE_GRACE_MS,
  MAIN_CHAT_ORPHAN_GRACE_MS,
  isMainChatExecutionAgeExceeded,
  isMainChatAbortSettleExpired,
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
assert.equal(isMainChatSemanticProgressEvent('tool_progress'), false, 'tool transport progress must not reset the semantic watchdog');

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

console.log('main chat execution owner regression passed');
