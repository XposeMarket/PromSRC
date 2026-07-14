# Provider Selection / Google Search Follow-up — 2026-05-08

## Correction: do not misuse `site:` as a Google-provider test

A query like:

```text
site:googleblog.com Google Search latest AI Mode May 2026
```

only proves that the search system can return pages from `googleblog.com`. It does **not** prove that the Google search provider/engine was used.

`site:<domain>` is a domain restriction operator. It tells the search engine to only return results from that site/domain. Therefore, using `site:googleblog.com` when trying to test “Google Search” accidentally forces Google-owned results and creates a misleading result set.

## Correct provider/engine test pattern

When testing whether Google is active as a provider, use a normal broad query with no Google-owned domain restriction, then inspect the provider banner/tool metadata.

Better test queries:

```text
OpenAI latest model release pricing
```

```text
latest AI search product announcements May 2026
```

```text
weather API pricing comparison 2026 official docs
```

These should be able to return mixed domains. The provider check should come from the tool output banner, e.g. `[Multi-engine: tinyfish+tavily+google+brave]`, `[Successful engines: tinyfish+tavily+brave]`, and `[Failed engines: google: ...]`, not from the domains returned.

## Current provider-selectable tools

After the 2026-05-08 tool/schema update, Prometheus exposes provider-selection arguments in source and prompt context:

- `web_search({ query, max_results?, multi_engine?, provider? })`
- `web_search_single({ query, max_results?, provider? })`
- `web_search_multi({ query, max_results? })`

Use these directly when they are visible in the active tool schema:

```json
web_search_single({ "query": "OpenAI latest model release pricing", "provider": "google", "max_results": 5 })
```

```json
web_search_multi({ "query": "latest AI search product announcements May 2026", "max_results": 5 })
```

If an older/runtime-constrained session only exposes `web_search({ query })`, then do not fake single-provider testing through query text. State that the active schema lacks provider-selection fields and inspect only the returned banner/metadata.

## Google 403 interpretation

If the banner says Google was attempted but failed, for example:

```text
[Multi-engine: tinyfish+tavily+google+brave]
[Successful engines: tinyfish+tavily+brave]
[Failed engines: google: Google HTTP 403 forbidden ...]
```

then Google is configured/attempted, but the Google Custom Search API request is blocked. Treat this as a Google API/CSE access issue, not as proof that the search tool is broken. Likely remediation areas are API enablement, Custom Search JSON API access, CSE ID validity, key restrictions, billing/quota, and propagation delay after settings changes.

## Rule added to the main skill

Do **not** use `site:google.com`, `site:googleblog.com`, `site:developers.googleblog.com`, or any other Google-owned domain restriction to test whether the Google provider is active.

Use `site:` only when intentionally narrowing results to a known source/domain for source discovery or verification.
