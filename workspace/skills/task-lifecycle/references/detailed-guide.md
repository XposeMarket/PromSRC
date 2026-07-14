# Detailed guide

This reference preserves the full operating detail that was moved out of the concise skill entrypoint during the catalog migration. Read only the sections needed for the current task.

# Task Lifecycle Playbook

Prometheus now has **multiple execution modes** plus a set of **internal-state read tools**. This skill covers both: pick the right execution mode for *doing* work, and use the right read tools for *reporting on* work.

If the user is asking about Prometheus's own state ("what's going on", "what are my priorities", "what have the agents done", "what's running") jump to **Reading internal state** below — that is the common, expensive-to-get-wrong path.

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

## Reading internal state (agents, tasks, jobs, teams, work done)

This is how Prometheus answers questions about **itself** — its agents, scheduled jobs, background tasks, teams, and what work has been produced. Get this right and one tool call replaces six.

### Start here: `automation_dashboard` is the single snapshot

For almost every "what's going on / what are my priorities / what have the agents done / what's running" question, call **`automation_dashboard` first**. It returns ONE joined snapshot:

- `agents[]` — the roster joined with each agent's scheduled jobs, background tasks, recent runs, and **last produced output**
- `teams[]` — managed teams with members, their jobs, and recent tasks
- `scheduledJobs[]` — jobs with health + last result
- `tasks[]` — background tasks with status/step/finalSummary
- `internalWatches[]`, `eventQueue[]`, and aggregate `counts`

Knobs:
- `depth: "full"` — return **untruncated** output/results. Use this when the user wants to actually read the work product (drafts, approval packets, summaries). Default `summary` is compact.
- `agent_id: "<id>"` — focus the snapshot on a single agent (its jobs, tasks, recent runs, last output).
- `include: ["agents","teams","outputs"]` — narrow which sections to compute when you only need part of it.
- `limit`, `include_done` — as before.

**Do NOT** chain `agent_list` + `task_control(list)` + `task_control(get)` + `schedule_job_detail` + `schedule_job_history` to assemble this by hand. That was the old way and burns 6–10 calls. `automation_dashboard` already joins it. Use `depth:"full"` once instead of re-fetching detail tools to un-truncate output.

### When to drop to the granular tools

Use these only for **control/mutation** or **deep single-entity inspection** that the snapshot doesn't cover:

| Tool | Use it for |
|---|---|
| `agent_list` | Just need IDs/descriptions before spawning/dispatching (not for "what have they done"). |
| `agent_info` | Full config of ONE agent (instructions, constraints, tool access). |
| `task_control(get)` | Step/status metadata + control entry point for ONE task. For the produced output, use `automation_dashboard(depth:"full")` or `schedule_job_detail`. |
| `task_control(list/latest)` | Quick task list when you explicitly don't need the agent/team join. Note: it also bundles scheduled jobs. |
| `task_control(resume/rerun/pause/cancel/delete)` | Acting on a task. |
| `schedule_job_detail` | Deep dive on ONE job: config, prompt, latest result, linked tasks, watches, events, schedule memory. |
| `schedule_job_history` | Per-run history (status/duration/errors/output) for ONE job. |
| `schedule_job_log_search` | Search run logs across jobs by text/status/date. |
| `schedule_job(list/create/update/...)`, `schedule_job_patch/outputs/stuck_control` | Managing/editing/unsticking jobs. |
| `team_manage(list)` | Team config (members) when you don't need the joined rollup. |
| `background_status` / `background_progress` | Polling an ephemeral `background_spawn` agent mid-turn (rarely needed — results auto-merge). |

Rule of thumb: **snapshot for reporting, granular tools for acting.**

### Render it: `show_agent_work`

After you've gathered the snapshot, present it with the **`show_agent_work`** tool — a native operator card (greeting, summary rows, numbered priorities, team rows, active work) shown in chat. Use it when the user asks for a snapshot, priorities, "what's going on", a morning/startup status, or "what have the agents done".

Workflow:
1. `automation_dashboard({ depth: "full" })` (or `agent_id`-scoped) to gather real state.
2. Synthesize the card from what you actually found — **do not invent** rows. Keep each list tight (2–6 items).
3. Call `show_agent_work` with the fields you have:
   - `greeting` / `title` — e.g. "Good morning." / "Subagent work snapshot"
   - `summaryRows[]` — `{ icon, title, subtitle }` (icons: calendar, users, clipboard, check, bolt, clock, flag, sparkles)
   - `priorities[]` — `{ title, subtitle, status }` (status: ready, running, blocked, idle, done)
   - `teams[]` — `{ name, detail, status }`
   - `activeWork[]` — `{ title, status, progressLabel, href }` for in-flight tasks/jobs
4. **Attach `taskId` to any priority/activeWork row that maps to a real background task** (you have the IDs from `automation_dashboard`). This makes the row clickable in the UI: it expands an inline drawer showing live status/step/summary with Resume / Pause / Restart / Delete buttons and a box to message that task's agent. Also pass `jobId`/`agentId`/`proposalId` when relevant. Without `taskId` the row is static text.
5. Add a short text reply alongside the card for anything that doesn't fit the rows.

Don't call `show_agent_work` with fabricated data or for unrelated questions — it's for reporting real internal state. Plain text is fine when there's nothing structured to show.

### Build / update status (NOT git status)

`automation_dashboard` returns a `build` field: `{ version, channel, updateAvailable, latestVersion, repo? }`.
- When `build.updateAvailable` is true, you may surface a row like "Update available → vX.Y.Z" in the snapshot. This is the only build/version signal end users should ever see.
- `build.repo` (local git working-tree state — modified/untracked counts) exists **only in dev builds** and is for the developer's own use. **Never** put repo/git/uncommitted-files state into an operator snapshot or any user-facing card — it's dev noise and must not appear for end users.
- Do **not** run `git status` yourself to populate the snapshot. Use the `build` field. If you're not in a dev build there is nothing repo-related to report — show the update status instead.

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
- Hand-assembling internal state with `agent_list` + `task_control` + `schedule_job_*` instead of one `automation_dashboard` call
- Re-fetching detail tools to un-truncate output instead of passing `depth:"full"` to `automation_dashboard`
- Calling `show_agent_work` with invented rows, or using it for questions that aren't about Prometheus's own state

---

## Bottom line

Choose the lightest execution mode that safely fits the job:
- direct execution first
- `background_spawn` for parallel same-turn side work
- `run_task_now` for durable verified background jobs
- `spawn_subagent` for one specialist
- `ask_team_coordinator` for real multi-agent coordination
- `declare_plan` only when a visible plan is actually needed

And to **report on** Prometheus's own state:
- `automation_dashboard` (one joined snapshot) → optionally `depth:"full"` / `agent_id`
- granular `schedule_job_*` / `task_control` / `agent_info` only for control or deep single-entity inspection
- `show_agent_work` to render the snapshot as an operator card — with real data, never invented
