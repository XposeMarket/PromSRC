---
name: "web-scraper"
description: "Search, fetch, read, scrape, or extract information from websites with Prometheus-native web and browser tools. Use for web research, source collection, full-page extraction, repeated listings, JavaScript-rendered pages, infinite scrolling, structured DOM data, or clean summaries derived from extracted content."
---

# Web Research and Extraction

Use the lightest Prometheus-native path that returns trustworthy data. Do not write a custom scraper when search, fetch, or browser extraction already solves the request.

## Routing

1. **Discover sources:** use web search when the user asks a question or topic rather than supplying a URL.
2. **Read static pages:** use `web_fetch`; use `web_fetch_batch` for several known URLs.
3. **Read a complete or JavaScript-rendered page:** open it in the browser and use `browser_scroll_collect` to collect deduplicated content across the page.
4. **Extract repeated structured data:** use `browser_extract_structured` with container and field selectors.
5. **Read visible page text:** use `browser_get_page_text` when structure is unimportant.
6. **Inspect data APIs:** use browser network interception when the page renders useful XHR/fetch JSON and DOM extraction is inferior.
7. Use custom Playwright/Python only for permitted batch work or transformations the native tools cannot express.

## Full-page workflow

1. Open the requested URL in the browser and wait for the meaningful content.
2. Handle an ordinary consent/interstitial control when necessary; do not bypass authentication or access controls.
3. Use `browser_scroll_collect` rather than repeated manual scroll calls. Set a reasonable scroll count, delay, character cap, and stop condition.
4. If the page is card/table/list oriented, run structured extraction as well and retain missing fields as `null` rather than inventing values.
5. Deduplicate records by stable URL, identifier, or a normalized field combination.
6. Preserve source URLs and distinguish extracted facts from interpretation.
7. Present the result in the format that best fits the request: concise synthesis, bullets, table, JSON, or saved dataset.

## Reliability and safety

- Report blocked, empty, login-only, or partial extraction honestly.
- Never treat navigation text or an empty array as successful content extraction.
- Respect robots directives, site terms, rate limits, privacy, and the user’s authorization.
- Do not evade CAPTCHAs, fingerprinting, or access controls.
- Avoid social actions while collecting unless the user separately requests them.

Read `references/detailed-guide.md` only when native tools are insufficient and a custom scraper is genuinely required.
