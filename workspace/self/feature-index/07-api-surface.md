# Gateway API Surface Map

Last source verification: 2026-07-22. This is a route-family map for internal product documentation and integration planning. It is **not** a stability promise, a complete parameter schema, or a public unauthenticated API specification.

## Route families

| Family | Responsibilities |
|---|---|
| Chat and sessions | Gateway status, stream/non-stream chat, steering, sessions/history/search/rename/delete, edit-rerun reset, model-route override, context-window data, main-goal actions, thread supervision, push subscription/status/test |
| Mobile chat and commands | Mobile stream replay/runs/reconciliation, model/stop controls, screenshots, mobile read state; paired authorization supplied by mobile client |
| Voice/realtime | Voice status/voices/audio/TTS/STT; voice-agent context/narration/input/realtime bootstrap/calls/skills/workgroups; xAI realtime/vision; mobile interruption |
| Tasks/background/heartbeat | Background task list/detail/evidence/stream, message/pause/resume/restart/delete/join/error response, legacy/current background status, schedule task logs/memory, heartbeat config and per-agent tick/config |
| Teams/schedules/Brain | Teams CRUD/members/context/chat/dispatch/runs/events/workspace/change review; schedules CRUD/run/parse/context; Brain status/pulse cards/config/manual Thought/Dream runs |
| Agents/channels | Channel status/config/test/send test, Telegram personas/team rooms, agent CRUD/history/runs/chat/profile and workspace files, agent context/heartbeat/subagent config/spawn/dispatch |
| Memory/audit/projects/canvas | Memory graph/search/records/index operations, audit retrieval, project/canvas file upload/read/write/download/preview/open-path style operations |
| Settings/credentials/account | Settings families (provider/model/search/paths/features/session/security/hooks/heartbeat/bulk); credential status/audit; account login/status/refresh/logout; installed apps/system/lifecycle |
| Connections/MCP/webhooks/extensions | Connection catalog/state/setup, MCP management, webhook wake/agent/status, connector/extension-specific administration |
| Pairing/remote access | QR/certificate/claim/poll/pending/approve/deny/device admin/me; remote access and Tailscale/funnel status/control |
| Onboarding/migration | Tutorial/meet/replay/model health/migration preview/import/memory seed/confirmation flows |
| Proposals/source/development | Proposal list/detail/lifecycle/approval paths, development source edit and verification flows, process supervisor controls |

## Documentation rules

- Treat `/api/*` as gateway-internal/paired/operator API unless a release contract specifically exposes it.
- Route existence does not imply anonymous access: account auth, pairing admin checks, safe session parameters, credentials, feature settings, or approval policy can gate a request.
- Use route source and its request schema for exact verbs/fields. The family may span more than one router.
- Prefer tool documentation for an agent-facing capability; use this map when describing what the UI or a client integrates with.

## Source anchors

`src/gateway/routes/chat.router.ts`, `tasks.router.ts`, `teams.router.ts`, `channels.router.ts`, `pairing.router.ts`, `voice.router.ts`, `settings.router.ts`, `account.router.ts`, `onboarding.router.ts`, canvas/project/memory/audit/proposal/connection route modules, and `src/gateway/server-v2.ts`.
