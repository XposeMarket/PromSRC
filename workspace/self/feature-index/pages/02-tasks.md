# Tasks Page: Background Work, Process Logs, Evidence, and Recovery

Desktop owner: `web-ui/src/pages/TasksPage.js`. Gateway owner: `src/gateway/routes/tasks.router.ts`.

## What this page is

Tasks is the operator console for **background tasks** and their associated supervision records. It is not the main chat history. A background task is an independent runtime lane with its own status, plan, journal, progress, tool activity, evidence, approvals, messages, and final result. The page lets the user inspect or intervene without pretending the work is still an ordinary foreground turn.

## Board and task cards

The board groups tasks by normalized status. The current UI can show running, queued, paused, stalled, needs-assistance, complete, and failed work, with expandable overflow for large columns. A card identifies the task title, task status, timing/progress and any visible pause reason. Opening it fetches the authoritative task detail from `GET /api/bg-tasks/:id`; the board cache is only a fallback.

## Detail panel: what each section means

| Section | What it reads | Why it exists |
|---|---|---|
| Status/header | Task title, channel, start time, normalized state, current step and last tool/time | Explains which independent run is being inspected and whether it is actively moving |
| Plan and progress | `task.plan`, progress items, completion state | Shows declared work phases and which have actually advanced; it is not a guessed progress bar |
| Journal/timeline | `task.journal` events such as tool call/result, error, plan mutation, status push, pause, resume, advisor decision, heartbeat | The durable event trail for reconstructing what the task did and why it stopped |
| Final summary | `task.finalSummary` when terminal | The task’s reported outcome, distinct from raw logs/evidence |
| Manager bar | Manager-enabled state and executor/provider label | Indicates supervised/team-style task context and which worker/provider executed it |
| Pending approvals | `GET /api/approvals?status=pending&taskId=...` | Keeps a task blocked until the user resolves the action that needs authorization |
| Recovery/assistance | Pause analysis, clarification question, recovery conversation | Lets a blocked worker ask for information and lets the user reply into the task instead of starting an unrelated chat |
| Process runs | Recent managed process cards associated with the task | Exposes commands/dev servers/renders started under the supervisor; these are process records, not the task’s prose journal |
| Evidence bus | `GET /api/bg-tasks/:id/evidence` | Shows task-produced evidence/notes used for accountability, scheduled work, and later reasoning |

## Process log versus task journal

These are intentionally different streams:

- The **task journal** records agent-level state: what the task attempted, tool events, plan/status changes, pauses, recovery and heartbeats.
- A **process run card** represents a managed operating-system process created by the task (for example a dev server, build, render, or interactive CLI). It has a process run ID, status and combined stdout/stderr log; the UI uses the shared `ProcessRunCard` rendering/control behavior.
- The **process log is synced through the managed-process supervisor and gateway process routes**, then displayed inside the task only when linked/recent for that task. It is not a generic terminal transcript copied into every task.
- **Evidence** is a third lane: a bounded, task-associated evidence record. It can outlive a transient process and is not equivalent to either a command log or an assistant final answer.

## Controls and exact effects

| Control | Gateway action | Meaning |
|---|---|---|
| Pause | `POST /api/bg-tasks/:id/pause` | Requests a running task pause; the task may include a pause reason/analysis |
| Resume | `POST /api/bg-tasks/:id/resume` | Continues an eligible paused/queued/stalled/needs-input task with its saved state |
| Restart | `POST /api/bg-tasks/:id/restart` | Starts a new attempt for a failed task with prior-run context; it is not silently editing historical output |
| Reply/send | `POST /api/bg-tasks/:id/message` | Sends clarification/recovery guidance into the task’s recovery conversation |
| Approve/deny | Approval routes scoped to the displayed approval ID | Resolves the task’s actual pending authorization; one-shot, session, and always scopes appear only when policy allows them |
| Draft Skill | `POST /api/bg-tasks/:id/skill-proposal` | Turns a completed/reusable workflow into a proposal draft; it does not auto-install a skill |
| Remove | `DELETE /api/bg-tasks/:id` | Removes the task record through the task API |

## Live synchronization and recovery

Task streams and broadcast events update the desktop state while a task runs. On opening a task, the UI re-reads task detail, pending approvals, and related process records instead of relying solely on an event that may have been missed. Thread supervision records are also visible so interrupted/managed Prometheus work can be inspected. The page exposes recovery only for tasks in a recoverable state; a completed agent run remains a historical record and follow-up work should be a new task/delegation.

## Document language

Say: “Tasks gives you the plan, agent journal, supervised process logs, evidence, approvals, and recovery conversation for independent work.” Do not say: “Every task is a terminal job,” “a process log is the full agent history,” or “resume rewrites completed work.”
