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
prior tool run log (session-scoped)
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
    │    TOOL_BLOCKS.{category} (per activated category)
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
| Context compactor | chat.router.ts:1527 — no persona, no memory |
| Brain runner | brain-runner.ts — calls handleChat as `cron` (interactive personality) with a per-job tool allowlist; not a separate pipeline |
| Realtime voice | realtime.router.ts:166–214 — separate pack |
| Reactor subagents | reactor.ts:431 — soul-loader.buildSystemPrompt |

---

## Related

- [21-runtime-prompt-map.md](21-runtime-prompt-map.md) — who gets what, overlap matrix
- [22-runtime-prompt-verbatim.md](22-runtime-prompt-verbatim.md) — literal strings per block
- [03-execution-and-prompting.md](03-execution-and-prompting.md) — execution modes overview
