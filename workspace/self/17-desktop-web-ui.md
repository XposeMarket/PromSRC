# 33) Desktop Web UI Maintenance Reference

Last verified against `web-ui/`, `generated/public-web-ui/`, `src/gateway/routes/`, `src/gateway/core/app.ts`, subagent Home chat/Runs recovery routes, Voice Room routes, auto-settle lifecycle, and package scripts on: 2026-08-09

This section is for the desktop web UI only: the browser/Electron operator surface served from `web-ui/` and mirrored into `generated/public-web-ui/`. Do not use this section as the mobile app reference. Mobile/PWA code lives under `web-ui/src/mobile/*` and is covered separately in `16-mobile-app.md`.

## Source Layout

Canonical desktop source:

- `web-ui/index.html` - desktop document shell, sidebar/nav DOM, page-view containers, settings modal markup, right/canvas panel markup, legacy inline script, desktop module imports, onboarding imports, auth boot wrapper, and mobile root/router includes.
- `web-ui/src/app.js` - desktop app bootstrap helpers, theme, sidebar collapse/resize, right-panel open/close, More popover, sidebar segment tabs, and `setMode(...)` page routing.
- `web-ui/src/state.js` - shared browser state object and constants such as theme storage key.
- `web-ui/src/api.js` - shared `api(path, opts)` wrapper, API base fallback handling, paired-device token attachment when present, and browser global `window.api`.
- `web-ui/src/ws.js` - shared WebSocket connection, event bus, mobile token query support, reload/update handling, and `window.connectWS`.
- `web-ui/src/utils.js` - desktop/shared helpers for escaping HTML, time/memory/percent formatting, toasts, confirms, logs, visual iframe/srcdoc rendering, Mermaid rendering, Markdown rendering, and legacy `window.*` helper exports.
- `web-ui/src/shortcuts.js` - global keyboard shortcut registry (`registerShortcut`, `initGlobalShortcuts`), attached once from `app.js`. Owns `Ctrl+N` (new chat), `Ctrl+K` (command palette), and `Ctrl+/` (shortcuts help).
- `web-ui/src/command-palette.js` - `Ctrl+K` command palette overlay (jump to pages, recent chats, and a few quick actions). Builds its DOM on first open and is loaded via dynamic `import()` from `shortcuts.js`.
- `web-ui/src/shortcuts-help.js` - `Ctrl+/` "Keyboard Shortcuts" reference overlay, also loaded via dynamic `import()`.

Desktop page modules:

- `web-ui/src/pages/ChatPage.js` - main desktop chat workspace, unified-session sidebar data and server hydration, SSE chat streaming, retained stream catch-up, process log, approvals, voice/dictation/realtime voice controls, browser canvas controls, right-panel canvas/editor workspace, creative editor integration, generated media rendering, queued prompts, context-window indicator, and most chat/canvas globals.
- `web-ui/src/pages/TasksPage.js` - background task board, task detail panel, task chat/replies, task approvals, task state changes, evidence bus, coding workspace/command run panels, manager status, and error response panel.
- `web-ui/src/pages/SchedulePage.js` - schedules/automations list, Brain schedule cards, create/edit modal, RRULE parsing helpers, run-now/delete/enable controls, schedule reference chips, and schedule websocket refresh behavior.
- `web-ui/src/pages/TeamsPage.js` - teams canvas/board, team chat, team tabs, manager review/run-all/pause/resume/delete flows, context refs/files, memory, runs, workspace tree/editor, team subagent detail drawers, and team websocket handling.
- `web-ui/src/pages/SubagentsPage.js` - standalone subagent list/detail, local Agent Profile Pack preview/install/uninstall UI, marketplace provenance badges, subagent Home chat, abort/file upload/attachment previews, Runs tab task cards/recovery chat, system prompt editing, heartbeat config/markdown, context references/files, spawned tasks, memory reload, and process toggles.
  - Subagent chat embeds the shared chat composer classes inside a detail panel. Keep `SubagentsPage.js` markup scoped with `subagent-panel-chat-shell`, `subagent-panel-chat-messages`, and `subagent-panel-chat-composer`; `components.css` overrides that scoped composer to `position: static` so it does not inherit the main chat `.chat-input-area` absolute bottom positioning.
  - Subagent Home chat is for direct conversation, voice-originated chat, and main-agent handoff/tool messages. Do not use it as implicit paused-task recovery.
  - Subagent Runs tab uses task cards backed by `/api/agents/:id/runs` and `/api/agents/:id/runs/:taskId`. Recovery-eligible cards expose a chat thread and composer backed by `/api/agents/:id/runs/:taskId/recovery`.
  - Run recovery chat should reuse regular chat bubble/composer styling and attachment upload helpers so it matches Home chat visually and supports images/video/files.

- `web-ui/src/pages/ProposalsPage.js` - proposal list/filter, pending badge, approve/deny, jump-to-session, and jump-to-task behavior.
- `web-ui/src/pages/AuditPage.js` - non-main run audit log, run grouping/status classification, pagination, row expansion, and stats rendering.
- `web-ui/src/pages/MemoryPage.js` - memory graph canvas, force/layout modes, controls drawer, detail drawer, add-memory composer, attachment handling, graph refresh/indexing, shape/image layout, tooltips, and selection.
- `web-ui/src/pages/HubPage.js` - skill usage, tool/model overview cards, skill preview modal, skill resources, curator suggestions, achievements scaffold, and Hub activation.
- `web-ui/src/pages/ConnectionsPage.js` - the lazy-loaded More → Plugins connector catalog, deterministic search/sort adapter, connector detail view, OAuth/manual credential flows, browser login verification, disconnect/verify/repair actions, activity, X/xAI flows, Obsidian vault connect/sync/remove, and configured MCP server detail.
- `web-ui/src/pages/SettingsPage.js` - settings modal tabs: system, heartbeat, search, credentials, security, models, channels, agents, integrations, shortcuts, pairing, migration, OAuth/provider state, MCP/webhooks, channel tests, agent config, and pairing/remote access UI. Its Systems tab also owns the themed auto-settle policy control and the explicit custom-date activation choice. Its Models tab owns agent-model defaults/templates, provider-aware account selection for multi-account defaults, Brain Thought/Dream reasoning controls, and the persisted Voice Agent provider/voice default below Main Chat.
- `web-ui/src/pages/ProjectsPage.js` - sidebar projects list, project cards, project sessions, new/delete project flows, project files, project instructions/memory snapshot, and project-to-chat/canvas handoff.

Desktop shared components:

- `web-ui/src/components/ProcessRunCard.js` - process run card rendering, process-run list HTML, recent process fetch, card controls, and live process stream updates.
- `web-ui/src/components/CodingWorkspacePanel.js` - coding workspace status/diff panel and coding action handlers.
- `web-ui/src/components/agent-model-picker.js` - per-agent provider/model/reasoning picker, catalog hydration, live model refresh, save/clear handlers, and saved-callback registry.
- `web-ui/src/components/model-provider-credentials.js` - model provider credential status cache and provider filtering helpers.

Creative desktop components:

- `web-ui/src/components/creative/sceneGraph.js` - scene/document/element model, text measurement, library packs, animation presets, layout validation, selection context, patch parsing, timeline resolution, and scene graph op execution.
- `web-ui/src/components/creative/audioEngine.js` - audio track config normalization, preview element management, audio readiness, timeline sync, media readiness, export audio sessions, and audio analysis fetches.
- `web-ui/src/components/creative/exportEngine.js` - browser-side creative export engine.
- `web-ui/src/components/creative/renderJobs.js` - render job status normalization, worker-mode detection/context, render job API client, and render worker controller.
- `web-ui/src/components/creative/hyperframesController.js`, `hyperframesPreview.js`, and `hyperframesCatalogBrowser.js` - HyperFrames preview, editing, catalog browsing, lint/QA/export/materialization handoff.
- `web-ui/src/components/creative/motionTemplates.js` - creative motion template API client.
- `web-ui/src/components/creative/editor/*` - modular native creative editor: layout, store/history, preview renderer/viewport, handles/snapping/text editing/context menu, timeline/graph editor, text/shapes/effects/subtitles/properties/assets panels, shortcuts, and export encoder/dialog.

Desktop auth/onboarding:

- `web-ui/src/auth/account.js` - account auth client helpers used by the desktop boot/login flow.
- `web-ui/src/onboarding/onboarding-controller.js` - onboarding state machine and first-run orchestration.
- `web-ui/src/onboarding/tutorial-overlay.js` - tutorial overlay.
- `web-ui/src/onboarding/model-picker.js` - onboarding model/provider selection.
- `web-ui/src/onboarding/memory-confirm.js` - memory seed confirmation.
- `web-ui/src/onboarding/migration-panel.js` - migration preview/execute UI.
- `web-ui/src/onboarding/meet-panel.js` - first-meet flow.
- `web-ui/src/onboarding/redo-onboarding.js` - redo onboarding confirmation flow.

Desktop styles:

- `web-ui/src/styles/base.css` - global variables, base layout, shell primitives, sidebar/nav foundations.
- `web-ui/src/styles/components.css` - reusable controls/cards/modals, chat controls, context-window indicator, process/approval/media styles, and many desktop component styles.
- `web-ui/src/styles/pages.css` - page-specific desktop styles, chat/canvas/right-panel styles, creative and process page surfaces.
- `web-ui/src/styles/projects.css` - project sidebar/cards/file grid/editor styles.
- `web-ui/src/styles/hub.css` - Hub page styles.
- `web-ui/src/styles/onboarding.css` - onboarding overlay/panel styles.
- `web-ui/src/styles/fonts.css` - local font imports generated for public runtime.
- `web-ui/src/styles/mobile.css` - mobile-only styles; do not treat it as desktop UI unless editing shared activation boundaries.

Generated public mirror:

- `generated/public-web-ui/index.html`
- `generated/public-web-ui/static/app.js`, `api.js`, `ws.js`, `utils.js`, `state.js`
- `generated/public-web-ui/static/pages/*`
- `generated/public-web-ui/static/components/*`
- `generated/public-web-ui/static/styles/*`
- `generated/public-web-ui/vendor/*`

Never hand-edit generated desktop files except for emergency diagnosis. Make source changes under `web-ui/`, then sync generated output.

## Page Routing and DOM Ownership

Desktop routing is not a framework router. `web-ui/index.html` declares page containers and desktop chrome, then `web-ui/src/app.js:setMode(mode)` shows/hides those containers.

Current desktop modes in `app.js`:

- `chat` -> `#chat-view`
- `bgtasks` -> `#bgtasks-view`
- `schedule` -> `#schedule-view`
- `teams` -> `#teams-view`
- `subagents` -> `#subagents-view`
- `proposals` -> `#proposals-view`
- `audit` -> `#audit-view`
- `memory` -> `#memory-view`
- `hub` -> `#hub-view`
- `plugins` -> `#plugins-view` (lazy-loaded from More → Plugins)

The left sidebar lives in `#sidebar`. Its nav items call `setMode(...)` directly from inline `onclick` attributes. Sidebar segment tabs are handled by `setSidebarSegTab(...)` and swap among `#sidebar-jobs`, `#sidebar-projects`, and `#sidebar-skills`; the former Channels segment is not a desktop chat UI.

## Unified Session Sidebar

Desktop loads `GET /api/sessions?scope=all&includeAutomated=1` into one inline chat timeline. Pinned and ordinary top-level sessions share this list regardless of whether they originated on desktop, mobile, Telegram, CLI, Discord, WhatsApp, or a voice room. Project and side chats remain in their dedicated contexts. Each summary carries durable `channel` metadata plus a sanitized `lastOrigin` from the latest user turn; the sidebar presents that origin as a source label without recreating channel partitions. Active-list loading uses `state=active`; settled chats are reached through the Settled entry below Show More and use the same list/search pagination with `state=settled`.

### Settled chats and auto-settle

Manual Settle/Unsettle and automatic settling share the durable `session.settledAt` state transition. Settling changes visibility only: it does not delete session files, transcript history, resources, memory, task content, unread state, or scheduled work. WebSocket `session_state_changed` events update the desktop sidebar projection so an automatically settled chat leaves the active list without navigating away from an open chat; Unsettle returns it to the active list.

The Systems tab's auto-settle card is Never by default and offers 7, 14, 30, 90 days, or Custom. A past Custom date save asks whether to apply it to currently eligible existing chats or start aging from now. The backend uses durable `lastActiveAt`, bounded batches, an auditable `<configDir>/auto-settle/last-run.json` summary, and authoritative runtime/task/approval/schedule/supervision/project protections. The control is intentionally separate from manual settling and from any future auto-compaction/cleanup feature.

The chat mode owns the central `main.main-shell` and the right panel. Non-chat modes hide the main shell and close the right panel. The right panel `#right-panel` contains the canvas/editor/browser/agent execution surfaces; connector discovery is no longer a right-panel responsibility. `toggleRightPanel(...)`, `toggleCanvas(...)`, `setCanvasMode(...)`, and related globals mostly live in `ChatPage.js`.

Settings is modal, not a page mode. `openSettings(tab)` and `closeSettings()` live in `SettingsPage.js`; the modal markup lives in `index.html`.

The More popover exposes a dedicated `plugins` mode. `#plugins-view` owns the lightweight catalog shell and search UI; `ConnectionsPage.js` is loaded on first entry, fetches only `GET /api/extensions/catalog?kind=connector` plus connection attempts/configured MCP state, and owns the connector/MCP detail overlay `#connector-view`. The overlay is positioned against the active page or chat surface, so the same connection contracts remain usable from both compatibility paths. Model/provider settings remain in Settings.

Projects are split: sidebar/list behavior lives in `ProjectsPage.js`, while project sessions ultimately route back into Chat/canvas through `ChatPage.js` globals.

The desktop still has a legacy inline script in `index.html`. Many inline handlers depend on `window.*` functions exposed by ES modules. When moving behavior out of the inline script, preserve the existing global names until all markup callers are migrated.

## Module Imports and Boot Sequence

Desktop bootstrap modules in `web-ui/index.html` currently load the shared
runtime (`state.js`, `api.js`, `utils.js`, `ws.js`, and `app.js`), the account /
onboarding inline module, and the mobile router. `app.js` owns the page-module
map and dynamically imports page modules as their modes are entered; Settings
has a separate loader because it is a modal. The page-module map includes
Chat, Tasks, Schedule, Teams, Subagents, Proposals, Audit, Memory, Hub, and the
lazy Plugins route backed by `ConnectionsPage.js`.

`ConnectionsPage.js` is intentionally not part of the chat boot request. The
`plugins` route imports it when More → Plugins is opened; the legacy loader shim
remains only for inline compatibility callers such as the add-plugin modal.

`state.js`, `api.js`, `utils.js`, `ws.js`, and `app.js` load before page modules because page modules use their globals/imports. `ChatPage.js` is loaded before most other page modules because other surfaces call chat/session/canvas helpers through `window.*`.

The inline boot wrapper calls account/onboarding helpers and eventually starts the desktop app. The old global `connectWS()` shim in `index.html` delegates to `window.connectWS()` from `ws.js` once the module is available.

Mobile router inclusion at the bottom does not make this a mobile section. It exists so the same static bundle can switch into mobile mode when `#mobile`, `/mobile`, `?source=pwa`, `?pair=...`, `pm_force_mobile`, or a paired token requires it.

## Desktop API and WebSocket Backends

Static desktop UI is served by `src/gateway/core/app.ts`, which mounts `generated/public-web-ui` as the web root and `/vendor/*` plus `/assets`.

Important backend route groups consumed by the desktop UI:

- `src/gateway/routes/chat.router.ts` - `/api/status`, `/api/chat`, `/api/chat/steer`, `/api/sessions*`, `/api/sessions/:id/context-window`, voice-agent endpoints, retained main-chat stream endpoints used for cross-surface catch-up.
- `src/gateway/routes/canvas.router.ts` - `/api/canvas/*`, `/api/creative-mode`, preview/document/media routes, project preview/export/publish routes, HTML Motion, HyperFrames, creative assets/libraries/render jobs/scene/composition/export routes, `/api/open-path`, `/api/clear-history`.
- `src/gateway/routes/tasks.router.ts` - background task/task chat/task control APIs consumed by `TasksPage.js`.
- `src/gateway/routes/processes.router.ts` - managed process/run APIs consumed by `ProcessRunCard.js` and task panels.
- `src/gateway/routes/teams.router.ts` - team board, team chat, manager actions, team workspace, team memory, team subagent APIs.
- `src/gateway/routes/channels.router.ts` - channel status/config/test APIs, agents/subagent APIs, explicit subagent run/recovery APIs, persona/team-room Telegram flows, and dispatch.
- `src/gateway/routes/proposals.router.ts` - proposal list/approve/deny APIs.
- `src/gateway/routes/projects.router.ts` - project list/session/file/instruction/memory APIs.
- `src/gateway/routes/settings.router.ts` - settings, providers/models, search, heartbeat, security, and related config APIs.
- `src/gateway/routes/account.router.ts` - account config/status/login/logout/refresh APIs used by auth boot.
- `src/gateway/routes/connections.router.ts`, `extensions.router.ts`, and `obsidian.router.ts` - connector catalog/status/credentials/OAuth/browser-login and Obsidian vault APIs.
- `src/gateway/routes/hub.router.ts` - Hub usage, tool/model overview, skill content/resources, curator suggestions, goals, and achievements.
- `src/gateway/routes/memory.router.ts` - memory graph/detail/create/refresh/status APIs.
- `src/gateway/routes/onboarding.router.ts` and `migration.router.ts` - onboarding state and migration preview/execute/report APIs.
- `src/gateway/routes/pairing.router.ts` - pairing panel, remote access, QR/human-code, certificate, claim/approval status APIs. Desktop approval UI is in `SettingsPage.js`; mobile pairing screens are in the mobile section.
- `src/gateway/routes/audit-log.router.ts` - audit log query API.
- `src/gateway/routes/coding.router.ts` - coding workspace session/status/diff/stage/branch APIs.
- `src/gateway/routes/goals.router.ts` - goals, MCP server/tool, and shortcut APIs still used by older desktop settings surfaces.

WebSocket events enter through `web-ui/src/ws.js` and are consumed by page modules through `window.wsEventBus.addEventListener('message', ...)`. Chat streaming also uses `/api/chat` SSE directly in `ChatPage.js`; retained and cross-surface stream events are also mirrored through websocket/main-chat stream handlers.

### Desktop chat recovery contract (2026-08-01)

### Desktop model controls and voice orb (2026-08-01)

- The desktop model/reasoning switcher is intentionally compact: the quick effort slider and advanced rows use reduced type, spacing, and control heights so the popover stays subordinate to the composer.
- Model/reasoning popover surfaces must be opaque theme surfaces with no backdrop blur or translucent glass layer. Keep the control styling in `web-ui/src/styles/components.css` and mirror it into `generated/public-web-ui/static/styles/components.css`.
- The desktop voice orb keeps its motion/audio reactivity, but its idle state has no halo. Listening/thinking/speaking states may use only a restrained accent shadow; do not reintroduce the large ambient glow treatment.
- Desktop Voice Room controls live on the voice orb itself. Clicking the orb opens a target/room popover inside the desktop voice dock; the dock keeps the live transcript above the picker and expands the chat message reserve while the picker is open so transcript bubbles never sit underneath it.
- Desktop Voice Room state uses the same durable `voice_room_*` session contract as mobile. `/api/voice-rooms/resolve` supplies the deterministic roster and `/api/voice-rooms/:id/transcript` receives finalized realtime turns. Opening a saved `voice_room` session restores its roster and starts realtime voice; switching to a normal session or creating a new chat clears the room binding and resets the target to Prometheus.
- The desktop realtime bootstrap sends `voiceTarget` and an enabled `voiceRoom` context to both OpenAI and xAI transports. The host-side `voice_room_handoff` fallback can switch the active participant without changing the room session, while the room transcript remains shared and bounded in the bootstrap context.

`web-ui/src/pages/ChatPage.js` now treats a desktop `/api/chat` transport loss as a recoverable client disconnect, matching the mobile app's retained-stream behavior:

- Active desktop turns persist a bounded run record under `prometheus_desktop_active_chat_runs_v1`. The record carries the session id, `clientRequestId`, runtime/stream identity, last sequence, start time, and disconnect state. Writes are throttled during streaming, pruned after seven days, and force-persisted on `pagehide`.
- An incomplete SSE body (`stream ended before completion`) and recognized network/transport failures preserve the live `activeRun`, process/thinking state, and recovery metadata. The local-request ownership marker is released immediately so replayed frames are not filtered as duplicates. A real user abort remains terminal and is kept distinct from a page-lifecycle disconnect.
- Startup reconsiders the remembered active session and force-hydrates it from `/api/sessions/:id`; the existing local history/process timeline is merged with the server snapshot so a richer in-flight browser trace is not discarded.
- `recoverDesktopMainChatSession(...)` is single-flight per session and runs after `pageshow`, focus, `online`, foreground visibility, WebSocket reconnect, and active stream-update notifications. It reads `/api/mobile/chat/stream/:sessionId?after=...`, dedupes by session/stream/sequence, detects stream rotation or retention gaps, and replays from `after=0` when necessary. It applies recovery frames even when the original desktop SSE request is no longer local-owned, while the server's 12,000-frame/16 MiB retention bounds remain authoritative.
- Terminal replay clears the persisted run and live state only after the matching session has completed or errored. The generated public copy must be regenerated from this source after every change.

Paused task recovery is backend-synchronized, but standalone subagent Home chat is intentionally split from task recovery. `TasksPage.js` posts to the task message APIs. `SubagentsPage.js` Home chat posts to normal subagent chat routes, while the Runs tab posts recovery guidance to `POST /api/agents/:id/runs/:taskId/recovery`. Standalone subagent recovery turns should not be mirrored into Home chat history or rendered as normal Home messages. Team surfaces can still route team room/member/manager blocked-task turns through team recovery when that is the intended owner surface.

## Desktop Globals and Public Function Map

The desktop UI intentionally exposes many functions on `window` because `index.html` still contains inline handlers and page modules call each other without a framework-level event bus. When refactoring, treat these names as compatibility API until the corresponding markup/caller is migrated.

Core/shared globals:

- `api`, `connectWS`, `wsEventBus`
- `escHtml`, `escapeHtml`, `timeAgo`, `fmtPercent`, `fmtMemoryGb`, `meterWidth`, `setText`, `setMeter`
- `showToast`, `bgtToast`, `showConfirm`, `log`, `renderMd`, `buildVisualSrcdoc`, `buildVisualIframe`
- `setMode`, `toggleTheme`, `applyTheme`, `getInitialTheme`, `toggleSidebar`, `toggleRightPanel`, `toggleMorePopover`, `closeMorePopover`, `setSidebarSegTab`, `_syncPageViewPositions`
- `openCommandPalette`/`closeCommandPalette` (`command-palette.js`), `openShortcutsHelp`/`closeShortcutsHelp` (`shortcuts-help.js`) - see "Global Keyboard Shortcuts" below.

Chat/session/canvas globals from `ChatPage.js` include the highest-risk compatibility surface:

- session state: `chatHistory`, `chatSessions`, `activeChatSessionId`, `terminalSessions`, `mobileSessions`, `telegramSessions`, `discordSessions`, `whatsappSessions`, `channelSessionsByChannel`, `saveChatSessions`, `loadChatSessions`, `newChatSession`, `openSession`, `deleteChatSession`, `syncActiveChat`, `persistActiveChat`, `markSessionUnread`, `upsertAutomatedSession`, `renderSessionsList`, `renderChannelsList`
- chat send/render: `sendChat`, `renderChatMessages`, `renderAssistantContent`, `renderAssistantGeneratedImages`, `renderArtifacts`, `renderFilePills`, `copyChatMessage`, `forkConversationFromAssistantMessage`, edit/rerun helpers, queued prompt helpers, slash-command helpers, and token/context-window helpers
- process/progress: `addProcessEntry`, `renderProcessLog`, `clearProcessLog`, `toggleCurrentProcess`, `renderProcessPill`, `renderProgressPanel`, `toggleProgressPanel`, `requestGatewayMainChatAbort`, `spawnAgentExecution`
- approvals: `loadApprovals`, `loadSessionApprovals`, `resolveSessionApproval`, `resolveInlineApproval`, `loadApprovalProcessRun`
- voice: `toggleVoiceDictation`, realtime voice toggles/settings handlers, Voice Agent realtime start/stop/PTT/always-listening helpers, and pending voice turn helpers.  During provider-status refresh, the desktop applies the Models tab Voice Agent default for Codex Voice/Live/OpenAI Realtime or xAI before rendering the live voice controls.
- canvas/browser: `toggleCanvas`, `toggleCanvasFullscreen`, `setCanvasMode`, `canvasSave`, `canvasOpenTab`, `canvasCloseTab`, file browser/project-root helpers, browser canvas navigation/control/teach/name helpers, preview/frame-load/inspect helpers
- creative: creative mode setters, scene/project state, asset import/refresh/generation/layer extraction, creative editor selection/properties/timeline/keyframes/layers/playback/export/render jobs, HTML Motion block/template/icon/search/lint/QA/export helpers, HyperFrames catalog/studio/edit/patch/lint/QA/export helpers, and composition timeline/render helpers

Page globals:

- `TasksPage.js`: `refreshBgTasks`, task board drag/drop helpers, `openBgtPanel`, `closeBgtPanel`, pause/resume, task chat/reply/delete, approvals, evidence bus, coding workspace, command runs, process run refresh, and error response helpers.
- `SchedulePage.js`: `refreshSchedules`, `openScheduleCreateModal`, `editSchedule`, `saveSchedule`, `deleteSchedule`, `runScheduleNow`, Brain schedule controls, occurrence/ref helpers.
- `TeamsPage.js`: `refreshTeams`, `teamsPageActivate`, board/chat/tab/context/memory/runs/workspace/subagent helpers, manager review/run-all/pause/resume/delete, create-team modal, workspace editor helpers.
- `SubagentsPage.js`: `subagentsPageActivate`, `refreshSubagents`, Agent Profile Pack import helpers (`previewAgentProfilePackImport`, `installAgentProfilePackImport`, `uninstallAgentProfilePack`), detail/chat/abort/file/context/system prompt/heartbeat/task/memory/process helpers.
- `SettingsPage.js`: `openSettings`, `closeSettings`, `setSettingsTab`, settings loaders/savers, provider/model/OAuth handlers, channel tests, MCP/webhook handlers, agent config and heartbeat editors, security/permission handlers, migration handlers, pairing panel handlers.
- `ConnectionsPage.js`: connector grid/detail/OAuth/credential/browser-login/disconnect/activity and Obsidian handlers.
- `ProjectsPage.js`: project sidebar/list/card/new/delete/session/file/instructions/memory helpers and project-canvas handoff.
- `HubPage.js`: `hubPageActivate`, skill modal/resource/curator helpers.
- `MemoryPage.js`: `memoryPageActivate`, `refreshMemoryGraph`, controls/detail/add-memory/shape helpers.
- `AuditPage.js`: `loadAuditLog`, `toggleAuditRow`, `auditPage`.
- `ProposalsPage.js`: `loadProposals`, `approveProposal`, `denyProposal`, jump helpers, pending badge.

Component exports:

- `ProcessRunCard.js`: `renderProcessRunCard`, `renderProcessRunsHTML`, `loadRecentProcessRuns`, `installProcessRunCardHandlers`.
- `CodingWorkspacePanel.js`: `loadCodingWorkspace`, `renderCodingWorkspacePanel`, `installCodingWorkspaceHandlers`.
- `agent-model-picker.js`: `renderAgentModelPicker`, `agentModelPickerHydrate`, `registerAgentModelPickerOnSaved` plus `window.agentModelPicker*` handlers.
- `model-provider-credentials.js`: credential cache/filter helpers.
- Creative editor modules export `createCreativeEditor`, `syncCreativeEditor`, `createStore`, `createHistory`, `createViewport`, `createRenderer`, panel factories, timeline factories, interaction helpers, effect registry helpers, and export encoder/dialog helpers.

## Global Keyboard Shortcuts

`web-ui/src/shortcuts.js` is initialized once from `app.js` (`initGlobalShortcuts()`) and attaches a single `document` `keydown` listener. Bindings are registered via `registerShortcut(combo, handler, { allowInInputs, preventDefault })`; `allowInInputs: true` lets a shortcut fire even while a text input/textarea/contenteditable has focus (used for all three bindings below since these should work while typing in the chat composer).

Current bindings:

- `Ctrl+N` - new chat, calls `window.newChatSession()`.
- `Ctrl+K` - opens the command palette (`command-palette.js`, dynamically imported on first use). With an empty query, lists Quick Actions (New Chat, Toggle Sidebar, Toggle Theme, Keyboard Shortcuts), Pages (`setMode(...)` targets: chat, bgtasks, schedule, teams, subagents, proposals, audit, memory, hub), Recent Chats (up to 8, from `window.chatSessions`), and Skills. Typing a query also searches a deep index of every Settings tab (see below). `↑`/`↓` move selection, `Enter` runs the active item, `Esc` or click-outside closes.
- `Ctrl+/` - toggles the "Keyboard Shortcuts" help overlay (`shortcuts-help.js`, dynamically imported), a static reference list grouped into "General" and "Command Palette".

Both overlays build their DOM lazily on first open (appended to `document.body`, class `cmdk-overlay`/`cmdk-card`) and share styles added to the end of `web-ui/src/styles/components.css` (`.cmdk-*`, `.shortcuts-help-*`). Because these are app-only (Electron) shortcuts, `Ctrl+N`/`Ctrl+K` intentionally override browser defaults - this is fine since `Menu.setApplicationMenu(null)` in `electron/main.js` means nothing intercepts them first, but they will not work as intended in a plain browser tab (e.g. the dev `web-ui-static` preview), where the browser claims `Ctrl+N`/`Ctrl+K` first.

Filtering uses token-based AND matching (`scoreItem`): every space-separated word in the query must appear somewhere in the item's `label` + `sub` text, so a multi-word query like "heartbeat interval" matches an item whose label is "Interval (minutes)" and whose sub-line is "Settings → Heartbeat".

**Skills group**: `getSkillItems()` maps the Hub's skill list to palette items (icon 🧩, `run` calls `window.openHubSkillModal(id)`). The list is fetched lazily via `refreshSkillsCache()` (`GET /api/hub/skills/usage?range=all`, 60s TTL) - the palette renders immediately on open and re-renders once the skills response lands, so the group can pop in a moment after `Ctrl+K`.

**Settings deep search**: `buildSettingsIndex()` scans every `#settings-panel-<tab>` in the (always-present, hidden) `#settings-modal` for `<label>` and `.right-section-title` elements, and builds a flat, memoized index of `{ tab, label, target }` entries (`target` is the label's `<input>/<select>/<textarea>/<button>`, or its next sibling, or the label itself). Entries whose target sits inside a conditionally-hidden sub-section (e.g. a per-channel-type form like `#channel-form-whatsapp` that's only shown after picking that channel type, detected via an inline `style.display === 'none'` between the target and its panel) are skipped, since jumping to them would land on an invisible element. `getSettingsItems()` turns each entry into a palette item (icon ⚙️, `sub: "Settings → <Tab Label>"` via `SETTINGS_TAB_LABELS`); these only ever appear as search results (filtered out of the empty-query default view since they're too granular to browse). Selecting one calls `openSettingsAndHighlight(tab, target)`, which opens Settings on that tab (`window.openSettings`/`window.setSettingsTab`), then after 150ms scrolls `target` into view and adds the `.cmdk-highlight` class (a 1.6s flash animation, defined alongside the other `.cmdk-*` rules in `components.css`) for 1.6s - falling back to the closest visible ancestor if `target` itself has no `offsetParent`.

To add a new global shortcut: call `registerShortcut(...)` in `initGlobalShortcuts()`. To add a new command palette entry: add an item (with `id`, `group`, `icon`, `label`, `sub`, optional `kbd`, and `run()`) to `ACTION_ITEMS` or `PAGE_ITEMS` in `command-palette.js`. To document a new shortcut, add a row to the matching group in `GROUPS` in `shortcuts-help.js`.

## Maintenance Rules

Desktop UI source-of-truth is `web-ui/`. Public runtime output is `generated/public-web-ui/`. After any desktop UI source edit, run:

```powershell
npm run sync:web-ui
```

`npm run sync:web-ui` runs `scripts/prepare-public-build.js --web-only` and then `npm run check:web-ui`. The checker compares source desktop/mobile files against generated public copies and validates expected vendor/font assets.

Useful syntax checks for focused desktop edits:

```powershell
node --check web-ui/src/app.js
node --check web-ui/src/pages/ChatPage.js
node --check web-ui/src/pages/SettingsPage.js
node --check generated/public-web-ui/static/pages/ChatPage.js
```

For inline-script changes in `web-ui/index.html`, use a browser smoke test or a script extraction/parser check; `node --check web-ui/index.html` is not meaningful.

If the app is running and generated sync fails with `EBUSY` on Windows, stop the gateway/Electron process that is serving generated files, then rerun `npm run sync:web-ui`.

Desktop chat skill/slash picker (2026-08-01): `$` opens the skill suggestion surface directly and `/` remains the slash-command trigger. Both suggestion lists are limited to five rows without an internal popover scroll. Skill rows show `$<name>` as gold/bold text without a pill; slash-command rows retain their command styling. Selecting a skill inserts its plain display name and preserves selected skill metadata, allowing the rich composer preview to color the name without exposing literal `**` markers. The canonical implementation is in `web-ui/src/chat-slash-commands.js`, `web-ui/src/pages/ChatPage.js`, and `web-ui/src/styles/components.css`/`themes.css`; the served mirror is under `generated/public-web-ui/static/`.

For desktop visual/interaction changes, verify the actual browser/Electron surface when practical. The highest-risk areas are:

- `ChatPage.js` streaming/session/channel behavior
- right-panel canvas/editor/browser behavior
- Settings modal tab interactions
- cross-page globals used by inline `onclick` markup
- generated public sync after source edits

Desktop Chat stream, progress, and steer rules (2026-08-01):

- `renderStreamingChatUpdate(...)` uses `patchStreamingChatBubble(...)` once the live bubble exists. The patcher updates only changed trace groups/entries and restores `<details>` open state plus inner result/terminal scroll; full message rendering is only the safe fallback for a structural transition or first paint.
- Operational narration is one mutable `agent_progress` summary in the current collapsed tool group. Visible `reasoning_summary` prose is a separate immutable trace row, except for transport-continuation chunks. Do not reclassify visible reasoning as progress or append every planning update as a new reasoning paragraph.
- `appendChatSteerWorkflowSplit(...)` captures the real pre-steer process/trace segment, creates the user steer, advances `currentTurnStartIndex`, and clears the continuation live trace. The continuation must therefore contain only tool events after the steer. The first segment owns the one live work timer; `_settlePendingChatSteerPresentation(...)` collapses the temporary workflow presentation when the final response begins or completes.
- `isHiddenRuntimeProcessEntry(...)` filters recovered `runtime_checkpoint/progress_state` records from ordinary tool drawers. Runtime plan state belongs in the dedicated plan/progress UI, not in rows such as `Plan: Run Browser Session`.

Do not mix mobile changes into a desktop web UI fix unless the shared file truly requires it. If a change touches `web-ui/src/mobile/*`, `web-ui/src/styles/mobile.css`, `web-ui/manifest.webmanifest`, or `web-ui/service-worker.js`, also consult `16-mobile-app.md`.

## Sharp Edges

- `ChatPage.js` is very large and owns several surfaces at once. A chat fix can accidentally affect creative canvas, browser canvas, voice, approvals, or channel sessions. Search for the relevant `window.*` name and all DOM IDs before editing.
- `index.html` still contains both DOM markup and legacy inline behavior. A function may be defined in a module but invoked from inline HTML by global name.
- `app.js:setMode(...)` hides the main shell for non-chat modes and closes the right panel. If a page appears blank, check whether its `*-view` container is displayed and whether `main.main-shell` was intentionally hidden.
- Desktop sessions are no longer only local browser state. The canonical backend session APIs are `/api/sessions` and `/api/sessions/:id`; local `localStorage` is cache/compatibility state.
- Cross-surface streams have two paths: websocket/main-chat stream events and retained stream catch-up. Debug both before assuming the model/tool loop failed. Retention is now bounded to 12,000 frames and 16 MiB per session; sequence gaps require session/cold recovery.
- Progress/final frames are byte-bounded before WebSocket/SSE/replay delivery. Oversized text is previewed by reference and large data-URI media can arrive as a signed same-origin `/api/turn-blobs/:hash` URL; desktop renderers must accept that URL in the same field. A slow SSE socket may be closed after 30 seconds of backpressure without cancelling the turn, then recover through retained stream/session state.
- Session/final state is flushed before terminal publication, but post-restart terminal redelivery is not yet driven by the durable outbox. Do not describe the current journal as guaranteed offline delivery.
- Generated media previews should use `/api/canvas/inline?path=...` for browser playback, not download-style URLs.
- Account/auth/pairing logic is security-sensitive. Do not loosen gateway auth, pairing approval, OAuth credential handling, command approvals, or source-edit approvals as part of a UI cleanup.

## Untrusted content boundary

- `web-ui/src/utils.js::renderMd()` is the only supported Markdown-to-HTML path. It runs `marked` output through the vendored DOMPurify allowlist before trusted visual placeholders are restored. Direct `marked.parse(...)` output must never be assigned to `innerHTML` or `srcdoc`.
- Scripted Markdown visuals, HTML/SVG blocks, workspace/project previews, mobile live-canvas pages, HTML motion, and HyperFrames previews must use an opaque-origin sandbox. Never combine `allow-scripts` with `allow-same-origin` for content that can include model, imported, workspace, or user HTML.
- Cross-frame behavior uses narrow, source-checked `postMessage` messages. Do not regain iframe DOM access by restoring `allow-same-origin`; extend the validated bridge instead.
- Headless creative workers use `src/gateway/security/scoped-render-auth.ts`. The gateway bearer must not appear in worker/preview URLs, `location.search`, page globals, or injected fetch wrappers. Worker grants are random, expiring, job-bound, header-only credentials; HTML-motion query grants can read only their exact preview and asset path.
- Data must not be interpolated into inline event-handler JavaScript. Use `data-*` attributes plus delegated `addEventListener` handlers, as `ProjectsPage.js` does for arbitrary project/file names.
- Run `npm run test:untrusted-content-boundary` after changing Markdown, preview iframes, creative render authentication, or dynamic event binding.
- Mobile router and mobile CSS are present in the same bundle. Desktop fixes should not rely on `body.pm-mobile-active`; that class means the mobile shell has taken over.
## P0-1 performance record — 2026-08-08

- Desktop source of truth remains web-ui; generated/public-web-ui must be regenerated with npm run sync:web-ui after source edits.
- ProjectsPage.js is now lazy: it is no longer in the desktop boot module preload and loads only when the Projects sidebar tab opens. Its old 400 ms self-fetch was removed.
- api.js coalesces identical in-flight GET promises only. Mutations, no-store reads, AbortSignal reads, and dedupe=false reads retain independent behavior.
- app.js loads the bounded client performance ring. ChatPage records privacy-conscious submit, accepted, first SSE byte, first token, first visible token, server latency marks, done, and error milestones. The server exposes an opaque X-Prometheus-Trace-Id; do not add message text, token text, or credentials to these marks.
- Equivalent local browser measurements showed cold DCL p50 156.5 ms on HEAD versus 102.5 ms on the working tree, FCP 124 versus 80 ms, and decoded startup bytes 5.585 MB versus 5.363 MB across three samples. Thread-open and route timings did not materially change.
- The committed repeatable harness is scripts/benchmark-performance.mjs. It can serve HEAD web sources in browser memory for before measurements, so dirty workspace changes do not need to be reverted.

## Persistent Chat Sources integration — 2026-08-08

Desktop Sources is a normal right-rail section, not a topbar popup. `web-ui/index.html` places it directly below Agent Context/Progress and directly above Process Log. `web-ui/src/pages/ChatPage.js` loads attached-resource metadata for the active session and provides search, save current Browser page, Browser history, attach, detach, pin/unpin, and refresh controls.

When changing the section, preserve the existing right-rail order and regenerate `generated/public-web-ui` with `npm run sync:web-ui`. Keep content previews bounded; the desktop panel is a resource-management surface, not a full-content viewer.

## P1-7 link routing — 2026-08-09

`web-ui/src/link-router.js` installs once from `app.js` and delegates external anchor decisions for the entire desktop document. This keeps assistant/user Markdown, sources/references, search and tool results, documentation, artifact/generated-page, map/site, and static Settings links on one policy path without broad ChatPage refactoring. The normalized decision policy is `web-ui/src/link-routing-policy.mjs`; the generated public mirror must contain both modules.

Normal unmodified HTTP/HTTPS clicks go to the Prometheus Browser. Same-origin and loopback gateway links remain normal app navigation, downloads and file paths retain their existing flow, `mailto:`/`tel:` remain passthrough, and modifier clicks retain native target behavior. Right-click, `ContextMenu`/`Apps`, or Shift+F10 presents accessible `Open in Prometheus Browser` and `Open externally` actions. `Shift+Enter` is the keyboard external action. OAuth/system-auth controls are marked `data-prometheus-link-mode="external"` or call `window.openPrometheusExternalLink(...)` explicitly.

Electron’s `prometheusExternalLinks` bridge is restricted to explicit external actions. The main-process boundary keeps trusted/local gateway routes internal, dispatches ordinary external navigation to the renderer’s Browser router, and rejects unsafe schemes/embedded credentials. The gateway’s `browser:link_open` handler serializes per-session link opens and uses a non-persisted Prometheus alias when the selected agent target is personal Chrome, so the user Chrome lane is never silently used.

Focused checks:

```powershell
npm run test:link-routing
npm run test:electron-security-boundary
npm run check:web-ui
```

## P9 OAuth-first Plugins connection surface — 2026-08-09

`web-ui/src/pages/ConnectionsPage.js` is the single connector discovery and
connection surface. Its managed action now delegates all native OAuth connector
cards to the host-owned connection-v2 orchestrator; it does not duplicate
credential, callback, refresh, revoke, or capability logic. The generated
mirror under `generated/public-web-ui/static/pages/ConnectionsPage.js` must be
updated with `npm run sync:web-ui` and checked with `npm run check:web-ui`.

Managed cards show provider-app prerequisites, account/resource scope,
read-only defaults, exposed tools, verification/repair/reauthorization,
disconnect, and explicit Advanced alternatives for own OAuth apps, API keys,
setup tokens, browser sessions, local vaults, and custom MCP. Model-provider and
voice/realtime credentials remain in Settings and must not be moved into this
page.
