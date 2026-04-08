# SELF.md — Prometheus Architecture & Self-Reference Guide

Read this whenever you need to: create a proposal having to due with source code edits, diagnose an error, plan a change to your own codebase, create agents or teams, manage schedules, understand how any subsystem works, or reason about your own capabilities.

> **NAVIGATION TIP:** `D:\Prometheus\Context.md` is a pinpoint-indexed map of the entire codebase with exact file:line references for every major system (session, compaction, task runner, team dispatch, prompt injection, progress panel, Telegram, etc.). Read it first when you need to find something specific fast.

Last updated: March 27, 2026 | Prometheus v2 — Post-Refactor (Cloud-Based)

---

## Session Sync — March 27, 2026

This section summarizes the runtime/tooling cleanup completed in this session so architecture docs match real behavior:

- Removed legacy persona file dependencies from runtime and tooling:
  - `IDENTITY.md` references removed from prompt/bootstrap/persona tool paths.
  - `ROUTING.md` bootstrap/injection/sync paths removed.
  - `MEMORY.md` and `facts.md` markdown-memory references removed.
- Canonical memory model is now:
  - `USER.md` + `SOUL.md` category memory via `memory_browse`, `memory_read`, `memory_write(file, category, content)` in `subagent-executor.ts`.
  - Daily operational notes continue in `workspace/memory/YYYY-MM-DD*.md`.
  - Typed fact storage for system memory flows remains `facts.json` (fact store), not markdown files.
- Legacy memory tool stack removed from `src/tools`:
  - Deleted legacy `memory.ts`, `memory-read.ts`, `memory-file-search.ts`.
  - Tool registry no longer registers that stack.
  - Memory manager no longer depends on legacy `executeMemoryWrite`.
- Team/background identity sync now mirrors active runtime files only:
  - `system_prompt.md`, `AGENTS.md`, `HEARTBEAT.md`, `TOOLS.md`.
  - No `IDENTITY.md` / `ROUTING.md` copy paths.

---

## Identity & Runtime

- **Name:** Prometheus — "Everything AI" autonomous 24/7 assistant (Jarvis-style)
- **Project root:** `D:\Prometheus\`
- **Runtime:** Node.js 20 + TypeScript, compiled `src/` → `dist/` via `npm run build`
- **Entry point:** `dist/cli/index.js` → launches `src/gateway/server-v2.ts`
- **Web UI:** `http://127.0.0.1:18789` (Express + WebSocket + SSE)
- **Config dir:** `D:\Prometheus\.prometheus\`
- **Workspace:** `D:\Prometheus\workspace\`
- **Platform:** Windows primary; cloud-based deployment (not local-only anymore)
- **Memory system:** SOUL.md (AI identity), USER.md (user facts), SELF.md (architecture)
- **Daily memory:** Intraday notes in `workspace/memory/YYYY-MM-DD.md`
- **Weekly self-improvement:** Structured performance reviews with behavior changelog

---

## ⚠️ SRC CHANGE PROTOCOL - - - - - How to create a proposal for source code edits. 

DO NOT CREATE ANY SRC PROPOSALS WITHOUT READING THE EXACT SRC FILES RELATED TO THE CHANGES - ENSURE YOU PUT THE EXACT LINES AND FILES TO BE CHANGED IN THE PROPOSAL PLANS AND DETAILS

**You cannot edit `src/` directly via normal file tools.** Source changes go through a proposal system with human approval.

### The correct workflow for any src/ change:

1. **Research first** — Use `grep_source(pattern)` to find relevant code, `read_source(file)` to read it, `list_source(dir)` to browse. These are the only tools that reach `src/`.
2. **Write a full implementation plan** — Which files, exact lines/functions, what it does, risks
3. **Submit via `write_proposal`** — type: "src_edit", include affected_files, executor_prompt
4. **Human approves** in Settings → Proposals → `code_executor` applies the change and runs build

Alternatively, `find_replace_source` and `replace_lines_source` can edit `src/` directly (for simpler changes the user explicitly requests).

---

## Build System

```
npm run build           → tsc: src/ → dist/
npm start               → node dist/cli/index.js
start-prometheus.bat    → npm run build && npm start
```

**Golden rule:** Always edit `src/`. Never touch `dist/`.

---

## Gateway Architecture (Post-Refactor)

The gateway was refactored from a monolithic `server-v2.ts` into a modular architecture:

### Entry Point
`server-v2.ts` (~30KB) is a **thin entry point**: config init, singleton setup (skillsManager, cronScheduler, telegramChannel, heartbeatRunner), router injection, server listen, graceful shutdown. No route handlers or handleChat.

### Core (`gateway/core/`)
- `core/app.ts` — Express app + middleware
- `core/server.ts` — HTTP + WebSocket server creation
- `core/startup.ts` — Post-listen wiring: scheduler, Telegram, agent schedules, heartbeat, self-repair hooks

### Chat Pipeline (`gateway/chat/`)
- `chat/chat-helpers.ts` (~39KB) — ~24 helpers: buildCronAgentPrompt, runCronAgentChat, getCanvasContextBlock, buildProgressItems, checkLoopDetection, etc.
- `chat/chat-state.ts` — Shared mutable state singletons

### Route Files (`gateway/routes/`)
- `chat.router.ts` (~178KB) — handleChat() + POST /api/chat (SSE) + GET /api/status
- `teams.router.ts` (~45KB) — Team CRUD, chat, dispatch, notifications
- `tasks.router.ts` (~36KB) — Background task engine, CRUD, execution
- `channels.router.ts` (~33KB) — Telegram channel, dispatch-to-agent
- `settings.router.ts` (~26KB) — Config management, model settings, agent config
- `canvas.router.ts` (~17KB) — Canvas file bridge, upload/download, preview, SSE events; images returned as `{ isImage, base64, mimeType }` so canvas renders them directly
- `projects.router.ts` — Projects REST API (see Projects System section below)
- `goals.router.ts` (~13KB) — Goal decomposition and management
- `skills.router.ts` (~11KB) — Skills CRUD, playbook injection, trigger matching
- `connections.router.ts` (~9KB) — CIS connectors: OAuth, browser-login
- `proposals.router.ts` (~7KB) — Proposal submission, approval flow
- `approvals.router.ts` (~3KB) — Approval resolution
- `audit-log.router.ts` (~1.4KB) — Audit log queries
- `canvas-state.ts` (~1.4KB) — Canvas session state singleton

### Communication Layer (`gateway/comms/`)
- `telegram-channel.ts` — Full Telegram bot: long polling, inline keyboards, file browser, team/agent/task/schedule management, proposals, repairs. Supports **session bridging** — Telegram replies route through the same session that sent the outbound message, enabling seamless web↔Telegram conversation continuity.
- `broadcaster.ts` — WebSocket broadcast, model-busy guard, team SSE registry, notification senders (Telegram, Discord, WhatsApp), **Telegram↔Session bridge** (linkTelegramSession/getLinkedSession)
- `reply-processor.ts` — Post-processing on AI responses
- `webhook-handler.ts` — Inbound webhook processing

### Telegram Command Registry (Canonical)
- Canonical parser/build location: `src/gateway/comms/telegram-channel.ts` → `handleIncomingMessage(...)`
- Canonical interactive callback handlers:
  - `handleTeamCallback` (`tm:*`)
  - `handleAgentsCallback` (`ag:*`)
  - `handleBgTasksCallback` (`bg:*`)
  - `handleScheduleCallback` (`sc:*`)
  - `handleModelCallback` (`md:*`)
  - Proposal callbacks (`pr:*`) and repair callbacks (`rp:*`)
- Runtime registry source of truth: `TELEGRAM_COMMAND_REGISTRY` constant in `telegram-channel.ts`

| Command | What it does | Built in | References |
|---|---|---|---|
| `/start` | onboarding + command overview | `handleIncomingMessage` | help text block |
| `/commands` | prints full command registry | `handleIncomingMessage` | `TELEGRAM_COMMAND_REGISTRY` |
| `/status` | bot/model status + Telegram user ID | `handleIncomingMessage` | `deps.getIsModelBusy`, `botInfo` |
| `/new` | starts fresh Telegram-linked thread | `handleIncomingMessage` | session bridge + broadcast |
| `/clear` | clears Telegram + linked session history | `handleIncomingMessage` | `session.clearHistory`, bridge unlink |
| `/cancel` | cancels pending one-shot chat mode | `handleIncomingMessage` | `pendingChat` |
| `/browse [path]` | opens file browser | `handleIncomingMessage` | `buildDirectoryKeyboard`, `sendBrowserView`, `fb:*` |
| `/download <path>` | sends workspace file document | `handleIncomingMessage` | `resolveWorkspacePath`, Telegram `sendDocument` |
| `/teams` | teams browser/manager/agent actions | `handleIncomingMessage` | `handleTeamCallback`, `tm:*` |
| `/agents` | agent browse/dispatch/prompt/model edit | `handleIncomingMessage` | `handleAgentsCallback`, `ag:*` |
| `/tasks` | task list + chat/resume/pause/cancel/delete | `handleIncomingMessage` | `handleBgTasksCallback`, `bg:*`, task store/runner |
| `/schedule` | schedules list + run/edit/delete | `handleIncomingMessage` | `handleScheduleCallback`, `sc:*`, schedule memory |
| `/model` | provider/model picker | `handleIncomingMessage` | `handleModelCallback`, `md:*`, `/api/settings/model` |
| `/proposals` | lists pending proposals | `handleIncomingMessage` | proposal store + `pr:*` |
| `/proposals <id\|pending\|done>` | proposal details or filtered list | `handleIncomingMessage` | proposal store + `pr:*` + proposals router dispatch |
| `/repairs` | lists pending repairs | `handleIncomingMessage` | `tools/self-repair` |
| `/repair <id>` | shows repair details | `handleIncomingMessage` | `tools/self-repair` formatter |
| `/approve <repair-id>` | applies pending repair | `handleIncomingMessage` | `applyApprovedRepair`, `rp:*` |
| `/reject <repair-id>` | discards pending repair | `handleIncomingMessage` | `deletePendingRepair`, `rp:*` |
| `/mcp-status` | shows MCP server status from config | `handleIncomingMessage` | `mcp-servers.json` |
| `/integrations` | shows integration state summary | `handleIncomingMessage` | `integrations-state.json` |
| `/setup <service>` | guided integration setup flow | `handleIncomingMessage` | `handleChat` integration-setup flow |
| `/approve_goal <id>` | approves goal decomposition | `handleIncomingMessage` | goal decomposer + broadcast hook |
| `/reject_goal <id>` | rejects/archives goal | `handleIncomingMessage` | goal decomposer |
| `/approve_skill <id>` | approves skill evolution | `handleIncomingMessage` | self-improvement engine |
| `/perf` | latest performance report | `handleIncomingMessage` | self-improvement engine |
| `/performance` | alias for `/perf` | `handleIncomingMessage` | same perf handler |

Notes:
- Duplicate alias `/schedules` has been removed. `/schedule` is the only schedule command.
- Command index is now injected into Telegram caller context each turn so the model can reason about command capabilities.

### Agent Runtime (`gateway/agents-runtime/`)
- `subagent-executor.ts` — Tool execution engine: ~80 tool cases. Handles all tool dispatch including file ops, browser/desktop automation, agent spawning, team management, scheduling, memory, skills, and more.
- `subagent-manager.ts` — SubagentManager for parallel agent orchestration
- `agent-builder-integration.ts` — n8n-style workflow integration

### Other key source files
- `gateway/prompt-context.ts` — buildPersonalityContext(): injects SOUL/USER context, tool-category guidance, and optional debug/project context per turn
- `gateway/session.ts` — Session management: history, compaction, memory flush, persistence
- `gateway/boot.ts` — BOOT.md startup sequence
- `gateway/browser-tools.ts` — Browser automation via Playwright CDP. Tools: open/snapshot/click/fill/key/wait/scroll/scroll_collect/close/get_focused_item/get_page_text/vision_screenshot/vision_click/vision_type/send_to_telegram + **new power tools:** `browser_run_js` (arbitrary JS in page context), `browser_intercept_network` (XHR/fetch capture), `browser_element_watch` (wait for DOM condition, no-polling), `browser_snapshot_delta` (only changed elements — 60–80% token reduction on SPAs), `browser_extract_structured` (CSS-schema JSON extraction). Env: `CHROME_USE_REAL_PROFILE=true` uses the user's real Chrome profile for pre-existing logins.
- `gateway/desktop-tools.ts` — Desktop automation via PowerShell Win32. Tools: screenshot/find/focus/click/drag/type/type_raw/key/scroll/clipboard/launch/close/process_list/wait_for_change/diff/get_window_text/vision_act/send_to_telegram + **new power tools:** `desktop_get_accessibility_tree` (full UI Automation tree with roles/names/states/bounds), `desktop_pixel_watch` (wait for pixel color change — 100× cheaper than screenshot polling), `desktop_record_macro`/`desktop_stop_macro`/`desktop_replay_macro`/`desktop_list_macros` (record → save → replay click/type/key/scroll sequences with timing).
- `gateway/tool-builder.ts` — buildTools(): thin assembler (~282 lines). Tool definitions split into:
  - `gateway/tools/defs/file-web-memory.ts` — list_files, read_file, web_search, memory_write, grep_source, grep_files, etc. (23 tools)
  - `gateway/tools/defs/agent-team-schedule.ts` — spawn_subagent, team_manage, schedule_job, etc. (18 tools)
  - `gateway/tools/defs/cis-system.ts` — deploy_analysis_team, social_intel, write_proposal, gateway_restart, etc. (11 tools)
- `gateway/mcp-manager.ts` — MCP client connections and tool proxying
- `gateway/skills-runtime/skills-manager.ts` — Skill discovery, playbook loading, trigger matching
- `gateway/scheduling/cron-scheduler.ts` — Cron job engine
- `gateway/scheduling/self-improvement-engine.ts` — Weekly performance reviews, skill evolution
- `gateway/scheduling/prompt-mutation.ts` — Post-run prompt optimization
- `gateway/scheduling/schedule-memory.ts` — Per-schedule run log and memory
- `gateway/teams/managed-teams.ts` — ManagedTeam data layer (.prometheus/managed-teams.json)
- `gateway/teams/team-manager-runner.ts` — Manager review loop, manager conversation handler
- `gateway/teams/team-dispatch-runtime.ts` — Team dispatch task builder
- `gateway/teams/team-detector.ts` — Auto-suggests team creation from conversation context
- `gateway/proposals/proposal-store.ts` — Proposal persistence and lifecycle
- `gateway/errors/error-watchdog.ts` — Failure analysis and self-repair triggers
- `gateway/goal-decomposer.ts` — Goal decomposition with approval workflow
- `gateway/conversation-learning.ts` — Post-session business fact extractor → BUSINESS.md and entities/ (**wired**: fires on compaction trigger)
- `gateway/projects/project-store.ts` — Projects data layer: CRUD, session registration, knowledge files, `buildProjectContextBlock()` context injector, `findProjectBySessionId()`
- `gateway/projects/project-learning.ts` — Project-specific fact extractor → CONTEXT.md (**wired**: fires fire-and-forget after every assistant reply in a project session)
- `gateway/teams/notify-bridge.ts` — Team→chat event queue (**wired**: live push via broadcastWS on every `notifyMainAgent` call — events arrive instantly without user prompting. Also drained as fallback on every handleChat response.)
- `gateway/policy.ts` — Policy engine: evaluates every subagent tool call by tier (read/propose/commit) (**wired**: audit log on every tool call in subagent-executor)
- `tools/deploy-analysis-team.ts` — One-shot website analysis team; tool: `deploy_analysis_team` (**wired**: registered + deps injected at boot)
- `tools/social-scraper.ts` — Social media intelligence; tool: `social_intel` (**wired**: registered + deps injected at boot)
- `orchestration/multi-agent.ts` — Multi-agent orchestration: preflight routing, rescue/file-analyzer secondary calls, file-op classifier & formatters (browser/desktop automation is **primary-executed**; dedicated secondary browser/desktop advisor calls removed)
- `orchestration/file-op-v2.ts` — File operation progress watchdog, verification pipeline
- `tools/web.ts` — web_search and web_fetch implementations

---

## Projects System

Projects give Prometheus a persistent, scoped workspace per engagement — goals, people, files, and context that survives across every chat session within the project.

### Storage layout
```
.prometheus/
  projects/<id>.json            ← project metadata (name, instructions, memorySnapshot, sessions[], knowledge[])

workspace/
  projects/<id>/
    CONTEXT.md                  ← living context file: auto-updated every session
    knowledge/                  ← uploaded knowledge files (PDFs, docs, text, images)
```

### How context injection works
`buildProjectContextBlock(sessionId)` in `project-store.ts` is called from `buildPersonalityContext()` in all 3 context tiers (Tier 1, Tier 2/3, autonomous). It:
1. Resolves which project owns the session via `findProjectBySessionId()` (scans `.prometheus/projects/*.json`)
2. Injects: project name, custom instructions, memory snapshot, CONTEXT.md content (up to 2000 chars), knowledge file listing with absolute paths
3. Prepends a **mandatory CONTEXT.md writing rule** at the very top via `lines.unshift()`: Prometheus must call `create_file` or `find_replace` on CONTEXT.md after every turn where the user shares project information
4. On first session: adds extra instruction telling Prometheus this is a new project and to ask what it's about

### How CONTEXT.md stays updated — two layers
1. **AI layer (inline):** The mandatory rule in the system context instructs Prometheus to update CONTEXT.md in the same turn the user shares information. It has the exact absolute path.
2. **System layer (guaranteed):** `extractAndWriteProjectContext()` in `project-learning.ts` fires fire-and-forget after every assistant reply — pure heuristic regex scan of user messages, appends facts to Goals / Key People & Entities / Tech Stack & Tools / Timeline & Milestones sections. No LLM call.

### Project onboarding flow
When a new project is created and its first session opened:
1. Frontend calls `POST /api/projects/:id/sessions` → backend registers session via `addSessionToProject()`, returns `{ sessionId }`
2. Frontend inserts session into `window.chatSessions` and calls `openSession(sessionId)` — fresh empty chat
3. Frontend calls `sendChat('__project_onboarding_start__')` after 800ms
4. Backend intercepts `__project_onboarding_start__` in `chat.router.ts`: strips it from session history immediately, replaces `effectiveMessage` with a rich system prompt telling Prometheus to greet and ask about the project
5. `buildProjectContextBlock()` simultaneously injects the project context + mandatory CONTEXT.md rule + first-session instruction
6. Frontend MutationObserver strips the trigger bubble from the DOM and `window.chatHistory` before it persists

### API endpoints (`projects.router.ts`)
```
GET    /api/projects
POST   /api/projects                    { name }
GET    /api/projects/:id
PATCH  /api/projects/:id                { name?, instructions?, memorySnapshot? }
DELETE /api/projects/:id
POST   /api/projects/:id/sessions       { isOnboarding? } → { sessionId }
DELETE /api/projects/:id/sessions/:sessionId
GET    /api/projects/:id/files
POST   /api/projects/:id/files          { filename, content } or { filename, base64, mimeType }
GET    /api/projects/:id/files/:fileId/content
DELETE /api/projects/:id/files/:fileId
```

### Project session IDs
Project sessions are regular UUID sessions in `.prometheus/sessions/<id>.json`. The project record tracks which IDs belong to it. `findProjectBySessionId()` resolves ownership by scanning all project JSON files. Import paths must NOT use `.js` extension — use `from './project-store'` not `from './project-store.js'`.

### Important constraints
- Project sessions **never appear** in the main Sessions sidebar — only inside the project card in the Projects tab
- `__project_onboarding_start__` is stripped from `session.history` before `handleChat` runs — never persisted to disk
- `CONTEXT.md` is seeded with section headers on project creation; placeholder text auto-removed by `project-learning.ts` once real content is written
- Knowledge files listed in context include absolute paths — Prometheus can `read_file` them directly without path resolution
- `extractAndWriteProjectContext` logs `[ProjectLearning] Scanning session...` when it fires; if this never appears, check that the session ID is registered in the project JSON

---

## Session System

Sessions persist conversation history and are identified by string IDs. Key patterns:
- **Web UI sessions:** UUID like `f4659897-3964-4b1c-ab4e-540c0e755452`
- **Telegram sessions:** `telegram_{userId}` (or bridged to a web session — see below)
- **Task sessions:** `task_{taskId}`
- **Cron sessions:** `cron_{jobId}`
- **Team dispatch:** `team_dispatch_{agentId}_{timestamp}`

### Telegram↔Web Session Bridge
When the AI sends an outbound Telegram message from any session (web UI, cron, task), the bridge maps that Telegram user to the originating session. Subsequent Telegram replies route through the same session, enabling seamless conversation continuity between web UI and Telegram. The link updates whenever `send_telegram` fires from a new session. A new web chat that sends a Telegram message re-links to the new session. Users can `/clear` to reset both sessions and the bridge.

### Session lifecycle
- History is capped by `maxMessages` (default 120)
- Token-based compaction triggers at 70% of context window
- Memory flush triggers at 75% — prompts the AI to save facts before context is lost
- Sessions auto-saved to `.prometheus/sessions/{id}.json`
- Task/cron sessions cleaned up after 7 days

---

## Creating Agents, Teams & Schedules

### Creating a new subagent
```
spawn_subagent({
  subagent_id: "my_agent_id",
  run_now: false,
  create_if_missing: {
    name: "Agent Display Name",
    description: "What this agent does",
    model: "",
    maxSteps: 15,
    system_instructions: "Full system prompt...",
    heartbeat_instructions: "What to do on each heartbeat tick..."
  }
})
```

### Creating a new team
```
team_manage({
  action: "create",
  name: "Team Name",
  team_context: "Full context...",
  subagent_ids: ["agent_1", "agent_2"],
  review_trigger: "after_each_run",
  manager_system_prompt: "Optional custom manager prompt"
})
```

**team_manage(create) REJECTS agents not in config** — always `spawn_subagent(run_now:false)` first.

### Running a collaborative round
```
team_manage({
  action: "run_round",
  team_id: "team_abc",
  objective: "Research and write an article about EV batteries",
  agent_directives: {
    "scout_agent": "Focus on Toyota solid-state battery news",
    "writer_agent": "Draft an 800-word article from Scout's research"
  }
})
```

Or run a full multi-round session:
```
team_manage({
  action: "run_session",
  team_id: "team_abc",
  objective: "Complete the weekly news roundup",
  max_rounds: 5
})
```

### Scheduling
```
schedule_job({
  action: "create",
  name: "Daily Report",
  schedule: "0 9 * * *",
  prompt: "Generate the daily report...",
  delivery_channel: "telegram"
})
```

---

## Team System (current architecture)

### Coordinator model (active default)
The **main Prometheus agent acts as Manager/Coordinator** for all teams. Key files:
- `teams/team-coordinator.ts` — Coordinator logic with 14 rules, idle detection, WAITING_MAIN_AGENT signal
- `teams/team-manager-runner.ts` — Facade: exports `triggerManagerReview`, `handleManagerConversation(teamId, msg, broadcast, autoContinue?)`
- `teams/team-dispatch-runtime.ts` — `runTeamAgentViaChat`, `setDispatchDeps`

### Session model
- Team sessions: `team_coord_{teamId}` — isolated from main chat, persistent across turns
- The **notify-bridge** (`teams/notify-bridge.ts`) delivers team events to the main chat live via `broadcastWS` on every `notifyMainAgent` call — no polling needed. Also drained as fallback on every `handleChat` response.
- Main agent appears as "Manager" in team chat

### Start button / auto-continuation
- Start button fires with `autoContinue=true` → coordinator loops up to 9 turns (1 initial + 8 continuations) until `[GOAL_COMPLETE]`, `[NEEDS_INPUT]`, team paused, or max reached
- Stops on: short response (<80 chars), explicit markers, error, team paused

### Subagent architecture (unified Option B)
Subagents run as a **full Prometheus agent** — same `handleChat`, same main workspace (NOT overridden):
- `[YOUR ROLE ON THIS TEAM]` block injected via `callerContext` (from agent's `system_prompt.md`)
- Team workspace path given in `callerContext`; agents use full absolute paths to write shared files
- **Tool filter (blocklist approach):** All tools allowed except `memory_browse/write/read`, `gateway_restart`, `write_proposal/find_replace_source/replace_lines_source` (unless `can_propose=true`)
- `grep_source` / `grep_files` / `read_source` / `list_source` are all available to subagents
- `_activeAgentSessions` Set — loop guard (same agent can't dispatch itself, max 4 concurrent)
- `_bgAgentResults` Map — background task registry, cleaned after 1 hour

### Team communication tools (in-agent)
- `post_to_team_chat(team_id, message)` — post to shared channel mid-task
- `dispatch_team_agent(team_id, agent_id, task, background?)` — foreground (blocks) or background (returns task_id)
- `get_agent_result(task_id, block?)` — collect background agent result

### Agent ID extraction note
Extract agent ID from sessionId with regex `/^team_dispatch_([^_]+(?:_[^0-9][^_]*)*)/` — NOT `split('_')[2]` (breaks on multi-word IDs like `code_executor_synthesizer_v1`)

### Legacy round-based mode
`team_manage(run_session/run_round)` — 4-phase system (plan→execute→sync→review), MAX_ROUNDS=10 via `team-round-runner.ts`. NOT used by the Start button — kept for backward compatibility.

---

## Background Agent System

One-shot ephemeral parallel agents with full tool access. **Not** background tasks (persistent, multi-step). **Not** subagents (no profile files). Fire-and-forget — system auto-merges results before the final response.

### When to use background_spawn (ALL 3 must be true)
1. Work is **independent** of your primary tool sequence (no shared dependencies)
2. Can **start right now** with all context embedded in the prompt
3. You **don't need the result** to proceed with your next tool call → do it inline if false

### Prompt construction rule
The bg agent has **no session history**. Prompts must include exact file paths, specific content, which tools to call, and all parameters. Never reference "what we discussed."

```
BAD:  "Update the note about what we just did"
GOOD: "Call write_note: content='Result: X. Date: 2026-03-27.' tag='testing'"
```

### Mid-plan spawning
You **can** call `background_spawn` during any active `declare_plan` step. The bg agent runs in parallel with remaining steps and is collected at turn end. Only do this when the side-work doesn't gate subsequent steps.

### Key files
- `src/gateway/tasks/task-runner.ts` — `backgroundSpawn()`, `backgroundJoin()`, `_ephemeralBackgroundRuns` Map, `bgPlanDeclare()`, `bgPlanAdvance()`, `_bgAgentPlans` Map
- `src/gateway/routes/chat.router.ts` — `runBackgroundJoinGate()`: auto-fires via `Promise.all` before final response; `BG_AGENT_BLOCKED_TOOLS` / `BG_AGENT_ONLY_TOOLS` sets in `rebuildTools()`
- `src/gateway/agents-runtime/subagent-executor.ts` — executor cases for all bg tools including `bg_plan_declare`, `bg_plan_advance`
- `src/gateway/tools/defs/agent-team-schedule.ts` — tool schema definitions

### How it works
1. `background_spawn(prompt)` → full `handleChat` with complete tool access starts immediately, returns `background_id`
2. Main agent continues primary work in parallel — no waiting, no polling
3. `runBackgroundJoinGate()` fires after all tool rounds via `Promise.all` — merges completed results into final reply
4. Late completions arrive via `bg_agent_done` WS event → UI injects inner panel into last AI message

### Background agent plan system (bg agents only)
Bg agents handling multi-step tasks use their own isolated plan tools:
- `bg_plan_declare(steps[])` — declares plan in `_bgAgentPlans` keyed by bg session ID; never touches main plan panel
- `bg_plan_advance(note?)` — advances to next step; returns next label or completion confirmation
- Use for 2+ meaningful phases; skip for simple single-step tasks

### Tool injection rules
- **Blocked in bg agents** (`BG_AGENT_BLOCKED_TOOLS`): `background_spawn/status/progress/join`, `declare_plan`, `step_complete`, `write_note`
- **Bg-agent-only** (`BG_AGENT_ONLY_TOOLS`): `bg_plan_declare`, `bg_plan_advance` — stripped from main agent and all other modes

### Contracts
- **Never call `background_join` manually** — gate handles it; manual calls cause double-merge
- **No profile files** — pure in-memory only
- **Idempotent merge** — `mergedAt` timestamp + `joinedBackgroundIds` Set (double-guarded)
- **Join policies** (set on spawn): `wait_until_timeout` (15s default), `wait_all`, `best_effort_merge`
- **Fan-out:** spawn N agents → all auto-joined in parallel at turn end

### Session IDs
Background agents run under `background_{id}` session context (isolated from main chat history).

---

## Task Progress System

Background tasks display a live progress panel in the UI. The canonical source of truth is `task.plan[]` in the task record — **not** `runtimeProgress`.

### How it works
1. Agent calls `declare_plan(steps[])` early in execution — stored as `task.plan[]` in `.prometheus/tasks/<id>.json`
2. After each step completes, agent calls `step_complete(step_index, result)` — advances `currentStepIndex` and updates step status in `task.plan[]`
3. `step_complete` also syncs `runtimeProgress` to match (for live SSE push to UI)
4. UI reads `task.plan[]` first (stable, persistent); falls back to `runtimeProgress` only when `task.plan[]` is empty

### Session ID rule
All background task executions use session `task_{taskId}` — always normalized regardless of how the task was submitted. This ensures `declare_plan` blocking and `step_complete` resolution both work correctly.

### declare_plan guard
`declare_plan` is blocked if a plan already exists with at least one non-pending step — prevents mid-task plan replacement. Only fires when session starts with `task_`.

### allPending check
A plan can be replaced only when ALL steps are strictly `pending` (not running, not done). A step in `running` state locks the plan.

---

## Gateway Lifecycle

Prometheus can build and restart itself gracefully after code changes:

1. Code changes applied (proposal, repair, manual edit)
2. `gateway_restart` tool called (or `buildAndRestart()` from lifecycle.ts)
3. `npm run build` runs in-process (captured, same terminal)
4. If build succeeds: writes `restart-context.json` with what changed
5. Shuts down HTTP, WebSocket, Telegram, cron, heartbeat cleanly
6. Spawns new `node dist/cli/index.js` detached process
7. Current process exits
8. New process boots, detects restart context, runs slim briefing instead of full BOOT.md
9. AI notifies user via Telegram what changed and what to test

Key files: `lifecycle.ts` (orchestrator), `boot.ts` (hot restart detection)

---

## Data Directory Layout

```
.prometheus/
  config.json                    ← models, tools, channels, agents[]
  managed-teams.json             ← all ManagedTeam definitions
  connections.json               ← connector connection states
  connections-activity.jsonl     ← append-only connector activity log
  cron/jobs.json                 ← ALL CronJob definitions
  tasks/<task-id>.json           ← TaskRecord
  sessions/<session-id>.json     ← conversation history
  analysis/<teamId>/             ← website intelligence team workspaces
  projects/<id>.json             ← project metadata (name, instructions, sessions[], knowledge[])

workspace/
  SOUL.md                        ← AI identity and operating principles
  USER.md                        ← facts about the human (Raul)
  SELF.md                        ← this file — architecture reference
  TOOLS.md                       ← tool reference guide
  BUSINESS.md                    ← canonical business facts (loaded every session)
  entities/
    clients/, projects/, vendors/, contacts/, social/
  events/pending.json            ← cross-session event queue
  proposals/pending|approved|denied|archive/
  reports/                       ← intel team reports
  memory/YYYY-MM-DD*.md          ← daily logs and intraday notes
  skills/                        ← skill playbooks (34+ skills)
  projects/<id>/
    CONTEXT.md                   ← living project context (auto-updated every session)
    knowledge/                   ← uploaded project knowledge files
```

---

## Telegram Commands

The Telegram bot supports full system control:
- `/teams` — browse teams, agents, dispatch, chat, trigger reviews
- `/agents` — browse all agents, dispatch tasks, edit prompts/models
- `/tasks` — list background tasks, chat with agents, resume/pause/cancel
- `/schedule` — list schedules, run now, edit cron/prompt, delete
- `/proposals` — list/view/approve/reject proposals
- `/repairs` — list/approve/reject self-repair patches
- `/browse` — inline file browser with preview
- `/download <path>` — download workspace files
- `/setup <service>` — guided integration setup
- `/mcp-status` — MCP server status
- `/integrations` — integration states
- `/clear` — reset conversation (both web + Telegram sessions)

---

## CIS — Context Injection System

14 connectors available in the UI. Connection state in `.prometheus/connections.json`. Activity log in `.prometheus/connections-activity.jsonl`.

Connectors: gmail, slack, github, notion, hubspot, salesforce, stripe, ga4, instagram, tiktok, x, linkedin, reddit, google_drive.

Always call `view_connections({ action: "list" })` before referencing any external platform data — never assume connected.

---

## Common Error Patterns

| Error | Cause | Fix |
|---|---|---|
| `team_manage(create)` rejected | Agent not in config.json | `spawn_subagent(run_now:false)` first |
| Ghost cron jobs reappear | Hardcoded createJob in server-v2.ts | Remove hardcoded block |
| `Cannot find module './X'` | File moved during refactor | Use `list_source` to verify current path |
| `[ProjectLearning]` never logs | Import used `.js` extension on `.ts` file | Use `from '../projects/project-learning'` not `.js` |
| Project context not injecting | Session ID not in project JSON | Check `.prometheus/projects/*.json` sessions[] array |
| `used before assigned` in router | Singleton accessed at import-time before `init*()` | Move usage inside `init*()` function body |
| Telegram replies have no context | Session bridge not linked | Ensure `send_telegram` was called from the originating session |
| `step_complete` not advancing plan | Session ID wasn't `task_<id>` | Background task runner always normalizes to `task_${taskId}` now |
| Progress panel flickering/resetting | UI reading runtimeProgress before task.plan[] | UI now reads `task.plan[]` first as source of truth |
| `declare_plan` re-running from scratch | Plan guard only works with `task_` prefix sessions | Fixed by session normalization in background-task-runner.ts |

---

## Important Constraints

- **Never edit `dist/`** — overwritten on build
- **Always rebuild** after source changes: `npm run build`
- **`read_source` / `list_source`** — only tools that reach `src/` (plus `find_replace_source`, `replace_lines_source`)
- **`write_proposal`** is the src change path for major changes
- **BUSINESS.md** loaded every session — write business facts there immediately
- **view_connections()** before referencing any external platform — never assume connected
- **Teams data** in `.prometheus/managed-teams.json`
- **Schedule jobs** in `.prometheus/cron/jobs.json`
- **Agents must be in config.json** — `spawn_subagent(create_if_missing)` registers them
- **Router dependencies** injected via `init*()` from `server-v2.ts` — don't access singletons at module scope
- **Telegram session bridge** auto-links when `send_telegram` fires — Telegram replies continue the originating session

---

## CIS — Entity System Architecture

The entity system gives Prometheus persistent, structured knowledge about real-world objects in the user's business.

### File layout
```
workspace/
  BUSINESS.md                   ← Canonical business facts (Company, Team, Clients, Products, Vendors, Policies)
                                   Loaded into every session automatically via buildPersonalityContext()
  entities/
    clients/                    ← One .md file per client  (acme-corp.md, etc.)
    projects/                   ← One .md file per project
    vendors/                    ← One .md file per vendor/tool
    contacts/                   ← One .md file per person contact
    social/                     ← One .md file per social platform profile ([platform].md)
    (each folder has _template.md as the starting structure)
```

### How entities are populated
1. **Automatic (post-session):** `conversation-learning.ts` scans user messages for client names, project names, company facts. Runs fire-and-forget on every context compaction. Writes to BUSINESS.md and creates entity stubs.
2. **Manual (AI tool calls):** Block B adds `read_entity`, `write_entity`, `list_entities` tools so agents can explicitly read/write entity files during a session.

### Where BUSINESS.md is loaded
`gateway/prompt-context.ts` → `buildPersonalityContext()` → loads BUSINESS.md (1200 char limit) on every chat turn, giving every session business context without manual prompting.

### Block B entity tools (planned — not yet implemented)
| Tool | Purpose |
|---|---|
| `read_entity(type, id)` | Read `workspace/entities/[type]/[id].md` |
| `write_entity(type, id, content)` | Create or update an entity file |
| `list_entities(type?)` | List all entity files, optionally filtered by type |

---

## Block A — CIS Wiring Status (completed 2026-03-19)

| Item | Status | Where |
|---|---|---|
| conversation-learning.ts on session close | ✅ WIRED | `chat.router.ts` compaction block — fires fire-and-forget on context compaction |
| deploy-analysis-team deps injected | ✅ WIRED | `server-v2.ts` after `initChatRouter` |
| deploy_analysis_team tool registered | ✅ WIRED | `tool-builder.ts` |
| Event polling in chat cycle | ✅ WIRED | `chat.router.ts` after handleChat result — `drainPendingEvents` before SSE done |
| Policy engine in tool execution | ✅ WIRED | `subagent-executor.ts` — evaluate + audit every tool call (log only, non-blocking) |
| social_intel tool registered | ✅ WIRED | `tool-builder.ts` |
| social-scraper deps injected | ✅ WIRED | `server-v2.ts` after `initChatRouter` |
| Projects system | ✅ WIRED | `project-store.ts` + `project-learning.ts` + `projects.router.ts`; context injected in `prompt-context.ts` (all 3 tiers); learning fires in `chat.router.ts` after every reply |
| Canvas image support | ✅ WIRED | `canvas.router.ts` GET `/api/canvas/file` detects image extensions, returns `{ isImage, base64, mimeType }`; `ChatPage.js` renders in iframe with dimension readout; Code/Preview toggle hidden for images |
| Project onboarding trigger | ✅ WIRED | `__project_onboarding_start__` intercepted in `chat.router.ts`, stripped from history, replaced with rich system prompt; trigger bubble hidden via MutationObserver in `ProjectsPage.js` |

*Last updated: 2026-03-22*
