# 33) Desktop Web UI Maintenance Reference

Last verified against `web-ui/`, `generated/public-web-ui/`, `src/gateway/routes/`, `src/gateway/core/app.ts`, and package scripts on: 2026-05-29

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

- `web-ui/src/pages/ChatPage.js` - main desktop chat workspace, sessions/channels sidebar data, SSE chat streaming, retained stream catch-up, process log, approvals, voice/dictation/realtime voice controls, browser canvas controls, right-panel canvas/editor workspace, creative editor integration, generated media rendering, queued prompts, context-window indicator, and most chat/canvas globals.
- `web-ui/src/pages/TasksPage.js` - background task board, task detail panel, task chat/replies, task approvals, task state changes, evidence bus, coding workspace/command run panels, manager status, and error response panel.
- `web-ui/src/pages/SchedulePage.js` - schedules/automations list, Brain schedule cards, create/edit modal, RRULE parsing helpers, run-now/delete/enable controls, schedule reference chips, and schedule websocket refresh behavior.
- `web-ui/src/pages/TeamsPage.js` - teams canvas/board, team chat, team tabs, manager review/run-all/pause/resume/delete flows, context refs/files, memory, runs, workspace tree/editor, team subagent detail drawers, and team websocket handling.
- `web-ui/src/pages/SubagentsPage.js` - standalone subagent list/detail, subagent chat, abort/file upload/attachment previews, system prompt editing, heartbeat config/markdown, context references/files, spawned tasks, memory reload, and process toggles.
- `web-ui/src/pages/ProposalsPage.js` - proposal list/filter, pending badge, approve/deny, jump-to-session, and jump-to-task behavior.
- `web-ui/src/pages/AuditPage.js` - non-main run audit log, run grouping/status classification, pagination, row expansion, and stats rendering.
- `web-ui/src/pages/MemoryPage.js` - memory graph canvas, force/layout modes, controls drawer, detail drawer, add-memory composer, attachment handling, graph refresh/indexing, shape/image layout, tooltips, and selection.
- `web-ui/src/pages/HubPage.js` - skill usage, tool/model overview cards, skill preview modal, skill resources, curator suggestions, achievements scaffold, and Hub activation.
- `web-ui/src/pages/ConnectionsPage.js` - connector catalog/grid, connector detail view, OAuth/manual credential flows, browser login verification, disconnect, activity, X/xAI flows, and Obsidian vault connect/sync/remove.
- `web-ui/src/pages/SettingsPage.js` - settings modal tabs: system, heartbeat, search, credentials, security, models, channels, agents, integrations, shortcuts, pairing, migration, OAuth/provider state, MCP/webhooks, channel tests, agent config, and pairing/remote access UI.
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

The left sidebar lives in `#sidebar`. Its nav items call `setMode(...)` directly from inline `onclick` attributes. Sidebar segment tabs are handled by `setSidebarSegTab(...)` and swap among `#sidebar-jobs`, `#sidebar-channels`, `#sidebar-projects`, and `#sidebar-skills`.

The chat mode owns the central `main.main-shell` and the right panel. Non-chat modes hide the main shell and close the right panel. The right panel `#right-panel` contains the canvas/editor/browser/agent execution surfaces; `toggleRightPanel(...)`, `toggleCanvas(...)`, `setCanvasMode(...)`, and related globals mostly live in `ChatPage.js`.

Settings is modal, not a page mode. `openSettings(tab)` and `closeSettings()` live in `SettingsPage.js`; the modal markup lives in `index.html`.

Connections detail uses a fixed overlay `#connector-view`. `ConnectionsPage.js` owns `openConnectorView(...)`, `closeConnectorView(...)`, credential/OAuth flows, and Obsidian-specific actions.

Projects are split: sidebar/list behavior lives in `ProjectsPage.js`, while project sessions ultimately route back into Chat/canvas through `ChatPage.js` globals.

The desktop still has a legacy inline script in `index.html`. Many inline handlers depend on `window.*` functions exposed by ES modules. When moving behavior out of the inline script, preserve the existing global names until all markup callers are migrated.

## Module Imports and Boot Sequence

Desktop module order in `web-ui/index.html` is currently:

1. `src/state.js`
2. `src/api.js`
3. `src/utils.js`
4. `src/ws.js`
5. `src/app.js`
6. `src/pages/ChatPage.js`
7. `src/pages/AuditPage.js`
8. `src/pages/HubPage.js`
9. `src/pages/MemoryPage.js`
10. `src/pages/ProposalsPage.js`
11. `src/pages/SchedulePage.js`
12. `src/pages/TasksPage.js`
13. `src/pages/TeamsPage.js`
14. `src/pages/SubagentsPage.js`
15. `src/pages/ConnectionsPage.js`
16. `src/pages/SettingsPage.js`
17. `src/pages/ProjectsPage.js`
18. an inline module that imports auth/onboarding helpers
19. `src/mobile/mobile-router.js`

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
- `src/gateway/routes/channels.router.ts` - channel status/config/test APIs, agents/subagent APIs, persona/team-room Telegram flows, and dispatch.
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

Paused task recovery chat is backend-synchronized across task, subagent, and team surfaces. `TasksPage.js` posts to the task message APIs, while `SubagentsPage.js` and `TeamsPage.js` continue to post to their normal chat routes; the backend detects matching blocked task ownership, routes the turn through task recovery, and mirrors recovery turns back as `subagent_chat_message` or `team_chat_message` events. UI code should treat those mirrored messages as canonical chat history for the owner surface instead of creating a separate recovery-only display.

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
- voice: `toggleVoiceDictation`, realtime voice toggles/settings handlers, Voice Agent realtime start/stop/PTT/always-listening helpers, and pending voice turn helpers
- canvas/browser: `toggleCanvas`, `toggleCanvasFullscreen`, `setCanvasMode`, `canvasSave`, `canvasOpenTab`, `canvasCloseTab`, file browser/project-root helpers, browser canvas navigation/control/teach/name helpers, preview/frame-load/inspect helpers
- creative: creative mode setters, scene/project state, asset import/refresh/generation/layer extraction, creative editor selection/properties/timeline/keyframes/layers/playback/export/render jobs, HTML Motion block/template/icon/search/lint/QA/export helpers, HyperFrames catalog/studio/edit/patch/lint/QA/export helpers, and composition timeline/render helpers

Page globals:

- `TasksPage.js`: `refreshBgTasks`, task board drag/drop helpers, `openBgtPanel`, `closeBgtPanel`, pause/resume, task chat/reply/delete, approvals, evidence bus, coding workspace, command runs, process run refresh, and error response helpers.
- `SchedulePage.js`: `refreshSchedules`, `openScheduleCreateModal`, `editSchedule`, `saveSchedule`, `deleteSchedule`, `runScheduleNow`, Brain schedule controls, occurrence/ref helpers.
- `TeamsPage.js`: `refreshTeams`, `teamsPageActivate`, board/chat/tab/context/memory/runs/workspace/subagent helpers, manager review/run-all/pause/resume/delete, create-team modal, workspace editor helpers.
- `SubagentsPage.js`: `subagentsPageActivate`, `refreshSubagents`, detail/chat/abort/file/context/system prompt/heartbeat/task/memory/process helpers.
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

For desktop visual/interaction changes, verify the actual browser/Electron surface when practical. The highest-risk areas are:

- `ChatPage.js` streaming/session/channel behavior
- right-panel canvas/editor/browser behavior
- Settings modal tab interactions
- cross-page globals used by inline `onclick` markup
- generated public sync after source edits

Do not mix mobile changes into a desktop web UI fix unless the shared file truly requires it. If a change touches `web-ui/src/mobile/*`, `web-ui/src/styles/mobile.css`, `web-ui/manifest.webmanifest`, or `web-ui/service-worker.js`, also consult `16-mobile-app.md`.

## Sharp Edges

- `ChatPage.js` is very large and owns several surfaces at once. A chat fix can accidentally affect creative canvas, browser canvas, voice, approvals, or channel sessions. Search for the relevant `window.*` name and all DOM IDs before editing.
- `index.html` still contains both DOM markup and legacy inline behavior. A function may be defined in a module but invoked from inline HTML by global name.
- `app.js:setMode(...)` hides the main shell for non-chat modes and closes the right panel. If a page appears blank, check whether its `*-view` container is displayed and whether `main.main-shell` was intentionally hidden.
- Desktop sessions are no longer only local browser state. The canonical backend session APIs are `/api/sessions` and `/api/sessions/:id`; local `localStorage` is cache/compatibility state.
- Cross-surface streams have two paths: websocket/main-chat stream events and retained stream catch-up. Debug both before assuming the model/tool loop failed.
- Generated media previews should use `/api/canvas/inline?path=...` for browser playback, not download-style URLs.
- Account/auth/pairing logic is security-sensitive. Do not loosen gateway auth, pairing approval, OAuth credential handling, command approvals, or source-edit approvals as part of a UI cleanup.
- Mobile router and mobile CSS are present in the same bundle. Desktop fixes should not rely on `body.pm-mobile-active`; that class means the mobile shell has taken over.
