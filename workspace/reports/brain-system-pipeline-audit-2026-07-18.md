# Brain System Pipeline Audit — 2026-07-18

**Scope:** Read-only audit of the Brain operational structure: persisted state, Active Work Ledger, thought/dream artifacts, manifest/index behavior, visible configuration/docs, and scheduled-job surface. No `Brain/` or system artifacts were changed.

## Executive assessment

Brain is an **in-gateway, state-driven reflection pipeline**, not a user-visible scheduled job. Its operational core is coherent: a 15-minute eligibility ticker creates six-hour Thought runs, a nightly Dream synthesizes the prior local day, and a cleanup pass follows Dream by about 30 minutes. It persists cross-restart status, isolates write permissions by run type, verifies expected artifacts, and backs failed model work off for six hours.

The strongest current operational issue is **output durability without an explicit consumable context layer**. Thoughts and Dreams produce rich markdown and the ledger carries ongoing work, but there is no observed first-class manifest/index for thought/dream discovery, no formal capsule schema, and no TTL/replacement/injection consumer. The result is useful retrospective intelligence that depends on broad filesystem/prompt scans rather than a small, deterministic, per-context carryover packet.

## Current pipeline

```text
Gateway boot
  └─ BrainRunner starts 15-minute eligibility ticker
       ├─ Thought every ~6h (state-based; max 12h catch-up window)
       │    ├─ inspect recent audit/task/session/note activity
       │    ├─ light research + source inspection in private builds
       │    ├─ write Brain/thoughts/YYYY-MM-DD/HH-MM-thought.md
       │    ├─ maintain Brain/active-work.jsonl
       │    └─ submit structured skill candidates only
       └─ Dream nightly at 23:30 local (once per target day)
            ├─ synthesize the day’s Thoughts + non-resolved ledger entries
            ├─ update durable memory/business context where gated
            ├─ create executable proposals where appropriate
            ├─ write Brain/dreams/YYYY-MM-DD/HH-MM-dream.md
            ├─ rewrite Brain/proposals.md morning brief
            ├─ run Skill Curator dry-run
            └─ ~30m later: cleanup-only memory solidifier
```

### Cadence and eligibility

- `src/gateway/brain/brain-runner.ts:4-24` defines two run types and explicitly says eligibility is state-based rather than timer-only.
- Thoughts: every six hours; eligibility uses the last successful thought and a twelve-hour catch-up cap (`brain-runner.ts:18-22,53-58`).
- Dream: eligible at **23:30 local** and only once for the target local day; cleanup runs 30 minutes after Dream success (`brain-runner.ts:11-16,56-59`).
- The evaluator ticks every 15 minutes (`brain-runner.ts:22,55`). This is internal runner cadence, not a registered schedule-job.
- `schedule_job list` exposed only two unrelated user jobs (Morning Trading Brief, disabled; Morning motivational wake-up, enabled). No thought/dream generator job appeared.

### State and manifests

`Brain/state/latest.json` is the cross-session control record. `Brain/state/daily/YYYY-MM-DD.json` is the per-day execution manifest.

- State schema includes last successful and attempted Thought timestamps, status/error/window; Dream and cleanup equivalents; enable flags; model overrides; gateway start timestamp; and proposal dedupe IDs (`src/gateway/brain/brain-state.ts:16-62`).
- State writes use temp-file + rename atomic replacement (`brain-state.ts:108-115`).
- Daily state records each successful thought’s window/file/completion/run ID and Dream/cleanup artifact metadata (`brain-state.ts:65-93`).
- Current latest state is enabled for both modes, uses `openai_codex/gpt-5.6-luna` for Thoughts and `openai_codex/gpt-5.6-terra` for Dreams, and records a current Thought failure: `Brain/state/latest.json:2-26`.
- The July 17 daily manifest records three successful Thoughts, while `dreamRan` remains false for that date because the successful overnight Dream targeted July 16: `Brain/state/daily/2026-07-17.json:2-28`.

**Observed index gap:** date-folder naming plus state files function as the operational index. No workspace-visible `Brain/thoughts/index.*` or `Brain/dreams/index.*` manifest was found in the inspected Brain tree. This makes discovery/filtering dependent on scans or state, rather than a compact queryable artifact index.

### Thought production

- Each Thought creates a dedicated session/run ID and output path `Brain/thoughts/<date>/<window>-thought.md` (`brain-runner.ts:808-843`).
- Its scoped mutation allowance permits only the Thought artifact, that date’s business-candidates JSONL, and `Brain/active-work.jsonl` (`brain-runner.ts:861-866`).
- The prompt contract prohibits memory writes, proposals, and skill mutations; it asks the model to observe/verify, maintain the Active Work Ledger, write the Thought, and submit structured skill candidates only (`brain-runner.ts:873-915`).
- The runner accepts a valid model response that forgot the artifact by saving a recovered Thought artifact itself; success then requires a fresh non-empty file (`brain-runner.ts:941-995`).
- A successful run appends an entry to the daily manifest; a failure is not counted (`brain-runner.ts:971-995`).

Current visible example: `Brain/thoughts/2026-07-17/16-48-thought.md` contains a summary, three JSON Pulse Cards, evidence-backed activity/quality/skill analysis, opportunity items, and a verdict. It is rich and useful, but the Pulse Cards are embedded markdown rather than a separately managed context feed (`:5-29,31-60`).

### Active Work Ledger

`Brain/active-work.jsonl` is a durable, line-oriented registry of ongoing/resolved work. Its entries include `id`, title, origin, disk path, status, last verification date, current state, research links, and evidence paths. The inspected file has 18 entries and contains both resolved and in-progress records (`Brain/active-work.jsonl:1-18`).

- Thought is the maintainer: the allowed write scope and prompt explicitly assign it ledger maintenance (`brain-runner.ts:861-873`).
- Dream treats every non-resolved ledger entry as a primary driver even if no Thought mentioned it that day (`brain-runner.ts:2360`).
- This gives Brain a useful long-running worklist, but it is **not** a context capsule mechanism: it has no audience/context scope, priority/rank contract, TTL, expiry, replacement key, injection accounting, or independent validation/report lifecycle.

### Dream production and consumers

- Dream writes `Brain/dreams/<date>/<window>-dream.md`; it also expects a fresh `Brain/proposals.md` morning brief. If only the latter is missing/stale, the runner writes a fallback summary rather than treating a completed Dream as failed purely for that missing briefing (`brain-runner.ts:1210-1238`).
- Dream success updates latest/daily state and triggers the Skill Curator in dry-run mode (`brain-runner.ts:1240-1274`).
- `Brain/dreams/2026-07-16/23-37-dream.md` shows downstream actions: one business reconciliation, one submitted proposal, skill review, deferred ideas, watch items, and accounting (`:18-65`).
- `BOOT.md:5-13` is a clear consumer: daily startup reads recent Brain Thought/Dream activity alongside recent notes/compactions to suggest what to resume.
- `Brain/proposals.md` is a second consumer-facing summary surface, expressly described in source as the morning briefing (`brain-runner.ts:11-16`).
- Thoughts/Dreams are workspace-visible / publicly distributed paths (`src/config/public-workspace.ts:55,63`), so artifact confidentiality and indexing should be designed accordingly.

## Reliability and failure modes

1. **Empty model completion / no-tool response.** Current state says the latest Thought attempt failed because `response.completed` contained neither assistant text nor tool calls (`Brain/state/latest.json:3-5`). This is a real recent failure, not theoretical.
2. **Artifact omission or staleness.** The runner verifies fresh non-empty artifacts after execution. It recovers non-empty text into a Thought file and can recover a missing/stale `Brain/proposals.md`; otherwise it marks the run failed (`brain-runner.ts:941-988`, `:1210-1285`). Good guardrail, but recovery can turn unstructured model text into an apparently successful artifact.
3. **Retry storms / provider cost.** The runner documents earlier 15-minute retry storms and now applies six-hour retry backoff for failed Thought or Dream model work (`brain-runner.ts:60-65`).
4. **State/data model fragility.** `loadDailyStatus` falls back to defaults on parse/read errors (`brain-state.ts:198-210`). This prevents crashes but can hide a corrupt/missing manifest as an empty day, risking duplicate work or loss of operational observability.
5. **Ambiguous success semantics.** A file can be fresh and therefore successfully registered even if semantic sections, evidence quality, or ledger updates are absent. Dream has a proposal contract check, but Thought does not have an equivalent structured-content validation beyond file freshness.
6. **Context bloat / discovery cost.** Thought artifacts already hold broad prose, evidence, tables, and Pulse Cards. Dream documents that sessions history previously spilled roughly 200k tokens (`Brain/dreams/2026-07-16/23-37-dream.md:7-13`), and the Thought itself notes repeated inventory payloads as latency/context hotspots (`Brain/thoughts/2026-07-17/16-48-thought.md:44-50`). A future capsule consumer must be bounded by design.
7. **No formal capsule lifecycle.** Searches found historical discussion of “Brain Context Capsules,” but no current Brain folder/schema/consumer with `expiresAt`, TTL, replacement, or injection telemetry. Existing expiry/TTL references were unrelated or lexical false positives; no implementable Brain capsule runtime was observed.

## Recommended architecture: temporary context capsules

Add a separate **derived, bounded context plane**, not another replacement for MEMORY, Thoughts, Dreams, or the Active Work Ledger.

### 1. Artifact layout

```text
Brain/capsules/
  active.json                         # small index, atomically replaced
  archive/YYYY-MM-DD/<capsuleId>.json # immutable audit/history
  rejected/YYYY-MM-DD/<runId>.json    # schema/quality rejections (optional)
Brain/state/capsules.json              # optional watermarks and sweep status
```

Keep capsules separate from `Brain/state/latest.json`: state remains scheduler truth; capsule files become context/injection truth.

### 2. Strict capsule schema

```json
{
  "schemaVersion": 1,
  "id": "cap_20260718_connector-health",
  "replacementKey": "project:prometheus:connector-health",
  "status": "active",
  "scope": {"kind": "project", "id": "prometheus"},
  "audience": ["main_chat", "brain_dream", "startup"],
  "priority": 70,
  "confidence": 0.82,
  "createdAt": "2026-07-18T04:00:00.000Z",
  "refreshedAt": "2026-07-18T04:00:00.000Z",
  "expiresAt": "2026-07-20T04:00:00.000Z",
  "maxInjects": 5,
  "injectCount": 0,
  "text": ["Gmail and X refresh status needs verification..."],
  "evidence": ["reports/connector-plugin-benchmark-2026-07-15.md:85-153"],
  "source": {"runKind": "thought", "runId": "...", "artifact": "Brain/thoughts/..."},
  "supersedes": ["cap_old_id"],
  "reason": "Short-lived operational nudge; do not promote to durable memory yet."
}
```

Constraints: 1–3 bullets, hard character/token cap, provenance required, deterministic scope/replacement key, and no raw sensitive tool output.

### 3. Creation path

- Thought proposes capsule candidates in a structured block (or dedicated JSON side artifact), but does **not** inject them directly.
- A deterministic validator checks schema, evidence existence, dedupe/replacement key, max length, expiry window, allowed audience, and sensitive-content policy.
- Dream can promote, refresh, replace, expire, or reject candidates after cross-day synthesis. This preserves the current division: Thoughts observe; Dreams apply durable judgment.
- High-confidence, time-sensitive operational capsules may be published after validator approval without waiting for Dream, but should use a short TTL (for example 6–24h) and be marked `provisional`.

### 4. TTL and replacement policy

- Every capsule requires `expiresAt`; no infinite TTL.
- Use defaults by class: **operational 6–24h**, **project focus 3–7d**, **user preference/pattern 1–7d pending memory promotion**.
- Replacement is by `replacementKey`, not fuzzy text matching. Write new immutable artifact, atomically update `active.json`, mark prior one `superseded`, and retain audit linkage.
- Expiry sweeper runs with the existing 15-minute ticker; it removes expired/superseded records from `active.json` but retains archived artifacts.
- Promotion route: surviving, repeatedly refreshed, high-confidence capsules become explicit Memory/Entity/Active Work Ledger candidates; do not silently make temporary context durable.

### 5. Consumer contract

At prompt assembly, select at most a fixed budget (e.g., 3 capsules / 600–900 tokens total) using scope match, priority, confidence, freshness, and remaining injection budget. Inject a labeled block such as `Temporary Brain Context — expires ...`, with provenance optionally available to the model but not shown in normal user copy.

Track an append-only capsule-use record: session/run ID, selected capsule IDs, injection time, whether the turn completed, and whether the capsule was superseded/expired. This makes the mechanism auditable and lets Dream assess whether a capsule produced useful follow-through or only noise.

### 6. Verification gates

- Schema validation + atomic active-index replacement.
- Unit tests: expiry, replacement race, wrong scope, oversized content, duplicate run, corrupt active index recovery.
- Integration tests: Thought candidate -> validation -> bounded prompt selection -> TTL sweep -> Dream promotion/rejection.
- Observability: active count by scope, expired/superseded count, injection token budget, validator rejection reasons, and promotion outcomes.

## Prioritized implementation sequence

1. **Foundation:** add capsule schema, `active.json`, atomic write/read/validation, and immutable archive. No prompt injection yet.
2. **Lifecycle:** add 15-minute TTL sweep and deterministic `replacementKey` handling; expose status only in internal Brain diagnostics.
3. **Producer:** add structured Thought candidates; Dream approves/replaces/promotes them.
4. **Consumer:** bounded prompt-context selector for startup/main/Dream with injection ledger and feature flag.
5. **Quality controls:** metrics, tests, corruption recovery, policy checks, and a small UI/status surface if useful.

## Bottom line

Brain’s scheduler, state persistence, run isolation, recovery, and ledger/Dream handoff are already substantial. The missing layer is not “more reflection”; it is a **small, typed, expiring, replacement-aware delivery mechanism** that turns the best current Brain signals into safe, bounded context at the next relevant decision point. Build capsules as a derived cache with provenance and hard lifecycle rules, never as a second uncontrolled memory system.

## Evidence inventory

- `src/gateway/brain/brain-runner.ts:4-24,53-65` — pipeline contract, cadence, backoff, persisted state.
- `src/gateway/brain/brain-runner.ts:808-915,941-1023` — Thought session/write scope, allowlist, recovery and success registration.
- `src/gateway/brain/brain-runner.ts:1210-1309,1313+` — Dream artifact recovery, success/failure handling, cleanup route.
- `src/gateway/brain/brain-runner.ts:2360` — Dream consumes every non-resolved ledger item.
- `src/gateway/brain/brain-state.ts:16-115,198-215` — schemas, directory creation, atomic writes, daily-state fallback.
- `Brain/state/latest.json:2-26` — enabled current runtime configuration and latest Thought failure.
- `Brain/state/daily/2026-07-17.json:2-28` — current daily Thought manifest.
- `Brain/active-work.jsonl:1-18` — live ledger shape and status usage.
- `Brain/thoughts/2026-07-17/16-48-thought.md:5-60` — Pulse Cards and rich observation output.
- `Brain/dreams/2026-07-16/23-37-dream.md:6-65` — Dream synthesis, reconciliation, proposal and deferral outputs.
- `BOOT.md:5-13` — startup consumer.
- `src/config/public-workspace.ts:55,63` — Dreams/Thoughts are workspace-visible paths.
- `schedule_job list` (2026-07-17 audit) — only two unrelated scheduled jobs; Brain is not represented there.
