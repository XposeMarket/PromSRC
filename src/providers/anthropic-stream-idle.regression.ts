import assert from 'node:assert/strict';

// Regression: the stream idle watchdog must re-arm per read. The first version
// shared one timer variable, so the first read's timer was never cleared and
// every stream was cut at exactly the idle timeout (2026-09-29: ~121s rounds
// ending as `incomplete_stream` with no output).
process.env.PROMETHEUS_ANTHROPIC_STREAM_IDLE_TIMEOUT_MS = '300';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder();
const line = (e: object) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);

function slowStream(events: object[], gapMs: number, hangAfter = false): Response {
  return new Response(new ReadableStream({
    async start(controller) {
      for (const e of events) {
        controller.enqueue(line(e));
        await sleep(gapMs);
      }
      if (hangAfter) return; // never close: simulate a dead connection
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

const textEvents = (n: number) => [
  { type: 'message_start', message: { usage: { input_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...Array.from({ length: n }, (_, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `t${i} ` } })),
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: n } },
  { type: 'message_stop' },
];

async function main() {
  const { AnthropicAdapter } = await import('./anthropic-adapter');
  const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test' }) as any;

  // 1) A healthy stream that runs ~4x longer than the idle timeout, with every
  //    gap well under it, must complete normally.
  const started = Date.now();
  const long = await adapter.parseStreamingResponse(slowStream(textEvents(12), 100), 'claude-opus-5-5', { onToken: () => {} });
  assert.ok(Date.now() - started > 900, 'stream should outlive the idle timeout');
  assert.equal(long.stopReason, 'end_turn');
  assert.match(String(long.message.content), /t11/);

  // 2) A stream that goes silent must end as incomplete (recoverable), not hang.
  const dead = await adapter.parseStreamingResponse(slowStream(textEvents(2).slice(0, 3), 20, true), 'claude-opus-5-5', { onToken: () => {} });
  assert.equal(dead.stopReason, 'incomplete_stream');

  console.log('anthropic-stream-idle regression: PASS');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
