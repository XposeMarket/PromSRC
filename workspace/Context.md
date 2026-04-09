# Context.md - Source-Verified Code Index (2026-04-08)

This file is a practical index for fast navigation of the current Prometheus codebase.
All pointers were re-verified against `src/` in this workspace.

Note: line numbers are point-in-time and will drift after edits.

## 1) Entry, Startup, and Router Wiring

Main gateway entry:

- `src/gateway/server-v2.ts`

Key anchors:

- `initChatRouter(...)` at line 444
- `initTasksRouter(...)` at line 476
- `initTeamsRouter(...)` at line 478
- `app.use('/', ...)` router mounts at lines 488-500
- `server.listen(...)` at line 542
- `runStartup(...)` call at line 545

Startup wiring:

- `src/gateway/core/startup.ts`

Key anchors:

- `runStartup(...)` at line 72
- MCP autostart (`startEnabledServers`) at line 124
- `cronScheduler.start()` at line 126
- `setBackgroundAgentDeps(...)` at line 131
- `setTeamRunAgentFn(...)` at line 138
- coordinator deps wiring (`setCoordinatorDeps`) at lines 352-353
- weekly review job registration at lines 450-457
- `heartbeatRunner.start()` at line 467
- `telegramChannel.start()` at line 470
- audit materializer startup at line 522

## 2) Main Chat Runtime and Context Assembly

Chat route and loop:

- `src/gateway/routes/chat.router.ts`

Key anchors:

- rolling compaction helper: `maybeRunRollingCompaction(...)` at line 522
- main runtime loop: `handleChat(...)` at line 627
- session API history pull: `getHistoryForApiCall(sessionId, 10)` at line 655
- personality context build call at line 1425
- execution-mode system prompt policy block starts at line 1453
- plan protocol policy text starts at line 1494
- base system prompt compose at line 1500
- history append into model messages at lines 1522-1535
- plan declaration branch at lines 4135-4165
- plan step completion branch at lines 4214-4290
- background spawn join/synthesis gate starts at line 3707
- `/api/chat` route starts at line 4811
- rolling compaction call inside `/api/chat` at line 4858

Prompt context builder:

- `src/gateway/prompt-context.ts`

Key anchors:

- `TOOL_BLOCKS` at line 278
- `CATEGORY_POLICIES` at line 338
- `buildToolsContext(...)` at line 353
- `buildPersonalityContext(...)` at line 415
- autonomous mode detection at line 466
- project context injection points at lines 503, 543, 585

## 3) Session, History, and Compaction

Session engine:

- `src/gateway/session.ts`

Key anchors:

- compaction/memory-flush flags on session model at lines 28-31
- `PRE_COMPACTION_MEMORY_FLUSH_PROMPT` at line 39
- `PRE_COMPACTION_SUMMARY_PROMPT` at line 48
- `recordSessionCompaction(...)` at line 232
- legacy compaction apply helper `compactHistoryWithSummary(...)` at line 249
- message insert + defer logic `addMessage(...)` at line 397
- API payload history build `getHistoryForApiCall(...)` at line 514

Important runtime behavior:

- rolling summary stored in `latestContextSummary`
- API history can prepend `[Rolling context summary]`
- deferred synthetic turns for compaction and memory flush
- transcript and compaction artifacts are written to workspace audit folders

## 4) Tool System and Category Activation

Tool assembler:

- `src/gateway/tool-builder.ts`

Key anchors:

- categories constant: `ALL_TOOL_CATEGORIES` at line 24
- category resolver: `getToolCategory(...)` at line 56
- tool assembly entry: `buildTools(...)` at line 68
- tool def imports at lines 11-14
- MCP prefixed tool injection (`mcp__...`) at line 181
- composite tool injection at line 195

Tool definition surfaces:

- `src/gateway/tools/defs/file-web-memory.ts` (`getFileWebMemoryTools`) line 4
- `src/gateway/tools/defs/agent-team-schedule.ts` (`getAgentTeamScheduleTools`) line 4
- `src/gateway/tools/defs/cis-system.ts` (`getCisSystemTools`) line 4

Notable tool anchors:

- `web_search` in `file-web-memory.ts` line 572
- `web_fetch` in `file-web-memory.ts` line 583
- `social_intel` in `cis-system.ts` line 191
- `integration_quick_setup` in `cis-system.ts` line 254
- `write_proposal` in `cis-system.ts` line 365
- `gateway_restart` in `cis-system.ts` line 452
- `request_tool_category` in `cis-system.ts` line 477

## 5) Task Engine and Background Execution

Task store:

- `src/gateway/tasks/task-store.ts`

Key anchors:

- `TaskStatus` union starts at line 46
- includes `needs_assistance`, `awaiting_user_input`, `waiting_subagent`

Background runner:

- `src/gateway/tasks/background-task-runner.ts`

Key anchors:

- `BackgroundTaskRunner` class at line 108
- stall threshold const `STALL_TOOL_CALL_THRESHOLD` at line 53
- schedule resume helper `resumeTaskAfterSchedule(...)` at line 187
- plan/stall tracking around lines 564-839
- awaiting user input transition around lines 1045-1053
- needs assistance transition around lines 1060-1088

Task HTTP surface:

- `src/gateway/routes/tasks.router.ts`

Key anchors:

- `/api/tasks` CRUD starts near lines 50-96
- heartbeat settings APIs around lines 182-243
- `/api/bg-tasks` APIs around lines 312+ (get/list/pause/resume/message/stream)

## 6) Teams and Coordinator Runtime

Team dispatch runtime:

- `src/gateway/teams/team-dispatch-runtime.ts`

Key anchors:

- `setDispatchDeps(...)` at line 46
- `runTeamAgentViaChat(...)` at line 81
- team context builder `buildGenericTeamContext(...)` at line 561
- team workspace routing logic around lines 518-521

Team manager facade:

- `src/gateway/teams/team-manager-runner.ts`

Key anchors:

- file purpose note "Team Coordinator Facade" at line 2
- `setTeamRunAgentFn(...)` no-op compatibility shim at line 27
- `triggerManagerReview(...)` at line 300

Coordinator loop:

- `src/gateway/teams/team-coordinator.ts`

Key anchors:

- `IDLE_TURNS_THRESHOLD` at line 159
- dispatch tool instrumentation around line 217
- idle stop check at lines 335-336
- coordinator review entry `runCoordinatorReview(...)` at line 360

Teams router:

- `src/gateway/routes/teams.router.ts`

Key anchors:

- `/api/teams` list/create at lines 161 and 171
- `/api/teams/:id/dispatch` at line 503
- `/api/teams/:id/start` at line 589
- team events stream at lines 660 and 674
- team workspace endpoints at lines 803, 827, 852, 877

## 7) Telegram, WebSocket, and Channel Bridge

Telegram channel runtime:

- `src/gateway/comms/telegram-channel.ts`

Key anchors:

- command help/catalog builder `buildTelegramCommandsMessage(...)` at line 367
- inbound parser/dispatcher `handleIncomingMessage(...)` at line 2694
- command branches:
  - `/teams` around line 2894
  - `/agents` around line 2918
  - `/tasks` around line 2943
  - `/schedule` around line 2969
  - `/models` and `/model` around line 2993
  - `/proposals` around line 3133
  - `/repairs` around line 3205
  - `/mcp-status` around line 3271
  - `/integrations` around line 3298
  - `/setup` around line 3325
  - `/perf` and `/performance` around line 3427

Broadcast and bridge:

- `src/gateway/comms/broadcaster.ts`

Key anchors:

- model busy flag setter `setModelBusy(...)` line 20
- Telegram bridge link `linkTelegramSession(...)` line 40
- Telegram bridge resolve `getLinkedSession(...)` line 46
- websocket fanout `broadcastWS(...)` line 85
- team notification fanout `sendTeamNotificationToChannels(...)` line 237

## 8) Projects and Project Learning

Project store:

- `src/gateway/projects/project-store.ts`

Key anchors:

- project creation `createProject(...)` at line 129
- project-session lookup `findProjectBySessionId(...)` at line 276
- context block builder `buildProjectContextBlock(...)` at line 344
- knowledge file references under project context around lines 376-383

Project context learning:

- `src/gateway/projects/project-learning.ts`

Key anchors:

- extraction entry `extractAndWriteProjectContext(...)` at line 49
- heuristic extractors:
  - goals line 162
  - people line 189
  - tools line 215
  - milestones line 242
  - name line 261

## 9) Config and Providers

Config defaults + merge:

- `src/config/config.ts`

Key anchors:

- `DEFAULT_CONFIG` starts at line 80
- provider defaults under `llm` at lines 100-122
- heartbeat config block at line 167
- session rolling compaction defaults at lines 176 and 180-184
- orchestration config starts at line 211

Config schema:

- `src/config/config-schema.ts`

Key anchors:

- provider enum includes `ollama|llama_cpp|lm_studio|openai|openai_codex|anthropic` at line 18
- top-level schema `PrometheusConfigSchema` at line 143
- `session` schema block at line 232
- `heartbeat` schema block at line 220

Provider factory:

- `src/providers/factory.ts`

Key anchors:

- provider support comments at lines 7-12
- provider switch resolution starts around line 99
- adapter selection cases at lines 108-147

## 10) Storage and Runtime Artifacts

Main paths used by runtime:

- sessions: `.prometheus/sessions/*.json`
- audit log stream: `.prometheus/audit-log.jsonl`
- transcript artifacts: `workspace/audit/chats/transcripts/`
- compaction artifacts: `workspace/audit/chats/compactions/`
- daily memory: `workspace/memory/YYYY-MM-DD.md`
- intraday notes: `workspace/memory/YYYY-MM-DD-intraday-notes.md`
- project context files: `workspace/projects/<id>/CONTEXT.md`

## 11) Quick Refresh Checklist (When Updating This Doc Later)

1. Re-run `rg -n` against the files above for function/route anchors.
2. Confirm `/api/chat` flow in `chat.router.ts` still matches this map.
3. Re-check task statuses in `task-store.ts`.
4. Re-check team manager facade vs coordinator split.
5. Re-check tool category list in `tool-builder.ts`.
6. Update date stamp at top after verification.

