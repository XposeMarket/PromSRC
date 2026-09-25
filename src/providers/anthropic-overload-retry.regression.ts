import assert from 'node:assert/strict';
import {
  AnthropicAdapter,
  ANTHROPIC_OVERLOAD_MAX_RETRIES,
  isAnthropicOverloadResponse,
  isAnthropicOverloadStreamError,
} from './anthropic-adapter';

// 2026-09-25: a 7m28s Vita turn died on "anthropic stream error:
// overloaded_error: Overloaded". Overload is Anthropic capacity, not the
// request, so the adapter must back off and resend: on HTTP 529 always, and on
// an SSE overloaded_error only while nothing user-visible has streamed yet.

const OVERLOAD_BODY = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';

function oauthAdapter(): AnthropicAdapter {
  const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test' });
  (adapter as any).directConfig = undefined;
  (adapter as any).buildHeaders = () => ({
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    Authorization: 'Bearer test',
  });
  return adapter;
}

function okJson(): Response {
  return new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function sse(events: any[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const OK_STREAM = [
  { type: 'message_start', message: { usage: { input_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
  { type: 'message_stop' },
];
const OVERLOAD_EVENT = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };

async function main() {
  assert.equal(isAnthropicOverloadResponse(529, ''), true);
  assert.equal(isAnthropicOverloadResponse(500, OVERLOAD_BODY), true);
  assert.equal(isAnthropicOverloadResponse(400, '{"error":{"type":"invalid_request_error"}}'), false);
  assert.equal(isAnthropicOverloadStreamError('anthropic stream error: overloaded_error: Overloaded'), true);
  assert.equal(isAnthropicOverloadStreamError('anthropic stream error: api_error: boom'), false);

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void) => originalSetTimeout(fn, 0);
  try {
    // 1) HTTP 529 twice then OK -> succeeds after 3 calls.
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return calls <= 2 ? new Response(OVERLOAD_BODY, { status: 529 }) : okJson(); };
    const r1 = await oauthAdapter().chat([{ role: 'user', content: 'hi' }], 'claude-opus-5-5');
    assert.equal(calls, 3);
    assert.equal((r1 as any).message?.content, 'ok');

    // 2) 529 forever -> bounded retries, then throws.
    calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response(OVERLOAD_BODY, { status: 529 }); };
    await assert.rejects(oauthAdapter().chat([{ role: 'user', content: 'hi' }], 'claude-opus-5-5'), /529/);
    assert.equal(calls, ANTHROPIC_OVERLOAD_MAX_RETRIES + 1);

    // 3) SSE overloaded before any output -> replayed, caller sees one clean answer.
    calls = 0;
    let tokens = '';
    globalThis.fetch = async () => { calls += 1; return calls === 1 ? sse([{ type: 'message_start', message: { usage: {} } }, OVERLOAD_EVENT]) : sse(OK_STREAM); };
    const r3 = await oauthAdapter().chat([{ role: 'user', content: 'hi' }], 'claude-opus-5-5', { onToken: (t: string) => { tokens += t; } } as any);
    assert.equal(calls, 2);
    assert.equal(tokens, 'hello');
    assert.equal((r3 as any).message?.content, 'hello');

    // 4) SSE overloaded AFTER text streamed -> not replayed (would duplicate output).
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return sse([
        { type: 'message_start', message: { usage: {} } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } },
        OVERLOAD_EVENT,
      ]);
    };
    await assert.rejects(
      oauthAdapter().chat([{ role: 'user', content: 'hi' }], 'claude-opus-5-5', { onToken: () => {} } as any),
      /overloaded_error/,
    );
    assert.equal(calls, 1, 'must not replay after visible output');
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as any).setTimeout = originalSetTimeout;
  }
  console.log('anthropic-overload-retry regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
