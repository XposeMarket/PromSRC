---
name: "local-lead-hunting"
description: "Discover, verify, qualify, and persist local-business leads from live public sources using explicit market, geography, service, and fit criteria. Use for building or updating a local prospect pipeline; do not use for writing outreach, general market research, or analyzing a lead already selected."
---

# Local lead hunting

Produce an evidence-backed prospect pipeline, not a scraped list of names.

## Define the hunt

Confirm target geography, business category, offer, qualification criteria, exclusions, desired lead count, evidence freshness, and output location. If these are missing, use conservative assumptions and state them.

## Workflow

1. **Discover.** Search multiple relevant public sources and collect candidate business names plus stable URLs.
2. **Deduplicate.** Normalize business name, website/domain, phone, and location before deeper work.
3. **Verify.** Confirm the business exists, serves the target area, and matches the requested category using current source evidence.
4. **Qualify.** Evaluate observable fit signals, likely need, business health, contactability, disqualifiers, and evidence confidence.
5. **Persist.** Update the master prospect table and create per-business evidence only for qualified or meaningfully uncertain candidates.
6. **Review.** Verify counts, links, duplicate handling, qualification reasons, and timestamps before reporting completion.

## Evidence rules

- Separate observed facts from inference.
- Keep a source URL for every material qualification claim.
- Do not invent owner names, emails, revenue, budgets, or pain points.
- Mark stale, inaccessible, contradictory, or low-confidence evidence.
- Respect site terms, authentication boundaries, rate limits, and user privacy.

## Qualification

Use the user’s scoring criteria when supplied. Otherwise assess location/category fit, visible service need, commercial viability, reachable public contact path, and disqualifying conditions. A lead is not “high potential” solely because its website looks weak.

## Boundaries

Use `website-intelligence` for deep analysis of one selected site, `competitor-profile` for a specific competitor, and an outreach skill only after the lead is qualified. Do not contact anyone unless the user separately authorizes outreach.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for persistence schemas, qualification tiers, Xpose-specific handling, team delegation, and file-output templates.
- Read the workspace’s current prospect schema before altering an existing pipeline.

Report search scope, candidates reviewed, qualified/disqualified counts, output paths, evidence gaps, and the strongest reasons behind the final shortlist.
