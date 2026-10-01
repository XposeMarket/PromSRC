---
name: "thread-and-session-operations"
description: "Manage Prometheus peer sessions and supervised threads with exact routing and status verification. Use for session creation, steering, and reopening; not for standalone agent runs (agent-team-operations)."
---

# Thread and Session Operations

Use this playbook for the `prometheus_thread_ops` control plane and peer Prometheus sessions. Do not confuse peer sessions with subagent runs, durable tasks, or managed teams.

## Discover and inspect first

Use list, find, search, status, or read to identify the exact session, owner, channel, state, and recent history. Include settled sessions when looking for prior work. A queued creation is not a reply or completion; read or status is required after creation.

## Creation routes

Choose exactly one route: `ping` for detached work that notifies the owner, `forget` for detached work with no owner notification, or `supervise` for a durable objective with hidden review and terminal reporting. Define the objective, acceptance criteria, review/elapsed budgets, and bounded follow-up policy.

## Sending and steering

Use `send` for a new message to an idle peer. Use `steer` when the target is actively running and requirements change. If a settled session must receive a message, reopen or unsettle it first and verify it is active. Use `interrupt` only for a specific reason; interruption does not roll back external side effects. Use `wait:true` only when the current turn needs the reply.

Never send a duplicate prompt because creation was queued or a reply is delayed.

## Supervision review

Review only a newer pending event. `verified_complete` requires bounded evidence of the acceptance criteria. Use `wait` when progress exists but proof is incomplete, `continue` only for a specific bounded follow-up, `needs_user` for a real decision, and `failed` only with terminal evidence. An idle checkpoint is not completion.

## Recovery and verification

If a target is missing, search by title or objective and inspect audit history before creating another thread. Completed sessions are immutable; create a new follow-up. Resume paused supervision only after reading its blocker and objective. After create, send, steer, reopen, or interrupt, read status and recent messages or supervision state. Verify promised files, artifacts, or external state separately from the transcript.
