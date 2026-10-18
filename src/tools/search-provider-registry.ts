/**
 * Extra web_search providers, defined in one place.
 *
 * Each entry declares its config field, settings copy and a fetcher that
 * returns normalized results. web.ts, the settings router, config secret
 * migration, prompt context and both settings UIs (via GET /api/settings/search
 * `providers`) all read this list, so adding an engine is a single edit here.
 *
 * The original engines (tinyfish, tavily, google, brave, ddg, xai) keep their
 * bespoke code paths in web.ts.
 */

export type ExtraSearchProviderId =
  | 'exa' | 'serper' | 'firecrawl' | 'jina' | 'linkup' | 'serpapi' | 'perplexity' | 'searxng';

export type ExtraSearchResult = {
  title: string;
  url: string;
  snippet: string;
  imageUrl?: string;
  publisher?: string;
  publishedAt?: string;
};

export type ExtraSearchProvider = {
  id: ExtraSearchProviderId;
  label: string;
  /** Config field under `search.*`. Secret fields are vault-migrated. */
  field: string;
  /** 'key' = secret API key (masked); 'url' = plain base URL (self-hosted). */
  kind: 'key' | 'url';
  placeholder: string;
  signupUrl: string;
  freeTier: string;
  description: string;
  search: (query: string, limit: number, credential: string, timeoutMs: number) => Promise<ExtraSearchResult[]>;
};

async function readJson(res: Response, label: string): Promise<any> {
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 160); } catch { /* ignore */ }
    throw new Error(`${label} HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function clean(items: ExtraSearchResult[], limit: number): ExtraSearchResult[] {
  return items
    .filter((r) => /^https?:\/\//i.test(r.url))
    .map((r) => ({ ...r, title: r.title || r.url, snippet: (r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 600) }))
    .slice(0, limit);
}

export const EXTRA_SEARCH_PROVIDERS: ExtraSearchProvider[] = [
  {
    id: 'exa',
    label: 'Exa',
    field: 'exa_api_key',
    kind: 'key',
    placeholder: 'exa API key',
    signupUrl: 'https://dashboard.exa.ai/api-keys',
    freeTier: '$10 free credit monthly',
    description: 'Neural search built for AI agents; strong for research and docs.',
    async search(query, limit, key, timeoutMs) {
      const data = await readJson(await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query, type: 'auto', numResults: limit, contents: { highlights: { numSentences: 3 } } }),
        signal: AbortSignal.timeout(timeoutMs),
      }), 'Exa');
      return clean((data.results || []).map((r: any) => ({
        title: str(r.title),
        url: str(r.url),
        snippet: Array.isArray(r.highlights) && r.highlights.length ? r.highlights.join(' ') : str(r.summary || r.text),
        imageUrl: r.image || undefined,
        publisher: r.author || undefined,
        publishedAt: r.publishedDate || undefined,
      })), limit);
    },
  },
  {
    id: 'serper',
    label: 'Serper (Google)',
    field: 'serper_api_key',
    kind: 'key',
    placeholder: 'Serper API key',
    signupUrl: 'https://serper.dev/api-key',
    freeTier: '2,500 free queries',
    description: 'Fast Google results (organic, news, answer box).',
    async search(query, limit, key, timeoutMs) {
      const data = await readJson(await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q: query, num: limit }),
        signal: AbortSignal.timeout(timeoutMs),
      }), 'Serper');
      const out: ExtraSearchResult[] = [];
      const box = data.answerBox;
      if (box && (box.link || box.sourceLink)) {
        out.push({ title: str(box.title || 'Answer'), url: str(box.link || box.sourceLink), snippet: str(box.answer || box.snippet) });
      }
      for (const r of data.organic || []) {
        out.push({ title: str(r.title), url: str(r.link), snippet: str(r.snippet), publishedAt: r.date || undefined, imageUrl: r.imageUrl || undefined });
      }
      return clean(out, limit);
    },
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    field: 'firecrawl_api_key',
    kind: 'key',
    placeholder: 'fc-...',
    signupUrl: 'https://www.firecrawl.dev/app/api-keys',
    freeTier: 'free credits monthly',
    description: 'Search plus scraping, good page descriptions.',
    async search(query, limit, key, timeoutMs) {
      const data = await readJson(await fetch('https://api.firecrawl.dev/v2/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, limit, sources: ['web'] }),
        signal: AbortSignal.timeout(timeoutMs),
      }), 'Firecrawl');
      const web = Array.isArray(data?.data?.web) ? data.data.web : Array.isArray(data?.data) ? data.data : [];
      return clean(web.map((r: any) => ({
        title: str(r.title || r.metadata?.title),
        url: str(r.url || r.metadata?.sourceURL),
        snippet: str(r.description || r.snippet || r.markdown),
      })), limit);
    },
  },
  {
    id: 'jina',
    label: 'Jina Search',
    field: 'jina_api_key',
    kind: 'key',
    placeholder: 'jina_...',
    signupUrl: 'https://jina.ai/reader/',
    freeTier: '10M free tokens per key',
    description: 'Search that returns clean page content for each hit.',
    async search(query, limit, key, timeoutMs) {
      const data = await readJson(await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'X-Respond-With': 'no-content' },
        signal: AbortSignal.timeout(Math.max(timeoutMs, 10_000)),
      }), 'Jina');
      return clean((data.data || []).map((r: any) => ({
        title: str(r.title),
        url: str(r.url),
        snippet: str(r.description || r.content),
        publishedAt: r.date || r.publishedTime || undefined,
      })), limit);
    },
  },
  {
    id: 'linkup',
    label: 'Linkup',
    field: 'linkup_api_key',
    kind: 'key',
    placeholder: 'Linkup API key',
    signupUrl: 'https://app.linkup.so/api-keys',
    freeTier: 'free credits monthly',
    description: 'Agent-oriented search with fresh, sourced results.',
    async search(query, limit, key, timeoutMs) {
      const data = await readJson(await fetch('https://api.linkup.so/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ q: query, depth: 'standard', outputType: 'searchResults', maxResults: limit }),
        signal: AbortSignal.timeout(timeoutMs),
      }), 'Linkup');
      return clean((data.results || []).filter((r: any) => !r.type || r.type === 'text').map((r: any) => ({
        title: str(r.name || r.title),
        url: str(r.url),
        snippet: str(r.content),
      })), limit);
    },
  },
  {
    id: 'serpapi',
    label: 'SerpApi (Google)',
    field: 'serpapi_api_key',
    kind: 'key',
    placeholder: 'SerpApi key',
    signupUrl: 'https://serpapi.com/manage-api-key',
    freeTier: '250 free searches monthly',
    description: 'Google SERP data including answer boxes.',
    async search(query, limit, key, timeoutMs) {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${limit}&api_key=${encodeURIComponent(key)}`;
      const data = await readJson(await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }), 'SerpApi');
      if (data.error) throw new Error(`SerpApi: ${str(data.error).slice(0, 160)}`);
      return clean((data.organic_results || []).map((r: any) => ({
        title: str(r.title),
        url: str(r.link),
        snippet: str(r.snippet),
        publisher: r.source || undefined,
        publishedAt: r.date || undefined,
        imageUrl: r.thumbnail || undefined,
      })), limit);
    },
  },
  {
    id: 'perplexity',
    label: 'Perplexity Search',
    field: 'perplexity_api_key',
    kind: 'key',
    placeholder: 'pplx-...',
    signupUrl: 'https://www.perplexity.ai/account/api/keys',
    freeTier: 'paid, pay per request',
    description: 'Perplexity ranked web index (raw results, no LLM answer).',
    async search(query, limit, key, timeoutMs) {
      const data = await readJson(await fetch('https://api.perplexity.ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: limit }),
        signal: AbortSignal.timeout(timeoutMs),
      }), 'Perplexity');
      return clean((data.results || []).map((r: any) => ({
        title: str(r.title),
        url: str(r.url),
        snippet: str(r.snippet),
        publishedAt: r.date || r.last_updated || undefined,
      })), limit);
    },
  },
  {
    id: 'searxng',
    label: 'SearXNG (self-hosted)',
    field: 'searxng_url',
    kind: 'url',
    placeholder: 'http://localhost:8888',
    signupUrl: 'https://docs.searxng.org/admin/installation.html',
    freeTier: 'free, unlimited (you host it)',
    description: 'Open-source metasearch over many engines. Needs JSON format enabled.',
    async search(query, limit, baseUrl, timeoutMs) {
      const base = baseUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 403) throw new Error('SearXNG HTTP 403: enable "json" under search.formats in settings.yml');
      const data = await readJson(res, 'SearXNG');
      return clean((data.results || []).map((r: any) => ({
        title: str(r.title),
        url: str(r.url),
        snippet: str(r.content),
        publisher: Array.isArray(r.engines) ? r.engines.join(', ') : undefined,
        publishedAt: r.publishedDate || undefined,
        imageUrl: r.thumbnail || r.img_src || undefined,
      })), limit);
    },
  },
];

export const EXTRA_SEARCH_PROVIDER_IDS = EXTRA_SEARCH_PROVIDERS.map((p) => p.id);

export function getExtraSearchProvider(id: string): ExtraSearchProvider | undefined {
  return EXTRA_SEARCH_PROVIDERS.find((p) => p.id === id);
}

export function isExtraSearchProviderId(id: string): id is ExtraSearchProviderId {
  return EXTRA_SEARCH_PROVIDER_IDS.includes(id as ExtraSearchProviderId);
}

/** Secret config fields that must be vault-migrated (url-kind fields are not secrets). */
export const EXTRA_SEARCH_SECRET_FIELDS = EXTRA_SEARCH_PROVIDERS.filter((p) => p.kind === 'key').map((p) => p.field);
export const EXTRA_SEARCH_ALL_FIELDS = EXTRA_SEARCH_PROVIDERS.map((p) => p.field);

/** Built-in engines, for UI catalogs. */
export const BUILTIN_SEARCH_PROVIDERS = [
  { id: 'tinyfish', label: 'TinyFish', field: 'tinyfish_api_key', signupUrl: 'https://agent.tinyfish.ai/api-keys', freeTier: 'free tier' },
  { id: 'tavily', label: 'Tavily', field: 'tavily_api_key', signupUrl: 'https://app.tavily.com/home', freeTier: '1,000 free credits monthly' },
  { id: 'google', label: 'Google CSE', field: 'google_api_key', signupUrl: 'https://developers.google.com/custom-search/v1/overview', freeTier: '100 free queries daily' },
  { id: 'brave', label: 'Brave', field: 'brave_api_key', signupUrl: 'https://api-dashboard.search.brave.com/app/keys', freeTier: 'free monthly credit' },
  { id: 'ddg', label: 'DuckDuckGo', field: '', signupUrl: '', freeTier: 'no key needed' },
] as const;

export const ALL_SEARCH_PROVIDER_IDS: string[] = [
  ...BUILTIN_SEARCH_PROVIDERS.map((p) => p.id),
  'xai',
  ...EXTRA_SEARCH_PROVIDER_IDS,
];

/** Public catalog for settings UIs (no secrets). `configured` is filled by the router. */
export function searchProviderCatalog(isConfigured: (field: string) => boolean) {
  return [
    ...BUILTIN_SEARCH_PROVIDERS.map((p) => ({ ...p, kind: p.field ? 'key' : 'none', builtin: true, configured: p.field ? isConfigured(p.field) : true })),
    ...EXTRA_SEARCH_PROVIDERS.map(({ search: _s, ...p }) => ({ ...p, builtin: false, configured: isConfigured(p.field) })),
  ];
}
