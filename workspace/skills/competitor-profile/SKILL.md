---
name: competitor-profile
description: Lead  Competitor
emoji: "🧩"
version: 1.0.0
---

# Competitor Profile

Use this skill to build a comprehensive intelligence dossier on a specific competitor or company. Uses web_search, web_fetch, and optionally deploy_analysis_team for full website audits.

---

## 1. Information to Gather

For each competitor, collect data across 8 dimensions:

### A. Company Basics
- Full name, legal entity, founding year, headquarters
- Funding stage and known investors (Crunchbase, PitchBook, press)
- Headcount estimate (LinkedIn, team page, Glassdoor)
- Key executives (CEO, CTO, CMO — LinkedIn)
- Revenue signals (ARR, GMV if public; estimates from employee count × industry benchmarks)

### B. Product & Features
- Core product description (their own words from homepage/docs)
- Feature list (from pricing page, docs, or screenshots)
- Unique differentiators they emphasize
- Integrations and ecosystem
- Free tier / trial / freemium vs paid gate
- Tech stack (detect via BuiltWith, Wappalyzer, or source inspection)

### C. Pricing
- Pricing tiers (names, prices, included features)
- Annual vs monthly discount
- Enterprise tier (custom pricing signals)
- Free plan limits
- Recent pricing changes (search "CompanyName pricing 2026" or "CompanyName raised prices")

### D. Positioning & Messaging
- Their headline value proposition (H1 on homepage)
- Who they target explicitly (use cases, industries, company sizes)
- Pain points they claim to solve
- Key emotional triggers in copy (productivity, savings, simplicity, power, etc.)
- Brand tone (formal, casual, technical, friendly)
- Tagline or slogan

### E. SEO & Content Footprint
- Run deploy_analysis_team OR web_search to check:
  - Domain authority signals (who links to them)
  - Blog content topics and frequency
  - YouTube/video presence
  - Keywords they rank for (search: `site:competitor.com`)
  - Guest posts, PR, earned media

### F. Social & Community
- X/Twitter followers, posting frequency, engagement style
- LinkedIn followers, content strategy
- Reddit mentions (search: `site:reddit.com "CompanyName"`)
- Slack/Discord community (size, activity)
- YouTube subscribers and content type

### G. Customer Signals
- G2, Capterra, Trustpilot, App Store reviews → common praise and complaints
- Case studies on their site → industries served, outcomes claimed
- Notable customers they name publicly
- Churn signals (search: "CompanyName alternative", "switching from CompanyName")

### H. Team & Hiring Signals
- Open job roles → reveals strategic bets (hiring AI engineers = building AI features)
- LinkedIn headcount growth (fast growth = well-funded, investing)
- Key recent hires (former execs from specific companies signals direction)
- Glassdoor rating and common complaints (culture, product-market fit signals)

---

## 2. Research Workflow

```
Step 1: Homepage deep-read
  → web_fetch("https://competitor.com")
  → Capture: headline, subheadline, features, CTAs, social proof

Step 2: Pricing page
  → web_fetch("https://competitor.com/pricing")
  → Capture: tiers, prices, limits

Step 3: Web search pass 1 — general
  → web_search("CompanyName 2026 review funding features")
  → web_search("CompanyName pricing plans")

Step 4: Web search pass 2 — competitive signals
  → web_search("CompanyName alternative 2026")
  → web_search("switching from CompanyName reddit")
  → web_search("CompanyName vs [your product]")

Step 5: Review mining
  → web_fetch("https://g2.com/products/CompanyName/reviews")
  → web_search("CompanyName review G2 Capterra 2026")

Step 6: Hiring signals
  → web_search("CompanyName jobs 2026 OR hiring")
  → web_fetch LinkedIn jobs page if accessible

Step 7 (optional): Full site audit
  → deploy_analysis_team({ url: "https://competitor.com" })
  → Wait for team_event with SEO, performance, content report
```

---

## 3. Output Template

```markdown
# Competitor Profile: [Company Name]

**Last updated:** [date]  |  **Confidence:** [High / Medium / Low — based on data freshness]

---

## TL;DR
[3-sentence executive summary: who they are, who they serve, and their key strength/weakness]

---

## Company Basics
| Field | Value |
|---|---|
| Founded | [year] |
| HQ | [location] |
| Funding | [stage, total raised, lead investors] |
| Team size | ~[N] (est.) |
| CEO | [name] |

---

## Product
**Core value prop:** "[their own words]"

**Key features:**
- [Feature 1]
- [Feature 2]
- [Feature 3]

**Differentiators:** [What they claim makes them unique]

**Tech stack:** [detected technologies]

---

## Pricing
| Tier | Price | Key limits |
|---|---|---|
| Free | $0 | [limits] |
| [Tier 1] | $X/mo | [limits] |
| [Tier 2] | $Y/mo | [limits] |
| Enterprise | Custom | — |

---

## Positioning
- **Target:** [company size, industry, role]
- **Pain point:** [what problem they solve]
- **Tone:** [formal / casual / technical]
- **Key message:** "[their elevator pitch]"

---

## SEO & Content
- Blog: [frequency, top topics]
- Domain authority: [signals]
- Top keywords: [2-3 detected]
- Media presence: [notable press, podcasts, etc.]

---

## Social Presence
| Channel | Size | Activity |
|---|---|---|
| Twitter/X | [followers] | [posts/week, tone] |
| LinkedIn | [followers] | [type of content] |
| YouTube | [subs] | [content type] |
| Community | [Slack/Discord, size] | [activity level] |

---

## Customer Sentiment
**What customers love:**
- [G2/review insight 1]
- [G2/review insight 2]

**Common complaints:**
- [Complaint 1]
- [Complaint 2]

**Churn triggers:** [What makes people leave, from "alternative" searches]

---

## Hiring Signals
- Currently hiring for: [roles]
- Strategic implication: [what this reveals about their roadmap]

---

## Competitive Gaps & Opportunities

| Our strength | Their weakness | Opportunity |
|---|---|---|
| [X] | [Y] | [Z] |

---

## Threat Level
**Short-term:** [Low / Medium / High]
**Long-term:** [Low / Medium / High]
**Rationale:** [Why]
```

---

## 4. Quality Rules

- **Cite sources** for every major claim (URL or publication)
- **Date-stamp** pricing and headcount — these change frequently
- **Flag low-confidence estimates** with (est.) or (unconfirmed)
- **Don't rely on a single source** — cross-reference claims across 2+ sources
- **Search for recent news** — funding rounds, product launches, pivots change everything