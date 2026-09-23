import assert from 'node:assert/strict';
import { AnthropicAdapter, isOutOfExtraUsageError } from './anthropic-adapter';

// Anthropic intermittently bills a single setup-token request to extra usage
// and rejects it ("out of extra usage") while the next identical request is
// billed to the plan. The adapter must retry exactly once, keep the Claude
// Code preamble first on the retry, and not retry other 400s.

const EXTRA_USAGE_BODY = JSON.stringify({
  type: 'error',
  error: { type: 'invalid_request_error', message: "You're out of extra usage. Add more at claude.ai/settings/usage and keep going." },
});
const PREAMBLE = "You are Claude Code, Anthropic's official CLI for Claude.";

function okResponse(): Response {
  return new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function oauthAdapter(): AnthropicAdapter {
  const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test' });
  // Simulate the setup-token (OAuth) path without touching the vault.
  (adapter as any).directConfig = undefined;
  (adapter as any).buildHeaders = () => ({
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    Authorization: 'Bearer test',
  });
  return adapter;
}

async function main() {
  assert.equal(isOutOfExtraUsageError(EXTRA_USAGE_BODY), true);
  assert.equal(isOutOfExtraUsageError('{"error":{"message":"prompt is too long"}}'), false);

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  // Skip the real retry delay.
  (globalThis as any).setTimeout = (fn: () => void) => originalSetTimeout(fn, 0);
  try {
    // 1) extra-usage rejection then success -> retried once, succeeds.
    const bodies: any[] = [];
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      calls += 1;
      return calls === 1 ? new Response(EXTRA_USAGE_BODY, { status: 400 }) : okResponse();
    };
    const result = await oauthAdapter().chat([{ role: 'user', content: 'hi' }], 'claude-opus-5-5');
    assert.equal(calls, 2, 'extra-usage rejection must be retried exactly once');
    assert.equal((result as any).message?.content ?? (result as any).content, 'ok');
    for (const body of bodies) {
      assert.equal(body.system?.[0]?.text, PREAMBLE, 'retry must keep the Claude Code preamble first');
    }
    assert.deepEqual(bodies[0], bodies[1], 'retry must send the identical request');

    // 2) extra-usage twice -> one retry only, then throws.
    calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response(EXTRA_USAGE_BODY, { status: 400 }); };
    await assert.rejects(
      oauthAdapter().chat([{ role: 'user', content: 'hi' }], 'claude-opus-5-5'),
      /out of extra usage/,
    );
    assert.equal(calls, 2, 'must not retry more than once');

    // 3) unrelated 400 -> no retry.
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}', { status: 400 });
    };
    await assert.rejects(oauthAdapter().chat([{ role: 'user', content: 'hi' }], 'claude-opus-5-5'), /prompt is too long/);
    assert.equal(calls, 1, 'other 400s must not be retried');
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as any).setTimeout = originalSetTimeout;
  }
  console.log('anthropic-extra-usage-retry regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
