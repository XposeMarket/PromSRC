# 08 — Agents, Tasks & Background Work

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/agents/`, `src/gateway/agents-runtime/`, `src/gateway/tasks/`, `src/gateway/threads/`
> **Read this when:** spawning or steering a standalone agent/background worker, changing its tool surface, model route, persistence, or task completion flow.

## TL;DR

- Persistent specialist agents live under `.prometheus/subagents/`; `SubagentManager` owns definitions, workspaces, identity and configured routing. `agents/model-routing.ts` resolves routing; every agent turn runs through the shared `runInteractiveTurn`/`handleChat` runtime.
- One-off delegated runs are formal tasks; `background_ops` creates ephemeral background work coordinated by `src/gateway/tasks/task-runner.ts` and executed by `BackgroundTaskRunner`.
- Background spawn is **explicit-tool-surface only**: give `tool_categories` up front; the worker can request more categories later. Prompt keyword auto-activation is deliberately skipped.
- `tool_categories` is normalized/deduplicated and capped at `BACKGROUND_SPAWN_MAX_TOOL_CATEGORIES = 8` in `task-runner.ts`; core tools remain available.
- Join policies are `wait_all`, `wait_until_timeout`, `best_effort_merge`; the explicit wait cap is 30 minutes. A short default wait should not be mistaken for task timeout.
- Spawn accepts provider/model, `reasoning_effort`, `speed`, timeout, tags, and category overrides. Model routing validates provider-aware effort/speed rather than forwarding unsupported values blindly.
- **Raul's routing rule:** when the main chat is using Anthropic, do not spawn Anthropic subagents. Use OpenAI workers: `gpt-6.1-sol` for low/medium effort; `gpt-6-luna` for xhigh/max and fast mode. Treat this as a user operating rule even though it is not enforced as a source-code hard gate.
- Durable detached peer turns have a separate queue/steer/restart path in `src/gateway/threads/thread-ops.ts`; do not confuse them with background tasks or team dispatches.
- Do not revive removed legacy `TaskRunner`/`start_task` orchestration or the unmounted internal-agent-task router (#557).

## Map

| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Persistent agent records and paths | `src/gateway/agents-runtime/subagent-manager.ts` → `SubagentManager`, `SubagentDefinition` | Persists definitions under `.prometheus/subagents`; create/update/run/status entrypoints. |
| Identity/persona generation | `src/agents/identity-generator.ts` → exported identity helpers; `src/agents/agent-prompt-file.ts` | Per-agent identity files and prompt composition. |
| Provider/model selection | `src/agents/model-routing.ts` → `resolveConfiguredAgentRouting`, `parseProviderModelRef` | Resolves role/agent/global route and provider-aware effort/speed. |
| Agent turn orchestration | `src/gateway/routes/channels.router.ts` → `runSubagentChatTurn`, `runAgentTaskOnce` | Persistent standalone agent chat and one-off "Run task" / Telegram / `schedule_job run_now` dispatch, all on the shared chat runtime. The old Reactor / `node_call` engine is retired. |
| Executor dispatch | `src/gateway/agents-runtime/subagent-executor.ts` → `executeToolCall` background action branch | Dispatches agent/team capability tools, including `background_ops`. |
| Background spawn tool categories | `src/gateway/tasks/spawn-tool-categories-arg.ts` → `normalizeSpawnToolCategoriesArg`; `src/gateway/tasks/task-runner.ts` → `normalizeBackgroundSpawnToolCategories` | Stable category filtering plus hard cap 8 (`BACKGROUND_SPAWN_MAX_TOOL_CATEGORIES`). |
| Ephemeral task state + wait/steer | `src/gateway/tasks/task-runner.ts` → `EphemeralBackgroundStatus`, `backgroundSpawn`, `backgroundSteer`, `backgroundWait`, `backgroundJoin` | Public task lifecycle, records, completion wake, join merge policy. |
| Worker runtime loop | `src/gateway/tasks/background-task-runner.ts` → `BackgroundTaskRunner`, `runOnceTask` | Executes worker turn(s), routes executor provider/model, streams and writes results. |
| Spawn continuity | `src/gateway/tasks/background-spawn-continuity.ts` → `persistBackgroundSpawnReceipt`, `backgroundSpawnContinuityForSession` | Durable receipt trail so a later turn can recover outstanding/completed work. |
| Task storage/recovery | `src/gateway/tasks/task-store.ts` → task read/write helpers; `task-recovery.ts`, `task-continuity.ts` | Persistent task state, restart recovery and continuity. |
| Existing run controls | `agent_run_ops` handler in `subagent-executor.ts` | List/get/steer/recover/resume/rerun existing failed or unfinished runs. |
| Detached peer sessions | `src/gateway/threads/thread-ops.ts` → queue/steer/run operations; `thread-supervision.ts` | Independent target sessions, durable detached turn queue and restart drain. |
| Tests | See [generated tests](generated/tests.md) for model-routing, background lifecycle and worker tool-surface coverage. | Discover current entrypoints there; don't hand-copy the test inventory. |

## How it works

### Main tool surfaces and task transitions

`agent_ops` is the persistent agent lifecycle surface (list/get/spawn/update/delete/deploy). A `spawn` with `run_now:false` ensures identity/configuration without launching a run; running it immediately is an explicit choice. `agent_chat_ops(action:"chat")` chats with a configured standalone agent; `delegate` creates exactly one formal task and assignment text should state the work, not ask the tool to spawn another task. `steer` targets an existing task ID, while mailbox delivery deliberately does not start execution. `agent_run_ops` manages already-existing run records (list/get/steer/recover/resume/rerun); recovery actions are distinct from a new delegation. Tool wrapper aliases and legacy action spellings are normalized by the `subagent-executor.ts` branches—extend their regressions when changing one.

Ephemeral background task transition is queued → in_progress → completed, failed, or timed_out. `backgroundSpawn()` resolves join policy (default `wait_all`), timeout, provider/model/effort, speed and category set before recording a task. `backgroundSteer()` queues a message onto that task's background runtime; `backgroundStatus()` returns state and routing; `backgroundProgress()` is the compact progress projection. `backgroundWait()` waits on explicitly supplied IDs (or active tasks from a spawner session) up to its requested cap and reports counts; if `timedOut`, task may still be queued or in progress. `backgroundJoin()` uses the requested policy or recorded policy: `wait_all` awaits task promise, `wait_until_timeout` returns at limit, and `best_effort_merge` does not block. A terminal result can be merged once (`mergedAt`).

The `background_ops` name is the unified model-facing surface; `background_spawn` remains in compatibility schemas/runtime handlers. Its tool schema and normalization are assembled across `src/gateway/tools/defs/agent-team-schedule.ts`, `cis-system.ts` and `subagent-executor.ts`. Field naming in model schema is snake_case and executor-facing runner options are camelCase; trust the normalizer rather than passing raw schema args into internal helpers.

### Choose the right execution lane

- **Persistent specialist, no immediate run:** `agent_ops(action:"spawn", run_now:false)` creates/ensures a definition. `agent_chat_ops(action:"delegate")` creates one formal task; it is not the same as an ephemeral fan-out.
- **One-off parallel work from the current turn:** `background_ops(action:"spawn")` registers an ephemeral task, runs it with explicit categories/route overrides and returns an ID. Use `status`/`progress`, `steer`, `wait`, and `join` against that ID. The `background_ops` tool handler is in `subagent-executor.ts`; state/orchestration lives in `task-runner.ts`.
- **Talk to a known running/finished subagent or manage its run:** use `agent_chat_ops` or `agent_run_ops` rather than spawning a duplicate worker.
- **Work in another chat thread:** use peer-session operations in `src/gateway/threads/thread-ops.ts`. The detached-turn queue persists pending work and server startup drains queued target threads (`src/gateway/server-v2.ts`).
- **Coordinated multi-member project:** use managed Teams (`09-teams.md`); their dispatch task events wake the team manager and share team workspace state.

### Background worker lifecycle

1. Tool handler normalizes action and fields. `background_ops` supports spawn, steer, status, progress, wait and join; legacy `background_spawn` is a sibling surface.
2. `task-runner.ts` creates an ID and task record, normalizes join policy, category list, timeout and overrides; a completion callback wakes the originating session. Spawn receipts are persisted for later continuity.
3. `BackgroundTaskRunner` resolves worker provider/model, opens its background session/runtime, executes the prompt with the explicitly provisioned tool lane, captures trace/result/errors and records terminal state.
4. `steer` queues a follow-up into an active worker; it does not create a new task. `wait` observes a set; `join` collects one result and applies the join policy/merge behavior. Check a fresh status after an ambiguous timeout.

### Persistence and model routing

Persistent subagent identity/configuration is not the same store as task run state: definitions and `workspace/` live below `.prometheus/subagents/<id>`, while task/runtime/trace state is handled by gateway task and runtime stores. `subagent-manager.ts` requires a resolvable executor provider/model and surfaces a direct settings hint when no route exists. `model-routing.ts` handles provider-qualified `provider/model` refs, safe inference for bare IDs, role/config fallbacks, and model-aware reasoning-effort checks. Supported speed tiers are normalized by provider/model (`providers/reasoning-capabilities.ts`); unsupported `fast` falls back to `standard`.

### Peer-thread turns

`thread-ops.ts` separates active-session steering from sending into an idle/settled peer. Queued detached turns include owner/target identity and are drained on startup; session wake/notification and thread supervision handle follow-through. Never direct a peer operation at the current owner session. For a running target, steer instead of enqueueing a second send; reopen a settled target before sending when needed. See [generated tools](generated/tools.md) for the current peer operation vocabulary.

## Config & knobs

- Persistent agent provider/model and reasoning live in the agent definition (`SubagentDefinition` in `subagent-manager.ts`) or global `llm`/`models` config, resolved in `src/agents/model-routing.ts`.
- Spawn arguments: `prompt`, `join_policy`, `timeout_ms`, `tags`, `provider`, `model`/executor route, `reasoning_effort`, `speed`, `tool_categories`, and eligible resource links. Tool schemas are generated/maintained in `src/gateway/tools/defs/agent-team-schedule.ts` and runtime tool builder; consult [generated tools](generated/tools.md) rather than hand-copying inventories.
- `BACKGROUND_SPAWN_MAX_TOOL_CATEGORIES` is a source constant in `src/gateway/tasks/task-runner.ts`, currently 8.
- Explicit `background_wait` ceiling: `BACKGROUND_WAIT_ALL_CAP_MS = 1_800_000` (30 minutes); unspecified wait defaults are intentionally shorter. Join-policy timeout and tool-call wait timeout are distinct concepts.
- `speed:"fast"` means supported OpenAI priority service tier or Anthropic fast mode; provider adapter applies it only when the selected model supports it.
- User-specific routing rule: **no Anthropic subagents while main chat runs on Anthropic; OpenAI uses `gpt-6.1-sol` (low/medium) or `gpt-6-luna` (xhigh/max + fast).** Recheck the rule with Raul before treating this policy as general product behavior.

## Gotchas / sharp edges

- **A prompt mentioning a category does not grant it.** Declare exact `tool_categories` at spawn; let the worker use `request_tool_category` if it later discovers a need. This prevents over-provisioning from keyword matches.
- **Eight categories maximum.** Normalize and prioritize rather than sending more; otherwise tail categories are discarded. Check `normalizeBackgroundSpawnToolCategories` rather than inferring schema behavior.
- **A tool wait timing out is not proof the worker failed.** Read status/progress and wait again or join with appropriate policy; the background worker may be slow-starting.
- **Prompt visibility differs by call:** full prompt is returned from spawn only; poll/status returns a preview. Do not design continuity around repeated full prompt echoes (#396).
- **Provider/model override should be provider-qualified when ambiguous.** A bare model ID that cannot resolve a provider can fail the effort capability gate or route unexpectedly; use a resolvable `provider/model` ref.
- **Do not assume every executor accepts effort/fast.** Routing checks model capability; unsupported settings normalize/reject according to the route. Run `src/agents/model-routing.regression.ts` after changes.
- **Persistence races matter.** Task state writes and recovery were hardened in #552; avoid reintroducing non-atomic writes or replaying a task whose owner is still running across warm handoff.
- **User rule is not code enforcement.** Source accepts explicit provider/model arguments, but Raul's Anthropic prohibition and OpenAI model/effort pairing are instructions for operators; follow them in every delegated spawn.
- **Old task runner is gone.** PR #557 removed legacy `TaskRunner`/`start_task` and an unmounted internal task router. Current task flow is `task-runner.ts` + `background-task-runner.ts`.
- **Skill worker constraint:** background workers start with core tools plus explicitly selected categories, not the entire caller menu. Do not assume they inherit a full main-chat tool surface.

## How to change it safely

1. Trace the tool schema and `subagent-executor.ts` action branch, then `task-runner.ts` state transition and `BackgroundTaskRunner` executor route. Keep capability validation centralized.
2. Preserve the distinction among persistent agent definitions, formal subagent task runs, ephemeral background tasks, team member dispatch, and detached peer sessions.
3. Run the targeted regressions in [generated tests](generated/tests.md): `src/agents/model-routing.regression.ts`, `src/gateway/tasks/background-spawn-continuity.regression.ts`, `background-spawn-tool-surface.regression.ts`, `background-spawn-speed.regression.ts`, `task-continuity.regression.ts`, and `task-completion-protocol.regression.ts`. Run related agent/background UI contracts when touching presentation or lifecycle.
4. Check restart recovery, timeout/abort, completion wake, tool categories, model-effort gate, fast-mode handling, and join merge result. Avoid a live worker smoke test that creates uncontrolled external side effects.
5. Generated inventories are authoritative for tool/test lists: [tools](generated/tools.md), [categories](generated/tool-categories.md), [tests](generated/tests.md), [changelog](generated/changelog.md).

## Operational checklist

### Agent and task operations

- `agent_ops(action:"list")` is the cheap first probe when you do not know whether a persistent specialist already exists. `get` reveals definition and latest task/run information; avoid spawning a second copy when a usable one is configured.
- `agent_ops(action:"spawn")` creates/ensures a persistent definition; `run_now` is a separate choice. Creating an identity is not evidence that the first run succeeded—inspect run status/result.
- `agent_chat_ops(action:"delegate")` accepts one direct `assignment`. The call creates the task, so an assignment that says “spawn an agent to…” can cause redundant nesting and wastes capacity.
- Reuse the exact `task_id` for `steer`, `agent_run_ops` recovery and result lookup. A newly delegated task gets another ID and does not continue the old run's files/session automatically.
- `agent_run_ops` is lifecycle for an existing run: `get`/`list` inspect, `steer` adds instruction to that run, `recover`/`resume` restart a recoverable state, and `rerun` explicitly replays. Confirm the user intent and side-effect risk before rerunning.
- Mailbox delivery is a message, not an implicit run. If `request_turn` is false, do not promise the agent will execute immediately.
- Persistent subagent definitions, their identity/workspace and durable memory outlive ephemeral background IDs. Use the persistent path when the worker must retain persona, configuration and long-term memory.

### Background task choice points

- Fan out independent bounded tasks with `background_ops(action:"spawn")`; share only needed context and resources. Keep completion acceptance, artifact review and reconciliation with the originating main session.
- Spawn returns the **full prompt once**, while later status/progress projections return only a prompt preview. Store the task ID and a short scope summary in continuity rather than relying on repeated prompt retrieval.
- `wait_all` blocks until promise settles; `wait_until_timeout` returns with `timedOut:true` if it is still running; `best_effort_merge` does not wait. Join marks a terminal result merged once, so a later join may report it already merged.
- `background_wait` defaults to shorter runtime timeout and caps at `BACKGROUND_WAIT_ALL_CAP_MS` = 1,800,000 ms. Spawn timeout and a particular wait/join call's timeout are related but distinct fields.
- A task in `queued` can still be live; runtime admission/capacity may delay its worker turn. Check status rather than calling spawn again.
- `steer` queues another user direction while the worker is active. If it has already terminally completed, steering cannot turn it into a continuation; create a new task with the result/context if needed.
- `abort`/main-chat stop can terminate all active tasks spawned by the session. Do not treat an abort as a graceful review or as proof partial artifacts are safe.
- Durable spawn receipts preserve continuity across foreground turns, but runtime execution may be process/session-local. After a gateway restart, inspect receipt and actual task store/run records before claiming a task automatically resumed.

### Model and tool-lane decision tree

1. Resolve who will run: main-session ephemeral worker, persistent standalone agent, managed-team member, or peer session.
2. For ephemeral spawn, specify the intended provider/model when ambiguity matters. Record effective route from returned status; don't assume a requested alias was accepted unchanged.
3. Choose `reasoning_effort` only after selecting the model. `resolveBackgroundAgentModelRouting()` applies the provider/model capability gate; if an explicit effort is unsupported it throws rather than silently treating the model as capable.
4. Choose `speed` separately. Only supported `fast`/`standard` values are accepted; adapter normalizes unavailable fast tier to standard where applicable. User policy: while main chat is Anthropic, do not spawn Anthropic subagents; use OpenAI `gpt-6.1-sol` for low/medium and `gpt-6-luna` for xhigh/max + fast.
5. Give the worker the minimum category allowlist required. Categories are normalized and deduplicated; core tools are already available. Do not include a broad category “just in case”.
6. If a missing capability is discovered, the worker may request that category via `request_tool_category`; this is a deliberate follow-up escalation, not prompt-driven auto-grant.
7. Attach only explicit resource IDs needed for the task. Background workers do not inherit arbitrary browser/session state or the full caller menu.

### Recovery and result verification

- A completed result is not automatically accepted work. Read the result/error and changed-file summary, validate artifacts or test evidence, and reconcile conflicting outputs before returning.
- Distinguish `failed` from `timed_out`; a deadline can occur while the model call or tool call is still pending. Check persisted task/trace state before rerunning side effects.
- If the worker produced files, verify workspace root and paths. For safe parallel work, assign disjoint outputs or have an explicit merge owner; multiple tasks editing the same file are not a merge strategy.
- If a task should be resumed later, record `write_note(status:"open", task_id:..., thread:...)` and resolve it only after final verification. The background receipt and user-facing work note solve different continuity problems.
- Use `background_ops(action:"progress")` for an economical state summary, `status` for latest route/state, and `join` only when ready to collect/merge. Avoid poll loops when one internal watch would be appropriate.
- For Teams, let team event routing own member result delivery. For a standalone subagent, use `agent_run_ops`/task state. Do not splice the task ID into a team or peer watcher.

### Current history and compatibility notes

- PR #557 removed the unused `TaskRunner`/`start_task` and unmounted internal-agent-task route. That removal is intentional; it does not remove `background_ops` or the durable task system.
- PR #552 hardened scheduled-job/task review and handoff behavior; #549 fixes duplicate schedule fires and store races during warm handoff. Re-check current status after hot reload/warm handoff rather than assuming an execution record is final.
- `BACKGROUND_SPAWN_MAX_TOOL_CATEGORIES` limits the explicit worker category set to eight even when the schema accepts an array. A “category not loaded” failure is often missing provisioning, not a broken tool implementation.
- Older conversation memory may mention `tools` full-set injection or keyword auto-provisioning. The supported current path is explicit `tool_categories`, optional explicit resource links, and `request_tool_category` when needed.
- For an unresolved source/path/model constraint, return the exact blocker and one concrete next action. Do not fabricate a worker ID or claim a run started if admission failed.

## Related

- [05 Tools & categories](05-tools-and-categories.md) · [09 Teams](09-teams.md) · [10 Scheduling & automations](10-scheduling-automations-triggers.md) · [11 Memory, notes & Brain](11-memory-notes-brain.md)
- [01 Identity & paths](01-identity-and-paths.md) · [04 Chat pipeline & providers](04-chat-pipeline-and-providers.md) · [25 Sharp edges](25-sharp-edges.md)
- [tools inventory](generated/tools.md) · [category inventory](generated/tool-categories.md) · [test inventory](generated/tests.md) · [merged PR history](generated/changelog.md)
