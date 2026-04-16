---
name: Task Lifecycle
description: Current guide for choosing between inline execution, interactive plans, ephemeral background agents, durable task runs, delegated subagents, and team coordination. Covers task_control, run_task_now, background_spawn, and modern task-selection rules.
emoji: 📋
version: 3.0.0
triggers: create task, background task, multi-step, long running, check tasks, task status, stalled, resume task, complete task, task list, existing task, task control, declare plan, background_spawn, run_task_now, subagent, team
---

# Task Lifecycle Playbook

Prometheus now has **multiple execution modes**. The key is choosing the right one instead of forcing everything into one system.

---

## The execution modes

### 1) Direct inline execution
Use this when the work is quick and should happen in the current turn.

Examples:
- a few file reads
- a short edit
- one browser flow
- one shell command
- a quick lookup

If the task is straightforward and you can just do it now, do it now.

### 2) Interactive plan: `declare_plan` + `complete_plan_step`
Use only when the user explicitly wants a plan/checklist/steps first, or when policy requires a visible multi-step structure for a live external-action workflow.

Important current rule:
- do **not** default to `declare_plan` for ordinary work
- do **not** use it for casual read-only or simple execution
- browser/desktop work is often handled directly unless a visible plan is explicitly needed

### 3) Ephemeral background agent: `background_spawn`
Use this for sidecar work that can run in parallel **during the current turn**.

Best for:
- repo scans
- memory/write-note side work
- focused research
- file audits
- independent analysis that does not block your next action

Key properties:
- starts immediately
- fully self-contained prompt required
- result auto-merges at turn end
- good for speeding up parallelizable work

Do **not** use it when the result is required before your immediate next step.

### 4) Durable background task: `run_task_now`
Use this for larger work that should run as its own persistent task and be verified before reporting back.

Best for:
- work that may take a while
- substantial research or production tasks
- jobs you want to survive restart / show in Tasks panel
- tasks where verification matters

Key properties:
- persisted task
- independent execution + verification pass
- better than `background_spawn` for long or important jobs

### 5) Delegated single-agent work: `spawn_subagent`
Use for a focused specialist to do one defined job.

Best for:
- isolated research
- focused file editing
- running a specific narrow procedure repeatedly
- reusable specialist roles

Always check existing agents first with `agent_list()` before creating or dispatching new ones.

### 6) Multi-agent work: `ask_team_coordinator`
Use when the task truly benefits from multiple roles or parallel workstreams.

Best for:
- large research pipelines
- multi-role execution
- ongoing autonomous team efforts
- status checks on existing teams

Do not manually manage teams from main chat when the coordinator path is available.

---

## Quick decision guide

| Situation | Best path |
|---|---|
| Quick work in this turn | Direct inline execution |
| Need sidecar parallel help right now | `background_spawn` |
| Long durable verified task | `run_task_now` |
| One focused specialist | `spawn_subagent` |
| Multi-agent coordination | `ask_team_coordinator` |
| User explicitly wants visible step plan | `declare_plan` |

---

## `background_spawn` rules

Use `background_spawn` only when all three are true:
1. the work is independent of your main tool sequence
2. it can start immediately with a fully self-contained prompt
3. you do not need the result before your next step

Good examples:
- while you inspect one skill, a background agent audits another
- while you edit a file, a background agent collects references
- while you complete the main request, a background agent writes a note or summary

Bad examples:
- you need the answer before deciding what file to edit
- the task depends on results from a tool call you have not made yet
- the work is the main blocking task itself

---

## `run_task_now` rules

Use `run_task_now` when:
- work is substantial enough to outlive the current turn
- you want a proper task record
- you want verification before the result comes back
- the user asked for something that may take a while but should be completed autonomously

Prefer `run_task_now` over `background_spawn` when reliability and persistence matter more than same-turn merge speed.

---

## `task_control` rules

`task_control` is for inspecting and managing durable tasks.

Common actions:
- `list` — see tasks
- `latest` — get newest task
- `get` — inspect one task deeply
- `resume` — continue paused/stalled work
- `rerun` — run a task again
- `pause` — pause a running task
- `cancel` — stop a task
- `delete` — remove task record

### Dedup rule
Before creating a new durable background task, check for duplicates:
- `task_control({ action: "list", ... })`

Only do this when you are actually about to create a task, not on every turn.

If an equivalent task already exists:
- resume it if paused/stalled
- rerun it if failed or stale
- avoid duplicate task creation

---

## Status interpretation

Common statuses include:
- `queued`
- `running`
- `paused`
- `stalled`
- `needs_assistance`
- `awaiting_user_input`
- `failed`
- `complete`
- `waiting_subagent`

### Practical handling
- `running` → usually leave it alone unless user asks
- `paused` / `stalled` → inspect with `get`, then `resume` if fixable
- `needs_assistance` / `awaiting_user_input` → gather blocker and respond clearly
- `failed` → inspect root cause, then `rerun` or create a corrected new task

---

## `declare_plan` versus task systems

Do not confuse plan UI with background task execution.

### `declare_plan`
- lives in the current conversation
- meant for visible phase tracking
- advanced with `complete_plan_step`

### Background agents / tasks
- run separately
- do not use `complete_plan_step`
- may use their own isolated plan mechanisms internally
- should be prompted self-contained

Important current behavior:
- unless explicitly asked otherwise, default to action rather than declaring a plan
- do not create a plan just because a task has multiple tool calls

---

## Choosing between `background_spawn` and `run_task_now`

| Question | If yes | If no |
|---|---|---|
| Can it finish as same-turn side work? | `background_spawn` | consider `run_task_now` |
| Must it persist and survive restart? | `run_task_now` | `background_spawn` may be enough |
| Do you need verification before reporting success? | `run_task_now` | `background_spawn` may be enough |
| Is it parallel side work to your main flow? | `background_spawn` | maybe direct inline or `run_task_now` |

---

## Choosing between `spawn_subagent` and team coordination

| Situation | Best path |
|---|---|
| One specialist, one focused job | `spawn_subagent` |
| Multiple roles or parallel streams | `ask_team_coordinator` |
| Need ongoing managed team behavior | `ask_team_coordinator` |

---

## Common mistakes to avoid

- Using a background task when direct inline execution is faster
- Using `background_spawn` for work that blocks the next decision
- Creating durable duplicate tasks without checking `task_control(list)` first
- Treating `declare_plan` as mandatory for every multi-step task
- Spawning a subagent when the work is actually multi-agent and should go to the team coordinator
- Asking a team to do what one direct tool call could do immediately

---

## Bottom line

Choose the lightest execution mode that safely fits the job:
- direct execution first
- `background_spawn` for parallel same-turn side work
- `run_task_now` for durable verified background jobs
- `spawn_subagent` for one specialist
- `ask_team_coordinator` for real multi-agent coordination
- `declare_plan` only when a visible plan is actually needed
