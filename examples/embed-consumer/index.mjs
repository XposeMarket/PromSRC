// A separate Node project embedding Prometheus. It only touches the public
// entry point `prometheus/embed` (dist/embed/index.js) and its documented API.
//
//   cd examples/embed-consumer && npm install && node index.mjs
//
// It uses a tiny offline "model" so it runs anywhere (CI included) without an
// API key. Swap `provider` out (or omit it and configure a real provider in
// dataDir) to run against a real model.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { createPrometheusRuntime, EMBED_API_VERSION } = require('prometheus/embed');

// An LLMProvider: on the first call it asks for our tool, then answers using its result.
const provider = {
  id: 'example-offline',
  calls: 0,
  async chat(messages, _model, options = {}) {
    this.calls += 1;
    const toolMsg = [...messages].reverse().find((m) => m.role === 'tool');
    if (!toolMsg) {
      const offered = (options.tools || []).map((t) => t.function?.name || t.name);
      assert.ok(offered.includes('lookup_order'), 'the embedded tool is offered to the model');
      return {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup_order', arguments: JSON.stringify({ id: 42 }) } }],
        },
        stopReason: 'tool_use',
      };
    }
    const text = `Order status: ${String(toolMsg.content)}`;
    options.onToken?.(text);
    return { message: { role: 'assistant', content: text }, stopReason: 'end_turn' };
  },
  async generate(prompt) { return { response: String(prompt).slice(0, 16) }; },
  async listModels() { return [{ name: 'example-offline' }]; },
  async testConnection() { return true; },
};

const events = [];
const runtime = await createPrometheusRuntime({ provider });
try {
  runtime.registerTool({
    name: 'lookup_order',
    description: 'Look up an order by numeric id.',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    readOnly: true,
    execute: async ({ id }) => `order ${id} shipped on Oct 9`,
  });

  const run = await runtime.runTurn('Where is order 42?', { onEvent: (e) => events.push(e.type) });

  assert.equal(EMBED_API_VERSION, 1);
  assert.match(run.text, /order 42 shipped on Oct 9/);
  assert.deepEqual(run.toolResults.map((r) => r.name), ['lookup_order']);
  assert.equal(run.aborted, false);
  assert.ok(events.includes('tool_call') && events.includes('tool_result'), `events streamed: ${[...new Set(events)].join(',')}`);

  // Cancellation: abort before the model answers.
  const controller = new AbortController();
  const slow = { ...provider, async chat(_m, _model, options = {}) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 5_000);
      options.abortSignal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
    return { message: { role: 'assistant', content: 'too late' } };
  } };
  // A runtime is single-use per provider; close it and start another with the slow model.
  await runtime.close();
  const rt2 = await createPrometheusRuntime({ provider: slow });
  const started = Date.now();
  setTimeout(() => controller.abort(), 300);
  const cancelled = await rt2.runTurn('Take your time', { signal: controller.signal });
  assert.ok(Date.now() - started < 4_000, 'cancel ended the turn promptly');
  assert.notEqual(cancelled.text, 'too late');
  await rt2.close();

  console.log(`embed-consumer: ok (answer="${run.text}", ${provider.calls} model calls, cancel in ${Date.now() - started}ms)`);
} finally {
  await runtime.close();
}
process.exit(0);
