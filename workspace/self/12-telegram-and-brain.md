## 25) Telegram, Channels, and Command Surface

Current channel config blocks exist for:

- Telegram
- Discord
- WhatsApp

Each channel config can also carry `completionNotifications`:

- `enabled` gates response-complete notification delivery for that channel.
- `desktop` and `mobile` select which chat origins should trigger alerts.
- `includeSummary`, `includeLink`, and `summaryMaxChars` control the truncated final-message preview and best-effort deep link.
- Defaults are off; normalization lives in `src/gateway/comms/broadcaster.ts`, schema validation lives in `src/config/config-schema.ts`, and the Settings > Channels UI writes the block from `web-ui/src/pages/SettingsPage.js`.

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

Response-complete notification bridge:

- `src/gateway/notifications/completion-bridge.ts` sends opt-in completion alerts to Telegram, Discord, and WhatsApp when a `/api/chat` turn reaches the final response path.
- `src/gateway/routes/chat.router.ts` calls `notifyChatCompletion(...)` only for normalized `mobile` and `web` origins. Mobile sends `Mobile chat response complete:`; desktop web sends `Desktop response complete:`.
- Terminal/CLI, Telegram-origin, Discord-origin, WhatsApp-origin, tasks, proposals, team rooms, and existing Telegram command/task delivery are not replaced or echoed by this bridge.
- Telegram delivery uses `sendTelegramNotification(...)` in `broadcaster.ts`, which routes through the existing allowed Telegram channel delivery path.
- Discord and WhatsApp delivery reuse `sendDiscordNotification(...)` and `sendWhatsAppNotification(...)`.
- The bridge dedupes repeated final notifications by source/session/clientRequestId/content hash in memory.
- Link generation is best-effort: it prefers configured public mobile/gateway/remote-access URLs, then request origin, then local `http://127.0.0.1:<port>`, and appends `/#mobile/chat/<sessionId>`. iOS/PWA behavior may still open Safari/browser instead of the installed mobile shell, so the notification preview is the reliable part.

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
- failed Thought and Dream runs back off for six hours, and failed Dream cleanup runs back off for twelve hours, so a missing/stale artifact cannot create a 30-60 minute model retry storm
- recurring Brain sessions have model/tool-round safety budgets (Thought 32, Dream 48, cleanup 32 by default); these are independently configurable with `PROMETHEUS_BRAIN_THOUGHT_MAX_ROUNDS`, `PROMETHEUS_BRAIN_DREAM_MAX_ROUNDS`, and `PROMETHEUS_BRAIN_CLEANUP_MAX_ROUNDS`
- brain state, thought, dream, and cleanup artifacts live under `workspace/Brain/`
- **the brain runs as `executionMode: 'cron'`, which (post Plan-B/cron rework) takes the interactive personality path — so thought and dream already receive USER.md + SOUL.md + MEMORY.md + intraday notes + config soul.** The prompts now reason proactively from that context ("the user planned X with me — is it actually built yet?") rather than only auditing the activity window.
- **research tools (2026-06-10):** the Thought toolFilter now includes `web_search`/`web_fetch` (core tools) for light current-state + prior-art lookups, plus private-build-only source/prom read tools (`read_source`, `grep_source`, `read_prom_file`, …) so it can inspect Prometheus's own code/tools for current-state checks and tool-failure diagnosis. The Dream additionally gets `browser_open`/`browser_get_page_text` for deep competitor/OSS research. All Prometheus-source tools are stripped in public builds by `brainDreamToolFilter`.
- **Current-State Verification gate (the key 2026-06-10 change):** both Thought and Dream must separate ORIGIN evidence (the chat that pinned an item) from CURRENT-STATE evidence (what the live artifact does *now*). Before flagging/seeding/proposing anything, they must open the real file/tool/page/project and confirm the gap still exists — because the user often fixes a bug or finishes a feature via another tool (Claude/Codex) without going through Prometheus. If current state shows it's already handled, mark it resolved and do not propose. This is what kills stale proposals.
- **Active Work Ledger** (`workspace/Brain/active-work.jsonl`): the standing, memory-grounded list of what the user is actively building/circling. The Thought maintains it (upsert rows with `status`, `diskPath`, `currentState`, `research`, `evidence`); the Dream drives off every non-resolved entry even on a day with no note, and updates status (incl. `resolved`). This is what makes the brain proactive without an explicit task.
- **proposals use the 3-lane model** (`general` / `action` / `code_change`); the Dream files `action` proposals with the hardened contract (What you asked for / Current state / Research / Plan / Acceptance / Risks). `code_change` proposals are private-build-only. Editing one of the user's OWN projects is an `action` proposal, never `code_change`.
- thoughts are observation, seed capture, and low-risk existing-skill maintenance; they write dated thought markdown, the Active Work Ledger, and may update existing skills only through `skill_manifest_write` or `skill_resource_write`
- thoughts must not mutate memory, prompts, proposals, configs, cron jobs, team state, or create new skills
- thought-applied skill updates must be small, evidence-backed, ledgered with `appliedBy="brain_thought"`, verified with `skill_read` or `skill_inspect`, and explained in the Thought file for Dream review
- thoughts scan chats, sessions, transcripts, tasks, cron/team/proposal evidence, memory notes, `Brain/skill-episodes/`, and `Brain/skill-gardener/`
- dreams read the thought queue, memory roots, proposals, pending proposals, skill episodes, and live skill/workflow candidates before acting
- dreams run a Skill Gardener Review phase that compares actual session behavior against current skill docs
- Thought, Dream, cleanup, and normal chat are candidate-only skill observers; they submit structured evidence with `skill_candidate_submit`
- the scheduled Curator runs in `dry-run` mode and behavioral changes default to pending review
- Dream cannot automatically file `skill_evolution`; new-skill candidates first require Curator overlap analysis and explicit approval
- procedural workflow and tool-order learnings route into Curator candidates, not into `USER.md`, `SOUL.md`, or `MEMORY.md`
- dream output artifact handling is resilient: if a model-backed Dream returns usable text but misses/stales the dream markdown or `Brain/proposals.md`, the runner writes fallback recovery artifacts instead of failing only because an expected file was missing
- dream cleanup is now both memory solidifier and Skill Curator Critic; it should not create new memories, proposals, new skills, archives, merges, broad rewrites, or high-risk skill changes
- **Brain continuity layer (2026-07-18):** every successful Thought now writes a typed JSON sidecar under `Brain/context-capsules/<date>/<window>-capsules.json`. Capture has no fixed item-count cap; each evidence-supported thread gets a stable `threadKey`, TTL, validation state, relevance metadata, evidence, and optional supersession ids. Main-chat prompt assembly reads all active sidecars, resolves expiry/supersession/newest-per-thread, and injects only the turn-relevant subset under a character budget as `[BRAIN_ACTIVE_CONTEXT]`.
- **Dream next-day carry-forward (2026-07-18):** the nightly Dream classifies temporary threads as refresh/hold/resolve/expire/escalate/promote and writes `Brain/continuity/<date>/carry-forward.json`. The runner validates that decision file and atomically creates/rewrites the generated section at the top of the next day's existing `memory/<next-date>-intraday-notes.md`, preserving any live notes. Carry-forward output has no fixed item-count cap, but every item needs a stable thread key, current facts, loose ends, natural opening, review/expiry time, evidence, and validation state. A generated instruction tells all writers to note when/if any item changes, completes, becomes blocked, or is superseded. Threads cannot renew solely because they appeared yesterday.
- Dream cleanup may inspect the Curator queue, reject weak pending items, or submit a repair candidate; it cannot mutate skill files
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

Curator resources use stable canonical destinations instead of dated filenames: `references/recovery/<topic>.md`, `references/styles/<skill>.md`, and `references/workflows/<skill>.md`. Equivalent lessons merge into the existing canonical resource. Capture date, source sessions, confidence, and raw evidence remain in the Brain suggestion/evidence ledger rather than being copied into skill instructions.

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
- user-authored reusable instruction or validated recurrence across distinct sessions increases confidence; assistant final-response language and tool count do not

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
- behavioral lessons, triggers, resources, instructions, and new skills never auto-apply during the mutation freeze
- high-risk edits, broad instruction rewrites, archives, merges, skill deletion, and new skill creation require review/proposal flow
- pending suggestions expire after 45 days; rejected suggestions are suppressed for 90 days, and semantic duplicates point to and remain suppressed behind the existing suggestion
- trigger patches must name the proposed trigger, include positive and negative prompt sets, pass deterministic routing checks, respect the trigger cap, and target a skill that permits implicit invocation

Historical lesson patterns now requiring review:

- Creative/HyperFrames export says `Failed to fetch` but MP4 exists: add a recovery resource to `prometheus-creative-mode` that tells future runs to verify artifact path, nonzero file size, snapshots, and QA before treating the export as failed
- file edit/patch context drift or exact-text-not-found: route the recovery lesson to `file-surgery`, not whichever skill happened to be active

Skill Curator routing principle:

- route the lesson to the skill that owns future behavior, not merely the skill that happened to be read
- creative/export lessons belong in creative/video skills
- file edit and patch drift lessons belong in `file-surgery`
- browser/X navigation/auth lessons belong in browser automation skills
- scheduling/background-job lessons belong in scheduler operations skills

The Skill Gardener is meant to reduce memory bloat. Durable procedural recipes belong in skill docs, skill resources, or skill proposals. Memory should keep user facts, preferences, decisions, and durable project facts, not ad hoc "do these steps next time" instructions when a skill is the better home.
