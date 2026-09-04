import assert from 'node:assert/strict';
import { classifyMainChatStreamEvent } from './main-chat-stream';

type Frame = { type: string; data: Record<string, unknown> };

const replay: Frame[] = [];
const liveForConnectedClients: Frame[] = [];
const append = (type: string, data: Record<string, unknown> = {}) => {
  const frame = { type, data };
  const delivery = classifyMainChatStreamEvent(type, data);
  if (delivery.retain) replay.push(frame);
  if (delivery.live) liveForConnectedClients.push(frame);
};

append('thinking_delta', { delta: 'private thought' });
append('token', { delta: 'hello' });
append('model_stream_event', { event: { type: 'reasoning_delta', delta: 'detail' } });
append('model_stream_event', { event: { type: 'tool_call_start', name: 'read_source' } });
append('final', { text: 'done' });

assert.deepEqual(liveForConnectedClients.map((frame) => frame.type), [
  'thinking_delta',
  'token',
  'model_stream_event',
  'final',
]);
assert.deepEqual(replay.map((frame) => frame.type), ['model_stream_event', 'final']);
assert.equal(replay[0].data.event && (replay[0].data.event as any).type, 'tool_call_start');
assert.equal(replay.some((frame) => frame.type === 'token'), false);
assert.equal(replay.some((frame) => frame.type === 'thinking_delta'), false);

console.log('main-chat stream live-delivery regression: ok');
