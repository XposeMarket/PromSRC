# Tested Tool Behavior Snapshot — 2026-05-08 (archived)

Archived 2026-07-03 from the main SKILL.md, which had absorbed this entire dated investigation log permanently into its core instructions. Durable takeaways were folded into SKILL.md's "Multi-Engine Search Notes" section; this file preserves the full point-in-time detail for reference.

These notes came from live tool checks on 2026-05-08.

## `web_search`

Observed behavior:
- Returns a provider banner such as `[Multi-engine: tinyfish+tavily+brave]` when multiple engines are active.
- Current configured default runs multiple providers in parallel. As of the latest test on 2026-05-08, TinyFish is now active alongside Tavily + Brave.
- Earlier observed output before TinyFish was added was `[Multi-engine: tavily+brave]`; after TinyFish was added, repeated broad and targeted queries showed `[Multi-engine: tinyfish+tavily+brave]`.
- Search result quality improved when the query included source targeting such as `site:openai.com/...`.
- Results include title, URL, and snippet. Snippets are useful for triage, but **not enough** for final claims when a source can be fetched.

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

Operational takeaways (2026-05-08):
- TinyFish looked useful as a search-breadth upgrade inside the default blended engine, especially for agent/tooling docs, structured docs discovery, X/status URL discovery, and local-business/source discovery.
- Do not claim exact TinyFish-vs-Tavily-vs-Brave attribution from blended results; tool output did not label which provider produced each result.
- Do not claim Google provider is active unless the banner/tool metadata shows Google. In these tests the active banner was TinyFish + Tavily + Brave, not Google.

## `web_fetch` on normal pages

Observed behavior:
- Fetching `https://openai.com/index/gpt-5-1-for-developers/` returned clean article text with headings and body content.
- Fetching OpenAI docs returned a long text extraction including navigation plus the actual docs content.
- Some pages may include large navigation/sidebar text; skim for the content section and cite the fetched page, not every nav item.

## `web_fetch` on X/Twitter status URLs

Observed behavior:
- `web_fetch` has X-aware handling for `x.com/.../status/...` URLs.
- It can return structured fields such as `success`, `url`, `count`, `message`, `tweets`, `snapshot_deltas`, `x_media_summary`, and `x_media`.
- For reachable X threads, it captured tweet/thread items and media metadata.
- For media posts, it downloaded media into `downloads/x_fetch_media/...` and automatically analyzed downloaded images/videos.
- Example observed X media fields: `downloaded_files`, `analyses`, `direct_image_candidates`, `video_tweet_candidates`, and `analysis_limited`.
- If the X URL is unavailable/deleted/blocked, it can return `success: true` but `count: 0` and a page message such as "Hmm...this page doesn't exist." Treat that as no captured tweets, not as successful content extraction.
