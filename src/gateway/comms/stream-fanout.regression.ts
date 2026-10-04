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
{
  // Snapshot tool rows carry the call id so a fresh client can pair results with calls.
  const fresh = client();
  setWsClientStreamFocus(fresh, ['other']);
  send('tools', 1, 'tool_call', { action: 'workspace_run', toolCallId: 'call-1', stepNum: 1 });
  send('tools', 2, 'tool_result', { action: 'workspace_run', toolCallId: 'call-1', stepNum: 1, result: 'ok' });
  setWsClientStreamFocus(fresh, ['tools'], true);
  const snap = parsed(fresh).find((frame) => frame.type === 'session_stream_snapshot' && frame.sessionId === 'tools');
  assert(snap, 'focus switch delivers a snapshot');
  assert.deepEqual(snap.tools.map((tool: any) => [tool.type, tool.data.callId]),
    [['tool_call', 'call-1'], ['tool_result', 'call-1']], 'snapshot tools keep their call ids');
}
{
  // The snapshot summary is the live narration segment only; a tool boundary
  // starts a new segment instead of gluing all commentary into one paragraph.
  const viewer = client();
  setWsClientStreamFocus(viewer, ['other']);
  send('narr', 1, 'reasoning_summary_delta', { text: 'First segment.' });
  send('narr', 2, 'tool_call', { action: 'workspace_run', toolCallId: 'c1' });
  send('narr', 3, 'tool_result', { action: 'workspace_run', toolCallId: 'c1', result: 'ok' });
  send('narr', 4, 'reasoning_summary_delta', { text: 'Second segment.' });
  setWsClientStreamFocus(viewer, ['narr'], true);
  const snap = parsed(viewer).find((frame) => frame.type === 'session_stream_snapshot' && frame.sessionId === 'narr');
  assert.equal(snap.summary, 'Second segment.', 'snapshot summary must not merge commentary across tool boundaries');
}
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

// Multiple concurrent threads: raw output and background narration are
// compacted only for opted-in clients not watching that parent session.
{
  const observers = Array.from({ length: 8 }, () => client());
  const busyServer = { clients: new Set(observers), on() {} } as unknown as WebSocketServer;
  setWss(busyServer);
  observers.forEach((observer, index) => setWsClientStreamFocus(observer, [`thread-${index}`]));
  const chunk = 'x'.repeat(8_192);
  const types = ['process_run_output', 'bg_agent_event'];
  const frames = 12 * 60 * types.length;
  for (let session = 0; session < 12; session++) {
    for (let event = 0; event < 60; event++) {
      broadcastWS({ type: types[0], sessionId: `thread-${session}`,
        run: { runId: `run-${session}`, sessionId: `thread-${session}` }, chunk, sequence: event });
      broadcastWS({ type: types[1], sessionId: `thread-${session}`,
        event: 'thinking_delta', eventType: 'thinking_delta', bgId: `bg-${session}`, text: chunk });
    }
  }
  const delivered = observers.reduce((sum, observer) => sum + observer.frames.length, 0);
  const deliveredBytes = observers.reduce((sum, observer) => sum + bytes(observer), 0);
  const baselineBytes = frames * 8 * (Buffer.byteLength(chunk) + 120); // conservative per-frame baseline
  assert(delivered < frames * 2, '12 sessions x 8 focused clients coalesce unfocused chatter');
  assert(deliveredBytes < baselineBytes / 4, 'background fanout bytes fall by at least 75%');
  broadcastWS({ type: 'process_run_exited', sessionId: 'thread-11', run: { runId: 'last', state: 'exited' } });
  broadcastWS({ type: 'bg_agent_event', sessionId: 'thread-11', bgId: 'last', eventType: 'error', message: 'failed' });
  broadcastWS({ type: 'bg_agent_done', sessionId: 'thread-11', bgId: 'last', state: 'failed' });
  for (const observer of observers) {
    for (const type of ['process_run_exited', 'bg_agent_event', 'bg_agent_done']) {
      assert(parsed(observer).some((frame) => frame.type === type && frame.sessionId === 'thread-11'),
        `${type} always reaches even unfocused clients`);
    }
  }
  console.log(JSON.stringify({ scenario: '8 clients x 12 sessions x 60 pairs',
    baselineFrames: frames * 8, afterFrames: delivered, baselineBytes, afterBytes: deliveredBytes }));
}
