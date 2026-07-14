---
name: "execution-mode-routing"
description: "Choose how new Prometheus work should execute: inline, planned, ephemeral background, durable task, delegated subagent, coordinated team, or scheduled job. Use when execution mode, persistence, parallelism, ownership, or restart survival is unclear; do not use merely to inspect or control work already running."
---

# Execution mode routing

Choose the smallest execution surface that safely reaches the requested outcome.

## Decision order

1. **Inline:** Use for short work that can complete in the current turn without durable monitoring.
2. **Interactive plan:** Use when several dependent steps benefit from visible progress but the current agent still owns execution.
3. **Ephemeral background agent:** Use for bounded asynchronous work that may outlive the turn but does not require restart durability.
4. **Durable task:** Use when work must survive restart, expose persistent state, or support later control and verification.
5. **Delegated subagent:** Use for one independent specialist batch with a clear boundary and deliverable.
6. **Coordinated team:** Use when multiple independent batches can run concurrently and their outputs require synthesis.
7. **Scheduled job:** Use when execution is tied to a future time or recurrence rather than starting now.

## Selection questions

- Can the work finish safely in the current turn?
- Must it survive a restart or disconnection?
- Does it need later pause, resume, cancellation, or retry?
- Are there genuinely independent workstreams?
- Does another agent need distinct tools or context?
- Is a future or recurring time part of the requirement?
- What artifact or external state proves completion?

Do not use backgrounding merely to avoid waiting. Do not create a durable task for trivial work. Do not spawn multiple agents for tightly coupled edits to the same files. Do not schedule work that should run immediately.

## Handoff contract

For delegated, durable, team, or scheduled work, provide a self-contained objective, scope boundaries, relevant paths/context, prohibited actions, validation requirements, expected artifacts, and completion evidence. Preserve ownership: the parent remains responsible for integrating and verifying child output.

## After starting

Return to `task-lifecycle` for inspecting, controlling, recovering, or verifying existing work. Use `scheduler-operations-playbook` for schedule-specific mutation and delivery diagnosis.

Read `task-lifecycle/references/detailed-guide.md` only when older tool-by-tool execution guidance is needed.
