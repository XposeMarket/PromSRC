---
name: financial-model
description: Use this skill for financial modeling, business metric analysis, and projections. Outputs clean tables and optionally generates Excel/CSV files.
emoji: "🧩"
version: 1.0.0
---

# Financial Model

Use this skill for financial modeling, business metric analysis, and projections. Outputs clean tables and optionally generates Excel/CSV files.

---

## 1. Model Types

| Request | Model to build |
|---|---|
| "How long is our runway?" | Cash burn + runway model |
| "What are our unit economics?" | LTV, CAC, payback period |
| "Project revenue for next 12 months" | MRR/ARR growth model |
| "Build a P&L" | Income statement |
| "What's our break-even?" | Break-even analysis |
| "SaaS metrics" | MRR, ARR, churn, NDR, NRR |
| "How much should I raise?" | Fundraising needs model |
| "Model 3 scenarios" | Base / Bull / Bear case |

---

## 2. Required Inputs by Model Type

### SaaS Revenue Model
- Current MRR (or ARR)
- Monthly new MRR (new customer adds)
- Monthly churn rate (%)
- Average contract value (ACV)
- Expansion MRR rate (upsells, %)
- Projection period (months)

### Unit Economics
- Customer Acquisition Cost (CAC): total sales & marketing spend ÷ new customers acquired
- Average Revenue Per User (ARPU): monthly or annual
- Gross margin (%)
- Monthly / annual churn rate (%)
- Payback period target (months)

### Burn & Runway
- Current cash balance
- Monthly operating expenses (breakdown if available: payroll, infra, tools, marketing)
- Monthly revenue (to calculate net burn)
- Expected revenue growth (if any)
- Any planned capital events (fundraise, revenue milestone)

### P&L (Income Statement)
- Revenue by line (recurring, one-time, services)
- COGS (hosting, support, payment processing)
- Sales & Marketing
- R&D / Engineering
- G&A (legal, finance, admin)
- Period: monthly, quarterly, or annual

---

## 3. Core Formula Reference

### SaaS Metrics

```
MRR = Active customers × ARPU (monthly)
ARR = MRR × 12
New MRR = New customers × ARPU
Churned MRR = Churned customers × ARPU
Expansion MRR = Existing customers × upsell ARPU
Net New MRR = New MRR - Churned MRR + Expansion MRR
MRR Growth Rate = (MRR_end - MRR_start) / MRR_start × 100

Logo churn rate = Churned customers / Total customers at start of period
Revenue churn rate = Churned MRR / Total MRR at start of period
NRR (Net Revenue Retention) = (MRR_start + Expansion - Contraction - Churn) / MRR_start × 100
  → NRR > 100% = expansion revenue outpaces churn (excellent)
  → NRR 85-100% = average
  → NRR < 85% = serious churn problem
```

### Unit Economics

```
LTV (simple) = ARPU × Gross Margin % / Churn Rate (monthly)
LTV (discounted) = ARPU × Gross Margin % / (Churn Rate + Discount Rate)

CAC = Total Sales & Marketing Spend / New Customers Acquired (same period)

LTV:CAC ratio:
  > 3:1 = healthy
  > 5:1 = efficient growth
  < 2:1 = may be overspending on acquisition

CAC Payback Period = CAC / (ARPU × Gross Margin %)
  → Target: < 12 months (SaaS)
  → < 6 months = very efficient
  → > 18 months = fundraising risk
```

### Burn & Runway

```
Gross Burn = Total monthly operating expenses
Net Burn = Gross Burn - Monthly Revenue
Runway (months) = Current Cash / Net Burn
  → < 6 months = critical zone
  → 12-18 months = raise now
  → > 18 months = comfortable

Rule of 40 = Revenue Growth Rate (%) + Profit Margin (%)
  → > 40 = healthy SaaS
  → > 60 = elite
```

### Break-Even

```
Break-even units = Fixed Costs / (Price - Variable Cost per unit)
Break-even revenue = Fixed Costs / Gross Margin %
Months to break-even = Fixed Costs / Net New MRR per month
```

---

## 4. Output Templates

### 12-Month MRR Projection Table

```markdown
## Revenue Projection — 12 Months

**Assumptions:**
- Starting MRR: $X,XXX
- New MRR/month: $X,XXX (N new customers × $XX ARPU)
- Monthly churn rate: X.X%
- Expansion rate: X.X%

| Month | Starting MRR | New MRR | Churned | Expansion | Ending MRR | ARR |
|---|---|---|---|---|---|---|
| Jan | $X,XXX | $XXX | -$XXX | $XXX | $X,XXX | $XX,XXX |
| Feb | ... | | | | | |
| ...
| Dec | | | | | $XX,XXX | $XXX,XXX |

**End of year:**
- ARR: $XXX,XXX
- MRR growth: +XX%
- Net MRR added: $XX,XXX
```

### Unit Economics Summary

```markdown
## Unit Economics

| Metric | Value |
|---|---|
| ARPU (monthly) | $XXX |
| Gross Margin | XX% |
| Monthly Churn | X.X% |
| LTV | $X,XXX |
| CAC | $X,XXX |
| LTV:CAC | X.Xx |
| CAC Payback | XX months |
| NRR | XXX% |

**Assessment:** [1-2 sentence health check]
```

### Burn & Runway Summary

```markdown
## Cash Burn & Runway

| Category | Monthly |
|---|---|
| Payroll | $XX,XXX |
| Infrastructure | $X,XXX |
| Sales & Marketing | $X,XXX |
| Tools & Software | $X,XXX |
| Other | $X,XXX |
| **Gross Burn** | **$XX,XXX** |
| Revenue | $XX,XXX |
| **Net Burn** | **$X,XXX** |

**Cash balance:** $XXX,XXX
**Runway:** XX months (until [month/year])
**To 18-month runway, need:** $XXX,XXX additional
```

---

## 5. Scenario Analysis

When modeling uncertainty, always produce 3 cases:

| | Bear | Base | Bull |
|---|---|---|---|
| Growth rate | [low] | [expected] | [high] |
| Churn rate | [high] | [expected] | [low] |
| Runway | [X months] | [Y months] | [Z months] |
| ARR at 12mo | $X | $Y | $Z |

**Assumptions driving each scenario** — be explicit about what changes between cases.

---

## 6. File Output

To generate an Excel (.xlsx) or CSV file:
- Use `skill_read("xlsx-writer")` for Excel output
- Use `run_command` with Python pandas for CSV:
```python
import pandas as pd
df = pd.DataFrame(data)
df.to_csv('workspace/reports/financial_model.csv', index=False)
```
- Or generate a formatted HTML table for browser preview

---

## 7. Financial Modeling Rules

1. **Show all assumptions** — every model is only as good as its inputs
2. **Sensitivity analysis** — vary your key assumption by ±20% and show impact
3. **Don't project more than 24 months** without re-validating assumptions
4. **Revenue ≠ Cash** — note timing differences for deferred revenue, annual contracts
5. **Conservative baseline** — start with base case, offer bull as upside
6. **Label currency and period clearly** — USD monthly vs annual matters