---
name: Market Research
description: >
  TAM/SAM/SOM modeling, ICP validation, interview guide creation, customer segment
  analysis, and insight synthesis. Use whenever the user needs to size a market,
  validate a hypothesis about customers, understand who to target, design customer
  research, analyze survey results, or turn raw research into actionable insights.
  Triggers on: "market research", "market size", "TAM SAM SOM", "ICP", "ideal customer",
  "customer research", "user research", "validate our hypothesis", "who should we target",
  "customer interviews", "survey design", "market sizing", "go-to-market research",
  "understand our market", "market opportunity", "total addressable market",
  "customer persona", "customer segment", "research synthesis", "interview guide".
emoji: 📋
version: 1.0.0
triggers: market research, market size, TAM SAM SOM, ICP, ideal customer profile, customer research, user research, validate hypothesis, customer interviews, survey design, market sizing, market opportunity, addressable market, customer persona, customer segment, research synthesis, interview guide
---

# Market Research

Structured process for sizing markets, defining who to target, collecting customer intelligence, and synthesizing raw research into decisions.

---

## Module 1: Market Sizing (TAM / SAM / SOM)

### Framework Selection

| Approach | Best for | Credibility |
|----------|---------|------------|
| Top-down | Quick sizing, investor slides | Lower — relies on analyst estimates |
| Bottom-up | Operationally grounded sizing | Higher — based on real unit economics |
| Value-theory | Pricing power and willingness to pay | High for premium or novel markets |

---

### Top-Down Method

```
Start with a total industry figure (from analyst reports: Gartner, IDC, Grand View Research)

TAM = Total industry revenue or spend in the category
SAM = TAM × (% you can actually serve — geo, segment, use case)
SOM = SAM × (% you can realistically capture in 3-5 years — based on your GTM)
```

### Bottom-Up Method (preferred)

```
Step 1: Define the unit of sale (per seat, per company, per transaction)
Step 2: Count the number of potential buyers in your ICP
Step 3: Multiply by your price point (or average ACV for a range)

Example:
  Unit: Software subscription per company
  ICP: US-based SaaS companies, 10-200 employees = ~45,000 companies
  ACV: $3,600/yr
  SAM = 45,000 × $3,600 = $162M

  Realistic capture (SOM): 2% in 3 years = $3.2M ARR milestone
```

### Value-Theory Method

```
Step 1: What is the customer's cost if they DON'T use you?
  (time wasted, revenue lost, risk exposure, headcount cost)
Step 2: What % of that value would they pay to solve it?
  (typically 10-20% of quantified pain)
Step 3: Multiply by number of buyers with that pain intensity

Example:
  VP Sales spends 4 hrs/week on manual reporting = $25K/yr in lost time
  Willingness to pay: ~15% = $3,750/yr
  ICP: 80K VPs Sales in the US
  TAM (value-theory): $300M
```

---

## Module 2: ICP Definition

### ICP Discovery Process

Ask these to narrow from "everyone" to "the buyer who pays and stays":

```
FIRMOGRAPHIC (company level):
- Industry vertical(s)
- Company size (employees or revenue)
- Geography
- Growth stage (startup / growth / enterprise)
- Tech stack signals (if relevant)
- Business model (B2B, B2C, marketplace, SaaS, services)

DEMOGRAPHIC (person level):
- Job title / function
- Seniority (IC, manager, director, VP, C-suite)
- Budget authority (buyer vs. influencer vs. end user)

PSYCHOGRAPHIC (motivation level):
- Primary pain they're trying to solve
- What does success look like to them?
- What are they afraid of / avoiding?
- What metrics does their boss judge them on?

BEHAVIORAL:
- How do they currently solve this problem?
- Where do they look for solutions (Google, peers, conferences)?
- What triggers a decision to buy?
```

### ICP Scoring Matrix

Rate each customer segment on these dimensions (1-5):

```
Pain intensity:      How much does this problem cost them?
Willingness to pay:  Do they have budget? Do they spend on solutions?
Reach:               Can you find and talk to them at scale?
Retention:           Will they stick around? Low churn signal?
Expansion:           Will they buy more over time?
Speed to value:      Can they get value fast enough to renew?
```

Highest total score = highest-priority ICP segment.

---

## Module 3: Customer Interview Guide

### Setup Rules

```
1. Talk to people in your ICP, not your friends
2. Target: 8-12 interviews per segment to find patterns
3. Interview the BUYER, not just the user (they're often different people)
4. Never pitch during an interview — you're listening, not selling
5. Record with permission and take notes on exact quotes
```

### Universal Interview Guide

```
WARM-UP (5 min)
- Tell me about your role and what you're responsible for.
- What does a typical week look like?

PROBLEM EXPLORATION (15 min)
- Walk me through the last time you dealt with [problem area].
- What does that process look like today?
- What's the most frustrating part?
- What have you tried to fix it?
- What happened when you tried that?
- How much does this problem cost you? (time, money, risk)

SOLUTION AWARENESS (5 min)
- Have you looked at solutions? What did you look at?
- What made you not move forward / switch / stay?
- What would the ideal solution look like?

BUYING BEHAVIOR (5 min)
- If the perfect solution existed, how would you find out about it?
- Who would be involved in buying it?
- What would make you say yes / no?

CLOSE
- Is there anything I should have asked that I didn't?
- Can you refer me to 2 others facing the same thing?
```

---

## Module 4: Survey Design

For quantitative validation after qualitative interviews.

```
Survey Structure (max 10 questions):
1. Screener: Qualify the respondent (role, company size, etc.)
2. Behavior: How do you currently handle [problem]?
3. Pain: How painful is [problem] on a scale of 1-10?
4. Priority: Where does [problem] rank vs. other priorities?
5. Spend: What do you currently spend on solving [problem]?
6. WTP: How much would you pay for [solution]?
7. Awareness: Have you heard of / tried [alternatives]?
8. Decision: Who is involved in buying decisions for [category]?
9. Channel: Where do you discover new tools/solutions?
10. Open-end: What else should I know?

Rules:
- One question per question (no double-barreled)
- Likert scales (1-5 or 1-10) for consistency
- No leading questions ("How great would it be if...")
- Test with 3 people before sending broadly
```

---

## Module 5: Research Synthesis

Turn raw interviews/surveys into decisions.

### Affinity Mapping (qualitative)

```
Step 1: Pull every notable quote and observation onto separate notes
Step 2: Group them by theme (don't force pre-existing categories)
Step 3: Name each cluster with the insight, not the topic
  BAD cluster name: "Pricing"
  GOOD cluster name: "Buyers don't know what they're paying now — so price anchoring is hard"
Step 4: Count how many participants mentioned each cluster
Step 5: Rank clusters by frequency × intensity
```

### Insight Template

```
OBSERVATION: [What you heard / saw]
PATTERN: [How many / what % of participants mentioned this]
INSIGHT: [What it means — your interpretation]
IMPLICATION: [What to do with it — product, pricing, positioning, GTM]
CONFIDENCE: High / Medium / Low (based on sample size and consistency)
```

### Research Output Document

```
# Market Research Summary — [Date]

## Executive Summary (3 bullets max)
[The 3 most important things you learned]

## Market Size
TAM: $___  SAM: $___  SOM: $___
Methodology: [top-down / bottom-up]

## ICP Profile
Primary: [description]
Secondary: [description]
Who NOT to target: [description + reason]

## Top 3 Customer Insights
1. [Insight] → [Implication]
2. [Insight] → [Implication]
3. [Insight] → [Implication]

## Key Risks / Open Questions
- [What you don't know yet that matters]

## Recommended Next Steps
1. [Action]
2. [Action]
```
