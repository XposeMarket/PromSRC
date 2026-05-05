---
name: website-intelligence
description: Full Website Audit
emoji: "🧩"
version: 1.0.0
---

# Website Intelligence

Full playbook for deploying the one-shot 5-agent website analysis team and interpreting results.

---

## Tool

`deploy_analysis_team({ url })`

- **url**: Full URL including https:// (e.g. `https://example.com`)
- Spawns 5 specialist agents in parallel — runs async, result delivered to main chat via notification event
- Report saved to `workspace/reports/` after completion
- Team self-deletes after delivery

---

## When to Use

Use `deploy_analysis_team` when the user asks to:
- Audit their website
- Check SEO or search rankings
- Analyze site performance or tech stack
- Understand their AI/GEO visibility
- Research a competitor's website
- Get a site score or full report

For a quick single-question web check (e.g. "does my site have HTTPS?"), use `web_fetch` directly instead.

---

## What the 5 Agents Do

| Agent | Checks | Output file |
|---|---|---|
| **SEO Scanner** | Title, meta description, H1/H2, image alt text, canonical, robots meta, SERP presence, top keywords | `findings-seo.md` |
| **Performance & Stack Detective** | Framework detection (Next.js, WP, Shopify), JS bundle size, render-blocking, mobile viewport, lazy loading | `findings-performance.md` |
| **GEO (AI Visibility) Agent** | Brand presence in AI-generated search results, featured snippets, knowledge panels, AI citation score | `findings-geo.md` |
| **Backlinks & SERP Intelligence** | Domain authority signals, top referring domains, competitive ranking gaps | `findings-backlinks.md` |
| **Content Audit Agent** | Page copy quality, readability, value proposition clarity, CTA strength, content gaps | `findings-content.md` |

---

## Workflow

### Standard site audit
```
1. deploy_analysis_team({ url: "https://example.com" })
2. Agents run in parallel (async — takes 2-5 minutes)
3. Result delivered as team_event notification to main chat
4. Report compiled at workspace/reports/[domain]-analysis.md
5. Read report and summarize top 3 priority fixes for the user
```

### Competitive research
```
1. deploy_analysis_team({ url: "https://competitor.com" })
2. When report arrives, compare against user's own site
3. Identify gaps: keywords they rank for, tech advantages, content angles
4. Output a gap analysis with 5 actionable items
```

---

## Reading the Report

After the report arrives, structure your response as:

**1. Score summary** — give each area a rating (SEO: X/10, Performance: X/10, GEO: High/Medium/Low/Invisible, Content: X/10)

**2. Top 3 critical issues** — the highest-impact problems to fix first

**3. Quick wins** — things fixable in <1 day that have outsized impact (missing meta description, no alt tags, etc.)

**4. Strategic recommendations** — 2-3 longer-term moves (tech stack upgrade, content strategy, link building)

Keep it direct. Numbers and specifics over adjectives. If data is missing from a section, note it as "scraping limitation" rather than guessing.

---

## API Limitations

The team uses `web_fetch` + `web_search` — no Lighthouse API or PageSpeed Insights API. This means:
- **Performance scores** are heuristic, not Lighthouse numbers
- **Backlink data** is search-signal based, not Ahrefs/Moz level
- **GEO visibility** is based on web_search sampling, not exhaustive

For production-grade audits, recommend the user also run Google PageSpeed Insights and Ahrefs manually and share results for a combined analysis.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-19 | Initial skill created. Tool wired in Block A2. |