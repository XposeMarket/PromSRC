# TinyFish Web Search Test — 2026-05-08

## What was tested

Ran live `web_search` queries after TinyFish was added:

1. `OpenAI GPT-5.1 developer announcement pricing API official`
2. `latest AI search product announcements May 2026 official`
3. `weather API pricing comparison 2026 official docs`
4. `site:openai.com GPT-5.1 API pricing official docs`
5. `x.com sama GPT-5.1 API pricing same as GPT-5 status`
6. `TinyFish web search API provider official`
7. `Google AI Mode latest announcement May 2026 official non google query`
8. `Frederick Maryland roof repair company reviews website`

Also fetched:

- `https://docs.tinyfish.ai/search-api`
- `https://docs.tinyfish.ai/fetch-api`
- `https://x.com/sama/status/1989048466967032153`
- `https://openai.com/news/`

## Provider banner observed

Every tested search returned:

```text
[Multi-engine: tinyfish+tavily+brave]
```

Earlier before TinyFish was added, observed output was:

```text
[Multi-engine: tavily+brave]
```

This confirms TinyFish is now active in the blended multi-engine search path.

## Quality observations

TinyFish+Tavily+Brave produced strong official-source discovery:

- OpenAI pricing/model queries returned official OpenAI docs and pricing pages at the top.
- TinyFish query found official TinyFish docs and website immediately.
- Local business query returned useful review/source mix: Angi, HomeAdvisor, business site, Yelp, Reddit, Experience.com, etc.
- X/status query surfaced X status URLs and relevant snippets.

Weaknesses/noise still present:

- Broad AI-news query included a mix of good sources, news pages, Reddit, YouTube, and SEO-ish results.
- Weather API query included good official/pricing pages but also one odd raw current-weather result from weatherapi.com.
- Search snippets can show X post content, but `web_fetch` on the X URL may still capture `count: 0`, so X fetch must be validated separately.

## Compared to Tavily/Brave and Google

- Compared with previous Tavily+Brave-only banner, TinyFish is now included and appears to improve breadth and official-doc discovery, but exact per-provider attribution is unavailable because results are blended.
- Google provider was not shown in the provider banner during these tests. Google-owned domains appeared in result sets, but that only proves those domains were returned, not that Google powered the search.
- The exposed `web_search` schema still only accepts `query`; it does not expose `provider`, `engine`, or `multi_engine`, so true single-provider A/B testing cannot be done from the current assistant tool call.

## Skill update made

Updated `skills/web-researcher/SKILL.md` to v1.0.2 with:

- TinyFish active-provider banner notes.
- TinyFish test observations and operational takeaways.
- Warning not to claim exact provider attribution from blended results.
- Warning not to claim Google provider usage unless the banner/tool metadata shows Google.
