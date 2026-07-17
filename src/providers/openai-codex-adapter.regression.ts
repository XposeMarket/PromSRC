import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CodexIncompleteStreamError, OpenAICodexAdapter } from './openai-codex-adapter';

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function parse(chunks: string[]) {
  const adapter = new OpenAICodexAdapter(process.cwd());
  return (adapter as any).parseSSEStream(sseResponse(chunks), 'gpt-5.6-sol');
}

async function main(): Promise<void> {
  const completedTextEvent = JSON.stringify({
    type: 'response.completed',
    response: {
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Actual final response.' }] }],
      usage: { input_tokens: 10, output_tokens: 4 },
    },
  });

  const trailing = await parse([`data: ${completedTextEvent}`]);
  assert.equal(trailing.message.content, 'Actual final response.', 'an unterminated final SSE line must be parsed');

  await assert.rejects(
    () => parse(['data: {"type":"response.output_text.delta","delta":"partial"}\n\n']),
    (error: unknown) => error instanceof CodexIncompleteStreamError
      && /before response\.completed/.test(error.message),
    'a stream that closes before response.completed must be retryable failure, not a partial final',
  );

  await assert.rejects(
    () => parse(['data: {"type":"response.completed","response":{"output":[]}}\n\n']),
    (error: unknown) => error instanceof CodexIncompleteStreamError
      && /no assistant text or tool calls/.test(error.message),
    'an empty completed response must be retryable failure',
  );

  const toolCall = await parse([
    'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"example","arguments":""}}\n\n',
    'data: {"type":"response.completed","response":{"output":[{"type":"function_call","call_id":"call_1","name":"example","arguments":"{\\"ok\\":true}"}]}}\n\n',
  ]);
  assert.equal(toolCall.message.tool_calls?.[0]?.id, 'call_1', 'completed tool calls must remain valid output');
  assert.equal(toolCall.message.tool_calls?.[0]?.function.arguments, '{"ok":true}');

  const adapterSource = fs.readFileSync('src/providers/openai-codex-adapter.ts', 'utf8');
  assert.match(adapterSource, /allowIncompleteStreamRetry\s*=\s*true/, 'incomplete streams must have a one-retry guard');
  assert.match(adapterSource, /return runRequest\(requestedModel, allowFallback, fallbackFrom, fallbackReason, false\)/, 'the retry must disable itself after one attempt');

  const chatSource = fs.readFileSync('src/gateway/routes/chat.router.ts', 'utf8');
  const fallbackStart = chatSource.indexOf('if (!finalText || finalText.length < 5)');
  const fallbackEnd = chatSource.indexOf('if (greetingLikeTurn', fallbackStart);
  assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'missing-final fallback block must exist');
  const fallbackBlock = chatSource.slice(fallbackStart, fallbackEnd);
  assert.match(fallbackBlock, /No final response was generated\. Please retry\./, 'missing finals must be reported explicitly');
  assert.doesNotMatch(fallbackBlock, /allToolResults|\.result\b|`Done\./, 'missing finals must never synthesize prose from tool results');

  console.log('openai-codex empty-final regressions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
