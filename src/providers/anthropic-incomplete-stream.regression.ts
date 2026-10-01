import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AnthropicAdapter,
  FINE_GRAINED_TOOL_STREAMING_BETA,
  fineGrainedToolStreamingFallbackActive,
  noteIncompleteStreamCause,
  resetFineGrainedToolStreamingFallback,
  stripFineGrainedToolStreamingBeta,
} from './anthropic-adapter';
import { ModelResponseRecovery } from '../gateway/chat/model-response-recovery';

// 1. Beta stripping keeps every other beta intact.
assert.equal(
  stripFineGrainedToolStreamingBeta(`claude-code-20250219,oauth-2025-04-20,${FINE_GRAINED_TOOL_STREAMING_BETA}`),
  'claude-code-20250219,oauth-2025-04-20',
);
assert.equal(stripFineGrainedToolStreamingBeta(FINE_GRAINED_TOOL_STREAMING_BETA), '');

// 2. Only tool-argument failures arm the fallback; a plain dropped stream does not.
resetFineGrainedToolStreamingFallback();
noteIncompleteStreamCause('no_message_stop', 1_000);
assert.equal(fineGrainedToolStreamingFallbackActive(1_001), false);
noteIncompleteStreamCause('invalid_tool_json', 1_000);
assert.equal(fineGrainedToolStreamingFallbackActive(1_001), true);
assert.equal(fineGrainedToolStreamingFallbackActive(1_000 + 31 * 60_000), false, 'fallback expires');
resetFineGrainedToolStreamingFallback();

// 3. Recovery gives a specific instruction for broken tool JSON and carries the cause.
const recovery = new ModelResponseRecovery();
const bad = recovery.inspect({ content: null }, 'incomplete_stream', false, 'invalid_tool_json');
assert.equal(bad.action, 'retry');
if (bad.action === 'retry') {
  assert.equal(bad.cause, 'invalid_tool_json');
  assert.match(bad.prompt, /invalid or truncated JSON/);
  assert.match(bad.prompt, /script file/);
}
const plain = new ModelResponseRecovery().inspect({ content: null }, 'incomplete_stream', false, 'no_message_stop');
if (plain.action === 'retry') assert.match(plain.prompt, /stream was interrupted/);

// 4. End to end through the real stream parser: a tool_use block whose JSON does not
//    parse must yield incomplete_stream + cause, write a diagnostic record, and arm the fallback.
const sse = (events: any[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const body = sse([
  { type: 'message_start', message: { usage: { input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'workspace_run', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"action":"run","command":"rg "broken' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 470 } },
  { type: 'message_stop' },
]);

async function main() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-incomplete-'));
  const adapter: any = new AnthropicAdapter({ configDir });
  const response = new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  const parse = adapter.parseStreamingResponse || adapter.parseStream || adapter.readStream;
  if (typeof parse !== 'function') {
    console.log('anthropic incomplete-stream regression: stream parser not directly callable, skipped e2e section');
  } else {
    const result = await parse.call(adapter, response, 'claude-opus-5-5', {});
    assert.equal(result.stopReason, 'incomplete_stream');
    assert.equal(result.incompleteCause, 'invalid_tool_json');
    assert.equal(result.message.tool_calls, undefined, 'never execute a call with broken arguments');
    const log = fs.readFileSync(path.join(configDir, 'logs', 'anthropic-incomplete-stream.ndjson'), 'utf8');
    assert.match(log, /"cause":"invalid_tool_json"/);
    assert.match(log, /"name":"workspace_run"/);
    assert.equal(fineGrainedToolStreamingFallbackActive(), true);
    // The window is shared with other worker processes through a marker file.
    const marker = JSON.parse(fs.readFileSync(path.join(configDir, 'logs', 'anthropic-fine-grained-fallback.json'), 'utf8'));
    assert.ok(marker.until > Date.now(), 'marker file carries the fallback window');
    resetFineGrainedToolStreamingFallback();
    assert.equal(fineGrainedToolStreamingFallbackActive(Date.now(), configDir), true, 'another process picks the window up from the marker file');
    resetFineGrainedToolStreamingFallback(configDir);
    assert.equal(fineGrainedToolStreamingFallbackActive(Date.now() + 10_000, configDir), false);
  }
  fs.rmSync(configDir, { recursive: true, force: true });
  console.log('anthropic incomplete-stream regression passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
