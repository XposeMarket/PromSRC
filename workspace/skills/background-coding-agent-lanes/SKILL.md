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

## Rules

- Never launch agents in the same dirty tree without an explicit isolation plan.
- Prefer git worktrees or separate temp workspaces.
- Capture all prompts and summaries into Prometheus task history.
- Treat agent output as a proposal until Prometheus verifies it.
- Require human confirmation before merging, deleting worktrees, or pushing.
- Avoid passing secrets to external agents unless the user explicitly authorizes the integration.
- On cancellation, preserve logs and partial diffs.

## Implementation Route

1. Map lanes onto existing Prometheus tasks/jobs instead of inventing a parallel scheduler.
2. Add an agent registry for supported runtimes and their status checks.
3. Add lane creation with isolated workspace setup.
4. Add progress streaming, summary capture, and artifact collection.
5. Add reconcile/review tools before any auto-merge path.

## Acceptance Check

Prometheus can delegate bounded coding work while keeping ownership, verification, and merge decisions inside Prometheus.
