# Web Researcher

Use this skill for normal web research, current information, source discovery, source verification, and URL fetching.

The default Prometheus research path is:

> `web_search` for discovery → `web_fetch_batch` for several source URLs or `web_fetch` for one URL → answer from fetched evidence.

Do **not** use browser automation for normal reading unless the page is interactive, login-gated, JavaScript-rendered in a way `web_fetch` cannot handle, or the user explicitly asks to operate the website.

---

## Tested Tool Behavior Snapshot — 2026-05-08

These notes came from live tool checks on 2026-05-08.

### `web_search`

Observed behavior:
- Returns a provider banner such as `[Multi-engine: tinyfish+tavily+brave]` when multiple engines are active.
- Current configured default runs multiple providers in parallel. As of the latest test on 2026-05-08, TinyFish is now active alongside Tavily + Brave.
- Earlier observed output before TinyFish was added was `[Multi-engine: tavily+brave]`; after TinyFish was added, repeated broad and targeted queries showed `[Multi-engine: tinyfish+tavily+brave]`.
- Search result quality improved when the query included source targeting such as `site:openai.com/...`.
- Results include title, URL, and snippet. Snippets are useful for triage, but **not enough** for final claims when a source can be fetched.

Default use:
```json
web_search({ "query": "latest official docs for <topic>" })
```

Search and fetch top results in one call:
```json
web_search({ "query": "latest official docs for <topic>", "fetch_top_k": 3, "fetch_max_chars": 4000 })
```

Targeted source search:
```json
web_search({ "query": "site:platform.openai.com/docs/guides/tools-web-search OpenAI web search tool Responses API" })
```

Research rule:
- For complex/current topics, run 2–3 **different** searches, not the same query twice.
- Prefer official docs, primary sources, reputable reporting, then community/social sources.
- Use snippets to choose sources, then fetch the actual pages.

### Google/provider testing correction

Do **not** use `site:google.com`, `site:googleblog.com`, `site:developers.googleblog.com`, or any other Google-owned domain restriction to test whether the Google provider/engine is active.

Why:
- `site:<domain>` restricts results to that domain.
- A query like `site:googleblog.com Google Search latest AI Mode` only proves that the search system can return Google-owned pages.
- It does **not** prove that the Google provider powered the search.

Correct way to check provider behavior:
- Use a normal broad query with no Google-owned `site:` restriction.
- Inspect the returned provider banner/tool metadata, e.g. `[Multi-engine: tavily+brave]`.
- Result domains are not provider proof. Google Search can return non-Google domains, and non-Google providers can return Google-owned domains.

Good provider-test queries:
```text
OpenAI latest model release pricing
latest AI search product announcements May 2026
weather API pricing comparison 2026 official docs
```


### TinyFish added to multi-engine search — 2026-05-08

Live tests after TinyFish was added showed the provider banner:

```text
[Multi-engine: tinyfish+tavily+brave]
```

What changed vs earlier Tavily+Brave-only observations:
- Broad official-source query (`OpenAI GPT-5.1 developer announcement pricing API official`) returned strong official OpenAI docs/pricing/model pages at the top, plus relevant community/X/social corroboration.
- Current AI news query (`latest AI search product announcements May 2026 official`) returned a mixed set: official Google/OpenAI sources, publisher coverage, Reddit, and lower-quality SEO/news pages. This is useful for discovery but still needs fetch verification.
- Weather API/pricing query returned official provider pages and comparison pages, but also one odd `weatherapi.com` current-weather result with raw JSON-like weather data. Treat these as triage signals, not final evidence.
- TinyFish-specific query (`TinyFish web search API provider official`) immediately found official TinyFish docs and site pages. `web_fetch` confirmed TinyFish docs say Search and Fetch do not use credits, Search returns structured titles/snippets/URLs, and Fetch renders pages with a real browser and returns clean extracted text.
- X/status discovery query surfaced X status URLs well in search results. `web_fetch` may still capture `count: 0` for some X URLs even when the search snippet shows tweet text, so X fetch output must be checked separately.
- Local business query returned a useful mix of review sites, the business website, Yelp/HomeAdvisor/Angi, Reddit, and related competitors.

Operational takeaways:
- TinyFish looks useful as a search-breadth upgrade inside the default blended engine.
- It seems especially good for agent/tooling docs, structured docs discovery, X/status URL discovery, and local-business/source discovery.
- Do not claim exact TinyFish-vs-Tavily-vs-Brave attribution from blended results; the current tool output does not label which provider produced each result.
- Do not claim Google provider is active unless the banner/tool metadata shows Google. In these tests the active banner was TinyFish + Tavily + Brave, not Google.

Use `site:` only when intentionally narrowing to a known source/domain for source discovery or verification, not for provider identification.

### `web_fetch` on normal pages

Observed behavior:
- Fetching `https://openai.com/index/gpt-5-1-for-developers/` returned clean article text with headings and body content.
- Fetching OpenAI docs returned a long text extraction including navigation plus the actual docs content.
- Some pages may include large navigation/sidebar text; skim for the content section and cite the fetched page, not every nav item.

Default use:
```json
web_fetch({ "url": "https://example.com/article-or-doc" })
```

Use `web_fetch` when:
- Reading article/documentation pages.
- Verifying a search result.
- Pulling source text from a known URL.
- Avoiding browser overhead for non-interactive research.

### `web_fetch_batch` for multiple URLs

Use `web_fetch_batch` when a search produces several promising URLs and the research answer needs full source text from more than one page.

Default use:
```json
web_fetch_batch({
  "urls": [
    "https://primary-source.example/page",
    "https://secondary-source.example/page"
  ],
  "max_chars": 6000,
  "concurrency": 4
})
```

Batch rules:
- Prefer `web_search({ ..., "fetch_top_k": 2-5 })` when the top results are clearly the ones to read.
- Prefer `web_fetch_batch` when you want to choose exact URLs from search results.
- Keep batches focused: 2-5 URLs for most research, up to 10 for broad source surveys, hard max 20.
- Treat per-URL failures as partial evidence, not total failure; continue from successful fetched pages.
- For X/Twitter status URLs, individual `web_fetch` remains the clearest path unless the user gives several X URLs to inspect.

### `web_fetch` on X/Twitter status URLs

Observed behavior:
- `web_fetch` has X-aware handling for `x.com/.../status/...` URLs.
- It can return structured fields such as `success`, `url`, `count`, `message`, `tweets`, `snapshot_deltas`, `x_media_summary`, and `x_media`.
- For reachable X threads, it captured tweet/thread items and media metadata.
- For media posts, it downloaded media into `downloads/x_fetch_media/...` and automatically analyzed downloaded images/videos.
- Example observed X media fields: `downloaded_files`, `analyses`, `direct_image_candidates`, `video_tweet_candidates`, and `analysis_limited`.
- If the X URL is unavailable/deleted/blocked, it can return `success: true` but `count: 0` and a page message such as “Hmm...this page doesn’t exist.” Treat that as no captured tweets, not as successful content extraction.

Default X fetch:
```json
web_fetch({ "url": "https://x.com/<handle>/status/<id>" })
```

X URL rule:
- For read/fetch/inspect requests on X status URLs, use `web_fetch` first.
- Do not open browser first for a plain X URL fetch.
- If `count > 0`, answer from `tweets` and mention media only when present in `x_media_summary` / `x_media`.
- If `count === 0`, report that the X fetch reached the page but captured no tweets, and include the visible blocker/page message if present.
- Escalate to browser only when the user asks to interact with X, authenticated state matters, or `web_fetch` cannot retrieve enough content.

---

## Tool Choice Matrix

| Job | First tool | Escalate when |
|---|---|---|
| Discover current sources | `web_search` | Try alternate query/source targeting if results are weak |
| Read a known article/doc URL | `web_fetch` | Use browser text extraction if fetch is empty/noisy/JS-blocked |
| Verify facts from search results | `web_search` with `fetch_top_k` or `web_fetch_batch` on selected URLs | Add more sources if claims conflict |
| Fetch/read X status URL | `web_fetch` | Browser only for interaction, auth-specific content, or failed/empty fetch |
| Reddit research | `web_search` with `site:reddit.com` + `fetch_top_k`, or `web_fetch_batch` for selected threads | Browser only for interactive/auth-specific Reddit work |
| JS-heavy page/app | Browser tools (`browser_get_page_text`, snapshot, extraction) | Use `web_fetch` only if it can read the static content |
| Structured extraction/listings | `browser_extract_structured` or `browser_scroll_collect` | Use scraper scripts only if native tools are insufficient |
| Download/analyze files/media from known URLs | media/download tools | Do not use browser if direct URL works |

---

## Standard Research Workflow

### 1. Decide if web research is required

Use web tools when the request depends on:
- latest/current information
- named entities, products, docs, versions, pricing, policies, or releases
- claims that need sourcing
- source discovery
- social/X URL reading

Skip web tools for timeless knowledge or purely conversational replies.

### 2. Search with intent

Bad:
```text
AI news
```

Better:
```text
OpenAI GPT-5.1 developers official announcement API web search tools
```

Best when a source is known:
```text
site:openai.com/index GPT-5.1 developers OpenAI API
site:platform.openai.com/docs/guides/tools-web-search Responses API web_search
```

Important:
- `site:` is for domain/source restriction only.
- Do not use `site:google...` as a Google-provider test.
- If testing provider behavior, remove domain restrictions and inspect the provider banner.

### 3. Fetch the actual source

Never treat a snippet as enough when the source is fetchable.

For one source:
```json
web_fetch({ "url": "https://primary-source.example/page" })
```

For several sources:
```json
web_fetch_batch({ "urls": ["https://source-one.example/page", "https://source-two.example/page"] })
```

### 4. Cross-check when necessary

Cross-check when:
- the claim is high-stakes
- sources conflict
- data may be stale
- search results look SEO-spammy
- the answer affects product, pricing, legal, medical, financial, security, or outreach decisions

### 5. Answer with confidence labels

Use concise source-grounded language:
- “The official docs say…”
- “The fetched page says…”
- “Search found X, but I could not fetch/verify Y…”
- “This appears to be from an X thread; `web_fetch` captured N tweets and M media items…”

---

## Multi-Engine Search Guidance

Prometheus `web_search` may run configured providers in parallel. Observed provider banners:

```text
[Multi-engine: tavily+brave]              # before TinyFish was added
[Multi-engine: tinyfish+tavily+brave]     # after TinyFish was added/tested on 2026-05-08
```

Use this as an operational signal:
- Multi-engine is good for breadth and freshness.
- TinyFish appears to broaden/strengthen the combined result set, especially for agent/web-infrastructure queries, official docs, X/status discovery, and local/business lookups.
- `web_search` supports provider selection and can also fetch top result URLs with `fetch_top_k`; use that for compact search-and-read passes.
- Because the current output is blended multi-engine, compare TinyFish by observing before/after provider banners and result quality, not by claiming exact per-result attribution.
- Compared with the earlier Tavily+Brave-only behavior, TinyFish+Tavily+Brave produced strong official-source results for OpenAI pricing/model docs, found TinyFish's own docs immediately, surfaced X status URLs in search results, and produced useful local business/review/domain results.
- Google provider was not shown in the tested banner. Google as a source/domain can still appear in results; that does not prove Google provider usage.
- Still inspect result domains; multiple engines can return the same SEO junk.
- Re-query with `site:` filters when the exact source matters.
- Re-query with alternate phrasing when results are missing the obvious source.
- Prefer source diversity for research, but prefer official source primacy for exact product/docs claims.
- Provider identity comes from tool metadata/banner, not from returned domains.

Pattern for complex research:
1. Broad current query.
2. Official/source-targeted query.
3. Independent verification query, if needed.
4. Fetch 1–5 best URLs with `fetch_top_k` or `web_fetch_batch`.
5. Synthesize only after fetches return.

---

## X/Twitter Fetch Pattern

Use this when the user says things like:
- “fetch this X post”
- “read this tweet”
- “webfetch this X URL”
- “pull this thread”

Workflow:
1. `web_fetch` the X status URL.
2. Check `count` and `tweets`.
3. Check `x_media_summary` and `x_media.downloaded_files` if media is present.
4. Report captured text/thread/media clearly.
5. If no tweets were captured, say so and include visible blocker/page message.

Do not infer content from the URL or from stale memory.

---

## Browser Escalation Rules

Use browser tools only when:
- interaction is required: login, click, fill, post, filter, checkout, map movement, dynamic UI
- visual inspection is required
- `web_fetch` returns empty, wrong, heavily truncated, or nav-only text
- authenticated browser state matters
- the user explicitly asks to operate the page

For browser reading/extraction, prefer:
- `browser_get_page_text` for visible text
- `browser_extract_structured` for repeated cards/rows
- `browser_scroll_collect` for infinite feeds/search results
- screenshots/snapshots when layout or visual truth matters

---

## Quality Rules

- Search before fetch when you do not already have the best URL.
- Fetch before final answer when making factual claims from the web.
- Prefer primary sources.
- Do not cite or rely on suspicious domains unless the task is specifically about them.
- If a source is inaccessible, say exactly what failed and continue with the closest viable source.
- For high-stakes facts, use at least two independent sources or state that only one source was verified.
- Do not use browser automation just to read ordinary articles/docs.
- Do not call web tools for casual small talk or timeless facts.
- Do not mistake a domain-restricted query for proof of a specific provider.

---

## Quick Examples

### Official docs lookup
```json
web_search({ "query": "site:platform.openai.com/docs/guides/tools-web-search Responses API web_search" })
web_fetch({ "url": "https://platform.openai.com/docs/guides/tools-web-search?api-mode=responses" })
```

### Provider behavior check
```json
web_search({ "query": "OpenAI latest model release pricing" })
```
Then inspect the provider banner/tool metadata. Do not add `site:google...`.

### Current release lookup
```json
web_search({ "query": "OpenAI GPT-5.1 developers official announcement" })
web_fetch({ "url": "https://openai.com/index/gpt-5-1-for-developers/" })
```

### X URL fetch
```json
web_fetch({ "url": "https://x.com/testingcatalog/status/1986937917294391381" })
```

Observed result type: captured thread tweets plus downloaded/analyzed media when media was detected.

---

## Changelog

| Date | Version | Change |
|---|---:|---|
| 2026-06-05 | 1.0.3 | Added `web_fetch_batch` and `web_search({ fetch_top_k })` guidance for batch source fetching and compact search-and-read workflows. |
| 2026-05-08 | 1.0.2 | Added TinyFish multi-engine test notes: confirmed banner changed to `[Multi-engine: tinyfish+tavily+brave]`, documented observed result-quality changes, single-provider limitation, and comparison cautions versus Tavily/Brave/Google. |
| 2026-05-08 | 1.0.1 | Added explicit Google/provider testing correction: never use Google-owned `site:` restrictions as proof of Google provider usage; provider identity must come from tool metadata/banner, not result domains. |
| 2026-05-08 | 1.0.0 | Created dedicated web research/search skill after live testing `web_search`, normal `web_fetch`, docs `web_fetch`, and X-aware `web_fetch` including media download/analysis behavior. |
