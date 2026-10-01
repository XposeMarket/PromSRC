---
name: "parallel-agent-fanout"
description: "Split work into independent units, dispatch them to parallel background agents with self-contained briefs, synchronize results through files, then verify, judge, and merge, including adversarial attempt-and-refute rounds for findings that must be trusted. Use for 2+ independent investigations, per-file or per-source sweeps, multi-angle research, or N independent attempts at one hard question. Do not use for tightly coupled edits in one dirty tree (background-coding-agent-lanes), choosing an execution mode (execution-mode-routing), or managed recurring teams (agent-team-operations)."
---

# Parallel Agent Fanout

One agent per independent unit, each with exactly the context it needs and nothing from this chat. The parent keeps the plan, the ledger, and the synthesis; workers keep nothing but their slice.

## 1. Decide whether it fans out

Fan out only when every unit can be finished without a sibling's output and no two units edit the same file or resource. Keep it inline or serial when failures may share a root cause (fix one, fix all), when understanding needs the whole system, when the next step depends on the previous one, or when there are only one or two trivial units.

Done when you can write the unit list and a one-line reason each unit is independent.

## 2. Build the manifest and run folder

- Create `runs/fanout-<slug>-<yyyymmdd-hhmm>/` (unique per run, so stale outputs from an earlier run cannot be misread).
- Write `manifest.md` with one unit per line: id, scope (files, URLs, records, question), expected output file.
- Do the deterministic part yourself first (listing files, fetching URLs, grepping, building the unit list). Fan out only the judgment work.
- Size by the largest unit: roughly 8 to 12 edits, a few thousand lines of reading, or one focused question per worker. Split oversized units.
- Write `BRIEF.md` with goals, constraints, and the output contract every worker shares. If the fleet drifts, fix the brief once and steer, rather than re-explaining in each prompt.

## 3. Write each worker prompt

Every prompt is self-contained and contains, in order:

1. One line on where this unit fits.
2. The scope: exact paths, URLs, error text, test names. Paste the facts; do not say "the bug we discussed".
3. Constraints: what not to touch, "do not spawn agents", read-only or allowed edits.
4. The output contract: write the full result to `<run>/out_<id>.md` (or `.csv`), one located, falsifiable claim per line where findings are involved, and return only a status word plus a one-line summary.
5. The completion criterion: what "done" means for this unit.

Bad: "fix the tests". Good: "Fix the 3 failing tests in src/agents/abort.test.ts (names and errors below). Root-cause timing versus real bug. Do not just raise timeouts. Write findings and diff summary to <run>/out_2.md."

## 4. Dispatch in one block

Issue every `background_ops(action:"spawn")` in the same tool-call block so they run concurrently. Per spawn set:

- `provider:"openai_codex"`, `model:"openai_codex/gpt-6-sol"` (default, `reasoning_effort` medium or high), or `model:"openai_codex/gpt-6-luna"` with `reasoning_effort:"max"` for the hardest unit, whose output must then be reviewed. Always fully qualified. Never spawn Anthropic models while the main chat runs on Anthropic.
- `tool_categories` the unit needs (for example `["workspace_write"]`, `["browser_automation"]`).
- Use the cheapest model that handles the unit; mechanical transcription-style units do not need the strongest tier.

Too many units for one wave: run bounded waves (about 6 to 10 at a time) and queue the rest.

## 5. Synchronize

Keep doing independent local work while workers run. When idle, `background_ops(action:"wait", wait_ms)` in bounded stretches and check `status` between them. A worker that looks stalled has often already written its file; check the run folder before re-dispatching. `steer` a live worker when requirements change instead of spawning a duplicate.

## 6. Verify and merge

1. Count output files against the manifest; confirm each was written during this run.
2. Read the files, not the worker summaries; a "completed" status is a claim.
3. Check for conflicts: two workers touching the same file, contradictory findings.
4. Spot-check a sample against the sources; workers make systematic errors.
5. For code: run the full check suite on the combined result; a change that passes alone can fail together.
6. Synthesize on the parent. Cross-cutting conclusions are yours, not any one worker's.

## Adversarial convergence (when findings must be trusted)

For audits, security reviews, research claims, or "find every X":

1. Send the same question to 2 to 4 workers with different framings, each writing one located claim per line ("POST /users/:id/role in src/routes/users.ts:142 has no role check", never "auth has problems").
2. Merge and dedupe; note how many attempts found each claim.
3. Spawn refuters given the sources but not the attempts' reasoning, told to break each claim and return `claim_id | survives | counter_evidence`.
4. Keep survivors; drop refuted claims with a one-line reason. Run new claims through one more round; stop when a round adds no survivors, maximum 3 rounds.
5. Apply the same refutation to your own premises before handing them to workers as rules.

## Exit criteria

Manifest count equals output count; every output is fresh; conflicts are resolved and named; dropped claims have counter-evidence; the final answer reports worker count, failures or re-dispatches, and what was verified directly.

Lineage: inspired by obra/superpowers dispatching-parallel-agents and subagent-driven-development, and NousResearch/hermes-agent dynamic-workflow, rewritten for Prometheus.
