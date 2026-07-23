# Client Surface Inventory: Desktop and Mobile

Last source verification: 2026-07-22. This is the detailed companion to [03-desktop-web-ui.md](03-desktop-web-ui.md) and [04-mobile-app.md](04-mobile-app.md). It records what each shipped client screen actually exposes so a document can distinguish a page, its tabs, and its controls.

## Desktop page detail

| Desktop surface | Current data/actions exposed |
|---|---|
| **Chat** | Session/channel list and search; session creation, title/history/model-route/context-window management; streamed messages/tools/processes; attachments/uploads and file delivery; prompt queue; edit/rerun and variant controls; goal progress; active/pending approval, question, and proposal cards; side chats; browser canvas; projects/canvas files and previews; Creative scene/composition/media/template/HTML-motion/HyperFrames controls; voice STT/TTS/realtime/workgroup controls; Brain pulse cards; open-path/open-file and process output controls |
| **Tasks** | Background tasks, thread supervisions, task detail/evidence, live state, task-scoped approvals, message, pause, resume, restart, delete/join, and error-response/recovery controls |
| **Schedule** | Schedule list/create/edit/delete, natural-language parsing, enabled toggle, manual run, owner selection (main/subagent/team), model/skill/context configuration, jobs, and Brain Thought/Dream status/config/run controls |
| **Teams** | Team and agent inventory; create/update/delete; pause/resume/start/run-all/manager review/dispatch; team chat/history/stream; context references/files; member/manager profiles and heartbeat; workspace browsing/upload/read/write/delete; runs/events; proposed change apply/reject; task/approval visibility |
| **Subagents** | Agent/profile-pack inventory and install/preview; create/update/delete; agent task history/runs/recovery; persistent chat/voice; agent instructions/memory/workspace/attachments; skill/model/voice configuration; context references/files; heartbeat controls and approvals |
| **Proposals** | Status-filtered proposal queue, pending subset, inspect, approve/deny; Chat also provides inline proposal/approval handling in the originating thread |
| **Audit Log** | Paged/filterable audit log plus proposal context where it is relevant to a recorded run |
| **Memory Graph** | Interactive graph mounted through the memory client with selectable records, sources, summaries, relationships, graph controls and detail drawers |
| **Hub** | Goals, model/provider usage overview and limits, skills usage/review/run, token activity, tool heatmap/overview, operational cards and Brain-derived activity |
| **Projects side surface** | Project list/detail, project sessions, file list/content upload/download/edit/delete, and links into Chat canvas work; implemented as a sidebar/workspace surface rather than one of the nine routed modes |
| **Settings modal** | Provider OAuth/manual credential flows, models/agent templates, search/paths/session/security/hooks/heartbeat, channels, credentials audit, MCP servers/presets, extensions, migration/onboarding, pairing/device/Tailscale remote access, shortcuts, lifecycle/status, agents/teams/job administration |
| **Connections page** | MCP server lifecycle plus install/remove extension controls; connection-specific setup/status UI is added as configured integrations provide it |

## Mobile page detail

| Mobile screen | Current data/actions exposed |
|---|---|
| **Pair** | Device pairing claim and paired-client startup; gateway-side pending approval/device management remains an administrative surface |
| **Chat** | Session drawer/search/new chat, persistent thread/history, attachments, streaming response and tool/progress cards, main-goal pill, pending approvals, stop/interruption/reconciliation behavior, background-spawn dock, voice handoff and typed composer |
| **Voice** | Voice target and runtime controls, dictation/realtime lifecycle, interruption, camera/visual context staging, and routing back to chat; actual capabilities are browser/device/provider conditioned |
| **Schedule** | Cached/revalidated schedule cards, create entry point, enabled/paused toggle, manual run, and per-schedule editor expansion |
| **Teams overview** | Team count/grid, refresh, featured-team preview (members/workspace/progress), and navigation to team detail |
| **Team detail** | Start, pause/resume, review, delete; **Context** purpose/current task/member states/dispatches/context cards/workspace preview; **Subagents**, **Workspace**, **Memory**, **Runs**, and live **Team Chat** tabs |
| **Tasks** | Task counts and status filters, expandable task detail, recent activity/tool/progress views, and task-oriented navigation/recovery state |
| **Hub** | Mobile operational/usage hub; `more/hub` redirects here. The `creative` alias currently also resolves here rather than to the dormant Creative renderer |
| **More** | Profile/summary landing plus **Audit** and **Memory** subviews; Memory mounts the graph client within a mobile wrapper |
| **Proposals** | Status filter (pending, in-progress, approved, denied, executed, all), refresh, fast approval cards, proposal review, technical/evidence/plan detail and approve/deny workflow |
| **Subagents overview** | Agent count/grid/refresh, featured-agent preview with model/team/tool/last-run data |
| **Subagent detail** | Dispatch task, heartbeat tick, chat; **Overview** description/model/last run/allowed tools/MCP servers/model and voice pickers/context references; **Memory**, **Runs**, **Heartbeat**, and locked full-screen **Chat** routes |
| **Settings** | The mobile router renders Chat behind the shared desktop Settings modal and opens its selected tab full-screen; it is not a separate settings codebase |
| **Creative renderer (unexposed)** | Image/video modes, provider/aspect/template/preset selection, uploads, layer extraction, generation composer and output gallery exist in `renderCreativePage`; no current router case dispatches it |

## Client-wide interaction model

- Desktop and mobile use live gateway events where a stream is active; several mobile list surfaces first paint cached data and revalidate.
- Mobile team/subagent chat uses dedicated stream/replay paths and cleans up subscriptions when navigating away.
- Header settings opens the same settings configuration system in both clients.
- Approval, credential, provider, connected-app, desktop automation, browser control, and remote-access controls remain conditional on authorization/configuration even when a UI card can display their status.

## Source anchors

Desktop: `web-ui/src/app.js`, `web-ui/src/pages/*.js`, `web-ui/src/components/`. Mobile: `web-ui/src/mobile/mobile-router.js`, `mobile-shell.js`, `mobile-pages.js`, `mobile-api.js`. Corresponding gateway data families are in `src/gateway/routes/`.
