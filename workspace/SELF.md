# SELF.md - Prometheus Self-Reference (Current)

Last verified against `src/` on: 2026-04-08
Workspace: `D:\Prometheus\workspace`
Project root: `D:\Prometheus`

This file is the high-level, source-verified architecture guide for the current runtime.
It replaces older notes that described proposal-only source editing or pre-refactor assumptions.

## 1) Core Identity

- Name: Prometheus
- Runtime stack: Node.js + TypeScript
- Main startup path in dev/runtime scripts: `tsx src/cli/index.ts`
- Gateway entry: `src/gateway/server-v2.ts`
- Build artifact path still exists (`dist/`), but source of truth is always `src/`
- Default gateway endpoint: `http://127.0.0.1:18789`

## 2) Ground Truth (What Is Actually Running)

- `server-v2.ts` wires singleton services, routers, lifecycle hooks, and startup delegation.
- Startup side effects are centralized in `src/gateway/core/startup.ts` via `runStartup(...)`.
- `chat.router.ts` owns the main chat loop, model/tool execution flow, plan gating, and `/api/chat` SSE endpoint.
- Session history, compaction, and rolling summary state are in `src/gateway/session.ts`.
- Prompt/context assembly is in `src/gateway/prompt-context.ts`.
- Tool definitions are split into 3 defs files and assembled by `src/gateway/tool-builder.ts`.

## 3) Current Gateway Layout

`src/gateway/` subdomains (current):

- `routes/` - HTTP routes (`chat`, `teams`, `tasks`, `settings`, `channels`, etc.)
- `core/` - app/server/startup orchestration
- `comms/` - Telegram bridge, WS broadcasting, message channel helpers
- `tasks/` - task store and background runner
- `teams/` - managed teams, coordinator, team dispatch runtime
- `tools/` - tool defs and category-activation system
- `scheduling/` - cron scheduler, heartbeat, schedule memory, self-improvement jobs
- `projects/` - project store and project context learning
- `skills-runtime/` - skills manager and skill turn-context injection
- `audit/` - audit materializer and logging support

## 4) Chat Runtime Flow (Main Path)

`/api/chat` in `chat.router.ts` does this:

1. Starts SSE stream + heartbeat events.
2. Applies rolling compaction attempt when threshold is hit.
3. Adds user message to session with deferred compaction/memory-flush controls.
4. If deferred compaction/memory flush is triggered, runs internal synthetic turns.
5. Calls `handleChat(...)` for the user turn.
6. Persists tool-log summary to the latest assistant message.
7. Writes assistant response and closes SSE stream.

Inside `handleChat(...)`:

- Loads API-safe history via `getHistoryForApiCall(sessionId, 10)`.
- Builds session toolset and applies mode/tool filtering.
- Builds personality context via `buildPersonalityContext(...)`.
- Composes system message + prior history + current user message.
- Runs tool loop, plan controls, and background spawn joins as needed.

## 5) Prompt and Memory Context Injection

Main prompt layers assembled at runtime:

- Base execution-mode system block (interactive/background/proposal/cron/heartbeat)
- Core system prompt policy text
- `[RECENT_TOOL_LOG]` block (if available)
- caller context (canvas/task/etc. when provided)
- browser active-session context (if browser already open)
- personality context from `buildPersonalityContext(...)`

`buildPersonalityContext(...)` includes:

- `USER.md` and `SOUL.md` memory (path depends on mode/profile)
- `[TOOLS]` dynamic menu/policy block driven by activated categories
- optional `[PROJECT_CONTEXT]` if session is mapped to a project
- intraday notes in interactive modes (selectively skipped in autonomous paths)
- skills turn context (skill hint + pinned skill directives)

## 6) Session, Compaction, and History Behavior

`session.ts` currently manages:

- Persistent per-session history files in `.prometheus/sessions/*.json`
- Deferred pre-compaction memory flush prompt
- Deferred compaction prompt
- Rolling context summary persistence (`latestContextSummary`)
- API history pruning and summary-prefixed history windows
- Transcript and compaction audit artifact output in workspace audit dirs

Important behavior:

- Rolling summary can be injected as synthetic assistant context before recent turns.
- Internal compaction/memory turns are recorded as synthetic transcript entries.
- History trim policy preserves raw auditability and prunes for API payload separately.

## 7) Tool Architecture (Current)

Tool assembly:

- `tool-builder.ts` builds the final tool list.
- Core + category-activated tools model is active.
- Categories: `browser`, `desktop`, `team_ops`, `scheduling`, `source_write`, `integrations`.
- MCP tools are injected dynamically as `mcp__<serverId>__<tool>`.
- Composite tools are injected from composite defs when available.

Tool definition split:

- `tools/defs/file-web-memory.ts`
- `tools/defs/agent-team-schedule.ts`
- `tools/defs/cis-system.ts`

## 8) Task Engine (Current)

Task status model includes:

- `queued`, `running`, `paused`, `stalled`, `needs_assistance`, `awaiting_user_input`, `complete`, `failed`, `waiting_subagent`

Background runner (`background-task-runner.ts`):

- Uses agent-driven `step_complete` progression.
- Detects stalls (tool-call threshold without step completion) and injects nudge guidance.
- Supports pause/resume. Legacy schedule-interruption helpers remain available, but normal scheduled jobs no longer globally pause every unrelated running task.
- Integrates with chat runtime through `task_` session IDs.

## 9) Team System (Current)

- `team-manager-runner.ts` is now a facade over coordinator behavior.
- `team-coordinator.ts` runs manager/coordinator loops and dispatch strategy.
- `team-dispatch-runtime.ts` is canonical for running team agents via full chat pipeline.
- `teams.router.ts` exposes team CRUD, dispatch, run/review controls, SSE events, and team workspace APIs.
- Team workspace isolation is active; dispatched runs are workspace-scoped.

## 10) Telegram and Channel Bridge

- `telegram-channel.ts` is the canonical Telegram command and callback handler.
- Command list text is built by `buildTelegramCommandsMessage(...)`.
- Inbound handling is in `handleIncomingMessage(...)`.
- `broadcaster.ts` handles WebSocket broadcast, model-busy guard, and Telegram-session linking (`linkTelegramSession` / `getLinkedSession`).

## 11) Project Context System

`projects/` currently provides:

- Persistent project metadata + session association
- Project-scoped `workspace/projects/<id>/CONTEXT.md`
- Project knowledge files under `workspace/projects/<id>/knowledge/`
- Context injection block via `buildProjectContextBlock(sessionId)`
- Heuristic project learning append flow via `project-learning.ts`

## 12) Providers and Config

Providers supported in `src/providers/factory.ts`:

- `ollama`, `llama_cpp`, `lm_studio`, `openai`, `openai_codex`, `anthropic`

Config is centralized in:

- `src/config/config.ts` (defaults, merge, env resolution, path migration)
- `src/config/config-schema.ts` (Zod validation)

Session defaults include rolling compaction settings under `config.session`.

## 13) Data and Log Locations

- Sessions: `.prometheus/sessions/*.json`
- Audit log stream: `.prometheus/audit-log.jsonl`
- Workspace transcript artifacts: `workspace/audit/chats/transcripts/`
- Workspace compaction artifacts: `workspace/audit/chats/compactions/`
- Daily notes: `workspace/memory/YYYY-MM-DD.md`
- Intraday notes: `workspace/memory/YYYY-MM-DD-intraday-notes.md`

## 14) Maintenance Rule For This File

If architecture changes, update this file only after reading the exact `src` files that implement the change. Do not rely on old notes or assumptions.
## 15) Memory Graph UI and Workspace File Indexing Update

Verified/updated on 2026-06-05.

- The Memory page graph was revamped from a flat 2D canvas into a bright 3D particle graph with `Galaxy`, `Sphere`, `Wave`, and `Tunnel` controls.
- Graph settings persist locally; current defaults are speed `35`, depth `740`, and glow `20`.
- Hover/select behavior remains active, and connected edges brighten around hovered/selected nodes.
- `Organize by type` groups same-color/type nodes while keeping the active 3D shape; `Separate` is a distinct separated-card layout mode and disables shape controls while active.
- Workspace files now enter the evidence index as `workspace_file` records under `workspace/files/...`.
- Root-level workspace files are prioritized first, followed by human-useful roots such as `downloads`, `uploads`, `generated`, `creative-projects`, `outputs`, `assets`, `entities`, `skills`, `Brain`, `memory`, `projects`, `proposals`, `tasks`, `teams`, `self`, and `.prometheus`.
- `workspace/audit` is excluded from workspace-file scanning because audit evidence is indexed through its own roots; dependency/build/cache folders are skipped.
- Text workspace files are chunked/search-indexed/embedded through the memory index path; binary or non-text files are represented as metadata-only records.
- Current workspace-file scanning still has a `12000` file cap. Long-term direction: add a dedicated workspace inventory/search layer so all files are browsable/searchable from Memory without rendering every file as a graph particle.

## 16) Gateway Runtime Process Isolation

Verified/updated on 2026-07-15.

- Memory evidence/operational/SQLite refresh and embedding backfill run in a recycled child through `src/gateway/process/runtime-worker-broker.ts`, preventing their temporary multi-gigabyte heap from becoming the gateway baseline.
- Provider/model calls made through `OllamaClient.chatWithThinking(...)` and `generateWithThinking(...)` now run in a bounded, heartbeating child-process pool under `src/gateway/turn-workers/`. The default is three workers with a 100-job queue; results travel through blob references.
- Finalization file-change summaries run their git/diff/stat/read work in a separate two-worker-by-default bounded pool under `src/gateway/turn-workers/`. Requests and results use blob references, each child defaults to a 384 MiB old-space cap, and an unavailable child omits optional change metadata instead of rescanning synchronously in the gateway.
- Stored-thread footprint calculation and tool-observation persistence run in separate bounded children. Oversized context snapshots degrade to an unavailable diagnostic, and observation failure or delay cannot fail a valid final; compact metadata may attach to the exact assistant message shortly after terminal publication.
- Session JSON commits use cooperative chunked serialization, asynchronous atomic write/fsync/rename, and per-session generation fences. Prompt/reference reads, project learning, auto-title work, and completion notifications no longer place large synchronous work on the terminal publication boundary.
- Top-level interactive/Goal/background/scheduled/team/Brain turns now receive a SQLite-WAL journal record at `<configDir>/runtime/turn-jobs.sqlite`. The journal owns per-session leases, fenced events/checkpoints/tool effects, resource leases, referenced finals, and stale-lease reconciliation; large content lives under `<configDir>/runtime/turn-blobs/`.
- Main-chat progress/final/done frames are exact-byte-bounded and blob-backed. Replay is capped at 12,000 frames and 16 MiB per session; slow SSE consumers cannot grow an unlimited write buffer or cancel the underlying work merely by disconnecting.
- Large model envelopes and final blobs serialize cooperatively and use asynchronous gzip/write/fsync; terminal/replay publication only reuses already-durable content references instead of performing a new large synchronous blob write.
- Session state and the durable final are persisted before terminal publication. Startup plus a bounded periodic pass marks a stranded `final_persisted` row complete only when it has zero delivery rows, preserving exact-client replay without rerunning the turn. Any explicit outbox row is left untouched; current chat delivery is still not executed/retried from that outbox after restart.
- `/api/health` exposes `memoryMaintenance` plus `turnRuntime` model/file-change/context/observation/session/retention worker and journal/lease-and-final recovery state, and lifecycle shutdown drains those workers and cooperative session persistence before closing the journal.
- The complete `handleChat(...)` orchestration/tool loop, prompts/sessions, tools, approvals, tasks, teams, and subagents remain gateway-owned. Model-heavy turns are process-isolated at the provider call, but this is not yet one OS process per complete turn or automatic checkpoint resume.
- Scheduled jobs now run independently instead of pausing all unrelated background work; real shared-resource contention is handled through existing locks and durable resource leases.
- Detailed current state and rollout gates: `workspace/self/30-runtime-process-isolation.md`.


