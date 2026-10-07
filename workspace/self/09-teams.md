# 09 — Managed Teams

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/teams/`, `src/gateway/internal-watch/`, `src/gateway/agents-runtime/capabilities/team-agent-executor.ts`
> **Read this when:** creating or operating a managed team, changing manager/member turns, dispatch, goal handling, event routing, or shared team workspaces.

## TL;DR

- Teams v3 are manager/member subagents plus a durable team store, shared chat/room state, dispatch receipts, and a shared team workspace. Main sources are `src/gateway/teams/managed-teams.ts`, `team-coordinator.ts`, `team-manager-runner.ts`, `team-member-room.ts`, and `team-dispatch-runtime.ts`.
- Runtime tool wrappers are `team_ops_wrapper` for lifecycle/dispatch/goal operations and `team_collab_ops` for manager/member collaboration; executor normalization maps wrapper payloads to underlying team capability calls.
- Team manager is a main-Prometheus-driven coordinator turn, not the old independent loop. Team events are routed to room state and can schedule manager/member auto-wakes.
- Current manager wake policy is event-driven in `team-event-router.ts` → `shouldWakeManager()`. Background member completions wake the manager directly; do not restore internal-watch polling for team task IDs.
- Team-level goal control was simplified on main #566: `manage_team_goal` supports focus/log/pause operations, not a milestone/memory-file project planner. Re-check `normalizeTeamGoalAction()` before changing prompts or callers.
- Each team has a team workspace and may specify a real project `workDir`; member/manager turns get the correct working root and allowed file paths (`team-dispatch-runtime.ts`, `team-workspace.ts`).
- Completion events can wake up to three related, wakeable teammates when their plan items may be unblocked. The manager reviews results, verifies artifacts, re-dispatches fixes or records accepted work.
- Team PRs #542–#544 are on current main; #547 also fixes timer watchdog/team-watch leakage. #545 and #546 are unrelated media/visuals changes, and #548 is a visual theme change—avoid implying the entire numeric range is team work. PR #549 is on main (schedule duplicate-fire/warm-handoff store races and blank update-field fix). PR #566 is **merged and at HEAD `a48712ccc`**, not pending; it removes ~2.5K dead lines and simplifies goal/event behavior.

## Map

| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Durable team model and store | `src/gateway/teams/managed-teams.ts` → `ManagedTeam`, `TeamRoomState`, `saveManagedTeam`, `loadManagedTeams` | Canonical team records; includes manager, members, focus, room, dispatches and workdir. |
| Lifecycle, validation, workspace provision | `managed-teams.ts` → create/update/delete/list/provision helpers | Team workspace is provisioned separately from project checkout. |
| Manager prompt/protocol | `src/gateway/teams/team-coordinator.ts` → coordinator prompt/build/run functions | Main agent acts as manager; current prompt has no memory.json/last_run.json bookkeeping. |
| Manager execution and completion review | `src/gateway/teams/team-manager-runner.ts` → `triggerManagerReview`, `triggerManagerReviewForAgent`, manager handlers | Main-chat manager turn, gates paused/manual review states. |
| Event routing | `src/gateway/teams/team-event-router.ts` → `routeTeamEvent`, `shouldWakeManager`, `wakeLikelyUnblockedMembers` | Writes/queues event, wakes dependent members, chooses manager wake. |
| Auto-wake queue | `src/gateway/teams/team-manager-autowake.ts` → manager/member scheduling helpers | Debounces/serializes event-driven turn scheduling. |
| Member room turns | `src/gateway/teams/team-member-room.ts` → member room/status helpers | Member updates/read of room plan, messages and status. |
| Dispatch + execution scope | `src/gateway/teams/team-dispatch-runtime.ts` → team dispatch/runtime helpers | Runs managed members, prefixes team context, scopes workspace/project workdir. |
| Dispatch queue, receipts | `team-execution-queue.ts`, `team-run-receipts.ts`, `team-dispatch-runtime.ts` | Controls execution and correlates task result with source/dispatch. |
| Shared files | `src/gateway/teams/team-workspace.ts` → workspace/path guards | Claim/access control, isolation and allowed roots. |
| Tool surface | `src/gateway/agents-runtime/capabilities/team-agent-executor.ts`; wrappers normalized in `subagent-executor.ts` | Use `team_ops_wrapper` and `team_collab_ops`, not stale direct-tool assumptions. |
| HTTP/API and workspace routes | `src/gateway/routes/teams.router.ts` | Generated route list: [routes](generated/routes.md). |
| Internal watches (general automation only) | `src/gateway/internal-watch/internal-watch-runner.ts`, `internal-watch-store.ts` | Team background dispatch no longer relies on task-id watches (#566); prior #547 fix also stopped team-watch leakage into unrelated chats. |
| Regression coverage | See [generated tests](generated/tests.md) for event routing, wrapper normalization and team simplification. | Don't duplicate the generated test list. |

## How it works

### Team execution path

1. Create/configure a team through `team_ops_wrapper(action:"manage", team_action:...)`. The manager, members, shared purpose/focus, room state, and workspace are stored in the managed-team store.
2. Main chat can start or dispatch a member. Wrapper normalization maps friendly arguments to internal schema; `dispatch` uses a member id and task prompt. From main chat, background dispatch is generally default and returns a task ID; inside manager flow it can block for the member response.
3. `team-dispatch-runtime.ts` resolves the actual team `workDir` when configured; otherwise use team workspace. It injects member role/team context and scopes its runtime file access. Do not treat the live parent checkout as an implicit shared write target.
4. The member runs in its own chat/runtime. Results are attached to dispatch receipts and then emitted as team events. Member completion/failure/blocker/artifact events update the room and are routed by `team-event-router.ts`.
5. `shouldWakeManager()` decides whether a manager turn is warranted. Failure, blockers, artifacts, warnings/errors/admission issues, newly woken members, remaining plan work after completion, and background completion events can wake it. A foreground result already returned inline need not get a duplicate manager wake.
6. `wakeLikelyUnblockedMembers()` looks for up to three other wakeable owners of pending/active/blocked plan items after a member completion; messages tell them to reread room state and report readiness. Auto-wakes are scheduled through the manager/member autowake layer.
7. The manager verifies output (including relevant files), then may re-dispatch a concrete fix or record accepted work via `manage_team_goal(action:"log_completed")`. For finished goals, the coordinator uses `[GOAL_COMPLETE]` review signaling; completion review is claimed once per goal key.

### Current tool wrapper surface

- `team_ops_wrapper`: `manage` lifecycle (`create`, `start`, `update`, `pause`, `resume`, `delete`, `list`) and execution/coordination actions (`dispatch`, `request_member_turn`, `get_agent_result`, `post_chat`, `reply`, `manage_goal`, `manage_context_ref`). Read the wrapper implementation/schema before adding action aliases.
- `team_collab_ops`: teammate or manager conversation and requests from within a team: speak to manager/teammate, ask for context/help, update status, share artifact, update goal, and reply routing. Exact action schema is generated in [tools inventory](generated/tools.md).
- `get_agent_result` can address a dispatched task by `task_id`, or by member ID to resolve that member's latest dispatch in the team. Do not reuse stale task IDs.
- Wrapper field names differ from executor field names in several cases. `agent-team-wrapper-params.regression.ts` covers normalization, including dispatch prompt, teammate id, request context and blank-field behavior.
- Keep response intent explicit in chat routing. Specific member route uses its ID/name; whole-team messages must remain broadcast intent until delivered.

### Goals and simplification on main

PR #566 (“Teams simplify: event-driven manager wakes, 2-field goal, remove ~2.5k dead lines”) is at current main HEAD (`a48712ccc`). `team-simplify.regression.ts` verifies the manager is directly woken for background completion (no open plan item required), foreground completion is not redundantly woken, obsolete goal actions are rejected, and the manager prompt/workspace no longer depend on memory.json/last_run.json/pending.json.

`manage_team_goal` action aliases normalize focus and completion logging (e.g. `set_goal` → `set_focus`; `log_completion` → `log_completed`); canonical focus/log actions plus agent pause/unpause operations are the supported simplified surface. Old mission/milestone operations are intentionally rejected with removal guidance. A two-field goal representation (purpose/focus) should not be conflated with the separate collaboration room plan, current dispatch tasks, or accumulated completion log. Read `normalizeTeamGoalAction()` and executor branches in `team-agent-executor.ts` before touching.

## Config & knobs

- Team data and room state are persisted by `managed-teams.ts` in the gateway config/data area; rely on its store/path helpers instead of hand-constructing a path.
- Team fields include permanent purpose, current focus/task, members/manager, completed work, room plan/messages/member states, dispatches and optional `workDir`. The compatibility loader normalizes older persisted shapes; migrate through its canonical writer.
- Manager configuration includes paused/manual review gates. `triggerManagerReview()`/`triggerManagerReviewForAgent()` enforce them before invoking a manager turn.
- Manager/member auto-wakes are debounced and routed by team ID + source; keep event payloads scoped so a wake from one team does not leak into unrelated chats (#547 fixed watch scoping; #564 settles stale dispatches).
- Shared workspace and optional project work directory are distinct roots. Recent #560 corrected the real project workdir for managers and members; don't assume the worktree root is the shared team workspace.
- Exact routes, tools and tests are generated: [routes](generated/routes.md), [tools](generated/tools.md), [tests](generated/tests.md).

## Gotchas / sharp edges

- **Current main already has #566.** Check `git log -1` before copying pre-simplification advice. Do not tell the manager to maintain `memory.json`, `last_run.json`, or `pending.json`; this bookkeeping was removed.
- **Background dispatch is event-driven.** Team member results route to `team-event-router.ts`; adding internal_watch polling causes duplicate wakes and stale-watch leakage. Use internal watches for their supported general task/event/file targets only.
- **One completion review per goal.** Repeated `[GOAL_COMPLETE]` output is guarded by `claimTeamGoalCompletionReview`; preserve claim semantics to avoid duplicate review runs (#564).
- **Blank wrapper fields can erase configuration.** #549 fixed blank `team_manage` update fields; retain omission-vs-empty semantics and tests. Do not send absent optional settings as empty strings.
- **Tool wrappers and executors historically disagreed on names.** #543 fixed capability executor shadowing team handlers; #544 corrected goal aliases/manager allowed paths; #542 fixed multiple Gauntlet findings. Extend the normalizer regression whenever changing wrapper params.
- **Wrong work root = wrong writes.** Members and manager must use team `workDir` when selected, else team workspace. Keep guards for allowed paths and avoid writing to unrelated/dirty parent checkout.
- **Manager can miss useful progress if event lacks correlation.** Preserve team ID, member ID, dispatch/task ID, source, status/result summary and artifact path through the event router/receipt.
- **Dispatch may settle stale.** #564 added stale-dispatch settlement; test complete/fail, retry and handoff states when changing event-to-result code.
- **Do not assume old functions remain.** #566 removed roughly 2.5K obsolete orchestration lines. Prefer live `team-manager-runner`, `team-event-router`, and `team-dispatch-runtime` symbols over archived docs.

## How to change it safely

1. Trace wrapper declaration → normalization → team capability executor → manager/member runtime → event route and persisted state. Keep manager vs member authority clear.
2. Run focused regressions: `src/gateway/teams/team-simplify.regression.ts`, `team-store-stall.regression.ts`, `team-execution-queue.regression.ts`, `team-workdir-store.regression.ts`, `src/gateway/agents-runtime/agent-team-wrapper-params.regression.ts`, and `src/gateway/agents-runtime/teams-gauntlet-fixes.regression.ts` (see [generated tests](generated/tests.md)).
3. Validate every wake trigger and non-trigger (background completion, inline foreground completion, blockers, failed/admission-limited dispatch, artifacts, active plan and paused manager). Test duplicate GOAL_COMPLETE review and stale dispatch settlement.
4. Check team/member workspace roots, path allowlists, project workdir, store writes/recovery, warm handoff and tool result correlation. Avoid a live dispatch if it can perform external side effects.
5. Check current main PR history in [generated changelog](generated/changelog.md): #542–#544, #547 and #549 are on main; #545/#546/#548 are unrelated. PR #566 is the current main HEAD `a48712ccc`; #560/#564/#566 behaviors are especially important context.

## Team manager and room operating checklist

### Team lifecycle and shared state

- Start with `team_ops_wrapper(action:"manage", team_action:"list")` or inspect the requested team before creating one. A team has an owner, manager, purpose/current focus, member IDs, room state, shared workspace and optional project `workDir`.
- Use `start` only after verifying manager/member definitions and workspace scope. Pausing/resuming the team manager is distinct from pausing a member; `team_collab_ops` status updates and per-agent pause states do not mutate a task result.
- The manager's authoritative operating context is the current team record plus room history/plan and member results. It may see compatibility `teamContext`, but current purpose/focus are canonical after simplification.
- The team store and member workspaces are not a single filesystem. Team workspace holds shared coordination artifacts; configured `workDir` is the project working root for all member and manager turns. Paths are checked against main workspace/allowed roots.
- Room plan item owner/status is a coordination hint. A member completion event is not proof that every plan item is done; manager should compare actual artifact with the relevant work item.
- For clarification/planning without execution, call `request_member_turn` / `team_collab_ops`; for work with side effects, make a distinct `dispatch` and retain the dispatch/task ID.
- Messages have actor, target and type. Use explicit targeted reply for one member; an all-target room post is visible to everyone and may prompt several agents.
- Context refs store bounded artifacts/links in the team context surface. Include a short purpose and source to help a later manager/member select relevant references; don't dump secrets into a shared room.

### Dispatch event triage

When a member event arrives, the manager should identify team, member, dispatch/task ID and source, then inspect the room state and task result. The event router appends a room message with the agent, summary and artifact metadata before deciding wakes. If one result may unblock related plan work, up to three wakeable teammates are asked to reread room state and report readiness. Those follow-up turns are event-driven and debounced; they don't poll.

Manager review should distinguish:

- **Completed**: verify artifact and test/success evidence; accept or request a concrete correction.
- **Failed/admission-limited**: inspect error/admission code and stale dispatch state; retry only after adjusting capacity, scope or prompt.
- **Blocked**: post the missing dependency/decision and keep status blocked until resolution.
- **Shared artifact**: check that path is in the team workspace or configured work root and the artifact is accessible.
- **Warning/error**: route to manager even if no room plan item is active. Preserve the event result and error field for diagnosis.
- **Background completion**: manager wake is mandatory because no main caller received the result inline. This is the #566 replacement for team task-ID watches.

### Goal and completion review rules

`purpose` is why the team exists long term; `currentFocus` is the active target. `completedWork` is a capped rolling log of accepted work, not the live room plan. The manager can set a new focus or log completion and pause/unpause members through the simplified goal tool. Use room plan entries to coordinate dependencies; don't emulate the removed mission/milestone persistence by writing ad hoc memory files.

`[GOAL_COMPLETE]` indicates the coordinator believes the currently focused goal is complete and asks the manager to verify. It is not self-approval: the manager checks deliverables and then records completion. `goalCompletionReviewKey` and claim logic ensure one review per goal key; if the same focus is returned again, inspect current key/claim state before requesting another review.

## Team flow in practical cases

### Running a managed team from main chat

1. Inspect existing teams, purpose/focus, manager pause state and member availability.
2. Create or update team membership and `workDir`, then call `start` if the manager needs to run. Keep project goal/purpose concise; file/path scope should be explicit.
3. Use `dispatch` for actual execution. Preserve the returned task/dispatch ID; wait/read results via team APIs, not by guessing from member chat text.
4. On result, inspect manager wake/event, find the matching dispatch receipt and member artifact, then ask manager to accept, block or fix.
5. Close the work by updating room state and/or logging completion, not by deleting team history. Pause or delete only when the team lifecycle requires it.

### Running from the team manager context

The manager has authority to coordinate its own members; don't recursively create another whole team as a substitute for dispatch. The manager can set member statuses and queue scoped messages, inspect its room, request a turn and update focus/completion. Shared team context is injected for the manager and member; business/project memory and entity scopes remain governed by their own runtime rules.

A manager's member selection should be based on scope and expertise, not arbitrary capacity or dispatch count. Give each member a concrete outcome and filesystem root. Independent tasks may run concurrently if their paths are disjoint; dependent tasks should wait for predecessor artifact/result before dispatch. The manager owns integration, cross-member review and the final claim that the team goal is complete.

### Event routing and wake coalescing

`routeTeamEvent()` first checks the team and member identity, appends a room message with result/blocker category and metadata (agent, run, dispatch, admission), then considers related member wakes and manager review. Manager auto-wake reasons contain a compact task/result/error and IDs; `team-manager-autowake.ts` coalesces/debounces pending reasons for the same team to avoid one model turn per event burst.

`shouldWakeManager()` deliberately distinguishes event and execution mode. Member failures, blockers, shared artifacts, warning/error/admission, newly woken members and background completion are wake-worthy. A foreground completion whose result was already returned inline and has no active plan follow-up is not woken a second time. If pending/active/blocked room plan work remains, completion is eligible for review even for a foreground dispatch. Preserve this predicate when changing event source fields.

### API wrapper debugging

When a team tool returns validation error, compare four layers in this order: emitted model schema in `tools/defs/agent-team-schedule.ts`; argument normalizer/alias map in `subagent-executor.ts`; internal executor action in `team-agent-executor.ts`; and the current persisted `ManagedTeam` shape. A schema can allow a wrapper alias that the internal executor converts to a different canonical action. Use focused `agent-team-wrapper-params.regression.ts` to reproduce blank-field, casing, camelCase/snake_case and dispatch prompt issues.

When the UI disagrees with tool output, inspect `teams.router.ts` route response and canonical store rather than assuming the UI has independent state. Ensure API snapshot includes team room, member status and task run identities consistently after restart.

## Related

- [08 Agents, tasks & background](08-agents-tasks-background.md) · [10 Scheduling, automations & triggers](10-scheduling-automations-triggers.md) · [11 Memory, notes & Brain](11-memory-notes-brain.md)
- [05 Tools & categories](05-tools-and-categories.md) · [25 Sharp edges](25-sharp-edges.md)
- [tools inventory](generated/tools.md) · [routes inventory](generated/routes.md) · [test inventory](generated/tests.md) · [merged PR history](generated/changelog.md)
