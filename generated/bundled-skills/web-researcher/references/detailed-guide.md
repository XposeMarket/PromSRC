# Detailed guide

This reference preserves the full operating detail that was moved out of the concise skill entrypoint during the catalog migration. Read only the sections needed for the current task.

# Web Researcher

Use this skill for normal web research, current information, source discovery, source verification, and URL fetching.

The default Prometheus research path is:

> `web_search` for discovery → `web_fetch_batch` for several source URLs or `web_fetch` for one URL → answer from fetched evidence.

Do **not** use browser automation for normal reading unless the page is interactive, login-gated, JavaScript-rendered in a way `web_fetch` cannot handle, or the user explicitly asks to operate the website.

---

## Multi-Engine Search Notes

`web_search` runs multiple configured providers in parallel and returns a provider banner, e.g. `[Multi-engine: tinyfish+tavily+brave]`. Durable rules:

- Treat the banner as an operational signal for breadth/freshness, not as proof of any single provider's contribution — blended output does not label which provider produced which result.
- Never use a Google-owned `site:` restriction (`site:google.com`, `site:googleblog.com`, etc.) to test whether the Google provider is active. `site:<domain>` only proves the search system *can* return pages from that domain — it does not prove which provider powered the search. To check provider behavior, run a normal broad query with no domain restriction and read the returned banner/tool metadata instead.
- Result domains are never provider proof in either direction — any provider can return any domain.
- Snippets are for triage only; fetch the actual page before making a factual claim, whenever the source is fetchable.

Full historical test notes (TinyFish rollout observations, specific query examples) are archived in `references/background/tested-tool-behavior-snapshot.md` if deeper context is ever needed.

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

Batch rules:
- Prefer `web_search({ ..., "fetch_top_k": 2-5 })` when the top results are clearly the ones to read.
- Prefer `web_fetch_batch` when you want to choose exact URLs from search results.
- Keep batches focused: 2-5 URLs for most research, up to 10 for broad source surveys, hard max 20.
- Treat per-URL failures as partial evidence, not total failure; continue from successful fetched pages.
- For X/Twitter status URLs, individual `web_fetch` remains the clearest path unless the user gives several X URLs to inspect.

### 4. Cross-check when necessary

Cross-check when:
- the claim is high-stakes
- sources conflict
- data may be stale
- search results look SEO-spammy
- the answer affects product, pricing, legal, medical, financial, security, or outreach decisions

### 5. Answer with confidence labels

Use concise source-grounded language:
- "The official docs say…"
- "The fetched page says…"
- "Search found X, but I could not fetch/verify Y…"
- "This appears to be from an X thread; `web_fetch` captured N tweets and M media items…"

---

## X/Twitter Fetch Pattern

Use this when the user says things like:
- "fetch this X post"
- "read this tweet"
- "webfetch this X URL"
- "pull this thread"

`web_fetch` has X-aware handling for `x.com/.../status/...` URLs and can return structured fields (`success`, `count`, `tweets`, `x_media_summary`, `x_media`, etc.), including automatic media download/analysis for media posts.

Workflow:
1. `web_fetch` the X status URL. Do not open browser first for a plain X URL fetch.
2. Check `count` and `tweets`.
3. Check `x_media_summary` and `x_media.downloaded_files` if media is present.
4. If `count > 0`, answer from `tweets` and mention media only when present.
5. If `count === 0` (can happen even with `success: true`, e.g. deleted/blocked page), report that the fetch reached the page but captured no tweets, including the visible blocker/page message if present. Do not treat this as a fetch failure or infer content from the URL/memory.
6. Escalate to browser only when the user asks to interact with X, authenticated state matters, or `web_fetch` cannot retrieve enough content.

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

### X URL fetch
```json
web_fetch({ "url": "https://x.com/<handle>/status/<id>" })
```

---

## Changelog

| Date | Version | Change |
|---|---:|---|
| 2026-07-03 | 1.1.0 | Archived the 2026-05-08 dated tool-behavior test log to `references/background/tested-tool-behavior-snapshot.md`; replaced with durable "Multi-Engine Search Notes" section. Consolidated duplicate batch-fetch and X-fetch guidance that had drifted into two places. |
| 2026-06-05 | 1.0.3 | Added `web_fetch_batch` and `web_search({ fetch_top_k })` guidance for batch source fetching and compact search-and-read workflows. |
| 2026-05-08 | 1.0.2 | Added TinyFish multi-engine test notes. |
| 2026-05-08 | 1.0.1 | Added explicit Google/provider testing correction. |
| 2026-05-08 | 1.0.0 | Created dedicated web research/search skill. |
