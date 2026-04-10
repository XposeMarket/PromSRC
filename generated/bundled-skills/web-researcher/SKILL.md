---
name: Web Researcher
description: Conduct reliable web research with multi-query coverage, source validation, and clear synthesis.
emoji: "🔍"
version: 1.1.0
triggers: >-
  research, web research, investigate, find out, look into, fact check, verify,
  summarize sources, compare options, compare tools, market scan, competitor research,
  latest updates, what changed, explain with sources, gather evidence, due diligence,
  pros and cons, trend analysis, background brief, source-backed analysis
---

Use this skill when the user needs factual, source-backed understanding from the public web.

## Trigger fit (practical phrasing)
Route to this skill when requests sound like:
- "Research X and summarize what matters."
- "Find the latest info on X."
- "Compare A vs B with sources."
- "Investigate whether claim Y is true."
- "Give me a quick brief with citations."
- "What are the top options/trends and why?"

## Boundaries (when to use vs not use)
Use this skill for:
- General web inquiry, explainers, comparisons, market/context scans, and claim validation.

Do NOT use this skill as primary for:
- Site-wide extraction/high-volume harvesting (use scraping/extraction workflows).
- Pure data pull from a known internal source (API/DB-first workflows).
- Tasks requiring direct browser interaction for account-only data unless explicitly needed.

## Minimum workflow (required)
1. Run `web_search` at least 3 times with meaningfully different queries:
   - Query 1: broad overview.
   - Query 2: specific angle (region, timeframe, product segment, or claim detail).
   - Query 3: validation/challenge query (contrary phrasing, alternatives, or criticism).
2. Include current year or timeframe terms when recency matters (e.g., "2026", "latest", "updated").
3. Open high-value results with `web_fetch` before concluding; do not rely only on snippets.
4. Validate across multiple independent sources; explicitly note disagreements or uncertainty.
5. Synthesize, don’t stack links: produce a concise conclusion, key evidence bullets, and cited URLs.

## Output quality bar
- Minimum: 3 distinct sources consulted and cited.
- Distinguish confirmed facts vs likely/uncertain claims.
- Call out stale information risk when sources are old.

## Anti-patterns (avoid)
- Single-query research.
- Single-source conclusions for contested topics.
- Copying search snippets as final analysis.
- Confident claims without citation.
