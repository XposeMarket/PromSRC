// Deterministic, offline pressure harness: 200 tokens/sec x 30s simulated.
// Run with: node --import tsx scripts/benchmark-gateway-stream-load.mjs
import assert from 'node:assert/strict';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { broadcastWS, setWss, setWsClientStreamFocus } from '../src/gateway/comms/broadcaster.ts';

const servers = [new WebSocketServer({ noServer: true })];
const clients = Array.from({ length: 3 }, () => ({ readyState: 1, bufferedAmount: 0, bytes: 0, tokenBytes: 0, frames: 0,
  send(value) { const size = Buffer.byteLength(value); this.bytes += size; this.tokenBytes += size; this.frames++; },
}));
servers[0].clients = new Set(clients);
setWss(servers[0]);
setWsClientStreamFocus(clients[0], ['session-0']);
setWsClientStreamFocus(clients[1], ['session-1']);
setWsClientStreamFocus(clients[2], ['unfocused']);
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
let stringifyMs = 0;
const start = performance.now();
for (let i = 0; i < 6000; i++) {
  const frame = { type: 'main_chat_stream_event', sessionId: `session-${i % 4}`, streamId: 'bench', seq: i + 1,
    event: 'token', data: { text: `token-${i}-` + 'x'.repeat(70) } };
  const before = performance.now();
  JSON.stringify(frame);
  stringifyMs += performance.now() - before;
  broadcastWS(frame);
  if (i % 100 === 99) await new Promise((resolve) => setImmediate(resolve));
}
await new Promise((resolve) => setTimeout(resolve, 15));
delay.disable();
const sample = { bytesPerClient: clients.map(c => c.bytes), unfocusedTokenBytes: clients[2].tokenBytes,
  totalBytes: clients.reduce((n, c) => n + c.bytes, 0), stringifyMs: +stringifyMs.toFixed(2),
  wallMs: +(performance.now() - start).toFixed(2), loopDelayP50Ms: +(delay.percentile(50) / 1e6).toFixed(3),
  loopDelayP99Ms: +(delay.percentile(99) / 1e6).toFixed(3) };
assert.deepEqual(clients.map(c => c.frames), [6000, 6000, 6000], 'baseline broadcasts all tokens to all focused/unfocused clients');
// Existing safe focus filter and tool-boundary exception must still work.
broadcastWS({ type: 'main_chat_stream_event', sessionId: 'session-0', event: 'reasoning_summary_delta', data: { text: 'test' } });
assert.deepEqual(clients.map(c => c.frames), [6001, 6000, 6000]);
broadcastWS({ type: 'main_chat_stream_event', sessionId: 'session-0', event: 'model_stream_event', data: { event: { type: 'tool_call_start' } } });
assert.deepEqual(clients.map(c => c.frames), [6002, 6001, 6001]);
console.log(JSON.stringify({ frames: 6000, tokensPerSecond: 200, simulatedSeconds: 30, clients: 3, ...sample }));
servers[0].close();
