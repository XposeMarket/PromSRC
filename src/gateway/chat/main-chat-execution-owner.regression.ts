import assert from 'node:assert/strict';
import {
  MAIN_CHAT_ORPHAN_GRACE_MS,
  isMainChatSemanticProgressEvent,
  isMainChatSemanticProgressStalled,
  isMainChatStreamOwnerOrphaned,
} from './main-chat-execution-owner';

const now = 1_000_000;

assert.equal(isMainChatSemanticProgressEvent('heartbeat'), false, 'transport heartbeat must not count as semantic progress');
assert.equal(isMainChatSemanticProgressEvent('token'), true, 'model output must count as semantic progress');
assert.equal(isMainChatSemanticProgressEvent('tool_result'), true, 'tool results must count as semantic progress');
assert.equal(isMainChatSemanticProgressEvent('ui_preflight'), false, 'preflight must not reset the semantic watchdog');

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

console.log('main chat execution owner regression passed');

