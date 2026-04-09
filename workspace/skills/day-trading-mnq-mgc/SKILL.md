---
name: Day Trading — MNQ & MGC
description: Optional-pack skill for professional intraday trading strategies for Micro E-mini Nasdaq-100 (MNQ) and Micro Gold (MGC) futures. Keep this skill discoverable for teams that still need it, but prefer non-core usage unless explicitly required. Use whenever an agent needs to analyze charts, generate trade signals, manage risk, execute trades, monitor news catalysts, or journal trade results.
emoji: "📈"
version: 1.0.1
status: optional-pack
deprecation: "Marked optional-pack / deprecated from core catalog. Do not hard-delete. Final removal requires telemetry review over one full quarterly cycle with confirmed low or zero usage."
---

> **Optional Pack Notice**
> This skill has been conservatively deprecated from the core catalog and is now treated as an optional pack. It remains fully intact for compatibility and discoverability.
> 
> **Removal gate:** any future hard removal must wait until usage telemetry has been reviewed across one full quarterly cycle and shows sustained minimal usage.

# Day Trading Skill — MNQ & MGC Futures

## ⚠️ HARD LIMITS — NEVER VIOLATE

```
MAX DAILY LOSS:      -$550.00  (STOP ALL TRADING immediately if hit)
MNQ MAX CONTRACTS:    5        (never exceed 5 contracts per trade)
MGC MAX CONTRACTS:    2        (never exceed 2 contracts per trade)
INSTRUMENTS:          MNQ and MGC ONLY
STYLE:                Intraday only — no overnight holds
```

**P&L Math:**
- MNQ: 1 tick = $0.50 | 1 point = $2.00 | 1 contract × 10 pts = $20.00
- MGC: 1 tick = $0.10 | 1 point = $1.00 | 1 contract × 10 pts = $10.00

---

## SESSION WINDOWS (Eastern Time)

| Window | Name | Quality |
|--------|------|---------|
| 09:30–11:00 ET | NY Open / Prime | ⭐⭐⭐ BEST |
| 08:30–09:30 ET | Pre-market catalyst | ⭐⭐ if news |
| 11:00–13:00 ET | Mid-day chop | ⚠️ Avoid or size down |
| 13:00–15:30 ET | Afternoon trend | ⭐⭐ |
| 15:30–16:00 ET | Close rip/fade | ⭐⭐ Scalp only |

**Never trade during:** NFP, FOMC, CPI release (first 5 min). Wait for dust to settle.

---

## STRATEGY 1 — Opening Range Breakout (ORB)

**Best for:** MNQ at NY open (09:30–10:00). High-probability institutional staple.

### Rules:
1. Mark the **09:30–09:45 candle** high and low (Opening Range)
2. Wait for a **clean breakout candle** closing outside the range
3. Enter on the **retest** of the breakout level (preferred) or on close
4. Stop: other side of Opening Range + 2 ticks buffer
5. Target 1: 1:1 R/R → move stop to breakeven
6. Target 2: 2:1 R/R → trail remainder

### Filters (need at least 2):
- Pre-market trend aligns with breakout direction
- SPY/QQQ gap direction matches
- Breakout candle volume > prior 3 candle average
- News catalyst supports direction

### Invalidation:
- Price breaks out then returns inside range → exit immediately
- Choppy back-and-forth inside range → skip entirely

---

## STRATEGY 2 — VWAP Mean Reversion

**Best for:** Both MNQ and MGC mid-morning (10:00–11:30). Range-bound conditions.

### Rules:
1. Price must be **>8 pts from VWAP on MNQ** or **>$3 from VWAP on MGC** — extended
2. Look for a reversal candle (doji, engulfing, pin bar) pointing back toward VWAP
3. Enter on confirmation (next candle moves toward VWAP)
4. Stop: 3 pts beyond the reversal candle extreme
5. Target: VWAP level (partial), then VWAP ±5 pts (full)

### Filters:
- Market is NOT in a strong directional trend
- RSI below 35 for long reversal, above 65 for short reversal
- No major news in next 30 min

---

## STRATEGY 3 — Momentum / News Catalyst

**Best for:** Both instruments when macro news drops.

### Trigger Events:
- Fed speak / FOMC → NQ sensitivity HIGH
- CPI/PPI/PCE data → NQ & Gold move
- NFP, ISM, Jobless Claims → moderate NQ
- Geopolitical events → Gold (MGC) primary mover
- Big tech earnings (MSFT, AAPL, NVDA, META, AMZN, GOOGL) → NQ direct

### Rules:
1. **Pre-news:** Note nearest S/R level. Do NOT enter before the print.
2. **Post-news:** Wait for the initial spike candle to CLOSE
3. Enter on **pullback** to 9 EMA or nearest key level
4. Stop: low of spike candle (long) or high (short) + 2 ticks
5. Target: size of spike candle × 1.5 (measured move)

---

## STRATEGY 4 — Key Level Bounce / Break

**Best for:** All sessions. Institutional price action.

### Key Levels:
- Prior day high/low — strongest
- Prior week high/low — very strong
- Round numbers (MNQ: every 50 pts; MGC: every $10)
- Overnight (globex) high/low
- Gap fill levels

### Long Setup:
1. Price approaches support → momentum slows (smaller candles, RSI flattening)
2. Reversal candle (hammer, doji, bullish engulfing)
3. Enter on next candle open or breakout of reversal high
4. Stop: 3–5 pts below support
5. Target: next resistance level

### Breakout (not bounce):
- Wait for 2 consecutive closes beyond level
- Enter on first pullback to broken level (now flipped support/resistance)

---

## CHART ANALYSIS OUTPUT FORMAT

```
INSTRUMENT: [MNQ/MGC] | TIMEFRAME: [1m/5m/15m] | TIME: [HH:MM ET]
CURRENT PRICE: [price]
TREND: [Bullish/Bearish/Neutral] — [reason]
VWAP: [above/below/at] | RSI: [value] → [overbought/oversold/neutral]

KEY LEVELS:
  Resistance 1: [price] — [source]
  Resistance 2: [price] — [source]
  Support 1: [price] — [source]
  Support 2: [price] — [source]

ACTIVE SETUP: [Strategy or "No setup — wait"]
  Direction: [Long/Short]
  Entry zone: [price range]
  Stop: [price] (-$[risk/contract])
  Target 1: [price] (+$[per contract])
  Target 2: [price] (+$[per contract])
  Confidence: [Low/Medium/High]

INVALIDATION: [What cancels this setup]
NOTES: [Gaps, news, volume anomalies]
```

---

## SIGNAL FORMAT (Analyst → Risk Manager)

```json
{
  "signal_id": "sig_YYYYMMDD_NNN",
  "timestamp": "HH:MM ET",
  "instrument": "MNQ",
  "direction": "long",
  "strategy": "ORB",
  "contracts": 2,
  "entry_price": 21450.00,
  "stop_price": 21440.00,
  "target_1": 21460.00,
  "target_2": 21470.00,
  "risk_per_contract": 20.00,
  "total_risk": 40.00,
  "confidence": "high",
  "catalyst": "ORB breakout above 21445 with volume",
  "daily_pnl_so_far": -120.00,
  "daily_limit_remaining": 430.00
}
```

**Risk Manager APPROVES if ALL:**
- total_risk ≤ $150
- daily_pnl_so_far > -$450
- daily_limit_remaining > total_risk × 2
- confidence is "medium" or "high"
- no HIGH IMPACT news in next 30 min

**Risk Manager REJECTS if ANY fail.**

---

## EXECUTION PROTOCOL (TopstepX Browser)

1. `browser_snapshot` → confirm instrument (MNQ or MGC) and account type (Practice/Live)
2. Set Qty field → enter contract count (max 5 MNQ / 2 MGC)
3. Click **Buy MKT** (long) or **Sell MKT** (short)
4. Immediately set Stop Loss (enter actual price, not distance)
5. Set Take Profit (Target 1 first)
6. `browser_snapshot` → confirm position shows in panel

**Closing:**
- Click **Close** or **Flatten** in positions panel
- `browser_snapshot` → confirm position = 0

**NEVER enter without qty confirmed. NEVER leave a trade without a stop.**

---

## DAILY DRAWDOWN PROTOCOL

| Cumulative Loss | Action |
|-----------------|--------|
| -$200 | Reduce contract size by half |
| -$350 | Stop trading for 30 min. Reassess. |
| -$450 | Maximum 1 more trade. Minimum size only. |
| **-$550** | **STOP. Close everything. Done for the day.** |

**Trade Rules:**
1. Never widen a stop — only tighten
2. Move stop to breakeven after Target 1 hit
3. 10-min cooldown after any stop-out (no revenge trading)
4. No FOMO entries — missed setup = wait for next
5. Scale out: 50–75% at Target 1, trail rest to Target 2

---

## NEWS MONITORING PROTOCOL

**Monitor every 5 min:**
- https://www.reuters.com/markets/
- https://finance.yahoo.com/
- https://www.marketwatch.com/markets

**🔴 HIGH IMPACT → pause all trading:**
- Fed rate decision or unexpected Fed speak
- CPI, PCE, PPI release
- NFP (Non-Farm Payrolls)
- Geopolitical escalation (war, sanctions, oil shock)

**🟡 MEDIUM IMPACT → tighten stops, reduce size:**
- ISM, PMI, Jobless Claims
- Big tech earnings (AAPL, MSFT, NVDA, META, GOOGL, AMZN)

**NQ Correlations:**
| Trigger | NQ | Gold |
|---------|----|------|
| Fed hawkish | DOWN | UP |
| Fed dovish | UP | DOWN |
| CPI hotter than expected | DOWN | UP |
| CPI cooler than expected | UP | DOWN |
| Tech earnings beat | UP | neutral |
| Geopolitical fear | DOWN | UP |
| USD strengthens | DOWN | DOWN |

---

## TRADE JOURNAL FORMAT

Save to: `trade-journal/YYYY-MM-DD.md` in team workspace

```markdown
## Trade #[N] — [HH:MM ET]
- Instrument: MNQ/MGC | Direction: Long/Short | Contracts: N
- Entry: [price] | Stop: [price] | Target: [price]
- Strategy: [name] | Catalyst: [reason]
- Exit: [price] at [HH:MM ET]
- Result: +/- $[amount] ([pts] pts)
- Running Daily P&L: $[cumulative]
- Notes: [what worked / what to improve]
```

**EOD Summary:**
```
Total trades: N | Winners: N | Losers: N | Win rate: X%
Gross P&L: $X | Max drawdown: $X
Rules followed: Y/N | Tomorrow key levels: [list]
```
