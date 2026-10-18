import assert from 'node:assert/strict';
import {
  ALL_SEARCH_PROVIDER_IDS,
  EXTRA_SEARCH_PROVIDERS,
  EXTRA_SEARCH_SECRET_FIELDS,
  getExtraSearchProvider,
  searchProviderCatalog,
} from './search-provider-registry.js';

// Registry shape.
const ids = EXTRA_SEARCH_PROVIDERS.map((p) => p.id);
assert.deepEqual(new Set(ids).size, ids.length, 'provider ids unique');
for (const id of ['exa', 'serper', 'firecrawl', 'jina', 'linkup', 'serpapi', 'perplexity', 'searxng']) {
  assert.ok(ALL_SEARCH_PROVIDER_IDS.includes(id), `${id} registered`);
}
assert.ok(!EXTRA_SEARCH_SECRET_FIELDS.includes('searxng_url'), 'searxng url is not a vault secret');
assert.ok(EXTRA_SEARCH_SECRET_FIELDS.includes('exa_api_key'));

// Catalog never leaks fetchers and reports configured state.
const cat = searchProviderCatalog((f) => f === 'exa_api_key');
assert.ok(cat.every((p: any) => typeof p.search === 'undefined'));
assert.equal(cat.find((p) => p.id === 'exa')?.configured, true);
assert.equal(cat.find((p) => p.id === 'serper')?.configured, false);
assert.equal(cat.find((p) => p.id === 'ddg')?.configured, true);

// Response normalization with a mocked fetch.
void (async () => {
const realFetch = globalThis.fetch;
const reply = (body: any, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
try {
  globalThis.fetch = reply({ results: [{ title: 'A', url: 'https://a.com', highlights: ['one', 'two'] }, { title: 'bad', url: 'ftp://x' }] }) as any;
  const exa = await getExtraSearchProvider('exa')!.search('q', 5, 'k', 1000);
  assert.deepEqual(exa.map((r) => r.url), ['https://a.com']);
  assert.equal(exa[0].snippet, 'one two');

  globalThis.fetch = reply({ answerBox: { answer: '42', link: 'https://ans.com' }, organic: [{ title: 'O', link: 'https://o.com', snippet: 's' }] }) as any;
  const serper = await getExtraSearchProvider('serper')!.search('q', 5, 'k', 1000);
  assert.deepEqual(serper.map((r) => r.url), ['https://ans.com', 'https://o.com']);

  globalThis.fetch = reply({ success: true, data: { web: [{ title: 'F', url: 'https://f.com', description: 'd' }] } }) as any;
  assert.equal((await getExtraSearchProvider('firecrawl')!.search('q', 5, 'k', 1000))[0].snippet, 'd');

  globalThis.fetch = reply({ results: [{ title: 'S', url: 'https://s.com', content: 'c', engines: ['google', 'bing'] }] }) as any;
  assert.equal((await getExtraSearchProvider('searxng')!.search('q', 5, 'http://localhost:8888/', 1000))[0].publisher, 'google, bing');

  globalThis.fetch = reply({ error: 'nope' }, 402) as any;
  await assert.rejects(getExtraSearchProvider('exa')!.search('q', 5, 'k', 1000), /Exa HTTP 402/);

  globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as any;
  await assert.rejects(getExtraSearchProvider('searxng')!.search('q', 5, 'http://x', 1000), /enable "json"/);
} finally {
  globalThis.fetch = realFetch;
}

console.log('search-provider-registry regression: ok');
})().catch((err) => { console.error(err); process.exit(1); });
