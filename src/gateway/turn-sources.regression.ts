import assert from 'node:assert/strict';
import { buildTurnSourcesArtifact, collectFetchedSources } from './turn-sources.js';
import { decodeNumericHtmlEntities, validateXFetchPayload } from '../tools/web.js';

// Single fetch with preview metadata + failed single fetch ignored.
const single = { name: 'web_fetch', args: { url: 'https://www.rtings.com/kb' }, result: 'ok', error: false, data: { title: 'Best Budget Keyboards', publisher: 'RTINGS.com' } };
const failed = { name: 'web_fetch', args: { url: 'https://www.reuters.com/x' }, result: 'HTTP 401', error: true };
// Batch: one ok (X post), one error; duplicate of the single fetch is deduped.
const batch = {
  name: 'web_fetch', args: { urls: ['https://x.com/jack/status/20', 'https://bad.example/', 'https://www.rtings.com/kb/'] }, error: false,
  result: '[1] https://x.com/jack/status/20\n{}\n\n---\n\n[2] ERROR https://bad.example/\nfail',
  data: { results: [
    { url: 'https://x.com/jack/status/20', status: 'ok', data: { tweets: [{ handle: '@jack', text: 'just setting up my twttr' }] } },
    { url: 'https://bad.example/', status: 'error' },
    { url: 'https://www.rtings.com/kb/', status: 'ok', data: {} },
  ] },
};
const other = { name: 'web_search', args: { query: 'x' }, result: 'r', error: false };

const items = collectFetchedSources([single, failed, batch, other]);
assert.equal(items.length, 2);
assert.equal(items[0].title, 'Best Budget Keyboards');
assert.equal(items[1].title, '@jack: just setting up my twttr');

const art = buildTurnSourcesArtifact([single, batch]);
assert.equal(art?.layout, 'pills');
assert.equal(art?.items.length, 2);
// Already shown by show_sources -> not repeated.
assert.equal(buildTurnSourcesArtifact([single], [{ type: 'sources', items: [{ url: 'https://www.rtings.com/kb' }] }]), null);
assert.equal(buildTurnSourcesArtifact([other]), null);

assert.equal(decodeNumericHtmlEntities('Anthropic&#x27;s &#8220;hub&#8221; &amp;'), 'Anthropic\'s \u201chub\u201d &amp;');
assert.match(String(validateXFetchPayload({ success: true, url: 'https://x.com/AnthropicAI', tweets: [], count: 0 }, 'https://x.com/AnthropicAI')), /login-gated/);
assert.equal(validateXFetchPayload({ success: true, url: 'https://x.com/a', tweets: [{ id: '1' } as any], count: 1 }, 'https://x.com/a'), null);

console.log('turn-sources regression: ok');
