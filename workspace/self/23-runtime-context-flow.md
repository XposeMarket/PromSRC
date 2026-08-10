## 39) Runtime Context Build Pipeline

> Re-verified 2026-08-01. Current source map and costs: [26-runtime-instruction-census.md](26-runtime-instruction-census.md). Current Stage 4 routing: [27-stage4-tool-menu-trigger-benchmark.md](27-stage4-tool-menu-trigger-benchmark.md).

The actual assembly sequence for every `handleChat` turn. Not the architecture overview — just the pipeline in order.

---

```
User Message
    │
    ▼
Router ─────────────────────────────────── chat.router.ts:2049
handleChat()
    │
    ▼
Execution Mode ─────────────────────────── chat.router.ts:2057, 3714–3770
interactive / background_task / cron /
team_subagent / team_manager / proposal_execution /
background_agent / heartbeat
    │
    ▼
buildBaseSystemPrompt() ────────────────── chat.router.ts:3802–3850
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

[WORKING_CONTEXT_PACKETS] ───────────────── session.ts → turn-context-packet.ts → chat.router.ts
last five rich turns at most: the request, safe provider reasoning/decision summary, findings, completed actions, compact tool/progress state, uncertainties, pending work, and a bounded continue-from-here instruction. Simple turns do not create a packet. Private/raw model thinking is never persisted or injected through this lane.

[CODING_CONTEXT_PACKET_V3] ─────────────── coding-context-packet.ts → chat.router.ts:2599
only selected coding continuations receive this durable, structured packet: targeted files/evidence, known build-test commands, the last verification, and a bounded recent terminal-command ledger. The ledger preserves safe command text or process reference, action/kind, outcome, exit code, duration, artifacts, and compact failure kind. It never reinjects raw command output, and redacts command secrets before packet persistence/injection.
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
    ├─ [MEMORY_REFERENCE] local atom compiler over workspace/MEMORY.md (default main path; exact source citations)
    │    raw [MEMORY] remains for Brain/Thought compatibility turns, explicit full-mode rollback/tests,
    │    and direct memory_read; it is not the normal main-chat projection
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
    ├─ memory_search results ─────────────── bounded best-effort evidence sidecar; never awaited solely for first token
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

### Durable MEMORY projection note (2026-08-09)

The atom compiler runs locally during gateway-owned snapshot capture. It preserves each selected bullet's exact source text and line range, and the main path intentionally admits all qualifying direct/related atoms subject only to a source-relative context safety ceiling. This is a recall preference: the system does not reintroduce the old arbitrary eight-hit/short-block truncation merely to save prompt tokens. The broad indexed `memory_search` path is secondary evidence retrieval; its automatic compiler excludes canonical `workspace/MEMORY.md` hits to prevent duplicate durable facts, and it may supplement a turn only when it finishes within work already happening. Otherwise generation proceeds with atom context and the user can request explicit search/read.

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

### Subagent file/memory boundary (2026-07-10)

For `direct_subagent`, `background_agent`, and `team_subagent`, `buildPersonalityContext()` emits the dedicated `[SUBAGENT_SOUL]` plus shared tool-category and skill context. The caller/system overlay supplies canonical `AGENT.md` and the explicit assignment/team context. Those branches do not emit main `[USER]`, `[SOUL]`, `[MEMORY]`, `[BUSINESS]`, `[TODAY_NOTES]`, `[PROJECT_CONTEXT]`, `[CIS_CONTEXT]`, or retrieved-memory blocks. A `switch_model` handoff stays on the full mode-appropriate subagent prompt instead of entering the main switch-model memory branch.

---

## User message carries (not system)

These arrive as the user turn, not the system prompt:

| Runtime | User message content |
|---------|----------------------|
| Standalone subagent | `buildSubagentPrompt()` — subagent-manager.ts:493–520 |
| Heartbeat | HEARTBEAT.md body inline — heartbeat-runner.ts:450–458 |
| Scheduled cron | job prompt + schedule memory + self-reflection suffix |
| Boot | daily startup or hot-restart instructions — boot.ts:100–108 |

## Working context and abort continuity (2026-08-01)

The runtime now has a small continuity lane separate from transcript history:

- `src/gateway/context/turn-context-packet.ts` defines the bounded packet and its prompt formatter.
- `Session.workingContextPackets` retains at most five recent rich-turn packets. A packet is created for tool-using, artifact/file-change, failed, or aborted turns; an ordinary reasoning summary without durable work does not consume this lane.
- `chat.router.ts` keeps provider `onReasoningSummary` deltas separate from private `allThinking`. Only the safe reasoning/decision summary may be placed in a packet or supplied to compaction.
- The main chat abort hook writes an immediate flushed packet from the live runtime checkpoint. The normal post-turn finalizer then merges the richer completed-tool view by `turnId`, so cancellation before model/tool unwinding does not lose the work that preceded it.
- An interrupted tool boundary is recorded as uncertain rather than completed. The next turn is told to verify that boundary before retrying it. Progress-state events are included in the durable checkpoint summary.
- `getWorkingContextForContext(...)` injects the packet window into normal Prometheus turns. Rolling and mid-workflow compaction consume the same packet window, so compaction cannot silently discard the decision trail.

This lane is deliberately not a raw chain-of-thought store. It preserves actionable findings, decisions, evidence references, and continuation state while keeping private reasoning private.

---

## Isolated paths (do not use this pipeline)

| Path | Entry point |
|------|-------------|
| Context compactor | chat.router.ts:1527 — no persona, no memory. Rolling and mid-workflow compaction receive the bounded working-context packets plus the active turn's provider reasoning-summary stream under `[RECENT_REASONING_AND_DECISIONS]`; private/raw thinking is excluded. |
| Brain runner | `brain-runner.ts` first builds the canonical redacted six-hour activity package (`activity-package.ts`), injects it directly into the Thought prompt, then calls `handleChat` as `cron` (interactive personality) with a per-job allowlist. It shares turn execution with chat, but activity assembly is a separate pre-model context lane. |
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

## Persistent Chat Sources / Context — 2026-08-08

`src/gateway/routes/chat.router.ts` calls `ResourceStore.getContext(...)` for the active thread after history and Browser state are known. The resulting `<persistent_chat_resources>` block is included in the same first/subsequent-turn prompt assembly path and in the prompt-cache identity. Attached metadata is bounded to a manifest; source text is loaded selectively for pinned, explicit, or query-relevant resources. The initial total resource block cap is 32,000 characters (approximately 8,000 tokens), with per-resource and manifest caps inside `src/gateway/resources/resource-store.ts`.

This layer is deliberately separate from message history, memory, runtime instruction blocks, and process logs. Resource contents are external/untrusted text. A safety event is emitted only when selected content matches the narrow prompt-injection detector; there is no generic “resource warning” on ordinary turns. See [32-persistent-chat-sources.md](32-persistent-chat-sources.md) for entity, lifecycle, Browser, task, artifact, migration, and security details.
