---
name: Local Lead Hunting
description: Run a repeatable, browser-first local prospecting workflow that finds real businesses, checks their websites, saves evidence, and separates strong leads from weak ones.
emoji: "🧩"
version: 2.2.0
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
6. Before manual scrolling loops on listing pages, make one real page interaction first when practical (for example clicking into the listings/results pane or selecting a business card). This avoids automation-layer blind-scroll guards that can block repeated `browser_scroll(...)` calls on some sites.
7. If the goal is broad candidate harvesting rather than tight UI steering, prefer bulk collection/extraction patterns over repeated single-scroll retries.

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

## Xpose Market Workflow

For **Xpose Market revenue prospecting** (or similar systematic agency lead-hunting), follow this specialized workflow:

### Discovery and Screening

1. **Read existing workspace artifacts first**
   - Check `Xpose Market/*.md` run logs and prospect files.
   - Use the same format and directory structure to ensure findings persist across sessions.
   - If a prospect has already been screened, update the existing record instead of re-screening.

2. **Live Google Maps discovery**
   - Start from Google Maps listings for target geographies and service categories.
   - Capture candidate URLs, review counts, and listing evidence into the run log as you discover them.

3. **Parallel candidate screening with background_spawn**
   - Use `background_spawn` to run independent website-screening agents **in parallel** with Prom's main Maps discovery.
   - Each `background_spawn` agent must:
     - Open its own **separate browser session** or tab (not share Prom's Maps session).
     - Open the candidate website in that independent browser.
     - Take `browser_snapshot()` and `browser_vision_screenshot()` for visual assessment (not just text fetch).
     - Scroll/inspect the site to collect evidence (CTA clarity, design quality, contact info, service clarity, trust signals).
     - Return a structured summary or patch back to the workspace artifact with visual findings, score, and outreach angle.
   - Do **not** create durable subagent tasks or use `deploy_analysis_team` for screening unless the user explicitly asks for deeper analysis.
   - Each background agent should be independent: one agent per candidate batch, separate browser tab, concurrent execution.

4. **Main Prom focus**
   - Keep Prom's main browser focused on **discovery** (Google Maps, listing accumulation, quick qualification notes).
   - While background agents screen candidates, continue scanning more maps listings.
   - This parallelism keeps discovery moving without bottlenecking on website assessment.

### Failure Handling

**If `background_spawn` hits rate limits (Anthropic 429, timeout, etc.):**
1. Note in the run log which candidates were blocked by the provider error.
2. Continue manual screening in Prom's main browser if time permits.
3. Mark those candidates as "awaiting background retry" or "text-screened only, visual pending."
4. Optionally retry later with a different model/provider.
5. **Do not silently skip them or treat them as unscreened.**

**If browser visual inspection is unavailable** (e.g., Playwright Chromium missing in runtime, headless shell not installed):
1. Fall back to text-only screening (web_fetch, web_search snippets, official site text extraction).
2. **Explicitly mark the candidate as "text-screened only"** in the evidence note.
3. Add a flag: `visual_inspection: blocked` or similar in the record.
4. Document the blocker reason.
5. **Require a later visual follow-up pass before creating mockups or final pitches.**
6. Do not treat text-only evidence as equivalent to visual screenshots when judging design quality or CTA clarity.

### Lead Hunt → Pitch Package Follow-Through

After ranking all candidates and identifying **A-tier leads**:

1. **Choose the top A-tier lead** for the first pitch package (usually the highest-review, weakest-website candidate).
   - Example from Xpose runs: Castillo Landscaping Services (4.9 / 220 reviews, very weak visual site).

2. **Create a dedicated pitch-package artifact** in the workspace with:
   - **Critique section:** Current site weaknesses (design, CTAs, trust signals, mobile feel, conversion flow).
   - **Mockup direction:** What the redesigned site should include (hero headline, service cards, gallery, estimate CTA, trust badges, review proof).
   - **Outreach copy:** The pitch angle and value proposition (e.g., "Your reviews are doing the hard part — the site just needs to turn that trust into estimates").
   - **Call script:** Key talking points and differentiators for the initial outreach call.
   - **Next actions:** Research contact info, verify business ownership, send pitch, schedule discovery call, build mockup.

3. **Link the pitch package from the run log**
   - Add a line like: "**Pitch Package Created:** [Castillo Landscaping Services](./pitch-packages/castillo-landscaping-2026-04-27.md)"
   - This keeps the discovery work tied to outreach execution.

4. **Save time on future runs**
   - Once a pitch package exists, do not re-screen that candidate unless there is new evidence.
   - Link back to the package in the prospect CSV record.

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
- fall into blind manual scroll loops on listing pages; if scrolling is blocked, re-anchor with a real interaction or switch to bulk collection/extraction tools instead of retrying `browser_scroll(...)` repeatedly

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

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-29 | v2.2.0: Added Xpose Market workflow section with `background_spawn` parallel-screening guidance, independent browser-session requirements for candidate evaluation, 429/timeout fallback handling, text-screened-vs-visual-screened status tracking, and lead-hunt-to-pitch-package follow-through for A-tier leads. Preserved general map-first local-lead guidance for non-Xpose work. |
| 2026-04-23 | v2.1.0: Added browser scroll-guard guidance for live listing workflows. Documented that repeated blind `browser_scroll(...)` retries can be blocked by the automation layer, so the workflow should re-anchor with a real interaction or switch to bulk collection/extraction patterns instead. |