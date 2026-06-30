## 39) Runtime Context Build Pipeline

The actual assembly sequence for every `handleChat` turn. Not the architecture overview — just the pipeline in order.

---

```
User Message
    │
    ▼
Router ─────────────────────────────────── chat.router.ts:1756
handleChat()
    │
    ▼
Execution Mode ─────────────────────────── chat.router.ts:1764, 3105–3158
interactive / background_task / cron /
team_subagent / team_manager / proposal_execution /
background_agent / heartbeat
    │
    ▼
buildBaseSystemPrompt() ────────────────── chat.router.ts:3191–3199
  execution mode block (one per mode)
  core identity: "You are Prom…"
  routing policies: HyperFrames / creative / team / skill recovery
  plan protocol (mode-specific)
  response style
    │
    ▼
[MODEL_CAPABILITIES] ───────────────────── chat.router.ts:2398–2411
provider / model / vision flag
    │
    ▼
[RECENT_TOOL_OBSERVATIONS] ─────────────── session.ts → chat.router.ts:1894
prior tool run log (session-scoped, lean by default; per-tool telemetry stored but only injected when explicitly requested)
    │
    ▼
callerContext ──────────────────────────── mode-specific source (see below)
  background task   → background-task-runner.ts:671–690
  proposal          → background-task-runner.ts:609–623
  team dispatch     → team-dispatch-runtime.ts:433–471
  team room         → team-member-room.ts:542–575
  team manager      → team-coordinator.ts:432–523
  scheduled subagent→ cron-scheduler.ts:206–219
  heartbeat         → heartbeat-runner.ts:494
  boot              → boot.ts:225–278
  background_spawn  → task-runner.ts:636
    │
    ▼
browserStateCtx (if tab open) ──────────── chat.router.ts:3090–3099
[BROWSER SESSION ACTIVE: …]
    │
    ▼
buildPersonalityContext() ──────────────── prompt-context.ts:964–1320
  branches by mode (local_llm / teach / voice /
  switch_model / team_subagent / autonomous / interactive)
    │
    ├─ [PROMETHEUS_SOUL]  config soul.md      loadSoul()
    ├─ [USER]             workspace/USER.md
    ├─ [SOUL]             workspace/SOUL.md
    ├─ [MEMORY]           workspace/MEMORY.md  (8k char cap, interactive)
    ├─ [BUSINESS]         workspace/BUSINESS.md  (if enabled)
    ├─ [TODAY_NOTES]      intraday notes       (interactive + team_manager only)
    ├─ [PROJECT_CONTEXT]  project store        (if session is project-bound)
    │
    ├─ buildToolsContext() ────────────────── prompt-context.ts:795–925
    │    always-on tool menu
    │    TOOL_BLOCKS.skills (always)
    │    TOOL_BLOCKS.{category} (persistent session categories plus unexpired scoped categories)
    │    browser_automation policy is wrapper-first: browser_session/observe/act/extract
    │    desktop_automation policy is wrapper-first: desktop_screen/apps/window/input/macro/background
    │    external_apps policy is wrapper-first for X/xAI and Vercel wrappers
    │    agents_and_teams policy is wrapper-first: agent_ops/chat_ops/team wrappers
    │    Creative bucket policies are wrapper-first: creative_project/scene/image/video/hyperframes/quality
    │    workspace_write policy is wrapper-first: workspace_read/edit/run/git/safety/code_nav
    │    prometheus_source_read/write policy is wrapper-first: dev_source_read/dev_source_edit
    │    realtime voice policy is wrapper-first in chat.router: voice_ops/browser/desktop
    │
    ├─ Skills hint ────────────────────────── skills-manager.ts:858–872
    │    [SKILLS] N playbooks / [MATCHING_SKILLS] if pre-matched
    │
    ├─ [ACTIVE_SKILLS] ───────────────────── prompt-context.ts:943–955
    │    recently used skill IDs
    │
    ├─ [CIS_CONTEXT] ─────────────────────── cis-context-builder.ts:104–108
    │    entity-aware business profile
    │
    ├─ memory_search results ─────────────── interactive + background_agent only
    │
    └─ [REFERENCE_FILES] hint ────────────── prompt-context.ts:1295
         "read self/index.md for architecture"
    │
    ▼
assembleContext() ─────────────────────── prompt-context.ts:23–35
  joins with PROMPT_CACHE_MARKER
  stable half | volatile half
  adapters strip marker before sending to model
    │
    ▼
Onboarding block (if onboarding_* session) ── meet-prompt.ts:8–105
    │
    ▼
Final System Prompt → model
```

---

## Exception: `team_subagent` ordering

personality comes **before** callerContext, reversing the default order:

```
base → model caps → tool obs → personalityCtx → callerContext → browser
```

vs. everyone else:

```
base → model caps → tool obs → callerContext → browser → personalityCtx
```

Source: `chat.router.ts:3206–3209`

---

## User message carries (not system)

These arrive as the user turn, not the system prompt:

| Runtime | User message content |
|---------|----------------------|
| Standalone subagent | `buildSubagentPrompt()` — subagent-manager.ts:493–520 |
| Heartbeat | HEARTBEAT.md body inline — heartbeat-runner.ts:450–458 |
| Scheduled cron | job prompt + schedule memory + self-reflection suffix |
| Boot | daily startup or hot-restart instructions — boot.ts:100–108 |

---

## Isolated paths (do not use this pipeline)

| Path | Entry point |
|------|-------------|
| Context compactor | chat.router.ts:1527 — no persona, no memory. Mid-workflow compaction also receives a bounded `[RECENT_REASONING_AND_DECISIONS]` block from the active turn's `allThinking` trail so conclusions, ruled-out files/searches, hypotheses, and next-step reasoning survive message trimming. |
| Brain runner | brain-runner.ts — calls handleChat as `cron` (interactive personality) with a per-job tool allowlist; not a separate pipeline |
| Realtime voice | realtime.router.ts:166–214 — separate pack |
| Reactor subagents | reactor.ts:431 — soul-loader.buildSystemPrompt |

---

## Context-window microscope

The live context-window endpoint is `GET /api/sessions/:id/context-window` in `src/gateway/routes/chat.router.ts`.

As of 2026-06-18 it keeps the existing authoritative top-level rows (`Messages`, `System tools`, `System prompt`, `Skills`, `Tool observations`, storage/free-space rows), and adds nested `children` rows for drill-down in the desktop and mobile popovers.

- `System tools` children are estimated from the current active tool schema surface, grouped by `getToolCategory()`, then scaled to the latest recorded `estimatedToolSchemaTokens`.
- `System prompt` children are heuristic block estimates for the known runtime prompt layers (`[PROMETHEUS_SOUL]`, `[USER]`, `[SOUL]`, `[MEMORY]`, `[BUSINESS]`, `[PROJECT_CONTEXT]`, `[TODAY_NOTES]`, tools menu, activated tool blocks, caller/browser/model/base context). The parent `System prompt` total remains the authoritative number.
- `Skills` children are also marked as estimates until the model-usage logger records exact skill hint / matching / active-skill block telemetry.
- `Logged provider usage` is out-of-band and should not be treated as current context size. It drills into `Last provider call` and `Session provider total` so cache reads/writes can be inspected separately from current prompt rows.
- Model-usage events record `estimatedSystemPromptTokens` and `estimatedConversationTokens` separately from total message input. The context-window UI must use that split for `System prompt`; do not infer prompt size by subtracting the current compacted chat history from the last provider call, because compaction and tool-category changes make those snapshots diverge.
- Fresh/idle sessions may have no provider-call telemetry yet. In that case the endpoint estimates current active tool schema directly and builds a no-side-effect prompt estimate so `System tools` and `System prompt` do not collapse to zero before the first model call.

Cache-accounting caution:

- OpenAI/Codex-compatible providers report cache hits as `cached_tokens` inside normal input tokens, so calibration must not add cache-read tokens on top of input tokens.
- Anthropic reports cache reads/writes separately from `input_tokens`, so calibration should add `cache_read_input_tokens` and `cache_creation_input_tokens` when comparing provider input against estimates.

Tool category lifetime:

- `activatedToolCategories` is the persistent session-scope category list.
- `scopedToolCategoryActivations` is the temporary category list. It expires by monotonic `userTurnCounter`, not by raw history length, so rolling compaction or history replacement does not accidentally extend or erase scoped activations.
- Main-chat auto-detection activates categories with `scope:"turn"` only. A category is available for the current assistant run and then falls out when the next user turn increments `userTurnCounter`.
- `request_tool_category` defaults to `scope:"turn"`; use `scope:"session"` only for explicit ongoing workflows, `scope:"next_turn"` for one follow-up user turn, or `scope:"ttl"` with `turns` for bounded multi-turn work.
- Creative categories remain manually requestable but are intentionally not emitted by the generic auto-detection path.

UI renderers:

- Desktop: `web-ui/src/pages/ChatPage.js` renders expandable rows inside the context-window popover.
- Mobile: `web-ui/src/mobile/mobile-context-window.js` renders the same `children` contract in the mobile context chip popover.
- Public generated web UI must stay synced with `npm run sync:web-ui`.

---

## Related

- [21-runtime-prompt-map.md](21-runtime-prompt-map.md) — who gets what, overlap matrix
- [22-runtime-prompt-verbatim.md](22-runtime-prompt-verbatim.md) — literal strings per block
- [03-execution-and-prompting.md](03-execution-and-prompting.md) — execution modes overview
