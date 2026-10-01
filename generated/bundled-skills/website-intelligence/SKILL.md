---
name: "website-intelligence"
description: "Audit a business website for SEO, content, conversion clarity, tech stack, and trust signals using the website analysis team for full audits or web_fetch for narrow checks. Use for site-specific intelligence; use competitor-profile for a company dossier and competitive-intelligence for multi-company market comparison."
---

# Website intelligence

Use for a site-specific audit, especially an agency client prospect's website. For market-level comparison use `competitive-intelligence`; for one company rather than its site use `competitor-profile`.

## Scope first

1. Identify the exact website URL, business, geography, target customer, and decision (lead qualification, SEO, conversion, technical audit, or competitor site comparison).
2. For one small question, use `web_fetch` or `web_search` and cite the pages inspected. Use `web_fetch_batch` for multiple known URLs only when exposed, otherwise batch `web_fetch` URLs. A JS-rendered page may require `browser_automation`.
3. For a full go-to-market audit, load `agents_and_teams` via `request_tool_category` and call `deploy_analysis_team({ url: "https://example.com" })` when available. This tool is a collector-first website analysis, not a persistent team and not a Lighthouse report. It runs specialists for business intelligence, SEO discovery, social reputation, browser funnel, CRO and messaging, technical audit, and competitive positioning. Avoid claiming guaranteed keyword rank, back-link authority, or page-speed scores.

## Full-audit output

1. Inspect the returned structured GTM bundle, specialist status, source evidence, limitations, strengths, findings, scorecard, marketing and sales playbooks, and priority actions. The tool saves a JSON artifact at a `site-analysis-*-bundle-*.json` path in the workspace, not a prebuilt report.
2. Follow the current tool result instructions to create one inline dashboard with scorecards, strengths, findings, playbooks, priorities, and download controls. Follow with a written executive rundown and prioritized marketing, sales, and site-improvement plan. Do **not** call `present_file` after `deploy_analysis_team` merely to surface that JSON.
3. Separate confirmed findings from heuristics or specialist guesses. Tag inaccessible pages, robots restrictions, sparse SERPs, or missing performance/API data as limitations. Any performance estimate is heuristic unless measured with a real tool; do not fabricate Lighthouse, Ahrefs, or Google Search Console data.
4. Prioritize 3 to 5 fixable issues with expected business impact and verification, e.g. inspect meta tags and live CTA before recommending changes. For agency prospecting work, distinguish a prospecting hypothesis from a confirmed client need.
5. Verify the dashboard and written recommendations match the same business and dated bundle. Never silently save an entity summary or submit outreach: `save_to_entity` is optional and should be used only when requested.

## Recovery

If `deploy_analysis_team` is unavailable, times out, or returns incomplete specialists, do a bounded manual audit via `web_fetch`, `web_search`, and browser inspection where necessary. State coverage, observations, and missing evidence; do not pretend a five-agent report ran. If the user only asked for one fact, answer it directly instead of launching the full audit.
