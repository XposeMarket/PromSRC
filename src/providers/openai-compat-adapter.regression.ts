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
  const astra = new OpenAICompatAdapter({
    providerId: 'openai',
    endpoint: 'https://api.openai.com',
    apiKey: 'test',
  });
  const originalFetch = globalThis.fetch;
  try {
    // Both callback-based chat and background callers must use Responses for
    // Astra tools, preserve reasoning/speed, and omit unsupported sampling.
    for (const stream of [false, true]) {
      const tokens: string[] = [];
      let requestBody: any;
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), 'https://api.openai.com/v1/responses');
        requestBody = JSON.parse(String(init?.body));
        return sseResponse([
          'data: {"type":"response.output_text.delta","delta":"Checking"}\n\n',
          `data: ${JSON.stringify({ type: 'response.completed', response: {
            output: [{ type: 'function_call', call_id: 'call_astra', name: 'lookup', arguments: '{"key":"status"}' }],
            usage: { input_tokens: 20, output_tokens: 8, input_tokens_details: { cached_tokens: 5 } },
          } })}\n\n`,
        ]);
      };
      const result = await astra.chat([{ role: 'user', content: 'Check status' }], 'gpt-6-astra', {
        think: 'max',
        speed: 'fast',
        temperature: 0.2,
        max_tokens: 2048,
        ...(stream ? { onToken: (token: string) => tokens.push(token) } : {}),
        tools: [{ type: 'function', function: { name: 'lookup', description: 'Look up status', parameters: { type: 'object', properties: { key: { type: 'string' } } } } }],
      });
      assert.equal(requestBody.model, 'gpt-6-astra');
      assert.equal(requestBody.reasoning.effort, 'max');
      assert.equal(requestBody.service_tier, 'priority');
      assert.equal(requestBody.max_output_tokens, 2048);
      assert.ok(!('temperature' in requestBody));
      assert.equal(requestBody.tools[0].name, 'lookup');
      assert.equal(result.message.tool_calls?.[0].id, 'call_astra');
      assert.equal(result.message.tool_calls?.[0].function.arguments, '{"key":"status"}');
      assert.equal(result.usage?.inputTokens, 20);
      assert.equal(result.usage?.outputTokens, 8);
      assert.deepEqual(tokens, stream ? ['Checking'] : []);

      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.ok(body.input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'call_astra' && item.output === 'Ready'));
        return sseResponse(['data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Ready to go."}]}]}}\n\n']);
      };
      const final = await astra.chat([
        { role: 'user', content: 'Check status' },
        result.message,
        { role: 'tool', tool_call_id: 'call_astra', content: 'Ready' },
      ], 'gpt-6-astra');
      assert.equal(final.message.content, 'Ready to go.');
    }

    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      assert.ok(!('temperature' in body));
      assert.ok(!('max_tokens' in body));
      assert.equal(body.max_completion_tokens, 2048);
      assert.equal(body.reasoning_effort, 'high');
      assert.deepEqual(body.response_format, { type: 'json_object' });
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    };
    const generated = await astra.generate('Return JSON', 'gpt-6-astra', { format: 'json', think: 'high', max_tokens: 2048 });
    assert.equal(generated.response, '{"ok":true}');
  } finally {
    globalThis.fetch = originalFetch;
  }

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

  console.log('OpenAI-compatible Astra request routing and Grok reasoning summary regressions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
