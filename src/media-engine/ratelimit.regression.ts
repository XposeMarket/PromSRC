import assert from 'node:assert/strict';
import { isRateLimitError, withRateLimitRetry } from './engine.js';

assert.ok(isRateLimitError(new Error('xAI Grok Imagine video generation failed: {"code":"resource-exhausted"}')));
assert.ok(isRateLimitError('Too many requests for team x'));
assert.ok(isRateLimitError(new Error('API error 429')));
assert.ok(!isRateLimitError(new Error('content moderation rejected')));

void (async () => {
let calls = 0;
const ok = await withRateLimitRetry(async () => { calls++; if (calls < 3) throw new Error('resource-exhausted'); return 'done'; }, 5, 5);
assert.equal(ok, 'done'); assert.equal(calls, 3);

let hard = 0;
await assert.rejects(withRateLimitRetry(async () => { hard++; throw new Error('nsfw'); }, 5, 5), /nsfw/);
assert.equal(hard, 1, 'non-rate-limit errors are not retried');

let capped = 0;
await assert.rejects(withRateLimitRetry(async () => { capped++; throw new Error('429'); }, 3, 5), /429/);
assert.equal(capped, 3, 'gives up after tries');
console.log('ratelimit regression: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
