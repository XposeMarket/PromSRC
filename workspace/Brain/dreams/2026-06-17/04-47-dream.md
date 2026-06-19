# Brain Dream — 2026-06-17
_Generated: 2026-06-18 04:47 local_

## Executive verdict
2026-06-17 was a high-signal Prometheus product day. The strongest completed work was source-level: model default persistence, mobile `switch_model` badge reversion, mobile drawer long-press session actions, and Anthropic runtime-steer compatibility all moved from reported bugs to verified current-source behavior. The strongest unfinished work is also source-level: the interactive `/goal` coding loop still has an under-contextualized judge, even though the worker path itself runs through the normal interactive turn machinery.

The Dream should preserve three next-action anchors:
1. **Finish `/goal` judge context before Raul leans on it for coding work.** Raul explicitly said this is super important, and current source still supports the diagnosis.
2. **Build the Smokers Paradise demo site.** The project exists as an empty directory after a “done” response, so it is a visible fulfillment gap and a good Xpose-style demo artifact.
3. **Run a self-doc sync pass.** Several self-edits shipped faster than `workspace/self` documentation, conflicting with Raul’s hard rule that Prometheus source edits must update correlated docs before completion.

## Live artifact checks
- `Brain/active-work.jsonl` exists with 38 entries and was last updated `2026-06-18T08:39:23.578Z`.
- `Brain/proposals.md` existed before this Dream but still carried the prior `2026-06-16` heading/artifact pointer.
- `Brain/business-candidates/2026-06-17/candidates.jsonl` contains the Smokers Paradise demo-site entity candidate.
- `entities/projects/prometheus.md` existed but had not yet recorded the 2026-06-17 Prometheus source/product events.
- `entities/projects/smokers-paradise-demo-site.md` did not exist before this Dream.
- `Brain/dreams/2026-06-17/` did not exist before this Dream and was created for this artifact.

## What shipped or resolved

### Model default persistence
Current evidence indicates this is resolved. The Settings Save behavior now persists model-tab live settings even when another tab is active; template Save pins the startup default; gateway startup re-applies `background_agent` in addition to the other model defaults.

Evidence:
- `audit/chats/transcripts/mobile_mqi5k8a7_gajh23.md:75-111`
- `src/gateway/core/startup.ts:239-246`
- `web-ui/src/pages/SettingsPage.js:3363-3420,4096-4124`
- `Brain/active-work.jsonl` entry `model-default-template-save-and-background-agent-restore` resolved

### Mobile model badge reversion after `switch_model`
Resolved in the current source path. Gateway emits `model_reverted`; mobile API routes the event; mobile page code refreshes the badge through `refreshMobileModelBadge()`.

Evidence:
- `src/gateway/routes/chat.router.ts:7176`
- `web-ui/src/mobile/mobile-api.js:1532`
- `web-ui/src/mobile/mobile-pages.js:6707-6711`
- `web-ui/src/mobile/mobile-model-badge.js:207-216`

### Mobile drawer long-press session actions
Resolved after an iOS correction loop. Long press now opens the haptic/context action sheet; pin placement, duplicate suppression, keyboard focus, keyboard-following rename sheet, scroll regression, full-width input, and Done-key save were iterated into the expected shape.

Evidence:
- `audit/chats/transcripts/mobile_mqi6g80i_astfmk.md:19-122`
- `memory/2026-06-17-intraday-notes.md:15-36`
- `web-ui/src/mobile/mobile-shell.js:899-1013`
- `web-ui/src/mobile/mobile-shell.js:1318-1402`
- `web-ui/src/styles/mobile.css:395-415`

### Anthropic runtime steer compatibility
Resolved in current source. The API-incompatible fake assistant acknowledgement after runtime steer injection is skipped for Anthropic, preventing assistant-prefill errors.

Evidence:
- `audit/chats/transcripts/mobile_mqie9g04_i4kfx4.md:1-109`
- `src/gateway/routes/chat.router.ts:4730-4740`

### Cron scheduler parallel dispatch / deadlock class
Do not re-propose. Current source already contains `runningJobIds`, `executeJob()` `try/finally` cleanup, and parallel overdue-job dispatch in `tick()`.

Evidence:
- `src/gateway/scheduling/cron-scheduler.ts:746`
- `src/gateway/scheduling/cron-scheduler.ts:1128-1152`
- `Brain/active-work.jsonl:38`

## Still open / highest leverage

### 1. `/goal` judge context and continuation directive
This is the top source seed. The interactive worker path is good: `startMainChatGoalRunner()` runs continuation turns through `runInteractiveTurn()`, so worker iterations receive the normal interactive tool/prompt stack. The weakness is the judge. `judgeMainChatGoal()` still judges from goal text, progress summary, denied actions, and latest assistant response under a hardcoded `GoalJudge` prompt. It does not include original session context/history or recent structured tool observations, even though `maybeSummarizeMainChatGoal()` already has richer context access.

Why it matters: Raul explicitly said `/goal` is “super important” before using Prometheus for more coding tasks. An under-contextualized judge can prematurely mark work done or loop vaguely after tool-heavy coding work.

Evidence:
- `audit/chats/transcripts/mobile_mqiga1sf_7j9s8m.md:43-87`
- `src/gateway/main-chat-goals.ts:230-255`
- `src/gateway/main-chat-goals.ts:308-351`
- `src/gateway/routes/chat.router.ts:7353-7425`
- `Brain/active-work.jsonl` entry `main-chat-goal-judge-context-and-continuation`

Recommended next action: use the dev-edit fast route, not a full proposal, when Raul asks to fix this. Required implementation shape should be source-grounded: re-read `workspace/self/`, inspect `main-chat-goals.ts` and `chat.router.ts`, pass recent session/context/tool observations into the judge, return a richer continuation directive, feed that directive into the next continuation prompt, update self docs, build/reload, and smoke a tiny `/goal` loop.

### 2. Self-doc drift after source edits
Still open. Recent source edits shipped faster than self docs. The drift now includes 2026-06-17 edits plus later 2026-06-18 mobile recovery/trace work.

Docs needing attention:
- `self/03-execution-and-prompting.md` — `/goal`, runtime steer/Anthropic guard, dev-edit completion expectations.
- `self/09-providers-and-models.md` — model default persistence and `switch_model` reversion event flow.
- `self/16-mobile-app.md` — mobile drawer long-press actions plus 2026-06-18 recovery/cache/tool-trace updates.

Evidence:
- `Brain/active-work.jsonl:9`
- `Brain/active-work.jsonl:21`
- `self/16-mobile-app.md` last modified before later 2026-06-18 rapid mobile edits
- `Brain/thoughts/2026-06-17/06-06-thought.md:51-56`
- `Brain/thoughts/2026-06-17/17-22-thought.md:53-58`

### 3. Skill-gardener business classifier false positives
Still open. The classifier continues to label technical/dev/trading workflows as business/vendor/outreach/social workflows because broad lexical triggers such as `tool`, `provider`, `proposal`, `process`, `follow-up`, and `social` appear in unrelated Prometheus work.

Evidence:
- `src/gateway/brain/skill-episodes.ts:205-221`
- `Brain/skill-gardener/2026-06-17/live-candidates.jsonl:1-7,20-21`
- `Brain/skill-gardener/2026-06-18/workflow-episodes.jsonl:1-6,8,14`
- `Brain/active-work.jsonl:20`

Recommended fix: source-level classifier hardening with fixtures/exclusions for Prometheus self-edits, mobile UI/source work, skill maintenance, scheduled trading briefs, AI smoke tests, and internal tool-stream/recovery work.

### 4. Smokers Paradise demo site
Open. The user-facing task was effectively under-completed: a directory exists, but the demo artifact does not. This is not a conceptual idea anymore; it is a concrete artifact request and a useful local-business/Xpose-style demo.

Evidence:
- `audit/chats/transcripts/mobile_mqi88c4i_k8pv3t.md:1-12`
- `Brain/business-candidates/2026-06-17/candidates.jsonl:1`
- `demos/smokers-paradise/` directory exists but is empty
- Pending proposal `prop_1781754019396_8e6938`

Recommended build shape: polished one-file demo landing/catalog/reservation flow under `demos/smokers-paradise/`, centered around browse products, reserve/order online, pickup in-store, and pay in person.

### 5. AI smoke test X-search half
Open but lower priority. Reddit collection produced useful signals after the Anthropic steer fix, but the X-search portion paused before completion.

Evidence:
- `audit/chats/transcripts/mobile_mqie9g04_i4kfx4.md:117-135`
- `Brain/skill-episodes/2026-06-17/episodes.jsonl:5-8`

## Proposal state to preserve
No new proposal was filed in this continuation. Keep the existing proposal map instead of duplicating work.

### Current/high-signal pending proposals
- `prop_1781754019396_8e6938` — Build the Smokers Paradise demo site. Keep open; current artifact check still supports the gap.
- `prop_1781753474168_6d4e91` — Fix dev-edit hot-restart completion-note logging. Keep open; dev-edit restarts still create operational friction.
- `prop_1781734228086_5a496c` — Harden Skill Gardener business workflow classification. Keep open; 2026-06-17 and 2026-06-18 evidence still supports it.
- `prop_1781322308947_26bdc8` — xAI/Grok credit usage tracking. Keep open; no duplicate needed.
- `prop_1781240319803_9193f9` — Robinhood Trading MCP OAuth support. Keep open; no duplicate needed.

### Do not re-propose
- Cron scheduler parallel dispatch/deadlock recovery: resolved in current source.
- X credentials restore: later X/Mara workflows succeeded; treat browser-run fragility as the current watch item instead of credential absence.

## Entity / memory actions completed by this Dream
- Created `entities/projects/smokers-paradise-demo-site.md` for the demo-site project candidate.
- Appended 2026-06-17 Prometheus project events to `entities/projects/prometheus.md` for model defaults, mobile badge reversion, drawer long-press actions, Anthropic steer fix, `/goal` open gap, self-doc drift, and skill-gardener classifier false positives.
- Updated `Brain/proposals.md` to point at this 2026-06-17 Dream artifact and keep the correct pending-proposal map.

## Next-run checklist
1. If doing source work: prioritize `/goal` judge context via dev-edit fast route with correlated self-doc updates.
2. If doing artifact work: execute the pending Smokers Paradise demo build and verify the directory is no longer empty.
3. If doing maintenance: sync self docs for 2026-06-17/18 source edits before more source churn.
4. If doing classifier work: use 2026-06-17 and 2026-06-18 gardener false positives as fixtures.
5. Avoid filing duplicate proposals for already-pending xAI/Grok usage, Robinhood OAuth, classifier hardening, or Smokers Paradise.
