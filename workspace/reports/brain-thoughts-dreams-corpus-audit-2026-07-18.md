# Brain Thoughts & Dreams Corpus Audit — 2026-07-18

**Scope:** Read-only audit of every discoverable file under `Brain/thoughts/` and `Brain/dreams/`. No Brain artifact or source file was changed.

## Executive finding

This is a useful **historical analysis and nightly-synthesis archive**, but it is **not suitable for raw automatic per-turn context injection**. The corpus is verbose, partially schema-drifted, frequently reiterates deferred work, contains point-in-time operational claims, and already records an analysis token-overflow caused by an oversized Thought window. It should feed a small, validated, expiring context-capsule layer instead.

## Inventory and freshness

| Corpus | Files discovered/inspected | Format | Coverage visible in paths | Freshest artifact |
|---|---:|---|---|---|
| `Brain/thoughts/` | **282** | Markdown (`*-thought.md`; plus `.gitkeep`) | 2026-04-09 through 2026-07-16 | `Brain/thoughts/2026-07-16/12-02-thought.md` |
| `Brain/dreams/` | **216** | Markdown (`*-dream.md`, with some `*-cleanup.md`; plus `.gitkeep`) | 2026-04-09 through 2026-07-16 | `Brain/dreams/2026-07-16/23-37-dream.md` |
| **Total** | **498** | Predominantly human-readable Markdown | about 99 calendar days represented, with gaps/multiple daily runs | corpus is ~1–2 days behind this audit date |

Evidence of full-corpus inspection: content searches traversed **282 files** in `Brain/thoughts` and **216 files** in `Brain/dreams` with no skipped large files. Representative paths: `Brain/thoughts/2026-04-09/01-52-thought.md`, `Brain/thoughts/2026-07-16/00-08-thought.md`, `Brain/dreams/2026-04-09/23-35-dream.md`, `Brain/dreams/2026-07-16/23-37-dream.md`, and `Brain/dreams/2026-07-16/00-22-cleanup.md`.

> Note: narrow listing returned only `.gitkeep` for `Brain/thoughts` despite the corpus-wide scanner traversing 282 files. The audit relies on the scanner count, which also returned real paths and contents; this is an inspection/index presentation inconsistency, not evidence of an empty corpus.

## Recurring structures

### Thoughts: window-level operational retrospectives

Early canonical Thought structure (for example `2026-04-09/01-52-thought.md`) is:

```text
---
# Thought <n> — <date> | Window: <UTC start>–<UTC end>
_Generated: <local timestamp>_
## A. Activity Summary
## B. Behavior Quality
## C. Memory Candidates
## D. Improvement Candidates
## E. Window Verdict
```

Recurring field patterns include user/session/cron/task/agent activity; went-well, stalled, tool-usage, and user-correction observations; tabular candidates with **confidence** and **evidence**; and a verdict with `Active`, `Signal quality`, and summary. Later Thoughts retain the activity/quality/evidence core but drift into headings such as `## Summary`, `## Pulse Cards`, `## C. Skill And Workflow Signals`, and `## Active Work Ledger`. Some embed a machine-readable JSON array in a fenced `## Pulse Cards` block (`title`, `body`, `prompt`).

### Dreams: day-level synthesis and reconciliation

Early canonical Dream structure (for example `2026-04-09/23-35-dream.md`) is:

```text
---
# Dream — <date>
_Generated: <local timestamp>_
_Thoughts synthesized: <n>_
## Day Summary
## Memory Updates Applied
## Proposals Generated
## Deferred Ideas
## Tomorrow's Watch Items
```

Later Dreams add business reconciliation, skill-gardener review, thought-skill audit, fleet metadata audit, and opportunity incubation. The latest full Dream (`2026-07-16/23-37-dream.md`) contains exact recurring sections: `Day Summary`, `Memory Updates Applied`, `Business Reconciliation`, `Business Updates Needing Review`, `Proposals Generated`, `Skill Gardener Review`, `Thought Skill Updates Audited`, `Skill Updates Applied`, `Fleet Skill Metadata Audit`, `Opportunity Incubation`, `Deferred Ideas`, and `Tomorrow's Watch Items`. Cleanup artifacts use a separate schema: `Cleanup Summary`, `Memory Edits`, `Skill Curator Critic`, `Fleet Metadata Regression Check`, and `Preserved On Purpose`.

## Freshness, duplication, and noise

### Strengths

- The archive is evidence-oriented: most actionable claims cite transcript paths, notes, source paths, artifacts, proposal IDs, or ledger rows.
- Dreams explicitly gate memory and proposal promotion rather than assuming every observation is durable. A full-corpus search found **33** occurrences of the exact no-promotion statement, `None - no items passed the memory gate tonight.`
- Deferred work is labeled rather than silently converted into persistent facts. `## Deferred Ideas` appears in **64** Dream artifacts.
- The later format distinguishes real artifacts from hypotheses, including proposal IDs and no-outreach boundaries.

### Duplication / stale patterns

- **Deferred-work repetition:** the same themes reappear across Thoughts, Dreams, and the Active Work Ledger—especially sessions-history payload bounds, screenshot-preview rendering, AI-surface scoring, connector health, NebulaX, and game follow-ups. Repetition is useful for continuity but dangerous as unconditional prompt context.
- **Idle-window boilerplate:** early Thoughts can be long despite reporting no activity, no memory candidates, and no task completions. Example: `2026-04-09/01-52-thought.md` records an idle window but spends 57 lines restating boot state and old blockers.
- **Schema drift:** Unicode versus ASCII title separators, old lettered headings versus newer summary/pulse-card/ledger sections, and Dream versus cleanup variants require tolerant extraction rather than positional parsing.
- **Historical claims age quickly:** proposals, task states, product defects, and “tomorrow” watch items are snapshots. The latest Dream itself identifies an older Xpose create-report proposal as stale because the report now exists (`2026-07-16/23-37-dream.md:13, 61`).
- **Known scale failure:** `Brain/thoughts/2026-04-09/07-58-thought.md` documents that its Thought analysis overflowed a 200k-token budget. That is direct evidence against loading raw files broadly.

## Strongest current actionable insights

These are current enough to be useful, but should be verified against live state before execution:

1. **Xpose Market manual first-customer review packet** — highest concrete business action. The latest Dream records a high-priority, deliberately unsent proposal: `prop_1784259731687_5bceac`, based on a completed sourced prospect JSON/HTML package. The next action is manual selection/review, not automatic outreach. Evidence: `Brain/dreams/2026-07-16/23-37-dream.md:31-35, 58-63, 76-79`.
2. **Bound sessions history payloads** — a real usability/latency problem: history-bearing session read/status emitted roughly 200k tokens while list/find/send/create worked. The archive correctly defers a patch until exact serializer/tool-contract source scouting occurs. Evidence: `Brain/thoughts/2026-07-16/00-08-thought.md:8, 21-24, 48-50`; `Brain/dreams/2026-07-16/23-37-dream.md:62, 70, 78`.
3. **Create a minimal browser-versus-desktop screenshot-preview repro with saved visual proof** — a prior 270-step investigation did not isolate capture, delivery, or mobile rendering. Do not restart broad debugging; make the smallest fixture and preserve visual evidence. Evidence: `Brain/dreams/2026-07-16/23-37-dream.md:41-42, 63, 71, 79`.
4. **Keep NebulaX as an uncommitted local showcase** — a real local site exists, but neither deployment nor an owner-confirmed second pass exists. It is a lower-priority optional product/creative lane, not active launch work. Evidence: `Brain/dreams/2026-07-16/23-37-dream.md:61, 64, 73`.

## Recommendation: curated capsules, not raw injection

**Do not inject raw Thought/Dream Markdown per turn.** Instead, build/select an intermediate capsule only when relevant:

```json
{
  "id": "brain-capsule-<stable-id>",
  "category": "project_context | user_context | system_context | opportunity_context",
  "summary": "1–3 factual bullets",
  "source_paths": ["Brain/dreams/...", "live verification source"],
  "confidence": "high | medium | low",
  "status": "active | deferred | resolved | superseded",
  "last_verified": "YYYY-MM-DD",
  "expires_at": "YYYY-MM-DD or null",
  "requires_live_verification": true,
  "dedupe_key": "stable-topic-key",
  "relevance_tags": ["xpose", "sessions"]
}
```

**Selection rules:** only high-confidence, active, evidence-backed items; maximum 3–5 capsules / roughly 300–600 tokens; exclude idle summaries, historical “tomorrow” items, unresolved speculation, raw tool/process logs, and anything marked deferred/resolved/superseded. Deduplicate against MEMORY, proposals, the Active Work Ledger, and newer Dream entries. Require live verification for operational state and source-fix candidates.

**Bottom line:** preserve the raw corpus as audit/evidence material and a retrieval source. Promote only fresh, compact, state-aware capsules into per-turn context. That gains continuity without recreating the token-overflow and stale-context problems the corpus itself documents.
