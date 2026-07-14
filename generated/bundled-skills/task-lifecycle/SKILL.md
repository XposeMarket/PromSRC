---
name: "task-lifecycle"
description: "Inspect and manage existing Prometheus tasks, background runs, agents, jobs, and team work through their lifecycle, including status interpretation, pause/resume, retry, cancellation, recovery, deduplication, and completion verification. Use for lifecycle control; use execution-mode-routing when deciding how new work should run."
---

# Task lifecycle

Manage durable or delegated work from current runtime evidence. Do not infer status from an assistant message alone.

## Start with the aggregate view

Use the automation dashboard or equivalent aggregate snapshot to orient across tasks, agents, jobs, teams, approvals, and recent work. Drop to a granular task/agent/job tool only when the aggregate view identifies a concrete target or lacks required detail.

## Lifecycle loop

1. Identify the exact task/run/agent/job and its owner.
2. Read current status, timestamps, progress, blockers, attempts, outputs, and child relationships.
3. Distinguish active work from queued, waiting, paused, failed, cancelled, blocked, and completed state.
4. Choose the smallest control action: inspect, pause, resume, retry, cancel, or leave running.
5. Verify the state transition and the real artifact/output before reporting success.

## Control rules

- Do not create duplicate work when an equivalent active task already exists.
- Retry only when the underlying failure is plausibly transient or corrected.
- Do not resume cancelled work automatically.
- Cancellation stops work; it does not prove rollback of external side effects.
- A foreground timeout can coexist with a still-running durable process.
- A completed status is insufficient when the task promised a file, delivery, code change, or external-state mutation; verify that outcome separately.
- Respect approval and ownership boundaries when controlling another agent’s work.

## Status reporting

Report what is currently happening, what evidence supports it, what action was taken, and what remains. Keep repository dirty-state diagnostics separate from user-facing task progress unless the user explicitly asks for source status.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for granular tool selection, detailed status semantics, plan-versus-task distinctions, and older execution-mode guidance.
- Use `execution-mode-routing` before starting new work that could be inline, background, durable, delegated, scheduled, or team-based.

The governing principle is simple: inspect live state, control one identified unit of work, and verify the promised outcome.
