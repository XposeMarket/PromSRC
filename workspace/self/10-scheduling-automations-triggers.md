# 10 — Scheduling, Automations & Triggers

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/scheduling/`, `src/gateway/timers/`, `src/gateway/triggers/`, `src/gateway/internal-watch/`, `src/gateway/threads/`
> **Read this when:** creating or debugging recurring/one-shot jobs, heartbeat instructions, timers, event triggers, webhooks, internal watches, task controls, or peer-thread supervision.

## TL;DR

- Use cron `schedule_job` for recurring or scheduled agent work, `timer` for one-off main-chat reminders, heartbeat for periodic proactive checks/instructions, and trigger rules for event-driven actions. These are separate runners/stores.
- Cron jobs are managed by `src/gateway/scheduling/cron-scheduler.ts`; scheduler guards same-job duplicate runs while allowing independent jobs to run concurrently. Jobs can be queued/running/paused/completed and may have per-job model/team routing.
- `update_heartbeat` writes config and optional `HEARTBEAT.md` instructions. Heartbeat config is timer behavior; the markdown is the agent's task prompt. Empty instruction files avoid needless turns, and exact `HEARTBEAT_OK` means no work.
- `timer` persists a one-shot instruction with session ownership and later queues it as a user-like turn. It is not recurring cron.
- Trigger engine matches typed events to persisted rules, applies conditions/verification/deduplication, then dispatches `wake`, `agent`, `task`, `team`, or `notify` actions. Webhooks are authenticated/deduplicated trigger inputs, not arbitrary task execution.
- `internal_watch` supports bounded file, task, scheduled-job, and event-queue watches; it persists across restart and fires once by default. A match is evidence; default policy is review-only, and `task_control` governs authorized follow-up.
- Main Prometheus peer-session tools (`prometheus_thread_ops`) can find/list/search/reopen/send/steer/wait/supervise other chat sessions; these are thread operations, not cron or background agent tasks.
- Managed Teams now wake the manager directly from dispatch events (#566). Do not create internal watches merely to poll a team member task ID.

## Map

| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Recurring/scheduled jobs | `src/gateway/scheduling/cron-scheduler.ts` → `CronScheduler`, `CronJob` | Schedule validation, persistence, execution/locking, run history, owner/team routing. |
| Schedule admin/detail | `src/gateway/scheduling/schedule-admin-tools.ts`, `schedule-memory.ts`, `schedule-archive.ts` | History/output inspection, run notes, completed archive handling. |
| Heartbeat timer and instructions | `src/gateway/scheduling/heartbeat-runner.ts` → `SubagentHeartbeatManager` | Config store, per-agent heartbeat setup, reads `<agent workspace>/HEARTBEAT.md`, active-hour and interval behavior. |
| One-shot timers | `src/gateway/timers/timer-store.ts` → `createMainChatTimer`, `getDueMainChatTimers`; `timer-runner.ts` → `MainChatTimerRunner` | Main-chat timer state and due-turn delivery. |
| Event trigger contract | `src/gateway/triggers/trigger-types.ts` → `TriggerEvent`, `TriggerRule`, `TriggerAction` | Versioned event/rule/action data model. |
| Matching and dedupe | `src/gateway/triggers/trigger-engine.ts` → `normalizeTriggerEvent`, `matchesTriggerMatcher`, `TriggerEngine` | Conditions, matcher, reservations/idempotency. |
| Trigger execution | `trigger-service.ts` → `initTriggerService`; `trigger-runtime.ts` → `PrometheusTriggerRuntime` | Retry/transient failure and action execution bridge. |
| Inbound webhook security | `src/gateway/triggers/webhook-endpoints.ts` → `WebhookEndpointStore`, `verifyWebhookRequest`, `parseWebhookBody` | Endpoint secrets, HMAC/token validation, event metadata. |
| Trigger HTTP API | `src/gateway/routes/triggers.router.ts` | See [routes inventory](generated/routes.md). |
| Internal conditions | `src/gateway/internal-watch/internal-watch-store.ts`, `internal-watch-runner.ts`, `internal-watch-policy.ts` | Persisted bounded watch definitions, match/delivery and action policy. |
| Automation capabilities | `src/gateway/agents-runtime/capabilities/automation-executor.ts` | Runtime handler for `timer`, `update_heartbeat`, `internal_watch`, `trigger_ops`, `task_control`, `schedule_job`, admin tools and `prometheus_thread_ops`. |
| Tool schemas | `src/gateway/tools/defs/agent-team-schedule.ts` | `schedule_job`, `timer`, `update_heartbeat`, `internal_watch`, `trigger_ops`, peer ops; inventories in [tools](generated/tools.md). |
| Detached peer turns | `src/gateway/threads/thread-ops.ts` → queue/send/steer/supervision operations; `server-v2.ts` recovery | Durable target-thread turns and restart recovery. |
| Tests | See [generated tests](generated/tests.md) for trigger, webhook, internal-watch, scheduling and timer coverage. | Use generated inventory rather than copying a hand-maintained list. |

## How it works

### Pick the correct scheduler

| Need | Use | Do not use |
|---|---|---|
| Repeat on cron or have a scheduled agent/team job | `schedule_job` → `CronScheduler` | One-shot `timer` |
| Ask main chat to do one thing later | `timer(action:"create")` | A cron job, unless repetition is intended |
| Periodic proactive inspection for an agent | `update_heartbeat` + that agent's `HEARTBEAT.md` | A pile of short-interval one-shot timers |
| React to typed inbound/manual/schedule/connector event | `trigger_ops` rules and `TriggerEngine` | Directly exposing a webhook secret as an action |
| Wake when a task/file/job/event state changes | `internal_watch` | Repeated manual polling |
| Send/steer/wait for work in another chat | `prometheus_thread_ops` | A background worker targeted at the current session |
| Coordinate managed team dispatch | Team event router | Internal watch for team task ID (removed in #566) |

### Cron schedule path

`automation-executor.ts` validates schedule/job fields, friendly schedule input and timezone/cron rules, then creates or updates a `CronJob` in the scheduler. The cron scheduler persists schedules and run metadata, owns due-time selection/queueing, and guards a job against duplicate concurrent execution; distinct jobs can run in parallel. A run gets its scheduled agent/team context and task card/runtime attribution, uses schedule memory/history for continuity, verifies configured expected outputs/results, records the run outcome, and can be inspected with schedule history/detail/log/output tools. Paused states include manual, configuration error, and interruption by schedule. Prefer `schedule_job` and `schedule_job_*` management tools over editing scheduler JSON directly.

### Heartbeat path

`update_heartbeat` accepts `agent_id` (default `main`), enabled, interval (1–1440 minutes; default 30), optional model, and full replacement `instructions`. `SubagentHeartbeatManager` saves config and registers an isolated heartbeat session for each agent. On fire it gates by configured active hours, reads that agent's `HEARTBEAT.md`, and runs the instruction as its own task. Keep operational checklist text in the workspace file; do not assume interval config itself tells the model what to do. A good HEARTBEAT file includes the contract: if no action applies, respond exactly `HEARTBEAT_OK` and nothing else.

### One-shot timer path

1. `timer(action:"create")` stores session-owned instruction and due time (`delay_seconds` or ISO `due_at`; minimum relative delay is 5 seconds).
2. `MainChatTimerRunner` polls due timers, guards against overlapping timer turns, marks the selected timer running, and invokes the normal interactive chat turn for its target session.
3. Success/failure updates persisted status; cancel/reschedule/list are exposed by the same tool. Default list/manage scope is current session; cross-session operations must specify `all_sessions`/`session_id`.

Timer states are `pending`, `due_waiting`, `running`, `completed`, `cancelled`, `failed`. For “remind me” language this is usually the right choice; for “every weekday” use a recurring schedule.

### Trigger + webhook path

1. `TriggerEngine` normalizes an event into the versioned contract, including source, id/time, payload and optional `dedupeKey`.
2. Persisted `TriggerRule` matches source/event conditions; rule verification contract can require or exclude expected result text. The engine reserves/deduplicates delivery before handing it to `TriggerService`.
3. `PrometheusTriggerRuntime` dispatches the configured action kind: `wake` a chat, send to an agent, run a scheduled task, post to a team, or notify a chat/channel.
4. `TriggerService` retries transient provider failures under bounded retry policy and records run outcome; use run state/history to distinguish match from successful delivery.
5. Webhook endpoints are named and bounded in `WebhookEndpointStore`; request parsing and `verifyWebhookRequest()` check path/header token or HMAC (including GitHub signature) before converting to a webhook trigger event. Deduplication uses delivery identity. Never log/reveal raw endpoint secrets.

### Internal watches and task control

`internal_watch` CRUD creates bounded (TTL required) persisted watch records, default one-shot and delivery mode `run_turn`. Supported target types are `file`, `task`, `scheduled_job`, `event_queue`; list/cancel is scoped to the creating chat unless explicitly configured. A condition match wakes a normal tool-capable main-chat turn with history. The event is evidence, not permission to take consequential action. `internal-watch-policy.ts` defaults to `review_only`; `task_control` runs an allowed follow-up only after the selected action policy passes. On gateway restart the watch runner recovers still-valid watches. Use a watch after a long task rather than polling; do not use a long-lived watch without an expiry.

### Peer-session operations

`prometheus_thread_ops` in `automation-executor.ts` is the main-chat control surface for peer sessions. List/find/search can include active and settled chats; use `state` to narrow, and `reopen` when a settled thread must become visible before sending/steering. Prefer `steer` while the target is actively running; send queues a turn into an idle/settled target. The detached-turn queue in `src/gateway/threads/thread-ops.ts` survives restart and is drained when the gateway is ready. `supervision_wait` is an internal blocking action for hidden supervision runtime, not an ordinary user-facing action. Never target the current owner session with peer operations.

## Config & knobs

- **Cron:** job `schedule` supports cron (5 or 6 fields); timezone is validated. Jobs can carry optional provider/model and managed `team_id`, execution status, run timestamps, expected output/result contracts, skills and enabled state. `CronScheduler` owns on-disk shape; use admin tools to inspect/patch it.
- **Heartbeat:** per-agent enable/interval/model and system-level active hours/review settings are persisted by `SubagentHeartbeatManager`; `HEARTBEAT.md` is a separate, full-replacement prompt file. Runtime bounds interval to 1–1440 minutes; default 30.
- **Timers:** one-off due time plus session ID/instruction/label. Minimum `delay_seconds` is 5; explicit dates should be ISO `due_at`.
- **Triggers:** source kinds include webhook, manual, schedule, heartbeat, connector, internal_watch, event_queue. Rule matcher, conditions, action, delivery and verification are typed in `trigger-types.ts`.
- **Webhooks:** secret/auth metadata is held by `WebhookEndpointStore`; supported auth method includes path token, GitHub HMAC, generic HMAC, or header token.
- **Watches:** bounded expiry required; supported condition/target and review/action policy are schema-defined in `agent-team-schedule.ts` and validated by the store/runtime.
- **Goals:** main chat goal reminders/continuity are separate from managed-team `manage_team_goal`; team goal actions are simplified and event-driven (see [09 Teams](09-teams.md)).
- Current schemas and routes: [tools](generated/tools.md), [routes](generated/routes.md); generated inventories win when prose becomes stale.

## Gotchas / sharp edges

- **A one-time timer is not a recurrence.** It only fires a single user-like turn in its owning chat. Use schedule jobs for repeated work.
- **Heartbeat timer ≠ prompt.** A heartbeat may execute with no useful task if `HEARTBEAT.md` is empty or stale. Check both persisted heartbeat config and the correct agent workspace instruction file.
- **Do not treat `HEARTBEAT_OK` as an error.** It is the no-action sentinel; excessive content or ignoring it makes idle checks noisy.
- **Same-job duplicates are guarded; independent jobs can overlap.** A stale `running` status or queued job after gateway restart needs pid/handoff diagnostics, not blindly re-triggering it.
- **A trigger match is not delivery success.** Check run record, reservation/dedupe outcome, retry state and provider result. Test duplicate webhook delivery and transient failures.
- **Webhook authentication must precede event dispatch.** Validate raw body/signature/endpoint ownership and only log masked secrets; dedupe by provider delivery ID to prevent duplicate work.
- **Internal watch requires a TTL.** Without expiry, the lifecycle violates its bounded-watcher contract. After a match, verify whether it fired once or remains active before creating another.
- **Watches do not grant authority.** Default action policy is review-only. Avoid giving broad task-control actions to a watch that only establishes a file/task state change.
- **Do not poll Teams tasks with internal_watch.** PR #566 routes background member results straight to the manager. A stale watch adds duplicate wake, wrong room scope and race risk.
- **Peer send vs steer matters.** Steer an active session; send/queue work to an idle/settled session; reopen a settled thread if visibility state blocks control.
- **Peer thread is not the owner session.** Operations reject target==actor; choose a real target chat ID.
- **Cross-session timer/watch/peer actions have privacy scope.** Default to current session and require explicit `all_sessions` or session selector for broader operations.
- **Recurring schedule timezone errors pause work.** Validate cron + timezone before diagnosing as a runner outage; use schedule diagnostics/history to inspect paused reason.

## How to change it safely

1. Follow tool schema → `automation-executor.ts` → owning store/runner → event delivery/runtime. Keep timer, heartbeat, cron, trigger, watch and peer state machines separate.
2. Regressions to run (search [generated tests](generated/tests.md)): `trigger-engine.regression.ts`, `webhook-endpoints.regression.ts`, `internal-watch-policy.regression.ts`, `internal-watch-restart-recovery.regression.ts`, `team-watch-routing.regression.ts`, `schedule-pattern`/`sched-task-review`/`handoff-concurrency` coverage, and timer-specific regressions if touching timers. `team-watch-routing` ensures events keep the right team/chat scope.
3. Test due selection, overlap/duplicate guard, restart recovery, cancellation/reschedule, timezone/cron validation, trigger dedupe and transient retry, watch TTL + one-shot semantics, action policy denial, peer active-vs-settled behavior.
4. Use isolated temporary data/workspace paths in regression harnesses. Never create an aggressive repeating live schedule, public webhook, or peer turn as a smoke test.
5. After tool schema or endpoint changes, compare [generated tool inventory](generated/tools.md) and [routes](generated/routes.md); do not edit generated inventories by hand.

## Operator checklist

### Scheduled-job lifecycle

- Before changing an existing job, inspect job detail and recent history; record owner, timezone, prompt, expected output, model, team target, enabled state and last outcome.
- Validate cron expression and timezone using the same scheduler helper the runtime uses. Avoid mental conversion of local time to UTC; a job can be valid but due at a surprising local hour.
- Create/update with `schedule_job`, then verify the persisted schedule and `next_run_at`. For `run_now`, capture the returned task/run identity and optionally create an `internal_watch` if the job is long-running.
- Read latest output/history after completion. Do not treat `enabled:true` as proof the last execution succeeded or that the next due time is correctly calculated.
- A completed schedule can be paused or archived under its review policy; check status and run detail before waking it manually. Do not patch the persisted scheduler file while runner has a warm-handoff lock.
- If there is a duplicated/missing run, compare due time, job run ID, queue state, process/handoff state and completion record before editing. #549/#552 address duplicate fire, warm-handoff store races and task review behaviors; #547 fixes timer owner-watchdog cancellation and team-watch routing leakage.

### Trigger and webhook review checklist

- For an inbound event, first establish source/provider, event ID, timestamp, endpoint ID, target trigger rule and dedupe key. A delivery that is correctly rejected as duplicate should not produce a second action.
- Normalize event before matching; don't make user-provided fields authoritative for endpoint identity or action target. The verified endpoint's provider metadata should determine webhook origin.
- Preserve raw-body integrity for HMAC checks, compare signatures safely, and avoid returning/logging the secret. Test missing, invalid and rotated credentials as separate states.
- Ensure a rule's action agrees with its owner and target: `wake` targets a chat, `team` targets a managed team room, `task` targets a scheduled job, `agent` targets an agent, `notify` sends a bounded notification.
- Conditions/template rendering should be deterministic and bounded. Agent-trigger actions retry transient provider failures with bounded backoff; inspect the recorded `TriggerRunRecord`/retry result before sending manually again.
- Verification contracts (expected/excluded result text) are postconditions, not just matchers. If the rule matched but verification failed, inspect action output and `TriggerRunRecord`.
- Webhook input is externally reachable only through registered secure endpoints; don't add a “debug” bypass to the normal route. Check [routes](generated/routes.md) and endpoint write protections when changing API.

### Internal-watch lifecycle checklist

- Set a TTL based on the expected work duration plus a reasonable retry margin. Watch creation without expiry is invalid; overly broad/long-lived watches create stale wakes.
- Choose the narrowest target type (`task`, `scheduled_job`, `file`, `event_queue`) and ensure the target is stable after restart. File watches should identify exact path/pattern and expected state rather than “anything changes”.
- Default `fire_once` and `delivery_mode:"run_turn"` wake the creating chat with its conversation history. A watch should deliver enough evidence (target, match, current status) to verify; it should not perform hidden follow-up work by implication.
- Leave `action_policy:"review_only"` unless a prior instruction explicitly allows scoped recovery. `recover_same_run` permits safe same-task continuation actions, while full rerun is even more consequential; `task_control` enforces target-task scoping at execution time.
- For live-steer delivery, a file/schedule watch with no target task does not freeze task control for unrelated jobs. For synthetic follow-up turns, policy gates all task controls until explicitly allowed.
- After a watch fires, list current watch state before adding another. Cancel obsolete watches and check `internal_watch_restart_recovery.regression.ts` when changing persistence.
- For team completion, skip internal watch entirely: #566 event routing handles it directly and tests `team-watch-routing`/team simplification guard against leakage.

### Timers, heartbeat, peer sessions

- Timer list defaults to current session and hides completed/cancelled entries. Use `all_sessions:true` only when the request explicitly needs cross-session management; `session_id` can narrow the other target.
- When editing a timer, pass its exact ID and replacement instruction/due time. Do not use an ID taken from another chat without explicit ownership intent.
- A heartbeat has two persisted layers: timer settings (enabled, interval, model) and workspace instruction text. Update the correct agent ID/workspace; `instructions` is a full replacement, not an append.
- Heartbeat config defaults disabled, 30 minutes, and all-day active hours (0–24). Global active-hours gate can suppress a valid enabled timer; inspect both config and `HEARTBEAT.md`.
- Peer list/find/search should narrow by session state and privacy scope; thread ID is not interchangeable with a background task ID. Reopen a settled chat only when needed; steer if target is currently running.
- Detached peer turns are persisted across restart; after gateway recovery, check queue/target session and result before resending. A crash after enqueue but before confirmation can otherwise duplicate an external action.

## Separation of scheduling, triggers and goals

The main user goal system (`src/gateway/main-chat-goals.ts`, `src/gateway/goal-decomposer.ts`, `src/gateway/chat/goal-reminder.ts` and `src/gateway/routes/goals.router.ts`) is not a cron job, not a team goal, and not an internal watch. A main-chat goal holds a user-directed target and can drive an interactive/autonomous chat continuation; it has its own durable state, approval/completion controls and session continuity. Team focus/completion is owned by Teams; scheduled agent work is owned by CronScheduler; event conditions/action are owned by TriggerEngine. Use the subsystem matching the lifecycle rather than translating one state model into another.

A scheduled job can produce a trigger source event, and an internal watch can observe a job/task result. Those are integration edges, not ownership transfer: the schedule's run result remains in schedule history/task records; the watch has its own expiry/delivery state; the trigger has a rule/run record. When diagnosing duplicate work, correlate all three IDs and look for retried delivery/rescheduling rather than deleting one data source prematurely.

### Retry and idempotency boundaries

| Layer | Idempotency key/state | Practical consequence |
|---|---|---|
| Timer | Unique timer ID and due/status transition | Repeated due polling should not create duplicate turns after `running` is persisted. |
| Cron job | Job ID, due slot and active run/queue status | Same job must not start twice for one slot; distinct jobs remain parallel. |
| Trigger | Event ID + optional `dedupeKey`, rule/run reservation and cooldown | Re-delivery of one webhook should not execute another action. |
| Internal watch | Watch ID + interruption/event ID + fire state | Restart recovery must not deliver the same matched observation twice. |
| Peer session | Target thread + persisted detached turn queue item | Acknowledge queue receipt before retrying send after an uncertain crash. |
| Team dispatch | Team/member/dispatch/task ID and event receipt | Team manager receives event rather than independently polling result. |

When the user asks for a workflow that combines these layers (e.g. nightly scheduled job that triggers a team and later reminds main chat), define which ID/store owns each step, its timeout/TTL, retry semantics, approval boundary, and who receives the terminal outcome. Avoid a recurring schedule that creates another recurring schedule or a watch without a bounded end.

### Live checks without creating side effects

- Use `schedule_job` list/history/detail first; do not run the scheduled prompt as a test when it may send, publish, spend, delete or modify production files.
- Use trigger rule/run list/inspection and webhook endpoint metadata. Never test an external webhook by exposing a real secret or delivering a live action to the production target.
- Use `internal_watch` list/status and runner diagnostics; do not keep creating test watches that will wake users later.
- Use heartbeat config/status plus read-only `HEARTBEAT.md` inspection; don't turn on main heartbeat just to check how it behaves.
- For timer completion, inspect persisted state or run a test against isolated session/runtime. Do not send a second timer message because an owner-watchdog canceled the first before the client received it.
- For peer-session work, confirm actual target thread and whether its current turn is active/settled before acting. Use read-only search/list whenever it answers the user's request.

## Related

- [08 Agents, tasks & background](08-agents-tasks-background.md) · [09 Teams](09-teams.md) · [11 Memory, notes & Brain](11-memory-notes-brain.md)
- [03 Prompt assembly & context](03-prompt-assembly-and-context.md) · [05 Tools & categories](05-tools-and-categories.md) · [25 Sharp edges](25-sharp-edges.md)
- [tools inventory](generated/tools.md) · [routes inventory](generated/routes.md) · [test inventory](generated/tests.md) · [merged PR history](generated/changelog.md)
