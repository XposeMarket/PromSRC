# Brain Thought 2 — Observation + Seed Capture

Date: 2026-06-14  
Window: 2  
Source window: 2026-06-14 06:45 UTC → 2026-06-14 12:57 UTC  
Session: `brain_thought_2026-06-14_02-45`  
Mode: observe, verify current state against live artifacts, light research, maintain Active Work Ledger, low-risk existing-skill maintenance only.

## Current-state observations

### 1. Mara / @raulinvests had a strong reliability window

Mara remained healthy through the second observation window. From 06:45 UTC through 12:57 UTC, the X account operator logged four more successful scheduled runs:

- 08:02 UTC: `prometheus-x-research-replies` posted 3 replies.
- 09:03 UTC: `prometheus-x-posts` posted 1 original.
- 10:02 UTC: `prometheus-x-research-replies` posted 3 replies.
- 12:02 UTC: `prometheus-x-research-replies` posted 3 replies, 0 quote reposts, 0 regular reposts.
- 12:20 UTC: `prometheus-x-posts` posted 1 original.

Combined with the earlier 2026-06-14 runs, this makes the current-day operating substrate very clear: direct status URLs for replies, keyboard compose/reply (`n`/`r`), `browser_type`, `Control+Enter`, page-text verification, schedule-memory/intraday logging, and `browser_close`.

The most important distinction is now operational rather than conceptual: use home/search feeds for discovery only when necessary; use deterministic URLs for the actual reply/post path. This keeps the scheduler out of the fragile browser-state zone.

Evidence:

- `memory/2026-06-14-intraday-notes.md` task notes at 08:08, 09:06, 10:08, 12:19, and 12:22 UTC.
- `.prometheus/subagents/x_account_operator_raulinvests_v1/memory/schedule-memory.md` contains matching 2026-06-14 run logs.
- Current injected TODAY_NOTES confirm all five later-window runs.

Seed captured: X posting/reply skills should continue treating keyboard compose + direct status URLs as the primary reliable path, not as a fallback.

### 2. The browser_snapshot ban is now validated by live cron success

The 2026-06-14 scheduled-job 400 errors were tied to `browser_snapshot` use inside scheduled X prompts. After the prompts were patched to avoid snapshot calls, the cron lanes kept succeeding across multiple reply and original-post runs.

This is stronger than a theoretical prompt fix. The later-window evidence shows repeated success under the no-`browser_snapshot` guardrail:

- Research-replies runs verified with direct URLs + page text, not snapshots.
- Original-post runs used keyboard compose and compact focus confirmation.
- No new snapshot-related 400 error appears in the observed window.

Seed captured: scheduled browser jobs need a stricter compatibility profile than interactive browser work. For X cron jobs, `browser_snapshot` should remain banned unless the scheduler/tooling compatibility issue is intentionally revisited and tested.

### 3. `browser_scroll_collect` remains the main browser fragility, but recovery is known

The earlier window exposed `browser_scroll_collect` failing with `Target page, context or browser has been closed` on X home/search collection. The later window did not need to solve that at source level because the scheduled workflows stayed healthy by avoiding that path for execution.

The lesson is mature enough to promote into skills/resources:

- Treat page/context closed after collection as a terminal state for that page.
- Do not loop snapshots, scrolls, or JS probes against the dead target.
- Reopen a deterministic status/search URL and continue from fresh state.
- Close the browser after completion to avoid CDP/profile contention.

Evidence:

- Earlier 2026-06-14 thought files captured the failure and recovery.
- Later run insights repeatedly confirm the deterministic URL path remained reliable.
- `Brain/skill-gardener/2026-06-14/live-candidates.jsonl` includes candidates for `prometheus-x-research-replies`, `browser-automation-playbook`, and `x-browser-automation-playbook`.

Seed captured: add a focused troubleshooting note/resource to browser/X automation skills rather than changing broad metadata.

### 4. Mobile skill trigger pill fix is complete; the reusable lesson is mobile auth-helper discipline

The mobile skill trigger pill was fixed earlier in the day in two passes:

1. Add `_pmEnsureSkillTriggerCacheLoaded()` so mobile could lazily load skill metadata before rendering trigger pills.
2. Replace bare `fetch('/api/skills')` with `mobileGatewayFetch('/api/skills')` after the first pass hit a paired-mobile auth failure.

This later Thought window did not reopen the bug. The durable seed is the mobile engineering rule: paired mobile surfaces should call gateway endpoints through authenticated mobile helpers, not bare fetch, unless the endpoint is intentionally public.

Evidence:

- `memory/2026-06-14-intraday-notes.md` DEV_EDIT_COMPLETE notes at 04:57 and 05:01 UTC.
- Earlier thought observations confirm the exact root-cause sequence.
- Active Work Ledger doc-debt item now includes this as a self-doc sync candidate.

Seed captured: update mobile/frontend debugging docs or skill resources with: “mobile endpoint 401/missing data → check bare fetch vs `mobileGatewayFetch` first.”

### 5. Skill-gardener output is plentiful; immediate metadata maintenance is not needed

The skill system does not need fleet metadata cleanup right now. Recent audit state is healthy: 123 skills, 0 flagged, avgScore 100.

The meaningful maintenance queue is content-level:

- `Brain/skill-gardener/2026-06-14/live-candidates.jsonl`: 43 candidates.
- `Brain/skill-gardener/2026-06-14/workflow-episodes.jsonl`: 11 lines / 8 workflow episode records.
- `Brain/skill-episodes/2026-06-14/episodes.jsonl`: 31 lines / 8 sessions.

Strongest candidates:

1. X research-replies: no-snapshot cron profile, direct status URL path, dead-context recovery.
2. Browser automation playbook: deterministic reopen after target page/context closes during scroll/collection.
3. X browser automation playbook: same X-specific recovery and verification notes.
4. Mobile/frontend debugging: authenticated helper pattern for paired mobile API calls.
5. Hook library / X posts workflow: preserve the current no-em-dash/no-generic-copy style while reinforcing keyboard compose.

No new skill should be created from this Thought. The evidence points to small existing-skill resource additions after the classifier issue is controlled.

### 6. Skill-gardener business classifier false positives remain open and gained better negative examples

The classifier issue is still live: scheduled X/social workflows can be mislabeled as quote/invoice/deal-like business workflows. The later 2026-06-14 window adds more high-quality negative examples because all observed workflows were social posting/reply operations, not business document ingestion or commercial deal analysis.

This matters because the labels can pollute business memory, route candidates toward irrelevant skills like deal/document ingestion, and make social automation look like business quote handling.

Seed captured: classifier tests should include these negative examples:

- `prometheus-x-research-replies` reply batches.
- `prometheus-x-posts` original posts.
- “quote repost” / “regular repost” language from X workflows, which should not imply quote/invoice/business-document workflows.

Evidence:

- `Brain/active-work.jsonl` item `skill-gardener-business-classifier-false-positives` remains `in_progress`.
- TODAY_NOTES show multiple X-only workflows in the current window.
- Existing active-work evidence from 2026-06-13 already documents the false-positive pattern.

### 7. Active Work Ledger state changed in a few places

Recommended ledger updates from this Thought:

- `mara-x-account-operator-raulinvests`: update current state with the later 08:02/09:03/10:02/12:02/12:20 UTC successes and reaffirm direct URL/keyboard path.
- `skill-gardener-business-classifier-false-positives`: keep `in_progress`; add 2026-06-14 later-window negative examples.
- `self-docs-write-blocked-in-dev-edit-scope`: keep `in_progress`; add mobile skill trigger helper doc debt.
- `generate-image-v2-product-surface`: no new implementation in this observation window; preserve as `in_progress` with prior partial UX improvements and deeper product surface still open.

## Seeds for later Dream / maintenance

1. **Existing-skill resource:** Add `references/x-cron-no-snapshot-direct-url-recovery-2026-06-14.md` to `prometheus-x-research-replies` or X browser automation skill.
2. **Existing-skill resource:** Add browser recovery note: “Target page/context closed during collection → reopen deterministic URL; do not retry against dead page.”
3. **Mobile/frontend docs:** Capture paired mobile gateway helper rule in `self/16-mobile-app.md` or a frontend debugging skill resource when source-doc write scope is available.
4. **Classifier fix:** Add social workflow negative examples before promoting skill-gardener candidates that were generated from X jobs.
5. **No action:** Do not create new skills from this window; the existing skills are the right homes.

## Active Work Ledger updates applied

- Updated `mara-x-account-operator-raulinvests` with later 2026-06-14 cron successes and current reliable path.
- Updated `skill-gardener-business-classifier-false-positives` with later-window negative examples.
- Updated `self-docs-write-blocked-in-dev-edit-scope` with mobile skill trigger helper doc debt.
- Reverified `generate-image-v2-product-surface` as still open with no new implementation observed in this window.

## Bottom line

The window is mostly a reliability confirmation. Mara is running cleanly under the no-`browser_snapshot` scheduled-job profile, direct URLs + keyboard interaction are now the proven X automation path, and the mobile trigger pill bug produced a reusable mobile-auth helper lesson. The main unresolved system risk is not posting reliability; it is skill-gardener classification quality around social workflows.