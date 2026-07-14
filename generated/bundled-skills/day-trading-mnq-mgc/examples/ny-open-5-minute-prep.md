# NY Open 5-Minute Prep Example

Use this example when the user asks for urgent MNQ/MGC market-open prep with only a few minutes before the NY cash open.

## Evidence

Observed successful run on 2026-05-13: the user asked, "Please open up trading view to MNQ and look up any news for today,lastnight and tell me what to expect on NYC market open in 5 mins". Prometheus used the trading skill, TradingView browser state, current news searches/fetches, a chart snapshot, and a concise final read. Evidence: `Brain/skill-episodes/2026-05-13/episodes.jsonl:2`; `audit/chats/transcripts/telegram_1799053599_1778678646139.md:4-27`.

## Fast Workflow

1. Read this skill first and keep all risk limits active.
2. Open/inspect TradingView for the requested instrument and timeframe; capture current price and visible structure.
3. Pull only the highest-signal current/overnight macro and market news: CPI/PPI/Fed, tech/semis for MNQ, USD/rates/geopolitics for MGC, and any immediate headline risk.
4. Identify the first two nearby support/resistance or pivot zones from the live chart.
5. Output a compact plan before the open:
   - current price and trend context
   - news backdrop in 3-5 bullets
   - key bullish/bearish thresholds
   - expected open behavior
   - opening-range plan, usually wait for the 09:30-09:45 range
   - explicit risk note: do not chase the first candle; size down when macro/news is hot
6. Write a note only if the run produced reusable levels, a trading rule, or a blocker worth preserving.

## Output Shape

```markdown
MNQ/MGC is open on TradingView. Quick read into NY open:

**Current chart:** [price/context]

**News backdrop:**
- [macro/news point]
- [market/sector/correlation point]

**What I’d expect at the open:**
- [chop/trend expectation]
- Bullish above [level] toward [targets]
- Bearish below [level] toward [targets]

**Best play:** wait for the 09:30-09:45 opening range. Do not chase the first candle. [specific trigger]

My read: [one-line bias + risk warning]
```

## Guardrails

- Do not imply certainty; market-open reads are scenario plans, not trade commands.
- Never recommend exceeding skill risk limits.
- If data is stale or TradingView/news cannot be verified quickly, say the exact blocker and give a cautious no-trade/opening-range-only plan.
- Preserve the user's trading psychology: after losses or emotional pressure, prioritize reset/cooldown over immediate recovery trades.
