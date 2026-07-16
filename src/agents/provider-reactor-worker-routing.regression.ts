import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OllamaClient } from './ollama-client';
import type { LLMProvider } from '../providers/LLMProvider';
import {
  ModelCallWorkerError,
  shouldSuppressModelCallRetry,
} from '../gateway/process/model-call-worker-pool';

const source = fs.readFileSync(path.join(__dirname, 'provider-reactor.ts'), 'utf8');

assert.match(
  source,
  /callProviderGenerateRaw\(this\.provider,\s*prompt,\s*this\.model/,
  'explicit-provider generate calls must use the shared isolated model runtime',
);
assert.match(
  source,
  /callProviderChatRaw\(this\.provider,\s*messages,\s*model/,
  'explicit-provider chat calls must use the shared isolated model runtime',
);
assert.doesNotMatch(
  source,
  /this\.provider\.(?:chat|generate)\s*\(/,
  'ProviderReactorClient must not bypass model-call isolation',
);
assert.match(
  source,
  /shouldSuppressModelCallRetry\(err\)/,
  'ambiguous post-dispatch failures must bypass the legacy retry loop',
);
assert.equal(
  shouldSuppressModelCallRetry(new ModelCallWorkerError('provider rejected', 'MODEL_CALL_FAILED', false, true)),
  false,
  'definite provider errors retain the established retry behavior',
);
assert.equal(
  shouldSuppressModelCallRetry(new ModelCallWorkerError('worker crashed', 'WORKER_EXITED', false, true)),
  true,
  'ambiguous worker exits must not duplicate a possibly billable call',
);
assert.equal(
  shouldSuppressModelCallRetry(new ModelCallWorkerError('timeout', 'MODEL_CALL_TIMEOUT', false, true)),
  true,
  'ambiguous timeouts must not duplicate a possibly billable call',
);

async function verifyDirectFallbackEquivalence(): Promise<void> {
  let chatOptions: any;
  let generateOptions: any;
  const observed: string[] = [];
  const provider: LLMProvider = {
    id: 'custom-regression',
    async chat(_messages, _model, options) {
      chatOptions = options;
      options?.onToken?.('direct-token');
      options?.onThinking?.('direct-thinking');
      options?.onReasoningSummary?.('direct-summary');
      options?.onModelEvent?.({ type: 'provider_event', nativeType: 'direct-regression' });
      return { message: { role: 'assistant', content: 'direct-chat' }, thinking: 'direct-thinking' };
    },
    async generate(_prompt, _model, options) {
      generateOptions = options;
      return { response: 'direct-generate', thinking: 'direct-thinking' };
    },
    async listModels() { return []; },
    async testConnection() { return true; },
  };
  const client = new OllamaClient();
  const chat = await client.callProviderChatRaw(provider, [{ role: 'user', content: 'hello' }], 'direct-model', {
    temperature: 0.3,
    num_ctx: 4096,
    num_predict: 123,
    think: 'medium',
    tools: [{ type: 'function', function: { name: 'direct_tool' } }],
    omitIntradayNotes: true,
    onToken: (value) => observed.push(`token:${value}`),
    onThinking: (value) => observed.push(`thinking:${value}`),
    onReasoningSummary: (value) => observed.push(`summary:${value}`),
    onModelEvent: (value) => observed.push(`event:${value.type}`),
  });
  assert.equal(chat.message.content, 'direct-chat');
  assert.equal(chatOptions.max_tokens, 123);
  assert.equal(chatOptions.num_ctx, 4096);
  assert.equal(chatOptions.tools[0].function.name, 'direct_tool');
  assert.equal(chatOptions.omitIntradayNotes, true);
  assert.deepEqual(observed, [
    'token:direct-token',
    'thinking:direct-thinking',
    'summary:direct-summary',
    'event:provider_event',
  ]);

  const generated = await client.callProviderGenerateRaw(provider, 'hello', 'direct-model', {
    temperature: 0.2,
    num_ctx: 2048,
    num_predict: 77,
    think: 'low',
    format: 'json',
    system: 'system',
  });
  assert.equal(generated.response, 'direct-generate');
  assert.equal(generateOptions.max_tokens, 77);
  assert.equal(generateOptions.num_ctx, 2048);
  assert.equal(generateOptions.format, 'json');
  assert.equal(generateOptions.system, 'system');
}

void verifyDirectFallbackEquivalence()
  .then(() => console.log('provider-reactor worker routing regression: ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
