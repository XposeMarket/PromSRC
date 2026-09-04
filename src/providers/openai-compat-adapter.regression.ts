import assert from 'node:assert/strict';
import { OpenAICompatAdapter } from './openai-compat-adapter';

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

function reasoningStream(reasoningField: string): string[] {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { [reasoningField]: 'Plan' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { [reasoningField]: ' next' } }] })}\n\n`,
    'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
}

async function collect(adapter: OpenAICompatAdapter, chunks: string[]) {
  const thinking: string[] = [];
  const summaries: string[] = [];
  const events: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => sseResponse(chunks);
  try {
    const result = await adapter.chat(
      [{ role: 'user', content: 'hello' }],
      'grok-4.6',
      {
        onToken: () => undefined,
        onThinking: (chunk) => thinking.push(chunk),
        onReasoningSummary: (chunk) => summaries.push(chunk),
        onModelEvent: (event) => events.push(event),
      },
    );
    return { result, thinking, summaries, events };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main(): Promise<void> {
  const grok = await collect(
    new OpenAICompatAdapter({
      providerId: 'xai',
      endpoint: 'https://example.test',
      apiKey: 'test',
    }),
    reasoningStream('reasoning_content'),
  );
  assert.deepEqual(grok.summaries, ['Plan', ' next'], 'Grok reasoning_content must stream as visible summaries');
  assert.deepEqual(grok.thinking, [], 'Grok reasoning summaries must not be routed through private thinking');
  assert.deepEqual(
    grok.events.filter((event) => event.type === 'reasoning_delta').map((event) => event.summary),
    [true, true],
    'Grok normalized reasoning events must retain summary classification',
  );
  assert.equal(grok.result.thinking, 'Plan next', 'Grok reasoning must remain available on the completed result');
  assert.equal(grok.result.message.content, 'Done');

  const otherProvider = await collect(
    new OpenAICompatAdapter({
      providerId: 'openai',
      endpoint: 'https://example.test',
      apiKey: 'test',
    }),
    reasoningStream('reasoning_content'),
  );
  assert.deepEqual(otherProvider.summaries, [], 'non-xAI private reasoning must not become a visible summary');
  assert.deepEqual(otherProvider.thinking, ['Plan', ' next']);
  assert.deepEqual(
    otherProvider.events.filter((event) => event.type === 'reasoning_delta').map((event) => event.summary),
    [false, false],
  );

  console.log('OpenAI-compatible Grok reasoning summary regressions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
