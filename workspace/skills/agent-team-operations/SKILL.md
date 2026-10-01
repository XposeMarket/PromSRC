---
name: "agent-team-operations"
description: "Coordinate Prometheus subagents, background workers, and managed teams. Use for ownership, delegation, steering, and worker recovery; not for choosing execution mode alone (execution-mode-routing)."
---

# Agent and Team Operations

Use this for important work involving subagents, background workers, teams, managers, or agent-owned runs. Use execution-mode-routing when the execution mode is unclear; use task-lifecycle for a concrete run already in progress.

## Choose the execution surface

- Inline for short work.
- background_ops for bounded parallel investigation that does not need restart durability.
- A durable task for restart survival, persistent progress, approvals, or later control.
- A standalone subagent for one independent specialist batch.
- A managed team only when multiple independent specialists must run concurrently and results need coordination. From main chat use `team_ops_wrapper(action:"manage", ...)` to create/manage a team; do not hand off to a nonexistent coordinator.

Do not create multiple workers for tightly coupled edits in the same dirty workspace.


Spawn only `openai_codex/gpt-6-sol` or `openai_codex/gpt-6-luna` with fully qualified routing; review Luna output and preserve worker tool/approval boundaries.

## Handoff contract

Every assignment includes objective, exact scope, workspace/paths, allowed and forbidden actions, relevant context, expected evidence/artifact, verification checks, and completion criteria. Workers are not the source of truth. The parent owns integration and verification.

## Live work loop

1. Inspect the dashboard or current run state to avoid duplicates.
2. Start the smallest worker set covering independent questions.
3. Wait or create an internal watch when work outlives the turn.
4. Read status, evidence, artifacts, and the last meaningful event, not only worker prose.
5. Synthesize partial results explicitly and preserve missing evidence.
6. Verify the promised artifact or external state.

## Steering and recovery

Steer active work when requirements change; do not duplicate a live run. Recover paused/stalled work only after reading owner, checkpoint, blocker, and side-effect state. Completed subagent runs are immutable: create a new follow-up task instead of resuming or rerunning. Never resume cancelled work automatically. If a worker/provider is unavailable, continue with remaining evidence, downgrade to partial, or use one bounded fallback worker. If a manager returns idle, greeting, or quota error, inspect linked evidence before treating it as success.

## Failure classes

Distinguish queue/lease delay, worker/provider failure, capability mismatch, auth/approval wait, tool failure, artifact-write failure, coordinator loss, partial synthesis, and delivery failure. Retry only a bounded, plausibly transient unit. Preserve logs and partial artifacts on cancellation.

## Completion proof

Report workers used, each state, evidence inspected, unresolved gaps, and the verified final outcome. A worker saying done is not completion proof.
