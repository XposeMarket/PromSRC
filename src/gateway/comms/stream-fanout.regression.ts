import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { broadcastWS, setWss, setWsClientStreamFocus } from './broadcaster';

// Exercise the real broadcaster with deterministic in-memory websocket clients.
// No listening port and no gateway startup required.
type Client = { readyState: number; bufferedAmount: number; frames: string[]; send: (text: string) => void };
function client(): Client {
  const frames: string[] = [];
  return { readyState: 1, bufferedAmount: 0, frames, send(text: string) { frames.push(text); } };
}
const legacy = client();
const focused = client();
const unfocused = client();
const server = { clients: new Set([legacy, focused, unfocused]), on() {} } as unknown as WebSocketServer;
setWss(server);
setWsClientStreamFocus(focused, ['focus']);
setWsClientStreamFocus(unfocused, ['other']);

function send(sessionId: string, seq: number, event: string, data: object = {}) {
  broadcastWS({ type: 'main_chat_stream_event', sessionId, streamId: `turn-${sessionId}`,
    seq, event, at: Date.now(), data });
}
function parsed(target: Client) { return target.frames.map((frame) => JSON.parse(frame)); }
function bytes(target: Client) { return target.frames.reduce((total, frame) => total + Buffer.byteLength(frame), 0); }

for (let seq = 1; seq <= 3000; seq++) send('focus', seq, 'token', { text: `token-${seq}-payload\n` });
const legacyCount = legacy.frames.length;
const legacyBytes = bytes(legacy);
const unfocusedCount = unfocused.frames.length;
const unfocusedBytes = bytes(unfocused);
assert.equal(legacyCount, 3000, 'legacy clients still receive every frame');
assert.equal(focused.frames.length, 3000, 'focused clients receive every frame for their session');
assert(unfocusedCount <= 1, '3,000 tokens in under a second produce at most one activity summary');
assert(parsed(unfocused).every((frame) => frame.type === 'session_activity'));
assert(unfocusedCount <= legacyCount / 10 && unfocusedBytes <= legacyBytes / 10,
  'unfocused frame count AND bytes must fall by at least 90%');
console.log(`fanout 3000 tokens: legacy ${legacyCount} frames / ${legacyBytes} bytes; unfocused ${unfocusedCount} frames / ${unfocusedBytes} bytes`);

send('other', 1, 'token', { text: 'their own stream' });
assert.equal(parsed(focused).filter((frame) => frame.sessionId === 'other').filter((frame) => frame.type === 'main_chat_stream_event').length, 0,
  'a focused client must not receive tokens from another session');
assert.equal(parsed(unfocused).filter((frame) => frame.sessionId === 'other' && frame.event === 'token').length, 1);

const switcher = client();
(server.clients as unknown as Set<Client>).add(switcher);
setWsClientStreamFocus(switcher, []);
send('switch', 1, 'token', { text: 'Hello ' });
send('switch', 2, 'thinking_delta', { thinking: 'reasoning' });
send('switch', 3, 'token', { text: 'world' });
send('switch', 4, 'tool_call', { action: 'test_tool', message: 'running' });
setWsClientStreamFocus(switcher, ['switch']);
const snapshots = parsed(switcher).filter((frame) => frame.type === 'session_stream_snapshot');
assert.equal(snapshots.length, 1);
const snapshot = snapshots[0];
assert.equal(snapshot.text, 'Hello world');
assert.equal(snapshot.thinking, 'reasoning');
assert.equal(snapshot.turnId, 'turn-switch');
assert.equal(snapshot.seq, 4);
assert.equal(snapshot.tools[0].type, 'tool_call');
send('switch', 5, 'token', { text: '!' });
send('switch', 6, 'token', { text: ' done' });
const continuation = parsed(switcher).filter((frame) => frame.type === 'main_chat_stream_event'
  && frame.sessionId === 'switch' && frame.seq > snapshot.seq);
assert.deepEqual(continuation.map((frame) => frame.seq), [5, 6], 'snapshot cursor has no gap or duplicate');
assert.equal(snapshot.text + continuation.map((frame) => frame.data.text).join(''), 'Hello world! done');
for (const event of ['done', 'error', 'session_title']) {
  send('switch', 7 + ['done', 'error', 'session_title'].indexOf(event), event, {});
  assert.equal(parsed(legacy).at(-1)?.event, event);
  assert.equal(parsed(focused).at(-1)?.event, event);
  assert.equal(parsed(unfocused).at(-1)?.event, event);
}
assert.equal(parsed(switcher).filter((frame) => frame.type === 'session_stream_snapshot').length, 1,
  'terminal events remove in-flight snapshots');
console.log('stream fanout regression passed');
