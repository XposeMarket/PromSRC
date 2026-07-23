# Desktop Web UI Reference

Last source verification: 2026-07-22. Routing owner: `web-ui/src/app.js`; page modules: `web-ui/src/pages/`.

## Shared application shell

The desktop UI has a collapsible/resizable sidebar, page navigation, a page title/subtitle, a shared right panel, theme selection, session/channel/project side panels, notifications/toasts, a global Settings modal, and WebSocket-driven live updates. Chat is the primary workspace; non-chat page modes replace the main view while retaining the application shell.

## Every routed desktop page

| Page mode | Purpose | What is on it |
|---|---|---|
| **Chat** | Foreground operational conversation | Persistent sessions and channel labels; message streaming; file/image attachments; prompt queueing; model/context indicators; edit/rerun and variants; side chats; goal strip/checklist; tool/process trace cards; approval cards; artifacts; voice controls; browser/canvas/creative right-panel workspaces; canvas project links; search and session controls |
| **Tasks** (`bgtasks`) | Background task queue | Background task list/detail, status/progress/evidence/stream/logs, task messaging, pause/resume/restart/delete/join/recovery/error-response controls, and reusable-workflow skill proposal path |
| **Schedule** | Recurring and one-off automation | Schedule list and editor; natural-language parse; ownership by Prometheus, subagent, or team; run-now, pause/resume/delete; run log/memory/context references; skill attachments and automation state |
| **Teams** | Managed multi-agent workspaces | Team cards/configuration, member management, manager purpose/context/model/review trigger, dispatch and run-all, team chat and stream, team events/runs, workspace/context files, proposed changes with apply/reject, pause/resume and room state |
| **Subagents** | Persistent individual agents | Agent inventory/create/edit/delete, identity/profile files, model and skill assignment, contexts/files, individual chat with streaming/voice, task-run history and recovery, notes/memory, heartbeat and schedule state, workspace previews |
| **Proposals** | Controlled pending changes | Proposal queue/detail, inspect/change scope, approve/reject and session/always approval flows, proposal editing and lifecycle status |
| **Audit Log** | Non-main-agent operational history | Filterable/paginated audit records, agent/run/event details and inspection of operational provenance |
| **Memory Graph** | Durable knowledge exploration | Interactive graph with pan/zoom and record/hub selection; record reads, related/timeline/project search, memory status and evidence/claim-oriented views |
| **Hub** | Operational overview and capability discovery | Skill usage and suggestions, achievements/tool activity, Brain pulse cards and Thought/Dream activity, provider usage cards and summary-style operational cards |

## Chat: the composite workstation

Chat is more than a transcript. Depending on the request, it can expose:

- an in-app browser canvas with agent, co-pilot, and teach lanes; snapshot/vision state; restore-last-page and browser controls;
- a file/canvas project workspace and previews;
- a Creative editor/workspace with generation, render status, asset and timeline controls;
- inline approvals, goal/progress, tool logs, process cards, background-lane state, artifact cards, image outputs, data visualizations, and file delivery pills;
- voice preview/voice-agent integration and mobile-aware session delivery;
- linked side chats that preserve a selected parent/project context but explicitly do not inherit active parent execution.

## Settings and Connections

Settings is a shared modal, available from desktop and reused full-screen by mobile. Its source-backed configuration families include provider credentials/auth, model/current-model and agent-model templates, search, workspace paths, session/default settings, feature flags, security and command approvals, hooks with test action, heartbeat, credentials/audit, installed app aliases, system stats, lifecycle restart, pairing/remote access, and channel-adjacent settings.

The separate Connections page presents the configured connection catalog and auth/setup flows, including MCP/connector administration and connection-specific states such as Obsidian/X/xAI where available. It must be described as “connections management,” not as a guarantee that a third-party account is already attached.

## Desktop-specific controls and boundaries

- `Ctrl/Cmd`-style keyboard behavior and page/module lifecycle are owned by the client modules; use `../17-desktop-web-ui.md` when documenting a specific shortcut.
- Theme, sidebar dimensions/collapse, recent session state, side-chat links, and browser restoration use browser-side persistence; gateway records are authoritative for server sessions/history.
- The app is intentionally cautious with untrusted HTML/content: renderers, browser output, files, URLs, and connector data cross an untrusted-content boundary.
- Electron supplies the desktop shell, while desktop computer-use capability comes from configured/native helper paths. Installing the desktop app does not itself promise every host-automation tool.

## Useful source anchors

`web-ui/index.html`, `web-ui/src/app.js`, `web-ui/src/pages/ChatPage.js`, `TasksPage.js`, `SchedulePage.js`, `TeamsPage.js`, `SubagentsPage.js`, `ProposalsPage.js`, `AuditPage.js`, `MemoryPage.js`, `HubPage.js`, `SettingsPage.js`, `ConnectionsPage.js`, and `../17-desktop-web-ui.md`.

For the control-by-control interpretation of every page, use the [page-by-page reference](pages/README.md).
