import assert from 'node:assert/strict';
import { getChatRuntime, resetChatRuntimeRegistryForTests } from '../web-ui/src/features/chat/runtime/chat-runtime.js';
import { createMobileTimelineView } from '../web-ui/src/features/chat/timeline/mobile-timeline-view.js';

resetChatRuntimeRegistryForTests();
const runtime = getChatRuntime({ gatewayId: 'gateway-test', sessionId: 'mobile-session' });
const timeline = createMobileTimelineView({ runtimeFor: () => runtime });

const oldUser = { messageId: 'u-old', role: 'user', content: 'old prompt', timestamp: 1 };
const oldAssistant = { messageId: 'a-old', role: 'ai', content: 'old reply', timestamp: 2 };
runtime.replaceHistory([oldUser, oldAssistant], { source: 'test-old' });

// Reproduce the live-send race: the compatibility thread has already advanced
// to a new optimistic user + streaming assistant pair, but the shared runtime
// still has an equally-sized snapshot from the prior render.
const liveUser = { messageId: 'u-live', role: 'user', content: 'Hi', timestamp: 3, _pmOptimistic: true };
const liveAssistant = { messageId: 'a-live', role: 'ai', content: '', timestamp: 4, streaming: true };
const raced = timeline.entries('mobile-session', [liveUser, liveAssistant]);
assert.deepEqual(raced.map((entry) => entry.msg), [liveUser, liveAssistant]);
assert.notDeepEqual(
  raced.map((entry) => entry.key),
  runtime.snapshot.history.order,
  'stale equal-length runtime keys must not be assigned positionally to a newer live thread',
);
assert.match(raced[0].key, /u-live/);
assert.match(raced[1].key, /a-live/);

// Once the runtime synchronizes to those exact source records, its canonical
// keys are safe to reuse and keyed rendering remains stable.
runtime.replaceHistory([liveUser, liveAssistant], { source: 'test-live' });
const synchronized = timeline.entries('mobile-session', [liveUser, liveAssistant]);
assert.deepEqual(synchronized.map((entry) => entry.key), runtime.snapshot.history.order);

resetChatRuntimeRegistryForTests();
console.log('Mobile timeline reconciliation tests passed.');
