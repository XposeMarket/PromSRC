# Search Provider Health Snapshot — 2026-05-22

Use this as a dated provider-health note when the user asks whether web search is working.

## Observed working paths

A 2026-05-22 live health check reported these paths working:

- `web_search` multi-engine: `tinyfish+tavily+brave+xai`
- `web_search_multi`
- `web_search_single` for TinyFish
- `web_search_single` for Tavily
- `web_search_single` for Brave
- `web_search_single` for DuckDuckGo
- `web_fetch`
- `x_search`

## Observed blockers

- Google single-provider search failed with `missing_google_api_key`.
- `xai_live_search` failed because xAI Live Search is deprecated and requires migration to xAI Agent Tools API.

## Guardrail

When doing future provider health checks:

1. Use provider-selectable tools directly when exposed (`web_search_single`, `web_search_multi`) instead of inferring provider behavior from query text.
2. Treat Google failure as an API-key/config issue if the error is `missing_google_api_key`.
3. Treat `xai_live_search` failure as expected deprecation unless/until Prometheus migrates that tool path to xAI Agent Tools API.
4. Do not let these blockers undermine the normal research path: default web search + fetch remains healthy when TinyFish/Tavily/Brave/x_search work.

## Evidence

- `audit/chats/transcripts/059cacdf-5faf-433a-a48e-fc9d06ad137f.md:6-23`
- `Brain/skill-episodes/2026-05-22/episodes.jsonl:4`
