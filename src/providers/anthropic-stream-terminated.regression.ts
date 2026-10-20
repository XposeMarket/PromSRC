import assert from 'node:assert/strict';
import { AnthropicAdapter, isTransientStreamTransportError } from './anthropic-adapter';
import { ModelResponseRecovery } from '../gateway/chat/model-response-recovery';

// Pull one SSE frame at a time: erroring in start() would discard queued text.
function droppedStream(error: Error, beforeError?: () => void, empty = false): Response {
  const events = empty ? [] : [
    { type: 'message_start', message: { usage: { input_tokens: 1 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial answer' } },
  ];
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(events[index++])}\n\n`));
      } else {
        beforeError?.();
        controller.error(error);
      }
    },
  }));
}

async function main() {
  for (const message of ['terminated', 'TERMINATED', 'other side closed', 'socket hang up', 'ECONNRESET', 'UND_ERR_SOCKET', 'fetch failed', 'network connection lost']) {
    assert.equal(isTransientStreamTransportError(new TypeError(message)), true, message);
    assert.equal(isTransientStreamTransportError({ message: 'read failed', cause: { message } }), true, `cause: ${message}`);
  }
  assert.equal(isTransientStreamTransportError({ cause: { code: 'UND_ERR_SOCKET' } }), true);
  assert.equal(isTransientStreamTransportError({ cause: { code: 'ECONNRESET' } }), true);
  for (const error of [null, undefined, 'terminated', new Error('parser failed'), new Error('unterminated JSON'), new DOMException('network aborted', 'AbortError'), { message: 'terminated', cause: { name: 'AbortError' } }]) {
    assert.equal(isTransientStreamTransportError(error), false);
  }

  const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test' }) as any;
  const parse = (error: Error, options = {}, beforeError?: () => void, empty = false) =>
    adapter.parseStreamingResponse(droppedStream(error, beforeError, empty), 'claude-opus-5-5', { onToken: () => {}, ...options });
  for (const empty of [false, true]) {
    const tokens: string[] = [];
    const result = await parse(new TypeError('terminated'), { onToken: (text: string) => tokens.push(text) }, undefined, empty);
    assert.equal(result.stopReason, 'incomplete_stream');
    assert.equal(result.incompleteCause, 'no_message_stop');
    assert.equal(result.message.content, empty ? null : 'Partial answer');
    assert.equal(tokens.join(''), empty ? '' : 'Partial answer');
    const recovery = new ModelResponseRecovery();
    assert.equal(recovery.inspect(result.message, result.stopReason, false, result.incompleteCause).action, 'retry');
    assert.equal(recovery.inspect(result.message, result.stopReason, false, result.incompleteCause).action, 'retry');
    assert.equal(recovery.inspect(result.message, result.stopReason, false, result.incompleteCause).action, 'exhausted');
  }
  const protocolError = new Error('parser failed');
  await assert.rejects(parse(protocolError), error => error === protocolError);
  const abort = new DOMException('network aborted', 'AbortError');
  await assert.rejects(parse(abort), error => error === abort);
  const controller = new AbortController();
  const terminated = new TypeError('terminated');
  await assert.rejects(parse(terminated, { abortSignal: controller.signal }, () => controller.abort()), error => error === terminated);
  console.log('anthropic-stream-terminated regression: PASS');
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
