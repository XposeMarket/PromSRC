---
name: Local Lead Hunting
description: >
  Run a browser-driven local lead discovery and qualification workflow for agency prospecting by scanning live business listings, especially Google Maps, opening real business websites, capturing persistent evidence, and deciding whether each business is a viable lead. Triggers on requests like find local leads, scan businesses in [city], prospect Frederick businesses, go through Google Maps for leads, audit local business websites, qualify local companies, check businesses for website problems, build a local lead list, save evidence while researching, and figure out whether these businesses are worth outreach. Use this when the user wants a repeatable map-first lead-finding process with saved workspace artifacts, quick qualification, and optional deeper site analysis for the strongest candidates.
emoji: 🎯
version: 2.0.0
triggers: find local leads, local lead hunting, google maps leads, go through google maps for leads, scan businesses in, scan local businesses, prospect frederick businesses, prospect local companies, audit local business websites, check businesses for website problems, qualify local companies, build a local lead list, save evidence while researching, local seo opportunity, website lead qualification
---

# Local Lead Hunting

Run a repeatable, browser-first local prospecting workflow that finds real businesses, checks their websites, saves evidence, and separates strong leads from weak ones.

---

## When to Use This

Use this skill when the user wants **real local-business prospecting**, not generic web-research summaries. The work should begin from **live business listings** — preferably Google Maps — then move into the business website, then into qualification.

This skill is for questions like:
- Which local businesses in this city look like good leads?
- Can you go through Google Maps and check actual business websites?
- Which businesses have weak websites, weak SEO, or poor conversion setup?
- Can you save all the evidence while you research so nothing gets lost?

Do **not** use this skill for generic market research, competitor writeups, or one-off web searches with no lead qualification goal.

---

## Core Principle

**Map first. Website second. Qualification third. Deep analysis fourth.**

Do not start by scraping random search snippets and guessing. Start from real local listings, confirm the business is real, inspect the site, record evidence, and only then decide whether the opportunity is worth deeper analysis or outreach.

The workflow must be **persistent**. Save findings to workspace files as you go. Do not leave important findings only in chat.

---

## Scope Boundary

### This skill SHOULD trigger for
- local lead generation for Xpose Market or similar agency work
- city-based prospecting from Google Maps or local listings
- scanning local businesses and checking their sites
- qualifying businesses based on website / SEO / conversion weaknesses
- saving lead evidence and audit artifacts during research

### This skill should NOT trigger for
- generic SEO advice not tied to lead-finding
- broad market research with no business-by-business qualification
- cold outreach writing by itself
- enterprise technical SEO audits with no prospecting component
- casual questions about a city or business category

---

## Required Workspace Persistence

For every lead-hunting run, create or update a stable research folder. Example:

```text
lead-research/xpose-market/
  README.md
  prospects.csv
  YYYY-MM-DD-<city>-run.md
  evidence/
  reports/
```

Minimum persistence requirements:

1. **Run log**
   - Create a dated markdown file for the session or update the current one.
   - Record geography, niches scanned, businesses checked, top candidates, and disqualification reasons.

2. **Master prospect file**
   - Maintain a cumulative CSV or table with one row per business.
   - Update existing rows instead of duplicating businesses on revisits.

3. **Per-business evidence**
   - For promising leads, save a dedicated evidence file with URLs, observed issues, qualification notes, and timestamps.

4. **Audit output linkage**
   - If a deeper analysis report is generated, write the report path and a short summary back into the prospect record and run log.

If the user says no data should be lost, treat these file writes as mandatory.

---

## Standard Data Schema

Capture these fields whenever available:

| Field | Meaning |
|---|---|
| business_name | Business name |
| category | Restaurant, salon, contractor, dental office, etc. |
| city | Target city / area |
| listing_source | Google Maps, local pack, directory, etc. |
| maps_url | Listing URL |
| website_url | Business website |
| has_website | yes / no |
| website_quality_score | 1-10 quick score |
| seo_basics_score | 1-10 quick score |
| conversion_score | 1-10 quick score |
| local_seo_opportunity | 1-10 score |
| viability_score | 1-10 score |
| status | high / medium / low / disqualified |
| primary_issues | Main problems observed |
| outreach_angle | Best outreach hook |
| recommended_service | website rebuild / local SEO / CRO / lead gen |
| evidence_file | Path to evidence note |
| audit_report | Path to saved deeper report |
| last_checked | Date checked |

Suggested CSV header:

```csv
business_name,category,city,listing_source,maps_url,website_url,has_website,website_quality_score,seo_basics_score,conversion_score,local_seo_opportunity,viability_score,status,primary_issues,outreach_angle,recommended_service,evidence_file,audit_report,last_checked
```

---

## Qualification Framework

### High potential
Use when most of these are true:
- real and active local business
- meaningful website, SEO, or conversion weakness is visible
- category where calls, bookings, leads, or foot traffic matter
- believable value proposition for Xpose Market
- outreach angle is specific, not forced

### Medium potential
Use when:
- business is legitimate and relevant
- some weaknesses are visible
- opportunity exists, but urgency, budget fit, or leverage is less obvious

### Low potential
Use when:
- business is real but improvement opportunity is modest
- website is acceptable already
- there is no strong hook for outreach

### Disqualified
Use when:
- duplicate, closed, irrelevant, or bad-fit business
- franchise / edge case where outreach is weak
- site and positioning are already strong enough that the pitch would feel forced

---

## Operating Workflow

### Phase 1 — Prospect discovery
1. Open browser tools and go to Google Maps or another live local business listing source.
2. Search by geography plus niche when helpful.
3. Visually scan actual business listings.
4. Capture raw candidates quickly.
5. Skip obvious non-fits early.

### Phase 2 — Quick qualification
For each candidate:
1. record the listing URL
2. note category, reviews, legitimacy, and whether a website exists
3. open the website if available
4. score first-pass quality using:
   - mobile feel
   - design trust
   - CTA clarity
   - contact accessibility
   - messaging clarity
   - obvious technical / SEO gaps

### Phase 3 — Deep analysis for promising leads
Only for stronger candidates:
1. run a deeper website analysis
2. use `deploy_analysis_team` when the site is worth a fuller breakdown
3. save the resulting report path
4. extract the most useful findings for future outreach

### Phase 4 — Final qualification
Assign one of:
- high potential
- medium
- low
- disqualified

Then update the master prospect file and run log.

---

## Using deploy_analysis_team Well

`deploy_analysis_team` should be used on **selected promising sites**, not every business in the list.

Use it when:
- the business is real and relevant
- the site exists
- the business appears to have genuine upside
- a deeper report would help future outreach or prioritization

Recommended operating pattern:

```text
1. Main Prom agent scans local listings and websites
2. Main Prom agent saves quick-screen findings immediately to workspace files
3. For strong candidates, run deploy_analysis_team(url)
4. Save the returned report path and key findings into the prospect record
5. Continue scanning other businesses while stronger candidates accumulate reports
```

This keeps discovery moving while deeper analysis strengthens the best leads.

---

## Minimum File Outputs Per Run

### 1. Run log
Example:

```text
lead-research/xpose-market/2026-04-11-frederick-run.md
```

Include:
- target geography
- niches scanned
- businesses reviewed
- top candidates
- skipped/disqualified reasons
- reports created

### 2. Master prospect sheet
Example:

```text
lead-research/xpose-market/prospects.csv
```

Use one row per business. Update instead of duplicating.

### 3. Per-business evidence note
Example:

```text
lead-research/xpose-market/evidence/acme-plumbing.md
```

Include:
- listing source and URL
- site URL
- observed issues
- score summary
- outreach angle
- status
- date checked

---

## Quick Viability Heuristics

Use these as fast judgment cues during scanning:

| Signal | Usually raises viability | Usually lowers viability |
|---|---|---|
| Website presence | No site or very weak site | Strong polished site |
| Conversion setup | No CTA, weak contact flow, unclear offer | Clear funnel already in place |
| SEO basics | Thin titles, weak structure, poor local signals | Solid location/service targeting |
| Business type | High-value service categories | Low-leverage categories |
| Outreach angle | Specific, visible fix opportunity | Vague or forced pitch |

---

## Anti-Patterns

Do **not**:
- rely only on generic web_search summaries when the user wants map-first lead hunting
- treat every ugly site as a good lead automatically
- run deep analysis on every business before screening
- keep findings only in chat without writing them to files
- confuse a cool-looking business with a high-probability client
- skip the outreach angle; weak angle usually means weak lead

---

## Mental Trigger Tests

### Clear match
User says: "Go through Google Maps in Frederick and find local businesses with weak websites."
Expected: This skill should load.

### Edge case
User says: "Find local businesses in Frederick and tell me which ones are worth outreach."
Expected: This skill should load.

### False positive
User says: "Explain local SEO for restaurants."
Expected: This skill should not be the primary skill unless lead-finding is also requested.

---

## Completion Standard

A lead-hunting run is complete when:
- businesses were sourced from live listings or equivalent local sources
- findings were persisted to workspace files during the run
- strong candidates were separated from weak ones with clear reasoning
- promising leads include enough evidence to support future outreach
- deeper reports, if created, are linked back into the saved research artifacts
