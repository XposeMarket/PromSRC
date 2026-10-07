# 03 — Prompt assembly and context flow

> Last verified: 2026-10-07 against PromSRC a48712ccc · **Owner area:** `src/gateway/prompt-context.ts`, `src/gateway/context/`, `src/runtime/`, `src/config/`
> **Read this when:** changing system-prompt composition, injected workspace memory, model capability context, context budgets, execution-mode behavior, or continuity/compaction.

## TL;DR
- `src/gateway/routes/chat.router.ts` orchestrates a chat turn; `buildPersonalityContext()` in `src/gateway/prompt-context.ts` builds much of the dynamic workspace/persona/tools/skills context. `buildToolsContext()` supplies policy descriptions based on activated categories; actual tool schemas are constructed separately.
- `CATEGORY_POLICIES` and `TOOL_BLOCKS` are prompt-side instructions, not the runtime registry or permission system. The actual provider tool surface and security gates remain authoritative.
- Prompt assembly is execution-mode and profile sensitive. Interactive, background, cron/heartbeat, team and subagent work do not all receive the same user memory, notes, business, project, browser or soul blocks.
- Main interactive context can include `[SOUL]`, `[USER]`, `[MEMORY]`, optional `[BUSINESS]`, `[TODAY_NOTES]`, Brain carry-forward, active skills, matching skills, project/CIS/retrieved-memory and workspace reference context. It is bounded and assembled conditionally.
- Subagent profiles use dedicated `[SUBAGENT_SOUL]` and assignment/team context; they do not implicitly inherit main-user `[USER]`, `[MEMORY]`, `[BUSINESS]`, notes or main memory retrieval.
- `[MODEL_CAPABILITIES]` is injected by chat orchestration from the resolved provider/model snapshot (e.g. vision flag/source); it is turn-specific and may differ after a model switch. Chat orchestration injects `[USAGE_AWARENESS provider=...]` through `formatUsageAwarenessForPrompt()` when a snapshot is available; this is conditional and best-effort.
- Context budgeting is model-aware: `src/gateway/context/model-context.ts` resolves tokenizer/window/output/reasoning profile and budgets; compaction/recovery and turn continuity are separate lanes.
- Runtime prompt-manifest support (`src/runtime/prompt-manifest.ts`) fingerprints prompt systems/capabilities/segments for diagnostics; it is not the prompt builder.
- Prompt strings and list-sized inventory details change often. See [generated/source-map](generated/source-map.md), [generated/tests](generated/tests.md), and the tracked source-copy hint `workspace/self/35-native-tool-category-prompt-signals.md`; verify all claims against live code.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Prompt construction | `src/gateway/prompt-context.ts` → `buildPersonalityContext()` | Main mode/profile selection; receives workspace, session, message, skills and optional snapshot. |
| Category policies | `src/gateway/prompt-context.ts` → `CATEGORY_POLICIES` | Prompt text used to explain category-specific actions. |
| Tool prompt blocks | `src/gateway/prompt-context.ts` → `TOOL_BLOCKS`, `buildToolsContext()` | Builds activated-category guidance, not tool definitions. |
| Main turn assembly | `src/gateway/routes/chat.router.ts` → `handleChat()` | Resolves turn mode, provider/model capabilities, tools and prompt blocks. File is very large; grep for symbols, do not read it all. |
| Model context profile | `src/gateway/context/model-context.ts` → `resolveModelContextProfile()`, context budget helpers | Provider/model-aware tokenization, context window, output/reasoning reserve, trigger/input budget. |
| Prompt cache segmentation | `src/gateway/prompt-context.ts` stable/volatile helpers; `src/gateway/prompt-cache.ts` | Stable prefix and per-turn tail separated with provider cache marker where supported. |
| Session compaction | `src/gateway/session.ts` → compaction helpers; `chat.router.ts` compaction paths | Summarizes/prunes transcript; distinct from prompt memory files. |
| Turn continuity | `src/gateway/context/turn-context-packet.ts` | Bounded presentation-safe findings, decisions, completed work, uncertainties and pending tasks. |
| Prompt diagnostics | `src/runtime/prompt-manifest.ts` → `buildRuntimePromptManifest()` and related types | Captures role/mode/capabilities/system segments/hash/token estimates for inspection. |
| Soul loader | `src/config/soul-loader.ts` → `loadSoul()`, `loadSubagentSoul()`, `loadVoiceSoul()`, `loadPrometheusRuntimeContract()` | Main, subagent and voice source-default paths/fallbacks. |
| Source defaults | `src/config/soul.md`, `subagent-soul.md`, `voice-soul.md` | Main Prom persona, dedicated worker contract, voice persona. |
| Workspace memory source | runtime workspace files + `src/gateway/prompt-context.ts` readers | User-controlled durable context, bounded/conditional per mode. |
| Reference text | `prompt-context.ts` path readers; `src/gateway/routes/chat.router.ts` → `buildBaseSystemPrompt()` | Reference files may be loaded by separate layers; no single `REFERENCE_FILES` export is guaranteed. |
| Generated test map | [generated/tests](generated/tests.md) | Prompt, category-routing, context, continuity and compaction regressions. |

## How it works

### Assembly layers

The request enters `handleChat()` in `src/gateway/routes/chat.router.ts`. It snapshots execution mode/session state, resolves the effective provider/model route and `ModelCapabilities`, builds the provider tool surface, and prepares a base prompt. The router composes the final prompt from several conceptually separate layers:

1. **Runtime contract / global operating instructions** — application-wide action and runtime rules.
2. **Base prompt and capability state** — task/execution framing plus `[MODEL_CAPABILITIES]` based on current resolved model; provider and model are explicit.
3. **Tool guidance** — `buildToolsContext(activatedCategories)` from `TOOL_BLOCKS` and `CATEGORY_POLICIES`; schemas sent to the model come from the tool builder, not these strings.
4. **Personality and workspace context** — `buildPersonalityContext()` selects a profile and conditional memory/project/skill/browser/notes blocks.
5. **Caller, team, channel or task context** — attached according to runtime role and entrypoint.
6. **Conversation messages and compacted history** — session transcript and recent turn state, potentially with safe continuity packet or compaction summary.

Known ordering exception: the team-subagent branch places personality before caller context, unlike the default path. Re-verify this against live `chat.router.ts` / prompt functions before altering.

`CATEGORY_POLICIES` communicates intended use and sharp edges for available categories. It does not grant a capability: actual tool availability is determined by provider tool surface, category activation/filter/cap rules, and runtime permission/approval enforcement. If instructions mention a tool absent from the built surface, fix routing/activation rather than relying on prose.

### Source files, user files and business injection

`src/config/soul-loader.ts` loads source-owned soul/contract defaults. `src/config/public-workspace.ts` seeds user workspace templates only if missing; customized files must be preserved. At prompt time, the builder reads installation-specific content using the effective workspace path. Relevant main-chat files include:

- `SOUL.md`: local persona additions and interaction instructions.
- `USER.md`: profile, preferences and durable operating context.
- `MEMORY.md`: concise durable facts/decisions, subject to mode and budget.
- `BUSINESS.md`: business-level facts only when `businessContextEnabled` is true; it is not unconditional in every profile.
- intraday notes: read-only recent operational continuity injected as `[TODAY_NOTES]` under a prompt-only budget. Writing notes is a separate tool/action and follows note-worthiness rules.

Workspace files are user data. Their absence is normal in a fresh workspace; code may use defaults or omit a section. Prompt loading is bounded and often sanitized/projected. Do not claim the model sees a whole file unless the specific loader/path proves that. Configuration can override workspace path; use the active session/config binding, not a hardcoded `%APPDATA%` path.

`Brain/` is not one monolithic prompt file. Brain carry-forward artifacts and active context may be projected into intraday notes or a compact capsule. The current interactive path does construct a `brainActiveContext` block and emits `[BRAIN_ACTIVE_CONTEXT]` when it has content; it is conditional and profile/mode dependent, not a guaranteed marker in every prompt. `processIntradayNotes()` preserves marked Brain carry-forward and limits recent entries; `processIntradayNotesForPrompt()` is the richer bounded projection used for main-chat context. Avoid confusing durable Brain artifacts with prompt injection.

`[REFERENCE_FILES]` and source-index references orient the model to the architecture docs (including `self/index.md` and `self/06-image-voice.md` in source instructions). These are pointer instructions, not automatically embedded full source trees. An absent local copy means read the actual source or guidebook instead of fabricating the referenced contents.

### Execution modes and profiles

`ExecutionMode` is defined in `chat.router.ts` and includes interactive, background task, proposal execution, background agent, heartbeat, cron, team manager and team subagent. Prompt **profile** is a second axis (for example default, `switch_model`, `local_llm`, `teach_mode`, and direct-subagent profiles); role/profile and execution mode combine to determine what is assembled.

| Mode/profile family | Expected prompt behavior |
|---|---|
| Interactive main chat | Full primary personality/context path; relevant user/soul/memory, skills/categories, recent notes and optional business/project/retrieved context, subject to budget and feature gates. |
| `switch_model` | Uses a turn-scoped generation override prioritized above provider/model overrides; the route snapshot is captured once and does not mutate global config. The prompt/profile path depends on whether the primary is local or cloud; inspect the actual branch. |
| `local_llm` | Explicit low-context profile: local-model time + condensed user memory, optional enabled business profile and skill context; intentionally omits the full soul/notes/tool blocks. |
| `teach_mode` | Adds USER/SOUL and browser/category/skill guidance appropriate to training/teaching; not the normal main-chat prompt. |
| `background_task`, cron, heartbeat | Uses autonomous/task framing and bounded carry-forward; no assumption of normal live interactive prompt or UI state. Heartbeat/schedule-specific instructions may arrive in the user message rather than system block. |
| `background_agent`, `direct_subagent`, `team_subagent` | Dedicated subagent soul + assignment/caller/team overlay. Do not silently copy main user's profile or memory. |
| `team_manager` | Team orchestration role/context; the route composes team instructions and context separately. Verify ordering when changing role prompts. |
| Voice | Voice-specific persona (`voice-soul.md`) and compact spoken-turn framing are selected by the voice runtime; not simply interactive chat with speech-to-text. |

Known ordering exception: the team-subagent branch places personality before caller context, unlike the default path. This ordering is documented in the fresher tracked source-copy prompt map (`workspace/self/21-runtime-prompt-map.md`) and should be re-verified against live `chat.router.ts`/prompt functions before altering.

### Model capabilities, context budget and compaction

`chat.router.ts` resolves model capability facts before building the first system prompt to avoid assembling a prompt with stale/unknown vision behavior. `[MODEL_CAPABILITIES]` records provider, model, `vision=true|false`, and capability source. It is regenerated when route changes; it is not a static property of the Prom persona. Vision-specific policy is elsewhere in the base prompt, so avoid duplicating contradictory rules in the capability block.

`src/gateway/context/model-context.ts` builds provider/model-specific profiles from configured overrides, provider metadata, known model patterns or fallback. Tokenizer family and context-window/output/reasoning capacity feed input budgets, safety headroom, compaction thresholds and tool-context budget. Estimates can be heuristic; the profile tracks its source. Do not hardcode one universal context limit.

Compaction is session/transcript management, not a substitute for USER/MEMORY. Main chat has pre-compaction memory flush/summary prompts, rolling compaction and context-pressure behavior in `src/gateway/session.ts`/`chat.router.ts`. Recovery/resume code preserves durable state and avoids treating provider-private raw thinking as safe continuity.

`TurnContextPacket` in `src/gateway/context/turn-context-packet.ts` is a bounded continuity lane separate from transcript history and raw thinking. It can carry task request, safe reasoning summary, findings, decisions, completed actions, tool/progress state, uncertainties and pending work. The session retains at most five rich-turn packets; packet projection has its own maximum. It is useful for abort/restart/next-turn continuation, not a replacement for full audit/history.

### Prompt caching and diagnostics

`src/gateway/prompt-context.ts` splits stable base/system content from volatile per-turn context at `PROMPT_CACHE_MARKER`; provider adapters decide how to map that marker to caching. Keep high-churn notes, tool observations, project and user request data in the volatile tail when editing cache segmentation. `src/gateway/prompt-cache.ts` manages cache-oriented transformation.

`src/runtime/prompt-manifest.ts` records `callType`, provider/model, runtime role, execution mode, surface, prompt variant, capabilities, system segment IDs, policy IDs, instruction-routing reports, system message hashes/sizes/cache segmentation and message-surface counts/estimates. Use it and actual runtime logs for debugging a prompt that differs from expectation; don't infer final prompt solely from one builder's return string.

## Config & knobs

- Workspace root comes from resolved config/layout (`workspace.path` and runtime workspace selection); see [01 Identity and paths](01-identity-and-paths.md).
- `session.*` config includes compaction controls (memory flush threshold, minimum messages, rolling compaction enable/count/tool-turn/summary/model settings) and main-chat-goal runtime settings. Schema lives in `src/config/config-schema.ts`; implementation lives in session/chat code.
- `llm.provider`, `llm.providers.<id>.model`, and `models.primary` resolve the live route; model-specific context overrides live with config/provider runtime metadata. See [04 Chat pipeline and providers](04-chat-pipeline-and-providers.md).
- Business context injection is session/runtime gated through `businessContextEnabled`; the file may exist without being injected.
- Prompt provider options such as `omitIntradayNotes` can suppress recent notes on smaller/switch-model retries; see `src/providers/LLMProvider.ts` and callsites.
- Provider usage-awareness may feed warning/context snippets from fresh API or response-header snapshots; treat it as best-effort limit context, not guaranteed live meter. See `src/providers/usage-awareness.ts`.

## Gotchas / sharp edges

- **Policy is not permission:** `[CATEGORY_POLICIES]` describes tools, but authorization comes from live tool registration, access controls and approval/denial layers.
- **Main profile is not universal:** background and subagent modes intentionally omit main memory blocks. If a worker lacks context, pass it in its assignment/caller context or an explicit supported memory capability.
- **User files are mutable/private:** source soul defaults do not overwrite workspace content; don't author new policy by editing Raul's USER/MEMORY files.
- **Business file is opt-in:** existence of `BUSINESS.md` does not mean every agent sees it. Verify gate and execution profile.
- **Markers are conditional:** `BRAIN_ACTIVE_CONTEXT`, `TODAY_NOTES`, and cache markers are only emitted in relevant branches when their content/options allow it. Grep live code before asserting a marker for every prompt.
- **Capability can go stale after route switch:** rebuild capability block and context profile after model/provider switch; don't reuse a turn-wide stale value.
- **Context-size estimates are not exact provider usage:** inspect actual provider response/manifest and usage logs; reserve output/reasoning and tool schema budget.
- **Compaction must preserve pending work:** use compaction safety/regression checks and verify “continue from here” rather than relying on a short summary alone.
- **Voice is a distinct surface:** use voice-specific profile/runtime rather than assuming every modality context is present in normal chat.

## How to change it safely

1. Identify exact mode/profile branch and source consumer first. `prompt-context.ts` is large: use targeted grep and line-window reads; do not dump it in full.
2. Trace both system prompt construction and provider/tool surface. Verify tool names/capabilities against [generated/tools](generated/tools.md) and [generated/tool-categories](generated/tool-categories.md); schemas do not come from `TOOL_BLOCKS`.
3. For prompt assembly, add/update focused regressions in `src/gateway/prompt-context*.regression.ts`, `chat.router`-related tests or skill/category routing suite listed in [generated/tests](generated/tests.md).
4. For context/compaction changes, inspect `context/model-context.ts`, session compaction code and `turn-context-packet.ts`; run matching context-window, compaction-safety, restart-compaction and turn-packet regressions.
5. For runtime-manifest changes, validate privacy/scrubbing and deterministic hashes; avoid storing raw secrets or provider-private reasoning in diagnostics.
6. Source modifications follow [07 Source editing and PR workflow](07-source-editing-and-pr-workflow.md); do not alter the read-only PromSRC checkout for this documentation task.
7. Verify the final assembled prompt for interactive, background, team/subagent, model-switch and voice paths affected by the edit. Confirm no cross-user or main-memory leakage to worker prompts.

## Related
- [01 Identity and paths](01-identity-and-paths.md)
- [02 Startup, gateway and runtime](02-startup-gateway-runtime.md)
- [04 Chat pipeline and providers](04-chat-pipeline-and-providers.md)
- [05 Tools and categories](05-tools-and-categories.md)
- [08 Agents, tasks and background work](08-agents-tasks-background.md)
- [09 Teams](09-teams.md)
- [11 Memory, notes and Brain](11-memory-notes-brain.md)
- [generated/tools](generated/tools.md) · [generated/tool-categories](generated/tool-categories.md) · [generated/tests](generated/tests.md) · [generated/changelog](generated/changelog.md)

## UNVERIFIED
- Exact team/voice prompt ordering after recent changes: use `chat.router.ts` and relevant voice entrypoint; the source-copy docs are orientation only.

## Fast prompt-debug workflow

1. Capture session ID, execution mode, runtime actor/profile, workspace root and active provider/model. Avoid copying private prompt text into a public issue.
2. Inspect `chat.router.ts` mode/caller branch and `buildPersonalityContext()` profile branch. Confirm whether this session is main chat, a manager, a subagent, a Brain process, voice or an autonomous schedule.
3. Search the named block marker (`[SOUL]`, `[USER]`, `[MEMORY]`, `[BUSINESS]`, `[TODAY_NOTES]`, `[BRAIN_ACTIVE_CONTEXT]`, `[USAGE_AWARENESS]`, `[MODEL_CAPABILITIES]`) in builder **and** final assembly. A missing block can be correct for that mode.
4. Check `workspacePath` binding and the exact bounded file reader. `loadFullMemoryProfile()` can fall back to caller-supplied workspace paths; do not inspect another agent's files to explain missing main context.
5. Use prompt manifest/hash, model capability snapshot and provider request metadata to distinguish a missing source block from a provider cache/retry that changed the submitted request.
6. Compare system prompt budget, context profile source, history/compaction state and usage in the same turn. A block can have been truncated or omitted due to budget even when loading succeeded.

For prompt-policy changes, preserve privacy boundaries between user, agent, team and worker spaces. Recent context work has included restart-checkpoint replay compaction, bounded tool schemas, working-context packets and Brain carry-forward extraction; these are separate prompt/history mechanisms, so use the source map and changelog when deciding where a new continuity requirement belongs.

The active interactive builder formats `[BRAIN_ACTIVE_CONTEXT]` from a six-hour activity capsule via `buildBrainCapsuleContext()`, separately from today's intraday note projection. `TODAY_NOTES` is produced from `memory/<UTC-date>-intraday-notes.md`; proposal/background-agent paths skip these injections, and autonomous prompt path currently suppresses intraday notes. When a context appears missing, verify mode, timestamp/time-zone path and capsule freshness before treating it as a reader regression.

The interactive path has a separate preloaded subset: in non-public builds it reads `self/index.md` (up to 3,000 characters) and, for voice, `self/06-image-voice.md` (up to 7,000) into `[SELF_INDEX]` and `[SELF_VOICE_SECTION]`. Those are the only explicit architecture/voice files in that branch; the rest remain read-on-demand references under `[REFERENCE_FILES]`. Public distribution builds omit these self-doc reads/hints. This makes file absence/build distribution a meaningful diagnostic branch.

## Prompt architecture guardrails

There are three related but independent “instruction routing” concepts:

1. `CATEGORY_POLICIES`/`TOOL_BLOCKS` in `prompt-context.ts` are human-readable tool-use/category instructions.
2. `instruction-segment-registry.ts` and instruction-intent routing select/trace operating-instruction segments by intent and actor.
3. Provider `tools` schemas represent actionable function contracts; the model output is then checked by the gateway permission/approval system.

Prompt-manifest `declaredPolicyIds`/`systemSegmentIds` are diagnostic identifiers, not prompt text. The current manifest can report instruction resolution and Stage 4 intent-routing results without exposing whole private instructions. For a discrepancy, compare builder output, manifest segment/hash report, final provider surface and tool authorization state separately.

When a safe low-level capability or native category has changed, don't patch the monolithic policy prose alone. Update the owning category/registry/tool builder and then check how it is represented in prompt instructions. [generated/tool-categories](generated/tool-categories.md) is the source-backed list; `self/35-native-tool-category-prompt-signals.md` is a cross-cutting source-copy hint, not the source of enforcement.

## Names and ownership at a glance

| Prompt-visible block / subsystem | Current owner | Trust boundary |
|---|---|---|
| `[SOUL]` / `[USER]` / `[MEMORY]` / `[BUSINESS]` | prompt-context readers + active workspace | Durable user-controlled context; builder may bound, omit or gate it. |
| `[SUBAGENT_SOUL]` / assignment overlay | subagent executor/runtime caller and assigned profile | Worker identity/input; main memory is not inherited implicitly. |
| `[BRAIN_ACTIVE_CONTEXT]` | Brain capsule/context reader in interactive prompt path | Recent compact capsule, not all of `Brain/`. |
| `[TODAY_NOTES]` | intraday note formatter + prompt-context assembler | Read-only short-horizon evidence; the model should not write notes just because they were injected. |
| `[MODEL_CAPABILITIES]` | chat router's current turn route snapshot | Provider/model capability observation; rebuild when the route changes. |
| `[USAGE_AWARENESS]` | usage-awareness cache + router working-context packet | Only the currently selected provider; may be absent/stale or omitted above threshold. |
| `[REFERENCE_FILES]` | profile-specific reference hint in prompt-context | Path pointers/read-on-demand; not guaranteed to preload the linked files. |
| `systemSegmentIds` | runtime prompt-manifest instrumentation | Diagnostic IDs/hashes and structured metadata, not authoritative prompt text. |
