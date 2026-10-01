---
name: "recovery-and-interruption-playbook"
description: "Recover interrupted Prometheus work from checkpoint evidence and side-effect state. Use for paused or interrupted flows; not for a general gateway outage (runtime-operations-incident-response)."
---

# Recovery and Interruption Playbook

Use this when work was interrupted, timed out, disconnected, stalled, or produced uncertain output. Recovery is inspection first, not automatic rerun.

## Reconstruct live state

1. Inspect the automation dashboard and exact task/session/run status.
2. Search audit and continuity evidence for the latest goal, tool call, checkpoint, approval, changed files, artifacts, and blocker.
3. Read durable request status when source edits, approvals, or proposals are involved.
4. Check external state and workspace diffs before repeating any side-effecting step.

## Classify resumability

- resumable: a live unfinished run has a valid checkpoint and no unknown side effect;
- follow-up: the prior run is complete or immutable but a new bounded milestone is needed;
- retryable: a transient failure affected an idempotent unit;
- user-gated: auth, approval, secure input, or missing decision is required;
- non-resumable/unsafe: state or side effects are ambiguous, so stop and inspect or ask.

Completed subagent runs and settled historical records are not reopened. Use a new follow-up task or thread with prior evidence. Never resume cancelled work automatically.

## Recover safely

Use the smallest control action: wait, steer, resume, recover chat, continue a durable request, or delegate a new follow-up. Preserve approval boundaries and never approve an action from recovery context. Keep partial artifacts, logs, and diffs. Do not rerun an entire workflow because the foreground turn timed out.

## Verify after recovery

Confirm the recovered state, the exact resumed checkpoint, and the promised artifact or external postcondition. Separate work completion from delivery or notification. Record what remains unverified and the next safe bounded check.
