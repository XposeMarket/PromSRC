# Prometheus Runtime and Architecture Reference

Last source verification: 2026-07-22.

## Runtime structure

Prometheus is gateway-centered. Clients send work to the gateway; the gateway assembles a role- and mode-aware context, selects tools/providers, coordinates execution, persists session/operational state, streams events, and hands results back to desktop/mobile/channels. The runtime separates interactive chat from independent task and agent lanes rather than treating all execution as one blocking request.

```text
Desktop UI / Electron ─┐
Mobile PWA / paired device ─┼─> Gateway routes + auth ─> session/turn runtime
CLI / channels / webhooks ──┘                              ├─ provider + tool builder
                                                           ├─ browser / desktop / media / workspace executors
                                                           ├─ background tasks / subagents / teams / schedules
                                                           ├─ memory / Brain / skills / audit / evidence
                                                           └─ WebSocket, SSE, push, and channel delivery
```

## Turn lifecycle

1. An interactive, mobile, channel, scheduled, voice, background, subagent, or team entry point creates/routs a turn.
2. The runtime chooses the execution mode and caller overlay, then builds context from identity/persona, workspace memory, session/history, model capability, skill hints/active skills, applicable browser state, tool observations, and role-specific rules.
3. The tool builder exposes core tools plus only relevant requested categories, configured connectors/MCP tools, and saved composites.
4. The selected model streams output and tool requests. The gateway executes tools, injects bounded observations, tracks progress/goals/approvals/evidence, and broadcasts live events.
5. A final result is persisted/delivered to the originating surface. Long-running work can transition to an independent task, agent run, schedule, timer, heartbeat, or watch-driven continuation.

The exact prompt/injection map is deliberately detailed in `../21-runtime-prompt-map.md`, `../22-runtime-prompt-verbatim.md`, `../23-runtime-context-flow.md`, and `../26-runtime-instruction-census.md`.

## Runtime roles and execution lanes

| Lane | Role |
|---|---|
| Main interactive worker | Foreground user conversation, plans/goals, approvals, tool use, final delivery |
| Side chat | Explicitly bounded branch from a parent conversation; no implicit carry-over of active operations |
| Background task | Independent task with its own status, journal/evidence/stream and lifecycle controls; parent can join or message it |
| Standalone subagent | Persistent configured agent with files, memory, model/skills, chat, runs, schedules and heartbeat |
| Managed team | Team manager plus member agents, coordination/chat/event stream, dispatch, context/workspace and review/change flows |
| Scheduled job | Recurring or one-shot automation owned by Prometheus, a subagent, or a team |
| Timer | One future user-like message in its originating main chat; separate from recurring schedules |
| Heartbeat | Per-agent continuation policy and instructions; distinct from a regular cron schedule |
| Internal watch | Bounded condition watch that wakes/alerts an existing chat after a match or timeout |
| Voice/realtime | Dedicated voice-agent and realtime routing paths, including mobile visual context |
| Brain Thought/Dream | Internal reflection/curation loops for pulse cards, evidence, skill evolution and proposal-gated prompt mutation |

## Data and persistence model

- **Workspace files** hold identity, user/business context, operational memory, skills, entities, events, generated/downloaded assets, and agent/team workspaces.
- **Sessions/history** preserve conversations and channel identities; local client caches accelerate navigation but server state is authoritative.
- **Memory** is file-backed and indexed, with graph/timeline/related-record/search and claim-review layers.
- **Audit/evidence/journal** record tool/agent/background activity, supporting inspection and recovery rather than opaque execution.
- **Configuration and credential systems** determine providers, models, tools, integrations, security, pairing, paths, feature flags and lifecycle defaults.
- **Brain artifacts** live under `workspace/Brain/` for Thought/Dream/pulse/curator state.

## Process isolation and reliability

The current gateway design isolates memory-index maintenance, provider/model calls, finalization scans, context diagnostics, tool-observation persistence, and related retained outputs from the primary gateway process where practical. It uses durable turn journals, bounded blob-backed delivery/retention, liveness/recovery mechanisms and gateway-owned workers. This is an implementation reliability property, not a guarantee that a task can never fail; task/agent recovery surfaces remain part of the user product.

## Authentication and configuration structure

Gateway/account authentication protects routes. Mobile uses paired-device tokens and an approval flow. Provider/model credentials are managed through settings/vault-oriented paths. Connections can register MCP/connector states. Command permissions, approvals, security settings, pairing/remote access, heartbeat, hooks, and lifecycle configuration are explicit operator surfaces.

## Release/runtime surfaces

Prometheus can run as a local gateway/web UI, Electron desktop package, paired mobile PWA client, CLI, and configured channel/webhook integration. Public packaging, generated UI synchronization, installer/runtime dependencies, self-update, self-repair and deployment helpers are maintained separately from normal end-user task execution. See `../18-public-release.md` and `../public-runtime-release/`.

## Source references

`../02-startup-runtime.md`, `../03-execution-and-prompting.md`, `../08-tasks-and-agents.md`, `../11-run-and-supervisor.md`, `../12-telegram-and-brain.md`, `../13-memory.md`, `../21-runtime-prompt-map.md`–`../23-runtime-context-flow.md`, `../29-agent-identity-and-memory-runtime.md`, and `../30-runtime-process-isolation.md`.
