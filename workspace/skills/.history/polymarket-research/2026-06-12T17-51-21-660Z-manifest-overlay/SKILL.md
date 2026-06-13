# Polymarket Research

Use this skill when Raul asks about Polymarket, prediction-market odds, event probabilities, market prices, orderbooks, price history, recent trades, or market movement monitoring.

This Prometheus skill is adapted from the Hermes Agent bundled skill `skills/research/polymarket` in `oss agents/hermes-agent/` and the public Hermes docs page for `research-polymarket`.

## Scope

- Read-only market data only.
- Uses public REST APIs that require no authentication.
- Does **not** support trading, wallet auth, signing, order placement, deposits, withdrawals, or execution advice.
- Treat prices as market-implied probabilities, not truth.

## Core Concepts

- **Events** contain one or more **Markets**.
- **Markets** are usually binary outcomes with Yes/No prices between `0.00` and `1.00`.
- Prices are probabilities: `0.65` means the market prices the outcome around `65%`.
- `outcomePrices`, `outcomes`, and `clobTokenIds` are often JSON strings inside JSON responses; parse them before using.
- `clobTokenIds[0]` is usually the Yes token and `clobTokenIds[1]` the No token.
- `conditionId` is used for price history and Data API market filtering.
- Volume is USDC/USD-denominated.

## Public APIs

1. **Gamma API** — `https://gamma-api.polymarket.com`
   - Discovery, search, event/market browsing.
2. **CLOB API** — `https://clob.polymarket.com`
   - Current prices, midpoint, spread, orderbook, price history.
3. **Data API** — `https://data-api.polymarket.com`
   - Recent trades and open interest.

## Visual card: `show_prediction_market`

For the common "what are the odds of X" / "show me the markets" request, just call the **`show_prediction_market`** tool (`query`, optional `slug`, optional `limit`). It hits the same keyless Gamma API and renders a native prediction-market card — questions with outcome probability bars, volume, and close date — on desktop and mobile. Lead with the card, then add a one-line takeaway.

Drop to the manual API workflow below only when you need depth this card doesn't show: orderbook, midpoint/spread, price history, recent trades, or open interest.

## Default Workflow (manual / depth)

When asked for odds or probabilities and the card isn't enough:

1. Search Gamma using `GET /public-search?q=QUERY`.
2. Parse events and nested markets.
3. Present market question, outcomes, current probabilities, volume, status, and slug.
4. If the user asks for depth, use `clobTokenIds` for price/book/midpoint/spread and `conditionId` for history/trades/open interest.
5. Keep the answer tight and label it as market-implied probability.

## Presentation Format

Convert prices to percentages:

- `outcomePrices = ["0.652", "0.348"]` → `Yes: 65.2%, No: 34.8%`
- Include volume when present.
- Include market slug when follow-up lookup may be useful.

Example:

> “Will X happen?” — Yes 65.2%, No 34.8% · Volume $1.2M · ACTIVE

## Prometheus Execution Notes

Preferred lightweight path:

- Use `web_fetch` on direct API URLs when you only need JSON text.
- Use `web_fetch_batch` when comparing several Gamma/CLOB/Data API URLs or checking multiple related markets in one pass.
- Use `web_search({ fetch_top_k })` only for surrounding news/context; do not treat search snippets as market data.
- For richer repeated use, run or adapt the local helper from the downloaded Hermes repo:
  - `oss agents/hermes-agent/skills/research/polymarket/scripts/polymarket.py`
  - Commands include `search`, `trending`, `market`, `event`, `price`, `book`, `history`, `trades`.
- If shell execution is needed, use `run_command`/`terminal` only for process execution, not for editing files.

## Safety / Judgment

- Do not give financial advice or tell the user to trade.
- If Raul asks about a trade, separate market data from personal decision/risk framing.
- For trading actions, this skill is insufficient; trading requires wallet-based crypto auth and explicit approval.

## Source Provenance

- Local source: `oss agents/hermes-agent/skills/research/polymarket/`
- Web source: `https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/research/research-polymarket`
- Upstream repo path: `https://github.com/NousResearch/hermes-agent/tree/main/skills/research/polymarket`
