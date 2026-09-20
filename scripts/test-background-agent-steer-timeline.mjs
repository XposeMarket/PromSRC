import assert from 'node:assert/strict';
import { mergeBackgroundAgentSteerMessages } from '../web-ui/src/features/chat/core/background-agent-work.js';
import { splitBackgroundAgentTimeline } from '../web-ui/src/features/chat/core/background-agent-timeline.js';

const original = { id: 'local', content: 'Please check **the frame**.\n\nThen continue.', timestamp: 2000, source: 'web_background_agent_chat' };
const replay = { id: 'server', content: original.content, timestamp: 2002, source: 'web_background_agent_chat', seq: 4, streamId: 'stream' };
const prometheus = { id: 'prometheus', content: 'Try the second capture path.', timestamp: 4000, source: 'background_ops_steer:parent', seq: 8, streamId: 'stream' };
const steers = mergeBackgroundAgentSteerMessages([original], [replay, prometheus]);
assert.equal(steers.length, 2, 'optimistic and streamed steer are one message');
assert.equal(steers[0].content, original.content, 'Markdown line breaks survive persistence');
assert.equal(steers[0].seq, 4);
assert.equal(steers[0].actor, 'User');
assert.equal(steers[1].actor, 'Prometheus');
assert.equal(steers[1].workflowLabel, 'Prometheus steered agent');

const message = {
  content: 'Final answer', body: { text: 'Final answer' }, streaming: false, _done: true,
  workStartedAt: 1000, workEndedAt: 6000,
  processEntries: [
    { id: 'tool-before', seq: 2, streamId: 'stream' },
    { id: 'tool-middle', seq: 6, streamId: 'stream' },
    { id: 'tool-after', seq: 10, streamId: 'stream' },
  ],
  liveTraceEntries: [
    { id: 'thought-before', extra: { seq: 3, streamId: 'stream' } },
    { id: 'thought-middle', extra: { seq: 7, streamId: 'stream' } },
    { id: 'thought-after', extra: { seq: 9, streamId: 'stream' } },
  ],
};
const timeline = splitBackgroundAgentTimeline(message, steers, 'stream');
assert.deepEqual(timeline.segments.map((segment) => segment.processEntries.map((entry) => entry.id)),
  [['tool-before'], ['tool-middle'], ['tool-after']]);
assert.deepEqual(timeline.segments.map((segment) => segment.liveTraceEntries.map((entry) => entry.id)),
  [['thought-before'], ['thought-middle'], ['thought-after']]);
assert.deepEqual(timeline.segments.map((segment) => segment.content), ['', '', 'Final answer']);
assert.equal(timeline.segments[0].streaming, false);
assert.equal(timeline.segments[2]._done, true);
assert.deepEqual(timeline.segments.map((segment) => segment.body.processEntries.map((entry) => entry.id)),
  [['tool-before'], ['tool-middle'], ['tool-after']], 'body recovery entries stay within their steer segment');
const durable = mergeBackgroundAgentSteerMessages(steers, [{
  id: 'prometheus', content: prometheus.content, timestamp: prometheus.timestamp,
  source: prometheus.source, seq: prometheus.seq, streamId: prometheus.streamId,
}]);
assert.equal(durable.length, 2, 'durable session replay does not duplicate an existing steer');
const repeated = mergeBackgroundAgentSteerMessages(durable, [{
  id: 'prometheus-again', content: prometheus.content, timestamp: prometheus.timestamp + 1000,
  source: prometheus.source, seq: 11, streamId: prometheus.streamId,
}]);
assert.equal(repeated.length, 3, 'two distinct steers with the same text remain visible');
console.log('[background steer timeline] both authors, persistence merge and chronological segments passed');
