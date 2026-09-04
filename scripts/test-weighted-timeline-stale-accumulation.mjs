import assert from 'node:assert/strict';
import {
  createTimelineEntries,
  createWeightedTimelineController,
} from '../web-ui/src/features/chat/timeline/weighted-timeline.js';

function messages(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `${prefix}-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `${prefix} turn ${index}`,
  }));
}

const original = createTimelineEntries(messages('original', 1_200));
const controller = createWeightedTimelineController({ surface: 'desktop' });
controller.select('chat', original, { followTail: true });
assert.equal(controller.stepEarlier('chat', original), true);
const accumulated = controller.select('chat', original);
assert.equal(accumulated.mode, 'accumulate');
assert.ok(accumulated.paintEntries.length > 96, 'backfilled history should retain the additive range');

// Simulate recovery/session replacement while the controller survives. None of
// the old accumulated keys exist in the replacement transcript.
const replacement = createTimelineEntries(messages('replacement', 1_200));
const recovered = controller.select('chat', replacement);
assert.equal(recovered.mode, 'tail', 'stale accumulation must fall back to a bounded timeline mode');
assert.equal(recovered.paintEntries.length, 96, 'stale accumulation must not paint the entire replacement transcript');
assert.equal(recovered.materializedEntries.length, 180, 'stale accumulation must restore the normal materialization budget');
assert.equal(recovered.lastPaintIndex, 1_199, 'fallback should retain the newest replacement turn');

console.log('weighted timeline stale accumulation regression passed');
