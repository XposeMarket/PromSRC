import assert from 'node:assert/strict';

const { executeWebFetch, webFetchTool } = await import('../dist/tools/web.js');
const url = process.env.PROMETHEUS_X_SMOKE_URL || 'https://x.com/NASA/status/2040963193049055469';
assert(webFetchTool.jsonSchema.properties.include_media, 'web_fetch must expose explicit media opt-in');
assert(webFetchTool.jsonSchema.properties.include_thread, 'web_fetch must expose explicit thread opt-in');
const result = await executeWebFetch({ url, max_chars: 20_000, include_media: false });

assert.equal(result.success, true, result.error || result.stdout || 'X fetch failed');
assert.equal(result.data?.success, true);
assert.equal(Array.isArray(result.data?.tweets), true);
assert.equal(result.data.tweets.length > 0, true, 'X returned no extracted posts');
assert.equal(Number(result.data.count) > 0, true);

const targetId = new URL(url).pathname.match(/\/status\/(\d+)/)?.[1];
const target = targetId
  ? result.data.tweets.find((tweet) => String(tweet.id) === targetId)
  : result.data.tweets[0];
assert(target, 'target status was not extracted');
assert(String(target.text || '').trim(), 'target post must contain text');
assert(String(target.handle || target.author || '').trim(), 'target post must contain author identity');
assert.equal(result.data.x_media, undefined, 'simple X fetch must not start a media workflow');

console.log(`X live smoke test passed: captured ${result.data.tweets.length} post(s) from ${url}`);
