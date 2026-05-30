## 25) Telegram, Channels, and Command Surface

Current channel config blocks exist for:

- Telegram
- Discord
- WhatsApp

Telegram channel config now also supports:

- persona bot configs under `personas`
- team room bridge configs under `teamRooms`

Telegram currently supports:

- interactive chat sessions
- session resume
- file browser and file download
- live task browsing/control
- team browser/control
- schedule browser/control
- model switching
- reasoning controls
- proposal browsing/approval buttons
- repair browsing/apply/reject
- integrations and MCP status
- command approvals
- persona-specific bots that can route group/direct messages to configured agent IDs
- team room mirroring for team chat, dispatch, completion, proposed changes, and manager review events
- **live token streaming to desktop web UI** — every token, tool call, and tool result emitted during a Telegram turn is broadcast as a `main_chat_stream_event` WebSocket message to all connected desktop clients, so the desktop sees Telegram activity live without refresh

## 25-LIVE) Cross-Channel Live Update Behavior (Web UI)

All channel messages (Telegram, mobile PWA, CLI, Discord, WhatsApp) flow through `handleChat` in `src/gateway/routes/chat.router.ts`. The `sendSSE` wrapper inside `handleChat` calls `appendMainChatStreamEvent` which broadcasts `{ type: 'main_chat_stream_event', sessionId, streamId, seq, event, data }` to ALL connected WebSocket clients.

The desktop web UI (`web-ui/src/pages/ChatPage.js`) listens to `main_chat_stream_event` in `handleMainChatStreamEvent`. When events arrive for a session the desktop isn't currently viewing:

- **Auto-switch**: if the desktop is idle (no active run, no typing), it switches to the external channel session immediately and shows a brief toast
- **Activity toast**: if the desktop is mid-conversation, a "Live on [channel] — View live →" toast appears so the user can jump to it manually

Session IDs by channel:
- Telegram: `telegram_<userId>_<chatId>` (via `getTelegramSessionId`)
- Mobile PWA: `mobile_default` (or per-thread session IDs)
- CLI: `cli_<id>`

On WS reconnect (`ws:open`), the desktop calls `_wsReconnectCatchUp` which:
1. Fetches `/api/sessions` and merges any sessions added while disconnected
2. Calls `catchUpMainChatStream(activeChatSessionId)` to replay missed stream events from the in-memory ring buffer (up to 800 events, 45-min TTL)

The session list is also refreshed from server every 45 seconds via `window._sessionListRefreshTimer` to surface any sessions missed by WebSocket events.

Stream event deduplication uses `shouldProcessMainChatStreamEvent` keyed by `sessionId + streamId` — each new AI turn gets a fresh `streamId` UUID so there is no cross-turn sequence collision.

Key source files for cross-channel live updates:
- `src/gateway/routes/chat.router.ts` — `appendMainChatStreamEvent`, `beginMainChatStream`, `finishMainChatStream`
- `src/gateway/comms/broadcaster.ts` — `broadcastWS` (sends to all WS clients)
- `web-ui/src/pages/ChatPage.js` — `handleMainChatStreamEvent`, `_wsReconnectCatchUp`, `_switchToChannelSession`, `_showChannelActivityToast`, `_isDesktopIdle`
- `web-ui/src/ws.js` — WebSocket connection and auto-reconnect

Current Telegram command surface in code includes:

- `/status`
- `/clear`
- `/new`
- `/resume`
- `/cancel`
- `/stop_now`
- `/stop`
- `/browse`
- `/download`
- `/screenshot`
- `/restart`
- `/update`
- `/teams`
- `/agents`
- `/tasks`
- `/schedule`
- `/models`
- `/model`
- `/reasoning`
- `/proposals`
- `/approvals`
- `/repairs`
- `/approve`
- `/reject`
- `/integrations`
- `/mcp-status`
- `/setup`

Current doc/handler mismatches inside Telegram code:

- `/approvals` is implemented but omitted from `buildTelegramCommandsMessage(...)`
- the help text says `/approve` and `/reject` act on proposals, but the handlers currently use them for self-repair approvals/rejections
- proposal approval is currently driven from `/proposals` details/buttons, not `/approve <proposalId>`

Telegram also exposes provider-specific reasoning controls, including Anthropic thinking budget options.

Telegram persona and team-room implementation files:

- `src/gateway/comms/telegram-persona-bots.ts`
- `src/gateway/comms/telegram-team-room-bridge.ts`

Persona bot facts:

- each persona config binds a bot token to an `agentId`
- group handling can require mentions via `requireMentionInGroups`
- allowed users and group chat IDs are enforced per persona config

Team room facts:

- each team room config binds a `teamId` to a Telegram `chatId` and optional `topicId`
- room bridge can post team chat messages, dispatch starts/completions, proposed changes, and manager review summaries
- `usePersonaIdentities` is present in config and should be considered when mapping team agents to Telegram-facing identities

## 25A) Brain Runner and Prompt Mutation

The current self-improvement loop is split between the brain runner and prompt mutation, not the older removed self-improvement API files.

Current source facts:

- `src/gateway/brain/brain-runner.ts` schedules thought cycles about every six hours
- dream cycles are scheduled nightly around 23:30 local time, with cleanup about thirty minutes later
- a fifteen-minute checker handles catch-up and retry behavior
- brain state, thought, dream, and cleanup artifacts live under `workspace/Brain/`
- thoughts are observation, seed capture, and low-risk existing-skill maintenance; they write dated thought markdown and may update existing skills only through `skill_manifest_write` or `skill_resource_write`
- thoughts must not mutate memory, prompts, proposals, configs, cron jobs, team state, or create new skills
- thought-applied skill updates must be small, evidence-backed, ledgered with `appliedBy="brain_thought"`, verified with `skill_read` or `skill_inspect`, and explained in the Thought file for Dream review
- thoughts scan chats, sessions, transcripts, tasks, cron/team/proposal evidence, memory notes, `Brain/skill-episodes/`, and `Brain/skill-gardener/`
- dreams read the thought queue, memory roots, proposals, pending proposals, skill episodes, and live skill/workflow candidates before acting
- dreams run a Skill Gardener Review phase that compares actual session behavior against current skill docs
- dreams audit Thought-applied skill updates and may accept, modify, remove/supersede, or defer them to prevent skill bloat
- dreams may automatically evolve an existing skill when the change is low-risk, evidence-backed, and scoped to an existing skill
- dreams must automatically file `skill_evolution` proposals for new skills when the proposal quality gate passes; they should not directly create brand-new skills
- procedural workflow and tool-order learnings should route into existing skill updates or new-skill proposals, not into `USER.md`, `SOUL.md`, or `MEMORY.md`
- dream output artifact handling is resilient: if a model-backed Dream returns usable text but misses/stales the dream markdown or `Brain/proposals.md`, the runner writes fallback recovery artifacts instead of failing only because an expected file was missing
- dream cleanup is now both memory solidifier and Skill Curator Critic; it should not create new memories, proposals, new skills, archives, merges, broad rewrites, or high-risk skill changes
- Dream cleanup may inspect the skill curator queue and recent auto-applied skill resources; it can accept, reject, revert, refine, or mark skill-curator items as needs_review
- Dream cleanup can reject weak pending curator items, delete/revert clearly bad auto-applied curator resources with `skill_resource_delete`, or refine an applied resource in place with `skill_resource_write` only when the correction is obvious and low-risk
- prompt mutations still flow through `src/gateway/scheduling/prompt-mutation.ts`
- the main chat prompt includes a skill recovery policy: if a skill-guided path fails, recover through another viable route, and after confirming the alternate route works, offer to update the skill with the corrected steps or guardrail
- the older `src/gateway/proposals/self-improvement-api.ts` and `src/gateway/scheduling/self-improvement-engine.ts` files are no longer present in the working source

## 25B) Brain Skill Gardener

Skill learning evidence is captured by `src/gateway/brain/skill-episodes.ts`.

Current artifact paths:

- `workspace/Brain/skill-episodes/<date>/episodes.jsonl`
- `workspace/Brain/skill-gardener/<date>/workflow-episodes.jsonl`
- `workspace/Brain/skill-gardener/<date>/live-candidates.jsonl`
- `workspace/Brain/skill-curator/suggestions.json`
- `workspace/Brain/skill-curator/reports/<runId>.md`

Current candidate classes:

- `update_existing_skill`
- `add_resource_or_template`
- `add_trigger`
- `create_new_skill_candidate`
- `no_action_but_record_episode`

Important signals:

- a skill was read and followed, then a tool/error path forced a correction
- a skill was listed but not read, suggesting a missing trigger or routing gap
- a multi-tool workflow succeeded without a skill, suggesting a possible new skill candidate
- a workflow involved durable browser, desktop, coding, creative, migration, or external-system steps
- user correction, repeated recurrence, or positive feedback increases confidence

Current Skill Curator behavior is implemented in `src/gateway/skills-runtime/skill-curator.ts` and is lesson-first, not transcript-first.

Curator lesson types currently include:

- `recovery`
- `style_pattern`
- `component_recipe`
- `workflow_recipe`
- `trigger_patch`
- `instruction_patch`

Curator quality rules:

- a valid curator suggestion must say what Prometheus should do differently next time
- it must include a future trigger, learned behavior, why it helps, target skill, evidence, risk, quality score, and apply preview when possible
- raw request/outcome excerpts, long tool lists, and generic "workflow completed" notes are not enough
- completed workflow alone should usually become `no_action` unless a reusable lesson exists
- deterministic gates should reject or ignore weak legacy workflow/troubleshooting dumps before they pollute skills
- low-risk, additive typed lessons can auto-apply in `auto-safe` mode
- high-risk edits, broad instruction rewrites, archives, merges, skill deletion, and new skill creation require review/proposal flow

Current auto-safe examples:

- Creative/HyperFrames export says `Failed to fetch` but MP4 exists: add a recovery resource to `prometheus-creative-mode` that tells future runs to verify artifact path, nonzero file size, snapshots, and QA before treating the export as failed
- file edit/patch context drift or exact-text-not-found: route the recovery lesson to `file-surgery`, not whichever skill happened to be active

Skill Curator routing principle:

- route the lesson to the skill that owns future behavior, not merely the skill that happened to be read
- creative/export lessons belong in creative/video skills
- file edit and patch drift lessons belong in `file-surgery`
- browser/X navigation/auth lessons belong in browser automation skills
- scheduling/background-job lessons belong in scheduler operations skills

The Skill Gardener is meant to reduce memory bloat. Durable procedural recipes belong in skill docs, skill resources, or skill proposals. Memory should keep user facts, preferences, decisions, and durable project facts, not ad hoc "do these steps next time" instructions when a skill is the better home.
