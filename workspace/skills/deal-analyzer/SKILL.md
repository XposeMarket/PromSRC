---
name: Deal Analyzer
description: >
  Analyze M&A, investment, partnership, and commercial deals for red flags, structure,
  risk, and negotiation levers. Use whenever the user is reviewing a term sheet, evaluating
  an acquisition, assessing a partnership agreement, analyzing a vendor contract, or
  needs help understanding deal mechanics. Triggers on: "analyze this deal", "review this
  term sheet", "acquisition offer", "partnership agreement", "deal structure", "investment
  terms", "is this a good deal", "what should I negotiate", "red flags in this contract",
  "letter of intent", "LOI review", "due diligence", "deal review", "should I take this
  offer", "commercial contract", "SaaS contract", "vendor agreement", "deal mechanics",
  "cap table", "dilution", "liquidation preference", "anti-dilution".
emoji: ⚖️
version: 1.0.0
triggers: deal analysis, term sheet, acquisition offer, partnership agreement, deal structure, investment terms, red flags, letter of intent, LOI, due diligence, deal review, commercial contract, vendor agreement, cap table, dilution, liquidation preference, anti-dilution, M&A, is this a good deal, what should I negotiate
---

# Deal Analyzer

Structured framework for evaluating deals — investment, M&A, partnerships, or commercial agreements — before signing anything.

---

## Step 1: Deal Classification

Identify the deal type before applying frameworks:

| Type | Key Questions | Primary Risk |
|------|-------------|--------------|
| **Fundraising (equity)** | Valuation, dilution, control, liquidation waterfall | Losing too much ownership / control |
| **M&A (sell-side)** | Price, structure (cash/stock/earnout), reps & warranties, earnout risk | Getting paid less than promised |
| **M&A (buy-side)** | Hidden liabilities, customer concentration, key person risk | Overpaying or inheriting problems |
| **Strategic partnership** | Exclusivity, IP ownership, revenue share, exit rights | Locked into bad terms / IP trap |
| **Commercial contract** | Payment terms, SLAs, termination rights, auto-renewal | Operational dependency or cost trap |
| **Licensing** | Scope, exclusivity, royalty structure, enforcement rights | Undervaluing IP or losing control |

---

## Module A: Investment / Term Sheet Analysis

### Key Terms Checklist

```
ECONOMIC TERMS
□ Pre-money valuation: $___
□ Investment amount: $___
□ Post-money valuation: $___
□ Implied ownership: ___%
□ Option pool: ___% (pre or post? — matters for dilution)
□ Liquidation preference: ___x participating / non-participating
□ Dividend: cumulative / non-cumulative / none
□ Anti-dilution: broad-based weighted average / full ratchet / none

CONTROL TERMS
□ Board composition: founder seats ___, investor seats ___, independent ___
□ Protective provisions: what requires investor approval?
□ Information rights: what must be shared and how often?
□ Pro-rata rights: right to invest in future rounds
□ ROFR / co-sale: right of first refusal on share sales
□ Drag-along: can majority force minority to sell?

FOUNDER TERMS
□ Vesting: ___ year schedule, ___ month cliff
□ Acceleration: single / double trigger / none
□ Reverse vesting on existing shares? Yes / No
```

### Red Flags in Term Sheets

```
🚩 Full ratchet anti-dilution — punitive in down rounds; fight for broad-based WA
🚩 Participating preferred with no cap — investor gets preference PLUS pro-rata on exit
🚩 Cumulative dividends — compound interest on the preferred; eats into exit proceeds
🚩 Board control shifting to investor(s) — founders lose ability to run the company
🚩 Option pool shuffle pre-money — dilutes founders before investment closes
🚩 Broad protective provisions — gives investor veto on normal operating decisions
🚩 Pay-to-play missing — existing investors can free-ride on future rounds
🚩 No acceleration on acquisition — founders leave value on the table at exit
🚩 ROFR + co-sale combo without drag-along — paralyzes secondary liquidity
```

### Liquidation Waterfall Analysis

```
Scenario 1: Exit at 1x invested capital (fire sale)
  Series A Preferred: $___M at ___x = $___M out
  Founders / common: $___M remaining

Scenario 2: Exit at 2.5x post-money
  Preferred gets: [participation or convert — whichever is higher]
  Common gets: remainder

Scenario 3: Exit at 10x (strong outcome)
  At what multiple does preferred convert to common?
  Is participation capped?

Build the table: who gets what at $5M / $20M / $50M / $100M exit
```

---

## Module B: M&A Analysis

### Sell-Side Deal Structure Review

```
PRICE COMPONENTS
□ Upfront cash: $___
□ Stock: ___% (what's the vesting cliff? lock-up period?)
□ Earnout: $___M over ___ years, tied to: ___
□ Escrow/holdback: ___% for ___ months (covers reps & warranties claims)

EARNOUT RED FLAGS
🚩 Metrics you can't control after acquisition (revenue dependent on acquirer resources)
🚩 No revenue floor guarantee during integration period
🚩 Definitions can be gamed (EBITDA with aggressive cost allocations)
🚩 Short measurement window (less than 2 years is often too tight)
🚩 No acceleration if acquirer changes strategy or divests the unit

REPS & WARRANTIES
□ What are you representing about the business?
□ Survival period: how long can they come back for claims?
□ Cap on liability: typically 10-20% of deal price
□ Baskets: de minimis threshold before claims count
□ R&W insurance: is the buyer buying it? (common in PE deals)

KEY PROTECTION ASKS
□ No-shop / exclusivity: how long? 45-60 days is standard; push back on 90+
□ MAC clause: what triggers a material adverse change that lets them walk?
□ Break-up fee: if they walk, what do you get?
□ Reverse termination fee: if you walk, what do you pay?
```

### Buy-Side Due Diligence Checklist

```
FINANCIAL
□ 3 years of audited financials
□ MRR/ARR reconciliation (churn, expansion, new)
□ Customer concentration: any customer >10% of revenue?
□ Deferred revenue quality: is it real or pull-forward?
□ Working capital: normalized working capital at close

LEGAL
□ Cap table: clean? Any convertibles, options, or side letters?
□ IP ownership: are all assets truly owned, not licensed?
□ Employee IP assignments: signed by everyone?
□ Open source: any GPL code that could infect the codebase?
□ Pending litigation / claims

COMMERCIAL
□ Top 20 customer contracts: change of control provisions?
□ Vendor/supplier: any single-source dependencies?
□ Customer churn cohort analysis (not just aggregate churn rate)
□ Sales pipeline: how much is real vs. hope?

KEY PERSON
□ Who leaves if founders leave? (technical, sales, ops)
□ Retention plan for critical employees post-close
□ Founder earnout / employment terms
```

---

## Module C: Partnership Agreement Analysis

### Framework

```
VALUE EXCHANGE
□ What does each party contribute?
□ What does each party receive?
□ Is the split fair given contribution asymmetry?

CONTROL & IP
□ Who owns IP created during the partnership?
□ Who owns customer data / relationships?
□ Can either party use work product after partnership ends?

EXCLUSIVITY
□ Is there exclusivity? In what scope (geography, vertical, use case)?
□ What triggers the right to go non-exclusive?
□ What are the performance minimums to maintain exclusivity?

EXIT RIGHTS
□ Termination for convenience: notice period?
□ Termination for cause: what qualifies?
□ What happens to in-flight work and revenue at termination?
□ Transition assistance obligations?

RED FLAGS
🚩 Perpetual exclusivity without performance minimums — you're locked in forever
🚩 Partner owns customer relationships — creates dependency
🚩 IP assignment to partner on anything you build together
🚩 Auto-renewal with no notice window — suddenly locked in for another term
🚩 Unilateral right to modify terms — they can change the deal after you're in it
```

---

## Module D: Negotiation Leverage Map

```
FOR EACH KEY TERM, ASSESS:

[Term]
  Current position: [what they offered]
  Your ask: [what you want]
  Your BATNA: [what you do if this term doesn't move]
  Leverage: High / Medium / Low
  Trade: [what you'd give to get this]
  Walk-away: Yes / No (is this a deal-breaker if it doesn't move?)
```

### Negotiation Priority Stack

```
Tier 1 — Walk-away terms (must have):
  [List 2-3 absolute requirements]

Tier 2 — Important but tradeable:
  [List 3-5 terms you want but would trade for Tier 1 wins]

Tier 3 — Nice to have:
  [List terms you'd take if offered but won't fight for]
```

---

## Deal Summary Output Template

```
# Deal Analysis — [Deal Name] — [Date]

## Deal Overview
Type: [Investment / M&A / Partnership / Commercial]
Counterparty: [Name]
Headline terms: [2-3 sentence summary]

## Economic Analysis
[What each party gets — build the waterfall if equity]

## Top 3 Risks
1. [Risk] — probability: H/M/L — mitigation: [how to address]
2. [Risk] — probability: H/M/L — mitigation: [how to address]
3. [Risk] — probability: H/M/L — mitigation: [how to address]

## Red Flags Found
[List with explanation of impact]

## Negotiation Priorities
Must-move: [terms]
Trade candidates: [terms]
Walk-away if: [conditions]

## Recommendation
[Proceed / Proceed with conditions / Walk away] + rationale
```
