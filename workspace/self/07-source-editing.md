## 13) Source Editing and Proposal Execution

Prometheus has three distinct code-editing surfaces:

- direct workspace file tools
- proposal-execution source-edit tools
- dev-only fast source-edit approvals through `request_dev_source_edit`

Proposal execution exposes dedicated internal code tools for:

- `src/`
- `web-ui/`
- selected allowlisted project-root files and directories

The dev-only fast source-edit lane is not the same as proposal execution:

- `request_dev_source_edit` is for immediate local/dev source fixes after the user asks Prometheus to patch its own `src/` or `web-ui/` code.
- It is disabled in public distribution builds.
- It grants only the listed `src/` / `web-ui/` files for the current session, never global source-write access.
- After approval it activates source read/write categories for the session and installs a mutation scope so writes outside the approved files are blocked.
- It should be used only after inspecting the relevant source files and knowing the exact affected files.

Current proposal tool families include:

- `read_source`, `grep_source`, `source_stats`, `write_source`, `find_replace_source`, etc.
- `read_webui_source`, `grep_webui_source`, `webui_source_stats`, `write_webui_source`, etc.
- `list_prom`, `read_prom_file`, `grep_prom`, `write_prom_file`, etc.

The current auto-execution boundary is more nuanced than the tool list:

- the proposal router recognizes internal-code proposals when they touch `src/`, `web-ui/`, or a small prom-root allowlist
- public distribution builds reject internal-code proposals entirely
- private builds only auto-dispatch internal-code proposals that qualify for `dev_src_self_edit` or `dev_src_self_edit_repair`
- dev self-edit eligibility now accepts affected files under `src/` and/or `web-ui/`
- allowlisted prom-root files are recognized as internal code, but they do not qualify for the dev self-edit sandbox

Proposal sandboxing is also now tied to explicit mutation scope:

- proposal execution builds a `mutationScope` from approved `affectedFiles`
- that scope is stored on `task.proposalExecution`
- background execution installs that mutation scope onto both the task session and the originating proposal session
- writes outside the approved files/dirs are blocked with an explicit "outside approved proposal scope" error
- paths ending in `/` become approved directories; other affected paths become exact approved files

Current sharp edge:

- `dev-src-self-edit.ts` prepares, baselines, and promotes both `src/` and `web-ui/` paths
- the executor's dev self-edit write gate still rejects non-`src` write targets with "Only approved src/ files may be written"
- until that executor guard is reconciled, treat `web-ui/` dev self-edit support as partially wired: the sandbox/promotion layer is ready, but write-tool permission is still `src/`-only in the active execution lane

## 13A) Coding Workspace API

`src/gateway/routes/coding.router.ts` and `src/gateway/coding/workspace-session.ts` expose a lightweight coding workspace API for the UI.

Current coding routes:

- `GET /api/coding/session`
- `GET /api/coding/status`
- `GET /api/coding/diff`
- `POST /api/coding/branch`
- `POST /api/coding/stage`
- `POST /api/coding/commit`

Coding workspace session facts:

- root defaults to `getConfig().getWorkspacePath()`
- package manager detection supports `npm`, `pnpm`, `yarn`, `bun`, `pip`, `uv`, `cargo`, `go`, and `dotnet`
- command detection reads package scripts or conventional project files to infer test/build/dev commands
- git status/diff/stage/commit/branch operations are shell-out wrappers around `git`
- `web-ui/src/components/CodingWorkspacePanel.js` is the current frontend panel for this API

## 14) Proposal System

Proposals are stored under `workspace/proposals/` in:

- `pending/`
- `approved/`
- `denied/`
- `archive/`

Current proposal types:

- `feature_addition`
- `src_edit`
- `config_change`
- `task_trigger`
- `memory_update`
- `skill_evolution`
- `prompt_mutation`
- `general`

Current proposal statuses:

- `pending`
- `approved`
- `denied`
- `executing`
- `repairing`
- `executed`
- `failed`
- `expired`

`repairing` proposals are stored in the approved bucket, not a separate top-level folder.

Current proposal routes:

- `GET /api/proposals`
- `GET /api/proposals/:id`
- `PATCH /api/proposals/:id`
- `POST /api/proposals/:id/approve`
- `POST /api/proposals/:id/deny`

Current proposal records can carry:

- `affectedFiles`, each with `path`, `action`, and `description`
- `executionSteps`, with optional kinds such as `inspect`, `edit`, `write_artifact`, `trigger`, `verify`, `build`, and `complete`
- `riskTier: low | high`
- optional `executorProviderId` and `executorModel`
- optional `teamExecution` metadata for managed-team proposal execution
- `revisionHistory` for pending proposal edits
- `approvalSnapshot`, which captures the exact approved proposal version/content
- optional `repairContext` for build-failure repair proposals

Pending proposals can be edited with `PATCH`; non-pending proposals cannot. A successful pending edit increments `version` and records a revision.

Special rules for `src/` proposals:

- if a proposal touches `src/`, it must be an approval-ready implementation plan
- its `execution_mode` must be `code_change` (legacy `type: src_edit` is still accepted as an implicit code_change for back-compat; the strict contract is keyed to the lane now, not the type label, via `validateSrcProposalReadiness`)
- `riskTier` must be `low` or `high`
- `executorPrompt` must be present
- its `details` must contain these exact sections:
  - `Why this change`
  - `Exact source edits`
  - `Deterministic behavior after patch`
  - `Acceptance tests`
  - `Risks and compatibility`
- normal src proposals must show source-read evidence through details or executor prompt
- each affected `src/` path must be named in details or executor prompt
- proposals created by the build-failure repair pipeline can bypass fresh source-read evidence through `sourcePipeline: proposal_build_failure`

Approved proposals that carry an executor prompt, or affected files plus details, dispatch into background execution using session IDs of the form `proposal_<proposalId>`.
Approval records an `approvalSnapshot` before dispatch, so execution has a durable approved version even if later UI state changes.

Execution lanes (the `execution_mode` field — this is the contract that drives the executor, as of the 2026-06-10 lane refactor):

- `general` — read, research, audit, and **internal Prometheus orchestration** (start/dispatch a team, message a subagent, update a team/subagent, surface a finding). No user-file writes or external-world side effects.
- `action` — substantive agency in the user's world: build/fix in the workspace + configured allowed paths, create an approved artifact, or draft+send an approved response to an incoming email/webhook/notification. Build-capable. Carries the hardened + current-state contract (see below).
- `code_change` — Prometheus's OWN `src/`/`web-ui/` self-edits only; sandboxed; build-verified; private builds only.

There are exactly three lanes now. The legacy `review` lane folds into `general` (`normalizeProposalExecutionMode` maps `review` → `general` on read). Internally, `dev_src_self_edit` / `dev_src_self_edit_repair` are still the sandbox sub-modes of the `code_change` lane. The old `standard` / `task_trigger` / `verification` / `artifact_run` task modes are superseded by the lane on `task.proposalExecution.mode`.

Lane resolution (`resolveProposalExecutionLane`, [proposals.router.ts](../../src/gateway/routes/proposals.router.ts)): touches Prometheus internal code or needs a build → `code_change`; else the explicit `execution_mode` (normalized); else inferred — read-only/research/orchestration intent with no affected files → `general`, otherwise `action`.

Lane prompts (`buildOperationalProposalPrompt`):
- The `general` prompt permits internal orchestration but forbids user-file/external mutation.
- The `action` prompt is build-capable and **leads with a mandatory current-state check** ("re-read the actual target now; if the gap/bug/trigger is already resolved, stop and report — do not redo it"). This is what prevents stale executions on things the user already fixed via another tool.

Hardened `action` contract (`details` headings, soft-validated): `## What you asked for` · `## Current state` · `## Research` · `## Plan` · `## Acceptance criteria` · `## Risks / open questions`.

Allowed-path note: `action` proposals may target files outside the workspace if they live under a configured `allowed_paths` directory. `normalizeProposalScopePath` preserves absolute paths so the mutation scope covers both workspace-relative and absolute allowed-path targets.

Risk tier affects executor routing:

- explicit `executorProviderId` plus `executorModel` wins
- otherwise `riskTier` maps through `agent_model_defaults.proposal_executor_low_risk` or `agent_model_defaults.proposal_executor_high_risk` when configured

Team proposal execution:

- stores `teamId`, `managerSessionId`, `executorAgentId`, optional `executorAgentName`, and return metadata
- dispatches the approved prompt as a team subagent task
- suppresses normal origin delivery and returns updates/results into team chat
- cannot execute Prometheus internal source-code changes

Proposal list filters currently include useful UI buckets:

- `in_progress` / `executing` for active execution
- `paused` for paused, stalled, needs-assistance, or awaiting-user-input work
- `executed`, which includes executed, failed, and expired records

## 15) Dev Source Self-Edit Sandbox

`dev_src_self_edit` is a real sandbox mode in `src/gateway/proposals/dev-src-self-edit.ts`.
`dev_src_self_edit_repair` is also real and uses the same source file for repair handoff semantics.

Eligibility and setup:

- disabled in public distribution builds
- applies when every affected file is under `src/` or `web-ui/`
- creates an isolated workspace under `.prometheus/proposal-workspaces/<proposalId>/repo`
- copies:
  - `package.json`
  - `package-lock.json`
  - `.npmrc`
  - `src/`
  - `web-ui/`
  - `generated/`
  - `scripts/`
  - `tsconfig*.json`
- links live `node_modules` into the sandbox when present
- writes `.prometheus/proposal-workspaces/<proposalId>/manifest.json`

Baselines and promotion:

- normal self-edit work captures live baselines before editing
- repair workspaces are copied from the failed sandbox and do not capture fresh live baselines
- allowed files are expanded before baseline/promotion
- `web-ui/index.html` maps to `generated/public-web-ui/index.html`
- `web-ui/src/...` maps to `generated/public-web-ui/static/...`
- promotion copies or deletes only approved expanded paths
- promotion refuses to overwrite a live file that changed after sandbox creation unless the sandbox already matches live
- incomplete promotion metadata pauses the task for assistance

The execution mode constants are `DEV_SRC_SELF_EDIT_MODE` and `DEV_SRC_SELF_EDIT_REPAIR_MODE`.
The default verification command for these sandboxed edits is:

- `npm run build:backend` for `src/`-only work
- `npm run sync:web-ui && npm run build:backend` when `web-ui/` affected files are present

Repair proposals inherit the canonical build command from the failed task.

Current task metadata for sandboxed proposal execution includes:

- `proposalId`
- `mode`
- `projectRoot`
- `liveProjectRoot`
- `buildRequired`
- `buildVerifiedAt`
- `buildVerifiedCommand`
- `liveFileBaselines`
- `promotion`
- `mutationScope`
- `buildFailure`
- repair lineage and blocked-task handoff state when running in repair mode

Current write restrictions inside `dev_src_self_edit`:

- generic workspace mutation tools are blocked
- only proposal source-write tools are supposed to mutate internal code
- mutation scope still blocks unapproved paths even when a source-write tool is available
- current executor code still only enables `src/` write targets in this lane
- `web-ui/` is represented in sandbox/baseline/promotion logic, but write permission still needs executor-side follow-through
- prom-root writes are explicitly blocked in this lane
- if a build failure has already occurred, source edits are frozen

## 15A) Fast Dev Source Edit Approvals

`request_dev_source_edit` is the fast dev-only alternative to a full source proposal when the user explicitly wants Prometheus to patch itself now.
It should feel like a compact proposal plus a live execution lane, not a raw file unlock.

Canonical files for this lane:

- `src/gateway/tools/defs/cis-system.ts` defines `request_dev_source_edit` and `prom_apply_dev_changes`
- `src/gateway/dev-source-approvals.ts` normalizes the dev edit plan, creates the scoped grant, computes the plan hash, and persists dev-edit continuations under `.prometheus/dev-edit-continuations.json`
- `src/gateway/agents-runtime/subagent-executor.ts` creates/resolves the approval, grants source tools, applies dev changes, persists continuation state, and marks completion notes
- `src/gateway/routes/chat.router.ts` seeds the declared plan from the approved dev-edit plan and closes it when the completion note lands
- `src/gateway/lifecycle.ts` carries `devEditContinuation` in restart context
- `src/gateway/boot.ts` detects post-restart dev-edit continuation and instructs Prometheus to write the completion note before final summary
- `src/gateway/verification-flow.ts` serializes dev edit plan data to clients
- `web-ui/src/pages/ChatPage.js` renders dev-edit plan/evidence in desktop approval cards
- `web-ui/src/mobile/mobile-pages.js` renders dev-edit plan/evidence in mobile approval cards
- `src/gateway/comms/telegram-channel.ts` renders dev-edit plan/evidence in Telegram approval messages
- generated public mirrors under `generated/public-web-ui/static/...` must stay in sync after web/mobile UI edits

Required approval contract:

- `request_dev_source_edit` must include `files`, `reason`, and `plan`.
- `files` must be project-relative paths under `src/` or `web-ui/`.
- `plan` should include:
  - `user_request`: what the user asked for
  - `reasoning`: why these files/approach are appropriate
  - `evidence`: file/line findings from inspected source, e.g. `{ file, lines, finding }`
  - `current_state`: what the code currently does
  - `fix`: what will change
  - `steps`: the concise execution plan to declare and follow
  - `verification`: checks/commands to run
  - `completion_note_tag`: usually `dev_edit_complete`
- The approved plan receives a stable `planHash` and `dev_edit_id`. Treat that approved plan as the execution contract.
- If Prometheus discovers it needs files outside the approved scope or a materially different fix, it should request a new dev source edit approval instead of silently expanding scope.

Execution behavior after approval:

- The chat runtime seeds a declared manual plan from the approved `plan.steps`, then appends verification, `prom_apply_dev_changes`, and completion-note steps.
- Source-write tools may edit only approved files.
- Prefer surgical source-write tools such as `find_replace_source`, `replace_lines_source`, `insert_after_source`, and their `*_webui_source` variants.
- Do not use generic workspace mutation tools for internal Prometheus source changes in this lane.
- Run the relevant verification from the approved plan before applying live changes.
- For `web-ui/` or mobile web UI edits, run or let `prom_apply_dev_changes` run `npm run sync:web-ui`.
- For backend/runtime edits, `prom_apply_dev_changes` should build and restart the gateway.
- For mixed backend plus web/mobile changes, `prom_apply_dev_changes` should sync web UI first, build backend, restart, then request a desktop reload.

Steer-interrupt during approval wait:

- When a steer arrives while `request_dev_source_edit` is waiting for user approval, the wait Promise resolves immediately with a steer-interrupt result rather than blocking until approval.
- The tool returns a message describing the steer message and the pending approval ID. The approval is NOT rejected — it remains pending.
- Prometheus should address the steer (which may say "change the plan", "add a file", "use a different approach", etc.), optionally call `update_dev_source_edit` to revise the pending plan/files/reason, then call `await_dev_source_edit_approval` to resume waiting.
- A second steer can interrupt `await_dev_source_edit_approval` the same way.
- The user's approval card in the UI updates live when `update_dev_source_edit` is called (via `approval_updated` WebSocket broadcast).

`update_dev_source_edit(approval_id, ...)`:
- Updates the pending approval's `reason`, `files`, and/or `plan` fields.
- Broadcasts `approval_updated` so the UI approval card re-renders with the revised plan.
- Only works on pending approvals in the current session.
- After updating, call `await_dev_source_edit_approval` to re-enter the wait.

`await_dev_source_edit_approval(approval_id)`:
- Re-enters the steer-interruptible wait for an already-created pending approval.
- Returns immediately if the approval was already resolved (approved or denied).
- Rebuilds the dev-source-edit grant from the approval record's `devSourceEdit` metadata on approval.
- Can be interrupted by another steer, which again returns the steer message and leaves the approval pending.

`PATCH /api/approvals/:id`:
- HTTP endpoint to update a pending approval's `reason`, `action`, `files`, and/or `plan` from the UI or external callers.
- Returns 404 if not found, 409 if already resolved.
- Broadcasts `approval_updated` WebSocket event after a successful update.

Post-restart/reload completion rule:

- `prom_apply_dev_changes` should carry the active `dev_edit_id` and approved completion note tag. It can infer the active pending dev edit for the session, but explicit `dev_edit_id` is better.
- Before restart/reload, it persists a `devEditContinuation` with the approved plan, files, changed surfaces, verification, and summary.
- Hot restart context carries that continuation through `lifecycle.ts` into `boot.ts`.
- After restart, Prometheus should not redo the patch. It should write:
  - `write_note({ tag: "dev_edit_complete", dev_edit_id: "<id>", content: "<what changed, verification, live status>" })`
- That note marks the continuation complete and lets the declared plan close before the final user response.
- Only after the completion note succeeds should Prometheus tell the user the edits are in.

Approval UI behavior:

- Desktop, mobile web, and Telegram approval cards should show the reason, evidence, current state/fix, plan steps, files, and verification in compact form.
- The approval should be readable as a mini proposal. Avoid dumping only raw JSON or only a file list.
- Source edit approvals should appear inline with the chat/tool stream and preserve the surrounding thinking/tool context.

Safety rules for this lane:

- Never use this in public distribution builds.
- Never weaken approval gates, filesystem scope, shell/desktop/browser approval policy, auth, credential handling, or audit logging without explicit user intent.
- Never broaden source-write access silently.
- Never store secrets in source files or notes.
- Never log credentials, tokens, cookies, OAuth codes, or API keys.
- For core runtime/tool execution/scheduler/memory/auth edits, keep the plan especially explicit and verification-heavy.

Verification checklist for fast dev source edits:

- Backend/runtime change: `npm run build:backend`
- Web/mobile UI change: `npm run sync:web-ui`
- Mixed backend plus web/mobile change: run both, or use `prom_apply_dev_changes` with the correct surfaces
- UI JS syntax check when practical: `node --check web-ui/src/pages/ChatPage.js`, `node --check generated/public-web-ui/static/pages/ChatPage.js`, and corresponding mobile files when touched
- After backend restart/reload, confirm the completion note was written with `tag: dev_edit_complete` and the declared plan closed
- Do not claim "fixed" unless verification completed, or clearly say what was not verified

## 15B) Dev-Live Self-Edits, Hot Restart, and Parallel Chat Recovery

Prometheus can now safely self-edit live gateway/web UI behavior only when the edit preserves parallel session identity and restart recovery.
The important source areas are:

- `src/gateway/routes/chat.router.ts` for `/api/chat`, live main-chat runtimes, SSE frames, mobile chat dedupe, and retained stream frames
- `src/gateway/live-runtime-registry.ts` for durable in-flight runtime records and restart checkpoints
- `src/gateway/runtime-recovery.ts` for preparing interrupted runtime summaries and per-session checkpoint messages
- `src/gateway/boot.ts` for hot-restart follow-up targeting and per-session recovery prompts
- `src/gateway/session.ts` for persisted chat messages, tool logs, process entries, and channel/session metadata
- `src/gateway/routes/settings.router.ts` plus `web-ui/src/mobile/*` for mobile-origin restart/session id propagation
- `web-ui/src/pages/ChatPage.js` for desktop session hydration, process-log rendering, websocket stream handling, creative canvas focus behavior, and restart notifications
- `web-ui/index.html` for the desktop Channels sidebar hub/drilldown rendering and channel classification helpers
- `generated/public-web-ui/static/pages/ChatPage.js`, which must be regenerated from `web-ui/src/pages/ChatPage.js`
- `generated/public-web-ui/index.html`, which must be regenerated from `web-ui/index.html`

Current live-runtime and hot-restart rules:

- Every main chat, mobile chat, Telegram chat, background task, subagent/team run, scheduled task, heartbeat, brain thought, or dispatch run must be modeled as its own runtime/session when it can run independently.
- Do not use a single global busy flag to reject independent user channels. A mobile or Telegram chat should not say "busy with another task" merely because a different web chat is running.
- Hot restart recovery must be scoped by `sessionId`. Never borrow user request text, tool names, last progress, or checkpoint details from another chat.
- A restart triggered from mobile or Telegram must carry the origin session id/channel into the restart context so the restart message returns to the correct chat.
- Hot-restart notifications should mark the target chat unread and append into the target session, not create a random restart chat unless there is truly no target session.
- If several chats are active during restart, each gets its own restart follow-up and context. Other sessions may be counted, but their private details must not bleed across chats.

Current frontend process-log/restart behavior:

- Desktop keeps per-session `processLog` arrays and attaches turn-specific `processEntries` to assistant messages.
- Server hydration through `/api/sessions/:id` must merge with local history/process logs instead of replacing richer local state. This protects live process streams that existed only in the browser before a restart.
- If a restart happens before the SSE stream emits final `done`, the desktop UI should create a short `Restart Context Packet` assistant bubble and place the full preserved process/tool packet behind the normal `Process` button.
- User-visible restart context should be short. Full tool dumps belong in `processEntries` or `toolLog`, not as giant text in the chat bubble.
- The right process panel should show the active session's `processLog`; individual message bubbles use `processEntries` for historical packet inspection.

Current parallel desktop/mobile stream behavior:

- `/api/mobile/chat/stream/:sessionId` exposes retained main-chat stream frames for a session, including whether the run is still active.
- Desktop must catch up from this endpoint when opening/loading an active mobile-origin session. Canvas state can hydrate separately, so a visible Creative canvas does not prove the process stream has been replayed.
- `main_chat_stream_event` websocket frames and catch-up frames must be deduped by session/stream/sequence before adding process entries.
- `tool_call`, `tool_result`, `tool_progress`, `ui_preflight`, `info`, `thinking`, `thinking_delta`, `progress_state`, `token`, `done`, and `error` frames are all relevant to the desktop process/chat stream.
- Creative mode commonly emits canvas/project state through separate events while the chat/tool stream is carried by main-chat stream frames. Debug both paths when mobile Creative work appears visually active but has no process log.

Cross-channel live chat/session consistency rule from 2026-05-20:

- Desktop, mobile, Telegram, CLI, Discord, and WhatsApp must all treat `src/gateway/session.ts` summaries and `/api/sessions` as the canonical session index, not browser `localStorage`.
- Channel classification must never rely only on a transient frontend `source` field. Backend summaries should normalize missing/stale channels by session id prefix: `telegram_` -> `telegram`, `mobile_` -> `mobile`, `cli_` -> `terminal`, `discord_` -> `discord`, `whatsapp_` -> `whatsapp`, task/brain/auto ids -> `system`.
- `normalizeSessionSummary(...)`, `buildSessionSummary(...)`, and `buildSessionSummaryFromFile(...)` in `src/gateway/session.ts` should preserve valid channel values and infer from `sessionId` instead of falling back blindly to `web`.
- The desktop Channels sidebar must load all channel summaries, not only mobile and CLI. `web-ui/src/pages/ChatPage.js` should fetch/merge `terminal`, `mobile`, `telegram`, `discord`, and `whatsapp` summaries, maintain `window.channelSessionsByChannel`, and keep `window.terminalSessions`, `window.mobileSessions`, `window.telegramSessions`, `window.discordSessions`, and `window.whatsappSessions` in sync for older rendering helpers.
- `web-ui/index.html` channel hub/drilldown counting must include server-only Telegram/Discord/WhatsApp sessions as well as mobile/CLI. `_getSessionChannel(...)` should consider `channel`, `source`, and known id prefixes.
- When opening a chat on desktop, force-refresh the full session from `/api/sessions/:id` so stale local browser state cannot disagree with mobile/Telegram. Local history/process logs may still need careful merge behavior for in-flight streams, but old `localStorage` must not be allowed to hide newer server messages.
- `openTerminalSession(...)` is historically named, but it is the generic server-backed channel opener. It should use the returned session's real `s.channel` instead of assuming `terminal`.
- `deleteChatSession(...)` must remove the session from all channel summary arrays and `window.channelSessionsByChannel`, not only `terminalSessions` and `mobileSessions`.
- `runInteractiveTurn(...)` in `src/gateway/routes/chat.router.ts` must bridge non-desktop channel turns into retained main-chat stream/websocket events. If a channel turn is not already owned by a local `/api/chat` SSE stream, it should call `beginMainChatStream(...)`, append `user_message`, `token`, `thinking_delta`, `tool_call`, `tool_result`, `progress_state`, `done`, and `error` frames through `appendMainChatStreamEvent(...)`, and finish with `finishMainChatStream(...)`.
- Desktop's `main_chat_stream_event` handler in `web-ui/src/pages/ChatPage.js` is for observing other surfaces live. It must avoid double-applying events for locally-owned desktop `/api/chat` turns, but it must create/update the relevant channel session, append live tokens/thinking/tool/progress state, mark unread when not active, save local state, and refresh the visible channel list.
- Telegram/mobile live bugs are usually two-path bugs: one path is the live stream bridge (`main_chat_stream_event` and retained stream catch-up), and the other is canonical session indexing/hydration (`/api/sessions`, `/api/sessions/:id`, local cache merge). Check both before blaming the model loop or websocket transport.
- After backend channel-normalization changes, the running gateway must be rebuilt and restarted if it is serving `dist/gateway/server-v2.js`; changing TypeScript source alone is not enough for the live app.

Current focus/canvas rules for parallel chats:

- Background chat/tool events must not steal the user's active desktop chat. If a background session emits a stream frame, restore the previously active session after processing it.
- Creative-mode websocket commands from a background session must not auto-open that chat or canvas. Suppress creative auto-open for background handling, then restore the prior active session.
- Closing the right panel should reset its selected view back to the main panel/process/connectors surface. Existing canvas files/state remain attached to the session, but the panel should not reopen directly into canvas unless the user clicks the canvas view again.
- `canvas_present` should remember the canvas file/path without forcing the panel open for background sessions.

Current chat media-presentation rule from 2026-05-20:

- When Prometheus presents already-created media files in chat, PNG/JPG/JPEG/MP4 should render like generated image/video review previews inside the chat bubble, not as compact file pills that open Canvas.
- For generated/exported MP4 previews, chat UIs should use `/api/canvas/inline?path=...` as the `<video src>` instead of `/api/canvas/download?path=...`. The inline route supports browser playback behavior, including range requests; download-style URLs can show a black video with a canceled play button on mobile/browser surfaces.
- Desktop implementation lives in `web-ui/src/pages/ChatPage.js`:
  - `renderFilePills(...)` now partitions media paths out of generic file pills.
  - `normalizePresentedMediaFile(...)`, `getPresentedMediaKind(...)`, and `renderPresentedMediaCards(...)` detect and render presented media.
  - `renderArtifacts(...)` also routes media artifacts through the same preview-card path.
  - `normalizeGeneratedVideoEntry(...)`, generated-video URL helpers, and `renderAssistantGeneratedVideos(...)` render `generated_video` / `generated_videos` tool results as playable in-bubble videos.
  - SSE `tool_result` events from `generate_video` should be collected into the active assistant turn as `generatedVideos`, and persisted on success, no-response, error, and abort paths.
- Desktop styling lives in `web-ui/src/styles/pages.css`:
  - `.assistant-image-preview--static` is the non-click-to-canvas image preview.
  - `.assistant-generated-video` provides the bounded in-bubble MP4 player frame.
- The public UI mirror must stay in sync under `generated/public-web-ui/static/pages/ChatPage.js` and `generated/public-web-ui/static/styles/pages.css`.
- Gateway route rule: `src/gateway/routes/canvas.router.ts` must keep `/api/canvas/inline` capable of serving video/audio with `Accept-Ranges`, `206 Partial Content`, and `416` for invalid ranges. Browsers often require range support before MP4 controls behave correctly.
- Subagent/tool bridge rule: `src/gateway/agents-runtime/subagent-executor.ts` should include a `generated_videos` array in generate-video tool extras, not only text/file references, so frontends can render previews without guessing.
- Main mobile web UI uses `_collectMessageMedia(...)` plus `_renderMobileMediaGallery(...)` in `web-ui/src/mobile/mobile-pages.js`; when files are normalized as image/video media, mobile renders `.pm-media-card` previews rather than `.pm-generated-file`. Video/audio card sources must use `/api/canvas/inline`.
- Separate workspace mobile app rule: `workspace/Prometheus Mobile App/source/mobile/mobile-api.js` must forward `tool_result` SSE events via `onToolResult`; `workspace/Prometheus Mobile App/source/mobile/mobile-pages.js` should collect `generate_video` `extra.generated_video(s)` into `body.generatedVideos` and render `<video controls playsinline preload="metadata">` cards using `/api/canvas/inline`; styling lives in `workspace/Prometheus Mobile App/source/styles/mobile.css` under `.pm-generated-video-*`.
- The intended user experience: generated media and presented local media look consistent, with inline preview/player controls and copy/download actions. Opening Canvas is reserved for explicit canvas/edit actions, not the default presentation of finished PNG/JPG/MP4 outputs.
- Verification used for this UI rule: `node --check web-ui/src/pages/ChatPage.js`, `node --check generated/public-web-ui/static/pages/ChatPage.js`, `npm run check:web-ui`, plus Playwright render checks for desktop and mobile-sized chat surfaces.

Verification rule for these edits:

- For `web-ui/` changes, run `npm run sync:web-ui`.
- For gateway/runtime changes, run `npm run build:backend`.
- For mixed gateway plus web UI changes, run both, and expect `prom_apply_dev_changes` to sync web UI, build backend when needed, restart the gateway, and then rely on hot-restart/session recovery instead of losing the live turn.
- When debugging a lost stream, inspect both `web-ui/src/pages/ChatPage.js` and the backend retained stream/runtime paths before assuming the model/tool loop failed.
- For channel/chat UI edits, also syntax-check the touched generated/source browser files when practical: `node --check web-ui/src/pages/ChatPage.js`, `node --check generated/public-web-ui/static/pages/ChatPage.js`, and an inline-script parse check for `web-ui/index.html` when the Channels sidebar script changes.
- To confirm the running app sees a channel fix, call local APIs such as `http://127.0.0.1:18789/api/sessions?channel=telegram`, `?channel=mobile`, and `/api/sessions`, and verify `id`, `channel`, `title`, `lastActiveAt`, and `messageCount` match the expected surface.
