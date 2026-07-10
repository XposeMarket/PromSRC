## 16) Tasks, Background Agents, and Autonomous Runs

### Display names (user-facing)

- Refer to subagents by **display name** (`identity.displayName` / `name`), not technical `id`, in answers and summaries. Use `agent_id` only in tool calls.
- Refresh roster via `agent_list` when uncertain.
- Example: **Mara** (`x_account_operator_raulinvests_v1`) — @raulinvests; **entities/projects/mara-x-account-operator.md**.

Current task statuses in `task-store.ts`:

- `queued`
- `running`
- `paused`
- `stalled`
- `needs_assistance`
- `awaiting_user_input`
- `complete`
- `failed`
- `waiting_subagent`

Important pause reasons include:

- `awaiting_user_input`
- `awaiting_command_approval`
- `recovering_from_build_error`
- `preempted_by_chat`
- `heartbeat_cycle`
- `blocked_on_repair`

Other current task facts:

- task IDs are opaque storage IDs validated by `src/gateway/storage/storage-paths.ts`; task JSON, evidence bus, session/checkpoint cleanup, and index reconstruction must never concatenate request IDs directly into paths
- invalid task IDs surface as HTTP 400 through the storage-boundary error handler, and `npm run test:storage-boundaries` verifies out-of-store deletion remains impossible
- proposal execution state records `standard`, `task_trigger`, `verification`, `artifact_run`, `dev_src_self_edit`, and `dev_src_self_edit_repair`
- tasks can carry mutation scope, build verification state, live baselines, promotion status, repair context, and team execution state
- background task runner uses `step_complete` progression, stall nudges, and task-scoped workspace binding
- proposal tasks are run with a proposal-specific runtime mode and session ID
- task delivery knows how to report team proposal results back into team chat

Paused task recovery ownership and chat surfaces:

- paused/failed recovery is task-owned, not only session-owned
- main/background tasks recover through the main paused-task chat and can resume, rerun, cancel, or accept more user guidance as the main agent
- standalone subagent Home chat is no longer a task-recovery trap. Normal user messages, voice turns, and handoff/tool conversations with the subagent stay in the subagent Home/chat thread.
- standalone subagent task recovery now lives under the subagent Runs tab/task card detail, using the task's `recoveryConversation` as the canonical thread.
- completed subagent run cards remain readable in Runs, but only recovery-eligible tasks expose the recovery composer.
- team subagent tasks recover through the same task recovery conversation whether the user speaks in the task panel/main paused-task chat, the team room, or the matching member direct thread
- team manager/executor tasks recover through the same task recovery conversation whether the user speaks in the task panel/main paused-task chat or team manager/team chat
- `task-recovery.ts` still includes owner reply sessions for main task sessions, team member room/direct sessions, and team manager/coordinator sessions; standalone subagent recovery should be entered explicitly through run routes rather than inferred from Home chat.
- `task-router.ts` owns explicit recovery handling through `handleTaskRecoveryMessage`. Standalone subagent recovery turns should not be mirrored into the Home chat store.
- `channels.router.ts` exposes explicit standalone subagent run APIs: `GET /api/agents/:id/runs`, `GET /api/agents/:id/runs/:taskId`, and `POST /api/agents/:id/runs/:taskId/recovery`.
- `channels.router.ts` direct standalone subagent chat routes should stay conversational and should not intercept a Home chat turn into a blocked task just because that subagent owns a paused run.
- `teams.router.ts` intercepts team room/member/manager chat turns when the addressed team or member owns a blocked task, then routes the turn through task recovery instead of starting unrelated team work
- `TaskRecoveryConversationTurn.source` includes `subagent_chat` and `team_chat` so the task panel can preserve where guidance came from; standalone subagent run recovery should use `subagent_chat` only as source metadata, not as permission to pollute Home chat history
- `TaskRecoveryConversationTurn.attachmentPreviews` can persist uploaded image/video/file preview metadata for recovery turns.
- explicit subagent run recovery accepts `attachmentPreviews`, builds runtime attachment context, forwards vision attachments to `handleChat`, and persists the visible user message separately from the attachment-expanded runtime prompt
- recovery assistant sessions stay constrained to recovery: they may discuss the paused task, synthesize resume guidance, or trigger resume/rerun/cancel, but should not do unrelated work from that recovery session
- `subagent-chat-store.ts` must filter persisted `task_recovery` messages out of Home chat history so old merged recovery turns do not reappear as duplicate/garbled subagent preambles

Proposal sandbox lifecycle details that are now implemented:

- a sandboxed proposal must complete a successful build before promotion back into the live repo
- successful build verification is currently recorded after a successful `run_command` of `npm run build`, `npm run tsc`, or canonicalized `npm run build:backend` for dev-src sandboxes
- if a later mutating tool runs, previous build verification is cleared and must be re-earned
- promotion status is tracked as `pending`, `promoted`, or `failed`
- promotion copies only the approved scoped files back into the live repo
- if promotion metadata is incomplete, the task pauses for assistance instead of guessing

Build-failure handling for proposal execution is now more structured:

- build failures are detected during proposal execution
- the failure is stored in `proposalExecution.buildFailure`
- the runner tries to auto-create a scoped repair proposal using:
  - original affected files
  - files referenced directly in the build output
- when a repair proposal is created, the original task pauses with `blocked_on_repair`
- a repair task can inherit the repaired sandbox, resolve the blocked failure, and auto-complete the previously failed build step
- once a build failure is recorded, direct source edits are frozen
- if an automatic repair proposal already exists, further repair writing is blocked
- if auto-repair proposal creation fails, the system allows exactly one manual `write_proposal` repair follow-up from inside that failed proposal context
- after a manual repair proposal is created, that escape hatch is closed and the task remains frozen pending review
- repair proposals are intentionally narrow: they should fix the captured build failure, not continue the original implementation
- if another file is required, the repair task must stop and create another scoped repair proposal instead of silently expanding scope
- environment-level sandbox failures are treated separately from scoped source repair failures and pause for assistance rather than creating a misleading code repair

## 17) Standalone Subagents, Team Subagents, Managers, and Coordinator

Prometheus now has multiple agent layers, not one generic "subagent" concept.

Wrapper surface note:

- `agents_and_teams` is wrapper-first for most model-facing agent/team operations. Use `agent_ops` for spawn/list/info/update/delete/deploy analysis team, `agent_chat_ops` for standalone subagent and agent chat turns/watches, `team_ops_wrapper` for managed team/coordinator/dispatch operations, and `team_collab_ops` for in-team collaboration actions.
- Granular agent/team tools remain executable compatibility handlers behind `normalizeAgentTeamWrapperTool(...)` and the capability executors, so task ownership, team state, recovery routing, approval/audit behavior, and background run tracking stay centralized.

Standalone subagents:

- created or ensured with `spawn_subagent`
- can be persisted and reused by ID
- can be hydrated from role templates:
  - `planner`
  - `orchestrator`
  - `researcher`
  - `analyst`
  - `builder`
  - `operator`
  - `verifier`
- are messaged directly with `message_subagent`
- Home chat is the long-lived conversational thread for direct user/subagent chat, voice-originated subagent turns, and main-agent handoff/tool messages to that subagent.
- Runs are separate task records, not extra Home chat turns. Use the subagent Runs tab for task cards, status, prompt/output/progress/process detail, and explicit recovery chat.
- standalone subagent task cards must copy the configured agent model into `TaskRecord.executorProvider`; otherwise `background_agent` execution falls through to mode defaults such as `background_spawn`/`main_chat` and can run on the wrong provider
- can be installed locally from signed/versioned marketplace Agent Profile Packs; imported profiles carry `marketplaceProfile` provenance, install under `.prometheus/subagents/<agent-id>`, preserve attached skill IDs, and can be uninstalled only through marketplace-pack-aware deletion that refuses non-marketplace agents



Managed teams:

- main-chat entry point is `ask_team_coordinator`
- main chat is explicitly told not to call `team_manage` directly for managed team work
- runtime execution modes include `team_manager` and `team_subagent`
- shared tools include:
  - `dispatch_team_agent`
  - `request_team_member_turn`
  - `get_agent_result`
  - `post_to_team_chat`
  - `message_main_agent`
  - `reply_to_team`
  - `manage_team_goal`

Team lifecycle management:

- `team_manage` supports `list`, `create`, `start`, `update`, `delete`, `trigger_review`, `dispatch`, `pause`, `resume`

There are two separate tool-profile systems to keep straight.

`ToolProfile` from `src/tools/registry.ts` is used by the standalone tool registry schema/filtering layer and currently includes:

- `minimal`
- `coding`
- `web`
- `desktop`
- `full`

Subagent allowlist profiles from `SUBAGENT_PROFILES` in `src/tools/registry.ts` currently include:

- `file_editor`
- `researcher`
- `shell_runner`
- `reader_only`
- `code_writer`
- `analyst`
- `web_agent`
- `scraper`

Subagent profile facts:

- `getSubagentToolFilter(profile)` returns an explicit allowlist for known profiles
- unknown or missing profiles return `undefined`, which means no filter/full access
- profile allowlists now include supervised process tools where appropriate: `run_command_supervised`, `start_process`, `process_status`, `process_log`, `process_wait`, `process_kill`, and `process_submit`
- `code_writer`, `web_agent`, and `scraper` include `generate_video` as well as `generate_image`
- the `subagent_spawn` schema in `tool-builder.ts` still advertises only `file_editor`, `researcher`, `shell_runner`, and `reader_only`, even though the registry has broader profile names for other runtime paths

## 18) Manager vs Subagent Spawn Strategy

There are two different parallel-work strategies in the runtime:

- when `orchestration.subagent_mode = false`, the runtime exposes `delegate_to_specialist`
- when `orchestration.subagent_mode = true`, it exposes `subagent_spawn`

So "standalone subagents" and "team subagents" are real separate concepts, and the runtime can also expose a lighter specialist-delegation mode instead of full child spawning.

## 19) Deploy Analysis Tool

`deploy_analysis_team` is a real core tool, not a category-gated extra.

Current intended behavior from tool definitions:

- one-shot GTM/site analysis for a URL
- deploys background specialists for:
  - business profiling
  - SEO discovery
  - social reputation
  - browser funnel testing
  - CRO/messaging critique
  - technical auditing
  - competitive positioning

Important note:

- current tool descriptions are slightly inconsistent
- `deploy_analysis_team` says the final experience should be inline and says not to call `present_file`
- `present_file` still mentions `deploy_analysis_team` as a common follow-up
- treat the current product intent as inline-first until those descriptions are reconciled
