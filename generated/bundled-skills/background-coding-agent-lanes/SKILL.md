---
name: "background-coding-agent-lanes"
description: "Coordinate bounded background coding-agent lanes for parallel repository investigation, isolated implementation, code review, diff handoff, verification, and patch reconciliation. Use when multiple coding agents need explicit file or worktree boundaries and Prometheus must retain lane ownership and merge decisions; do not use for a single-agent coding task or unrelated background jobs."
---

# Background Coding Agent Lanes

Use this skill when Prometheus should coordinate one or more background coding agents for parallel implementation, investigation, or review work.

## Prometheus Fit

Prometheus should own the lane state. External agents are workers, not the source of truth. Each lane needs a workspace boundary, task brief, progress log, diff/artifact handoff, and verification result.

## Lane Shape

Each lane should track:

- lane ID and purpose
- repo/workspace root
- branch or worktree
- assigned agent/runtime
- prompt/brief
- allowed files or scope
- status and last heartbeat
- artifacts and diff summary
- verification commands and results
- BASE commit from `git rev-parse HEAD` captured before each implementer starts
- durable lane ledger file whose first line names the plan; record briefs, BASE commits, statuses, rulings, reviews, and next action there so work survives context loss

## Rules

- Never launch agents in the same dirty tree without an explicit isolation plan.
- Prefer git worktrees or separate temp workspaces.
- Capture all prompts and summaries into Prometheus task history.
- Treat agent output as a proposal until Prometheus verifies it.
- Require human confirmation before merging, deleting worktrees, or pushing.
- Avoid passing secrets to external agents unless the user explicitly authorizes the integration.
- On cancellation, preserve logs and partial diffs.
- Workers never spawn their own reviewers. Prometheus dispatches reviewers separately and owns the review order.
- If main chat runs on Anthropic, never spawn an Anthropic worker. Prefer `openai_codex/gpt-6-sol` by default; use `openai_codex/gpt-6-luna` for maximum reasoning and review its output before accepting it.

## Lane execution and review

1. Write the plan and each scoped worker brief to files. Put the plan name on the first line of the durable lane ledger. Before each worker dispatch, record `git rev-parse HEAD` as BASE for that worker, its branch/worktree, file boundary, expected output shape, tests, and stop conditions. After context loss, read the ledger and reconcile live work against it before proceeding.
2. Put `fast-coding-loop` budget rules in every worker brief: one multi-pattern `rg` locate, large batched reads, batched surgical edits, then verify once. Aim for about 12 calls before first edit; avoid repeated tiny search/read loops. Require a report file containing BASE, changed paths, checks, diff summary, and one fixed status.
3. Accept only worker statuses `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`. For `DONE`, inspect the diff and test evidence. For `DONE_WITH_CONCERNS`, record each concern and resolve or escalate it before accepting. For `NEEDS_CONTEXT`, supply the missing bounded input and resume. For `BLOCKED`, record the precise constraint and re-scope, reroute, or report the blocker.
4. Review each completed change in two stages: first spec compliance against the original brief and acceptance criteria; then code quality, safety, and regression risk. Review the package against that worker's BASE with `git diff BASE..HEAD`, never assume `HEAD~1`. After individual reviews, conduct one whole-branch review on the strongest available model. Record verdicts and follow-up fixes in the ledger.
5. Resolve ambiguous implementation details with `Ruling: what, why, cost if wrong` and proceed. Stop for destructive actions, security-sensitive changes, or work outside the assigned worktree. For multi-branch work, collect read-only per-branch reports and propose one consolidation plan listing target branch, merge order, and conflict decisions; obtain human approval before any merge.

## Implementation Route

1. Map lanes onto existing Prometheus tasks/jobs instead of inventing a parallel scheduler.
2. Add an agent registry for supported runtimes and their status checks.
3. Add lane creation with isolated workspace setup.
4. Add progress streaming, summary capture, and artifact collection.
5. Add reconcile/review tools before any auto-merge path.

## Acceptance Check

Prometheus can delegate bounded coding work while keeping ownership, verification, and merge decisions inside Prometheus.
