import assert from 'node:assert/strict';
import { orderXaiAccountIds, isXaiCredentialFailure } from './xai-account-pool';
import { OpenAICompatAdapter } from '../providers/openai-compat-adapter';

const accounts = {
  exhausted: { label: 'Exhausted' },
  funded: { label: 'Funded' },
  third: { label: 'Third' },
};

assert.deepEqual(
  orderXaiAccountIds(accounts, 'exhausted', 'funded'),
  ['exhausted', 'funded', 'third'],
  'selected account must be attempted first, followed by provider default and remaining accounts',
);
assert.deepEqual(
  orderXaiAccountIds(accounts, undefined, 'funded'),
  ['funded', 'exhausted', 'third'],
  'provider default must lead when there is no explicit selection',
);
assert.equal(isXaiCredentialFailure(429, ''), true);
assert.equal(isXaiCredentialFailure(400, 'Your team has insufficient credits remaining'), true);
assert.equal(isXaiCredentialFailure(400, 'Unknown model'), false);

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const attemptedAuth: string[] = [];
  let callCount = 0;
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
  callCount += 1;
  attemptedAuth.push(new Headers(init?.headers).get('Authorization') || '');
  if (callCount === 1) {
    return new Response(JSON.stringify({ error: { message: 'Insufficient credits' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'fallback worked' } }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const adapter = new OpenAICompatAdapter({
      endpoint: 'https://api.x.ai',
      providerId: 'xai',
      getAuthCandidates: async () => [
        { token: 'xai-exhausted', label: 'Exhausted' },
        { token: 'xai-funded', label: 'Funded' },
      ],
    });
    const result = await adapter.chat([{ role: 'user', content: 'hello' }], 'grok-test', { max_tokens: 10 });
    assert.equal(result.message.content, 'fallback worked');
    assert.deepEqual(attemptedAuth, ['Bearer xai-exhausted', 'Bearer xai-funded']);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main()
  .then(() => console.log('xAI account pool regression checks passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
