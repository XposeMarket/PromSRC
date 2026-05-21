# Sunday Nasdaq / NQ Weekly Prep Example

Use this pattern when Raul asks broad current-market questions like: "How's Nasdaq currently?", "Sunday open Nasdaq", "what should I watch this week?", or "NQ levels this week".

## Tool Order
1. Use `web_search` for fresh futures/market context and major news catalysts.
2. Use 2-3 focused searches when needed: current NQ/Nasdaq futures, key technical levels, and macro/sector catalysts.
3. Fetch only the most useful source(s) with `web_fetch` if snippets are not enough.
4. Answer with levels, bias, invalidation, and watchlist. Avoid pretending to have live chart precision beyond the sources checked.

## Response Shape
- Current snapshot: NQ/Nasdaq futures direction and approximate price if verified.
- Key levels: immediate support, resistance/reclaim zone, major psychological level.
- Catalysts: semis/AI names, yields, oil/geopolitics, scheduled macro/news.
- Bias: short-term and bigger-picture.
- Trading posture: what confirms bull case, bear case, and where to avoid chasing.

## Guardrails
- For Sunday evening/opening futures, frame it as a developing Globex read, not a full NY-session signal.
- If the user asks for active trading execution, return to the skill's risk limits, contract limits, and no-overnight-hold rules.
- If data is stale or uncertain, say so and anchor the answer on levels/scenarios rather than false certainty.
