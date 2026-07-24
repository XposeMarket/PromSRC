# Goals, Context, Continuity, and Recovery

This is the systems manual for how Prometheus carries work across model turns, long conversations, gateway restarts, background execution, and separate chat threads. These systems overlap, but they do different jobs:

| System | What it preserves | What it does not promise |
|---|---|---|
| Session history | Canonical conversation messages and session-level state | Infinite active model context |
| Context compaction | A compact handoff packet plus the most recent messages | A verbatim replacement for every old message/tool result |
| Main-chat Goal | Objective, amendments, plan/progress, outcome, restart checkpoint | Permission to bypass approval, credentials, or safety boundaries |
| Tool observations and audit | Scrubbed, bounded evidence of tool activity; raw sidecars when materialized | That raw output is automatically injected into a later model call |
| Durable task / request state | Executable background work, checkpoints, approvals, and effect state | Blind replay of an uncertain external side effect |
| Thread supervision, watches, schedules, heartbeats | Ways to keep checking, wake, or re-enter work | Proof that the underlying work succeeded without inspection |

The important practical rule: Prometheus uses several durable records to *reconstruct intent and verify state*. It is deliberately conservative about replaying actions that may already have changed the outside world.

## 1. The state layers

### A. Chat session

Each session has a stable id, message history, title/pin/workspace/channel metadata, selected model route, active tool-category state, optional creative state, and optionally one `mainChatGoal`. Sessions are persisted under the configured Prometheus data directory (`sessions/<sessionId>.json`). The exact session snapshot is the primary record for the conversation; chat audit mirrors are recovery aids, not the sole source of truth.

The session stores both the full retained history and a compact-context cursor:

- `latestContextSummary` — the most recent rolling resume packet.
- `contextStartIndex` — the older positional checkpoint kept for compatibility.
- `contextStartMessageId` — the preferred stable checkpoint. It anchors the first retained message by message identity, rather than assuming the same array position after a web/mobile history merge.
- `contextSummaryUpdatedAt` — when the summary was produced.
- `pendingCompaction`, `pendingMemoryFlush`, and `contextTokenEstimate` — operational/session-health fields.

The gateway keeps raw session history for auditability. It does **not** destructively trim old history merely because context has been compacted; `getHistoryForApiCall()` constructs the smaller model-facing view from the current summary plus messages after the checkpoint. If the stable anchor disappears after a merge/replacement, the implementation falls back to index `0` instead of using a stale position that could hide newly inserted user messages.

### B. Durable user memory and project context

Conversation continuity is not limited to chat history. The workspace convention separates durable information by purpose:

- `USER.md`: identity and preferences.
- `SOUL.md`: Prometheus operating style/rules.
- `MEMORY.md`: durable decisions, project history, and long-lived continuity notes.
- `BUSINESS.md` and `entities/`: business context and structured people/project/vendor facts.
- project/workspace files and notes: the authoritative work product.

This layer is intentionally more durable and user-editable than a rolling chat summary. A compactor should retain a pointer to important files and decisions; it should not become a substitute for the actual project documents.

### C. Audit and tool-observation layer

Prometheus records compact, scrubbed tool observations with tool name/category, bounded argument and result previews, timing, status, touched paths, artifacts, and an optional raw-result reference. Large output is placed in a raw sidecar only when materialization succeeds; the normal future-prompt record remains small.

The audit mirror has several related artifacts under the workspace `audit/chats/` tree:

- `sessions/`: mirrored session snapshots.
- `transcripts/`: readable/JSONL conversation records.
- `compactions/`: rolling-compaction artifacts.
- `continuity/`: small immediate recovery journal.
- `tool-observations/`: compact tool observations and, where present, raw sidecars.

The immediate continuity journal is append-only and synchronous, but intentionally bounded and best-effort. It scrubs secret-looking fields, caps strings/objects/arrays, never carries raw tool output, and cannot fail a user turn. The broader transcript/audit materialization is asynchronous and bounded; if overloaded it can drop mirror records while canonical session state continues to exist. Therefore audit data is evidence and recovery support—not a license to infer an action happened when its current live state says otherwise.

## 2. Main-chat Goals

### What a Goal is

A main-chat Goal is a durable, session-scoped autonomy contract. It is created from `/goal <objective>` and turns the primary thread into an iterative workflow instead of a one-response exchange. It records:

- stable goal id and owning session id;
- original objective plus a requirements ledger for later user amendments;
- status, timestamps, turns/iterations used, last reason/directive, evidence and verification gaps;
- declared turn plans and individually tracked steps;
- pause, block, failure, and denied-action information;
- a restart checkpoint when a planned or unexpected gateway restart interrupts work; and
- completion usage totals (elapsed time, token/cost events in the Goal interval) when a genuine completed Goal is reported.

The requirements ledger is why later instructions can survive summary compaction: user amendments are separately recorded as durable goal requirements rather than relying only on an older transcript fragment.

### Status lifecycle

The stored status vocabulary is `active`, `restarting`, `paused`, `blocked`, `done`, `cleared`, and `failed`. The user-facing controls include `/goal status`, `/goal pause`, `/goal resume`, `/goal stop`, `/goal clear`, and creation/replacement with `/goal <objective>`.

| State | Meaning | How it leaves that state |
|---|---|---|
| `active` | The autonomous continuation loop may take the next in-scope turn. | It can continue, pause, block, finish, fail, or enter restart handling. |
| `paused` | Work is intentionally stopped with pause timing/reason retained. | `/goal resume` restores `active` and clears the pause reason. |
| `restarting` | A restart boundary is being tracked. | Recovery turns use the checkpoint, then resume/complete it. |
| `blocked` | Further progress needs an essential missing authority, credential, user choice, external system, or hard policy exception after safe alternatives were exhausted. | `/goal resume` can reactivate it when the condition is resolved. |
| `failed` | A runtime failure was persisted; the failure reason remains visible. | `/goal resume` can start a new active continuation. |
| `done` | The objective has an accepted owner completion or completed outcome. | A new or replaced Goal is required for new work. |
| `cleared` | The stored Goal was removed/cleared. | Create a new Goal. |

`/goal stop` is terminal from the workflow’s perspective, but the code distinguishes a user stop from evidence-backed success: a stopped Goal does not generate a successful completion report. `/goal clear` removes the active goal state rather than declaring work complete.

### Plans are tracking, not authority

During Goal work, the agent is asked to call `declare_plan` for a real multi-step path and then complete steps with evidence. The first declared plan becomes durable Goal progress shown by the UI. A later continuation reuses an unfinished open plan where possible, rather than declaring a duplicate every turn.

However, the plan does not outrank the objective. A Goal can only be completed by its owner calling `complete_goal` with a completion note and concrete steps taken; a stale plan checkbox cannot on its own prove completion. Conversely, owner completion may close the Goal even if an old plan item is overly broad or stale, because the completion handler records the actual closeout.

`block_goal` has a narrower meaning: it is for a real impasse after safe in-scope attempts—not for uncertainty, complexity, or a routine handoff. Completion can still be correct when the deliverable is ready and the only remaining work is an explicitly documented user-controlled activation or physical handoff, unless that unavailable action was itself an acceptance criterion.

### Continuation and safety budgets

After a Goal turn, an outcome is persisted as `done`, `continue`, or `blocked`. A continuing Goal stores the next directive, evidence/gaps, plan status, and iteration record before the next autonomous turn. The system has stop guards rather than running forever:

- configurable maximum iterations (default `100`);
- configurable consecutive no-progress threshold (default `8` judged turns with the same progress fingerprint);
- configurable consecutive unusable-judge-output limit (default `3`);
- configurable consecutive runtime-failure limit (default `3`);
- the normal approval, credential, scope, and hard-deny policies remain in force.

Hitting a safety budget blocks the Goal with the recorded reason. It does not silently claim success or bypass user control.

### Goal summaries versus chat summaries

These are different compactors:

- **Goal progress summary**: every configured number of Goal turns (default `5`), the Goal system asks a dedicated compacting call for a short goal-progress summary. Its model defaults to `session.mainChatGoals.compactionModel` when set, otherwise the current primary model; its reasoning override is `compactionReasoning`. It informs future Goal continuation.
- **Rolling context summary**: created for the normal chat context window (explained below), regardless of whether a Goal exists.

Both preserve intent, but neither overrides the requirements ledger, saved plan, checkpoint, durable task/request record, or current live state.

## 3. Gateway restart and Goal recovery

An active Goal can persist a restart checkpoint with the reason, phase, turn/plan/active-step position, recovery kind (`planned` or `crash`), dev-edit id, affected/touched files, changed surfaces, and pre-restart verification summary. Checkpoint phases are `interrupted`, `crash_recovered`, `boot_finalized`, `resuming`, and `complete`.

On a continuation after a checkpoint, the generated control context is intentionally cautious:

- a planned restart means verify the new gateway, complete post-restart checks, and continue unfinished work;
- an unexpected crash means partial effects are possible but unverified—reread known files, reconcile state, and do not claim the change is live merely because it was in the checkpoint;
- if a durable dev-edit continuation exists, reuse its id rather than making a second approval/apply request;
- if a live apply is already complete, do not repeat the apply/restart; only verify and complete remaining work.

Automatic Goal restart resumption is controlled by `session.mainChatGoals.autoResumeOnRestart` (default true). It is not blind replay: checkpoints tell the next turn where to inspect, while tool/request policies determine whether a previous effect can be reused, retried after verification, or must go to review.

## 4. Chat-context compaction

### Why it exists

The model cannot receive an unbounded transcript forever. Prometheus preserves the session record and periodically replaces the *model-facing* old portion with a structured resume packet. There are two triggers.

#### Rolling-message checkpoint

With `session.rollingCompactionEnabled` on (default), a compaction runs once the number of non-summary messages after the stable checkpoint reaches `rollingCompactionMessageCount` (default `20`, bounded to `10–120`). It takes the new window, the prior summary if any, recent tool observations (or recent tool logs as a fallback), and recovery artifact paths.

The result is stored as the current summary/checkpoint and recorded in the compaction audit artifacts. The next model call receives that summary plus messages after the checkpoint, not a synthetic user-visible recap.

#### Mid-workflow token-budget checkpoint

During a long tool loop, compaction can also happen *between model/tool rounds*. The gateway estimates input tokens using the active route’s model context profile and recent provider-usage calibration. It triggers when projected input reaches the compaction trigger (90% of the usable input budget) or when recent tool-observation text reaches its dedicated tool-context budget.

The active message array is then replaced with:

1. the original system message, when present;
2. `[Rolling context summary]` containing the resume packet; and
3. an internal instruction to continue directly without recapping compaction to the user.

The UI/tool stream exposes this as the synthetic `context_compaction` event, with reason and before/after context telemetry. A failure is non-fatal: Prometheus reports bounded-context continuation rather than failing the user’s task just because compaction failed.

### What the compactor is asked to preserve

The compactor writes a fixed ten-part handoff:

1. Primary request and intent
2. Key technical concepts
3. Files and code sections
4. Errors, fixes, and test results
5. Problem solving and decisions
6. Recent user messages
7. Pending tasks
8. Current work
9. Recovery artifacts
10. Continue from here

It is told to include concrete implementation state, eliminated hypotheses, commands/tests, blockers, approvals, preferences, newest instructions, and recovery paths; to avoid inventions and generic advice; and to direct the next assistant to protect user-owned changes and resume naturally. Reasoning trails may be used to preserve durable conclusions, but not copied as raw chain-of-thought.

The default rolling summary limit is `900` words (configurable, bounded to `80–1500`). The token-budget path derives a bound from the admitted model’s usable budget. It prefers the configured rolling-compaction model for ordinary rolling compaction; a mid-workflow interactive turn instead uses the already admitted route so a settings change cannot switch models halfway through a live turn.

If the compactor call fails, Prometheus creates a structured fallback summary containing the prior summary and recent messages, marking unknown sections as unknown. That fallback is intentionally less rich, but it preserves a safe continuation instruction instead of discarding the thread.

### What compaction does not do

- It does not delete the canonical chat session history.
- It does not guarantee exact raw tool results are available in a subsequent prompt; large results are bounded and raw sidecars require explicit audit/retrieval handling.
- It does not change approval state, execute tools, or retry an external action.
- It does not overwrite durable `MEMORY.md`, project files, task records, goal requirements, or live state.
- It does not mean a task is complete. It is a context-management event only.

## 5. Tool-effect durability and task recovery

For normal chat tool calls, the durable turn-job layer journals a logical effect before and after execution: tool/call identity, argument hash, attempt/execution count, result reference, and replay policy. The resource-policy boundary is deliberately fail-closed:

| Replay policy | Meaning after a lost lease/crash |
|---|---|
| `safe_retry` | Explicit built-in read/query/status allowlist may be retried. |
| `verify_before_retry` | Default for unknown plugins, composites, and future tools; inspect state first. |
| `never_replay` | Send/publish/payment/click/delete/restart/deploy-style effects must not be automatically replayed. |

A succeeded effect can reuse its referenced result. An expired, cancelled, or failed attempt that leaves a non-safe effect uncertain becomes `unknown` and moves the job to `needs_review`; a final job cannot be committed while an effect is still prepared/running. This prevents the dangerous failure mode of treating “the gateway lost track of it” as “safe to do again.”

The same prepared/running/result boundary is used for Goal complete/block, plan declaration/advancement/step completion, subagent spawn, outer task start, and secondary-assist branches. It still does **not** make arbitrary child processes safely replayable: a launched process needs its own ownership/verification contract before automatic resume is allowed.

Resource leasing protects selected shared resources during an attempt (for example browser-per-session, global desktop input, scheduler store, and lifecycle/dev-apply resources). File/repository command leases are optional behind `PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES=1`; when disabled, the normal shared-workspace concurrency model remains. Task/team managers retain their own manager locks rather than holding a long durable lease across a child turn.

### Task page, task journal, and recovery

The task system is a separate execution record from the chat transcript. It tracks managed background work, plan state, current step, task status, approvals, process output, artifacts, checkpoints, and its journal. The Task page’s “process log” should be read as a view of task/journal/process evidence—not as a duplicate of the chat summary.

When a gateway restart pauses a task with `pauseReason: "gateway_restart"`, that is an intermediate recovery state, not a terminal success/failure. Internal watches specifically ignore it as a normal terminal match and can create a restart-interruption follow-up that instructs Prometheus to inspect the same task and continue from the preserved checkpoint. It must verify current task state first; ambiguous, destructive, approval-waiting, or unsafe-to-repeat work is inspected/reported rather than blindly resumed.

Audit recovery tools expose recent sessions, search, session timelines, recovery candidates, a recovery brief, and safe artifact reading. A recovery brief combines the last Goal state, request state, successful/failed tool evidence, touched paths, latest assistant response, continuity timestamp, and evidence references; its own suggested next action is to inspect live thread/request state before mutating or duplicating recovery.

## 6. Threads, background agents, teams, watches, schedules, and heartbeat

These are all forms of continued work, but they start and retain state differently.

| Mechanism | Unit of work | Continuity model | Key boundary |
|---|---|---|---|
| Managed thread | Another full chat session | Its own history, workspace, optional Goal and supervision record | Parent session does not become the child’s shared context. |
| Background task | Durable managed task | Task state, plan/journal/checkpoint, approvals/effects | Must recover the same task, not silently create a duplicate. |
| Team | Multiple managed agent roles/runs | Team manager, member rooms, artifacts, dispatch state | Each worker has a scoped identity/workspace/tool route. |
| Internal watch | Saved condition on file/task/schedule/event queue | Watch store + last observation/pending match | An observation is evidence, not an instruction to mutate. |
| Scheduled job | Cron-like named automation | Job definition, run history/output/archive | A schedule is a trigger, not a permanent interactive thread. |
| Heartbeat | Periodic agent-owned `HEARTBEAT.md` review | One isolated `heartbeat_<agentId>` session per agent | `HEARTBEAT_OK` is intentionally silent. |

### Managed threads and supervision

`prometheus_thread_ops` creates or starts a target session (by default a fresh `prom_<uuid>` id), assigns its workspace, and can start a detached turn. If the thread is followed, a supervision record holds the objective, acceptance criteria, review/follow-up budgets, elapsed-time/no-progress limits, and target/owner linkage.

The target thread has its own session history and its own Goal if started in managed mode. The subagent/spawn model similarly does not share the parent’s active session history automatically. Parent/owner context is passed as a bounded instruction and subsequent work is recorded in the target thread. That separation prevents context collisions but means important requirements must be carried in the objective, task record, artifacts, or explicit message—not assumed to be magically shared.

Thread controls can create/start, message/steer, interrupt/stop, rename, pin, follow/revise/pause/resume/unfollow supervision, and inspect session/runtime state. An interrupt pauses live runtime; it does not erase the session’s recorded conversation.

### Internal watches

An internal watch can observe a file, task, scheduled job, or event queue. It persists target, condition, rationale, delivery session, origin session, last observation, and action policy. Matching can mean file appearance/change, task terminal/milestone state, scheduled-job completion/latest run, or event queue activity.

Its action policy is explicit:

- `review_only`: task mutation from the watch is technically blocked; inspect, verify, or report.
- `recover_same_run`: narrow steering/resume of the same run after inspection; no full reset/rerun.
- `full_rerun_allowed`: only after inspection supports it and prior user authorization/instruction justifies it.

Watch delivery prefers the creating main-chat session, then durable provenance fallbacks. A delivered observation tells the receiving turn that it is evidence, not a user command; it must compare the target against the original/latest intent before reporting or acting. This is the core safeguard against a stale notification causing surprise work.

### Schedules and heartbeat

Scheduled jobs use the cron scheduler and durable job/run history. Schedule controls include creating, patching, reviewing output/history, pausing/resuming, and stuck-control through the automation system. A schedule can pause/resume managed work according to its own rules; the heartbeat runner also resumes background tasks marked for schedule-driven resumption.

Heartbeat is a separate periodic prompt mechanism. Each registered agent can have a heartbeat configuration (enabled state, interval, and active-hour behavior) and reads that agent’s own `HEARTBEAT.md` using a private session id `heartbeat_<agentId>`. If the file has no actionable work, or the reply is exactly `HEARTBEAT_OK`, the tick is silent: no normal chat/sidebar/channel message is produced. Actionable output is broadcast and may be delivered to configured channels. One-off heartbeat blocks are pruned after a run so they do not repeat forever.

## 7. The settings that control this subsystem

The Settings session configuration is the operational control plane for the behavior above. Defaults from `src/config/config.ts` are shown here; a deployment can override them.

| Setting | Default | Effect |
|---|---:|---|
| `session.maxMessages` | `120` | Legacy/session sizing policy; raw history is still retained and active context is compacted separately. |
| `session.compactionThreshold` | `0.7` | Session compaction policy threshold. |
| `session.memoryFlushThreshold` | `0.75` | Threshold for pre-compaction memory-flush behavior. |
| `session.compactionMinMessages` | `20` | Minimum real user/assistant messages before token-threshold compaction may run. |
| `session.rollingCompactionEnabled` | `true` | Enables both normal rolling compaction and token-budget compaction checks. |
| `session.rollingCompactionMessageCount` | `20` | Non-summary messages after checkpoint required for rolling compaction. |
| `session.rollingCompactionToolTurns` | `5` | Recent assistant tool turns included in rolling context evidence. |
| `session.rollingCompactionSummaryMaxWords` | `900` | Word ceiling for rolling context resume packets. |
| `session.rollingCompactionNumCtx` | unset | Optional compactor context-window override; otherwise current model/config/environment fallback is used. |
| `session.rollingCompactionModel` | unset | Optional model override for ordinary rolling compaction. |
| `session.mainChatGoals.enabled` | `true` | Enables `/goal` workflow. |
| `session.mainChatGoals.autoResumeOnRestart` | `true` | Allows eligible active Goals to resume after restart recovery. |
| `session.mainChatGoals.summaryEveryTurns` | `5` | Frequency of Goal progress summaries. |
| `session.mainChatGoals.summaryMaxWords` | `450` | Goal progress summary word budget. |
| `session.mainChatGoals.compactionModel` | unset | Dedicated Goal-progress compactor route; falls back to current primary model. |
| `session.mainChatGoals.compactionReasoning` | unset | Reasoning-effort override for the Goal progress compactor. |
| `session.mainChatGoals.maxConsecutiveRuntimeFailures` | `3` | Runtime-failure safety stop. |
| `session.mainChatGoals.maxIterations` | `100` | Autonomous Goal iteration budget. |
| `session.mainChatGoals.maxNoProgressTurns` | `8` | Same-progress plateau safety stop. |
| `heartbeat.enabled` | `true` | Global heartbeat availability. |
| `heartbeat.interval_minutes` | `30` | Base heartbeat interval. |
| `heartbeat.workspace_file` | `HEARTBEAT.md` | Workspace heartbeat instruction file convention. |

## 8. Practical reading guide

When work seems to have “forgotten” something, ask which layer is involved:

1. **The user’s durable decision or preference** — check memory/project files and the Goal requirements ledger.
2. **A prior chat detail** — check the session history, latest context summary, and transcript/compaction artifacts.
3. **A tool outcome** — check tool observations and, if needed, the bounded audit raw artifact route.
4. **An interrupted change or external action** — check the Goal restart checkpoint, durable request/effect state, approvals, task journal, and live target state before retrying.
5. **A background workflow** — check the task page/state, active watch/schedule/team/thread record, then the actual task/runtime status.

The correct recovery action is therefore usually *inspect → reconcile → continue the same recorded unit of work*, not “start over and hope the old action did not happen.”

## Source map

- Goal lifecycle, progress summaries, restart checkpoints, and completion/block semantics: `src/gateway/main-chat-goals.ts` and `src/gateway/session.ts`.
- Rolling and mid-workflow compaction: `src/gateway/routes/chat.router.ts`; context budget calculations: `src/gateway/context/model-context.ts`.
- Session persistence/compacted context assembly: `src/gateway/session.ts`.
- Immediate continuity journal and audit recovery: `src/gateway/audit/continuity.ts`, `src/gateway/audit/audit-ops.ts`, and `src/gateway/audit/materializer.ts`.
- Durable effects/resource replay policy: `src/gateway/turn-jobs/resource-policy.ts` and chat execution integration.
- Managed threads/supervision: `src/gateway/threads/thread-ops.ts` and `src/gateway/threads/thread-supervision*.ts`.
- Background task recovery: `src/gateway/tasks/background-task-runner.ts` and task router/state modules.
- Watches: `src/gateway/internal-watch/internal-watch-runner.ts`, `internal-watch-store.ts`, and `internal-watch-policy.ts`.
- Schedules/heartbeats: `src/gateway/scheduling/cron-scheduler.ts`, `schedule-admin-tools.ts`, and `heartbeat-runner.ts`.
- Defaults/schema: `src/config/config.ts`, `src/types.ts`, and `src/config/config-schema.ts`.
