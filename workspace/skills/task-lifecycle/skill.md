---
name: Task Lifecycle
description: Complete behavioral rules for both task systems — interactive declare_plan progress panels and autonomous background start_task execution. Covers when to use each, step advancement, stall recovery, and task management via task_control. Use whenever starting multi-step work, checking task status, resuming a stalled task, or completing a task.
emoji: "📋"
version: 2.0.0
triggers: create task, background task, multi-step, long running, check tasks, task status, stalled, resume task, complete task, task list, is there a task, existing task, task control, declare plan, start task, step complete, background
---

# Task Lifecycle Playbook

Prometheus has **two distinct task systems**. Using the wrong one, or conflating them, leads to ghost tasks and broken step tracking. Read this before starting any multi-step work.

---

## System 1: Interactive Plans — `declare_plan` + `complete_plan_step`

**Use this for:** Multi-step work done inline in the current conversation. Steps are visible in the UI progress panel. You (the agent) drive each step interactively.

### When to use
- Any task that needs 2 or more distinct phases of tool calls in the current turn
- Work where the user is watching and expects to see progress
- Desktop/browser automation sequences
- File operations, research + write, build + verify

### How it works

```
1. declare_plan({ steps: ["Phase 1", "Phase 2", "Phase 3"] })
   → plan appears in UI progress panel

2. Do all tool calls for Phase 1
   → browser_open, browser_click, read_file, etc.

3. complete_plan_step({ note: "Done — found 3 targets" })
   → advances progress panel to Phase 2

4. Do all tool calls for Phase 2

5. complete_plan_step()
   → advances to Phase 3

6. Do all tool calls for Phase 3

7. complete_plan_step()
   → plan complete — respond to user
```

### Rules
- Call `declare_plan` **once** at the start. Never call it again mid-execution — if the system echoes "plan already declared", just proceed.
- `browser_*` and `desktop_*` tools **do NOT auto-advance** the plan step. Many tool calls belong to one phase. You must manually call `complete_plan_step` when the phase is finished.
- File/shell/memory tools DO auto-advance per successful action.
- Keep steps as high-level phases (2–6 per plan). "Navigate to page and extract links" is one step, not three.
- Do NOT call `step_complete` in interactive mode — that's for background tasks only.

### declare_plan parameters
```
declare_plan({
  steps: ["Phase 1: what you'll do", "Phase 2: ...", "Phase 3: ..."],
  task_summary: "One-line description shown as plan header"  // optional
})
```

---

## System 2: Background Tasks — `start_task` + `step_complete`

**Use this for:** Long autonomous tasks that run detached from the current conversation. The task gets its own session, its own plan, and runs until complete. The user can check progress in the Tasks panel.

### When to use
- Work that requires 10+ tool calls or multiple LLM rounds
- Tasks that should run in the background while the user does other things
- Complex research + writing, long browser automation sequences, batch operations
- Any task that might take minutes, not seconds

### How it works

```
User says: "Research and write a full competitor analysis"
→ You call: start_task({ goal: "Research and write competitor analysis for..." })
→ Returns: task started with ID

Background runner takes over:
  - Injects [BACKGROUND TASK CONTEXT] block with the plan
  - Agent executes tool calls step by step
  - After each step, agent calls: step_complete({ note: "what was done" })
  - Runner advances to next step
  - After all steps: completion verifier checks quality → delivers result
```

### start_task parameters
```
start_task({
  goal: "Specific, self-contained description of what to accomplish",
  max_steps: 25  // optional, default 25
})
```

### Inside background tasks: step_complete
The background runner injects the full plan into context. Your job:
1. Execute all tool calls for the current step (shown as `← CURRENT` in the plan)
2. Call `step_complete({ note: "brief summary of what was accomplished" })` when done
3. Runner advances to the next step automatically
4. Repeat until all steps are done

**Stall detection:** If you make 5 tool calls without calling `step_complete`, the runner injects a nudge reminding you to advance the step.

### What's different inside background tasks
| Tool | Interactive | Background task |
|---|---|---|
| `start_task` | ✓ Available | ✗ Stripped (can't nest tasks) |
| `declare_plan` | ✓ Available | ✗ Don't use — plan already set |
| `step_complete` | ✗ Don't use | ✓ Required to advance steps |
| `complete_plan_step` | ✓ For declare_plan | ✗ Not relevant |
| `write_note` | ✗ Stripped | ✓ Available (memory extraction) |

### Memory extraction
If `enableMemoryExtraction` is set on the task, a final step is auto-appended:
> "Memory extraction: review everything learned and call write_note for each distinct fact"
This step only passes the verifier if `write_note` was actually called at least once.

---

## System 3: Task Management — `task_control`

`task_control` is for **managing** tasks, not creating them. Creating is done via `start_task`.

### Actions
```
task_control({ action: "list", status: "", include_all_sessions: true, limit: 20 })
  → lists ALL active tasks + scheduled/cron jobs in one call

task_control({ action: "get", task_id: "<id>" })
  → full task record: status, plan steps, journal, resumeContext

task_control({ action: "resume", task_id: "<id>", note: "why resuming" })
  → resumes a paused or stalled task

task_control({ action: "rerun", task_id: "<id>" })
  → reruns a failed or completed task from scratch

task_control({ action: "pause", task_id: "<id>" })
  → pauses a running task cleanly

task_control({ action: "cancel", task_id: "<id>", confirm: true })
  → cancels a running task

task_control({ action: "delete", task_id: "<id>", confirm: true })
  → deletes a task record permanently (destructive — confirm: true required)
```

### Rule 0: Always check before creating

Before starting any background task, check whether one already exists for the same goal:

```
task_control({ action: "list", status: "", include_all_sessions: true, limit: 20 })
```

Look for:
- A task covering the same goal that's `running`, `paused`, or `stalled`
- A recently completed task that should be resumed or rerun

**If a matching task exists → resume or rerun it. Never create a duplicate.**

---

## Choosing the Right System

| Situation | Use |
|---|---|
| Browser/desktop automation, or actions with external side effects (post/send/delete/pay) | `declare_plan` + `complete_plan_step` — always |
| 3+ phases where each phase's output gates the next, or work where the user benefits from seeing the sequence | `declare_plan` + `complete_plan_step` — judgment call |
| Long autonomous work, background, many steps | `start_task` |
| Check if a task exists | `task_control({ action: "list" })` |
| Resume a stalled background task | `task_control({ action: "resume" })` |
| Rerun a failed background task | `task_control({ action: "rerun" })` |
| Single tool calls or quick lookups | Neither — just do it |

---

## Task Statuses

| Status | Meaning |
|---|---|
| `pending` | Created, not started yet |
| `running` | Active — steps being executed |
| `paused` | Deliberately paused (user request or schedule interrupt) |
| `stalled` | Inactive too long — needs investigation |
| `complete` | All steps done, result delivered |
| `failed` | Could not complete — reason logged in journal |

---

## Handling Stalled Background Tasks

A background task stalls when:
- A step failed and no recovery was attempted
- The runner hit a round timeout (120s default, 300s for research tasks)
- A tool dependency (browser, network) was unavailable

**Recovery procedure:**

1. Read the task's current state:
```
task_control({ action: "get", task_id: "<id>" })
```

2. Identify the last completed step, what failed, and what the journal says

3. Determine failure type:
   - **Transient** (rate limit, network, model busy) → `task_control({ action: "resume" })`
   - **Fixable** (wrong path, missing file, bad args) → fix root cause → resume
   - **Hard blocker** (missing credentials, feature not built) → report to user

4. For transient failures, just resume:
```
task_control({ action: "resume", task_id: "<id>", note: "Resuming after network timeout" })
```

5. For hard failures — report what happened and what the user needs to do.

---

## The Completion Verifier

After a background task finishes all steps, the system runs a **completion verifier** that inspects the final output before delivering it to the user. It can:
- **DELIVER** — output is good, send it
- **RESYNTH** — output is incomplete/cut off — triggers one re-synthesis round
- **DELIVER_ANYWAY** — imperfect but good enough (used after a re-synthesis attempt already ran)

This is automatic. You don't call it. Just produce complete step outputs and it will pass.

---

## Common Mistakes

| Mistake | Effect | Correct behavior |
|---|---|---|
| Using `task_control({ action: "create" })` | This action doesn't exist | Use `start_task(goal)` to create tasks |
| Calling `declare_plan` inside a background task | "Plan already declared" error | Background tasks have plans injected automatically — skip it |
| Calling `step_complete` in interactive mode | No-op or confusion | `step_complete` is background-task-only; use `complete_plan_step` interactively |
| Not calling `complete_plan_step` after browser/desktop phases | Plan never advances | browser_* / desktop_* don't auto-advance — manually call `complete_plan_step` |
| Creating a background task without checking for existing | Duplicate tasks pile up | Always `task_control({ action: "list" })` first |
| 5+ tool calls without `step_complete` in background task | Stall nudge injected, task can time out | Call `step_complete` after each step's tool calls are done |
| Leaving tasks in `running` state after completion | Tasks panel fills with ghosts | `step_complete` on the last step — runner handles completion automatically |
