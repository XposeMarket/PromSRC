---
name: Xpose Lead → Manual Outreach Packet
id: xpose-lead-outreach-packet
description: Package an already-qualified Xpose lead into a manual outreach/demo packet using existing audit, business-intel, pitch, demo, and brand assets, with explicit no-external-contact guardrails.
triggers:
  - xpose outreach packet
  - manual outreach packet
  - lead to outreach packet
  - package this lead
  - xpose pitch packet
  - create outreach copy for lead
  - turn audit into sales packet
  - Frederick-style packet
categories:
  - sales
  - xpose
  - outreach
  - local-business
  - reporting
required_tools:
  - file_ops
  - skills
optional_tools:
  - web
  - html-interactive
  - report-generator
permissions:
  workspace_read: true
  workspace_write: true
  external_side_effects: false
  browser_social_email_sending: false
---

# Xpose Lead → Manual Outreach Packet

Use this skill to turn an already-qualified Xpose Market lead into a reviewable manual outreach/demo packet. The Frederick Roof Repair packet is the first successful pattern: qualification → audit/intel/pitch/demo/brand assets → one no-contact packet Raul can review before deciding whether to reach out manually.

## When to use

Use this only when the lead already has at least:

- A qualification scorecard or master scorecard entry.
- One or more supporting assets such as website audit, business intel, pitch package, homepage/demo asset, or brand/visual asset.
- A clear Xpose-relevant pain angle tied to conversion, reputation packaging, local SEO, trust, mobile funnel, service-page structure, or visual credibility.

Do **not** use this skill for cold generic outreach from scratch. If the lead lacks evidence, produce a gap list and stop instead of inventing claims.

## Hard no-contact guardrail

Never send email, submit forms, call, DM, post, create CRM entries, trigger follow-ups, or otherwise contact the lead while using this skill.

The output is a manual review packet only. Raul decides if, when, and how to use it.

Every packet must explicitly say:

- No outreach has been sent.
- No CRM entry has been created.
- No email, call, SMS, DM, form submission, or follow-up automation has happened.
- Raul must manually review and approve any contact.

## Required input discovery

1. Read the master scorecard, usually:
   - `teams/team_moto00fr_2c910f/workspace/xpose-market/qualified/master-scorecard.md`
2. Locate the lead-specific qualification file.
3. Locate supporting artifacts when present:
   - Audit: `teams/team_moto00fr_2c910f/workspace/xpose-market/audits/...`
   - Business intel: `teams/team_moto00fr_2c910f/workspace/xpose-market/intel/...`
   - Pitch: `teams/team_moto00fr_2c910f/workspace/xpose-market/pitches/...`
   - Demo: `teams/team_moto00fr_2c910f/workspace/xpose-market/demos/<lead-slug>/`
   - Brand assets: `teams/team_moto00fr_2c910f/workspace/xpose-market/brand-assets/<lead-slug>/` or `generated/images/brand-kits/...`
4. Verify whether public evidence is stale. Use web refresh only if needed and allowed by the task.
5. Write a missing-input/gap list for anything not found. Do not fabricate metrics, screenshots, owner names, review counts, or business facts.

## Packet output convention

Create one folder per lead:

```text
xpose-market/outreach-packets/<lead-slug>/
├── manual-outreach-packet.md
├── one-page-demo.md
└── README.md
```

Use a stable lowercase slug based on the business name, e.g. `frederick-roof-repair`, `sky-cleaning-inc`, `all-around-plumbing-inc`.

## Packet structure

### `manual-outreach-packet.md`

Include these sections:

1. **Business Snapshot**
   - Business name, category, location, website, known contact/public profile details, rating/review proof, business age or credibility signals when evidenced.
   - Why this is a fit, tied to the scorecard and supporting artifacts.
2. **Evidence-backed problem teardown**
   - 3–7 concrete website/marketing/conversion issues.
   - Each claim must come from an audit, intel file, scorecard, demo notes, or refreshed source.
3. **Before/after narrative**
   - Current state.
   - Redesigned/Xpose state.
   - Demo and brand-asset references when available.
4. **Offer angle and value proposition**
   - Opening hook Raul can adapt.
   - Core pitch.
   - Scope summary.
5. **Manual outreach copy variants**
   - Email draft.
   - Short SMS/DM-style draft.
   - Call opener or voicemail.
   - Follow-up draft.
   - Label all drafts as manual-use only.
6. **Objection handling**
   - 3–5 likely objections with grounded answers.
   - Avoid fake ROI guarantees; use caveats and ranges only if supported.
7. **Supporting artifacts and links**
   - Relative paths to pitch, qualification, audit, intel, demo, brand kit, and live business links when present.
8. **Critical status: DO NOT SEND AUTOMATICALLY**
   - Explicit no-contact checklist.
   - Raul manual decision checklist.
9. **Summary / next step**
   - Concise final fit summary and next manual action.

### `one-page-demo.md`

Create a concise one-pager suitable for deck/call prep:

- The lead.
- The problem.
- The opportunity.
- The pitch in one paragraph.
- Expected impact, framed as directional and not guaranteed.
- Xpose Market service scope.
- Quick facts table.
- Supporting assets.
- Manual-review status.

### `README.md`

Create the navigation file:

- What's in the packet.
- Quick start for Raul.
- Supporting artifact index.
- Key context and A-grade rationale.
- Suggested use cases: cold email, phone call, screen share, LinkedIn/manual DM.
- Status and ground rules.
- File structure.
- Methodology/confidence/caveats.
- Next steps.

## Quality gate

Before calling the packet complete, verify:

- Every factual claim is tied to an artifact, source, or clearly labeled caveat.
- No fake screenshots, fake mockups, fake metrics, fake testimonials, or unsupported review counts are included.
- Outreach copy is labeled as draft/manual-use only.
- The packet states no external contact happened.
- Missing assets are listed as gaps, not silently filled in.
- Paths point to existing artifacts when claimed.
- Confidence level and caveats are clear.

## Frederick Roof Repair example pattern

Use the existing Frederick packet as the workflow shape, not as copy to reuse blindly:

- `xpose-market/outreach-packets/frederick-roof-repair/manual-outreach-packet.md`
- `xpose-market/outreach-packets/frederick-roof-repair/one-page-demo.md`
- `xpose-market/outreach-packets/frederick-roof-repair/README.md`

The Frederick pattern includes a business snapshot, 5-point problem teardown, before/after demo narrative, value proposition, manual outreach variants, objections, supporting artifact paths, and a clear no-contact status section.

The upstream scorecard surface is:

- `teams/team_moto00fr_2c910f/workspace/xpose-market/qualified/master-scorecard.md`

At creation time, that scorecard ranked Frederick Roof Repair as the top A-grade lead and listed Sky Cleaning Inc and All Around Plumbing Inc as next A-grade candidates. Treat those as examples of where this skill may apply next, but inspect current artifacts before producing any packet.

## Optional visual presentation

Only if Raul explicitly asks for a visual/deck/web presentation, use an appropriate visual/report skill or HTML output tool. Do not create visual mockups or polished screenshots unless source assets exist or the task explicitly asks for them.
