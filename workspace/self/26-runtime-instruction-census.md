# 26) Runtime Instruction Census

Verified 2026-07-12 against the active `C:\Users\rafel\PromSRC` working tree (base commit `15263a8d9aca76c0e39e8461c0d91f5282ef614e`). The working tree is intentionally dirty; this census describes the current files, not only `HEAD`.

This is the authoritative inventory produced from Threads 7–10. Documents 21–23 remain useful historical detail, but any conflicting line number, role matrix, or token estimate is superseded here.

## Measured baseline

- Live gateway process: `src/gateway/server-v2.ts` from `PromSRC`.
- Recent real main-chat provider calls before this redesign reported about 19,643 estimated system-prompt tokens and 19,132 estimated tool-schema tokens.
- The current context-window endpoint estimated 13,136 system-prompt tokens and 16,229 tool-schema tokens for an empty/default session. That endpoint is heuristic; provider-dispatch manifests are authoritative after Phase 2.
- `buildToolsContext(new Set())`: 12,876 characters, approximately 3,219–3,480 tokens depending tokenizer.
- Full static `TOOL_BLOCKS` pool: 25,683 characters, approximately 6,400–6,942 tokens.
- Base private tool surface with no activated category: 34 schemas / 50,287 serialized characters / about 12,572 raw estimated schema tokens.
- Phase 4 static private validation surface: 143 tools; public: 137; classifier mismatches: 0.

## Main injection map

| ID / source | Code location | Injection time | Recipients | Static/conditional | Approximate cost | Principal overlap |
|---|---|---|---|---|---:|---|
| Core base prompt | `src/gateway/routes/chat.router.ts::buildBaseSystemPrompt` | Every `handleChat` generation | Main and all `handleChat` roles | Mixed | ~500–2,000+ tokens depending Creative/team/vision | Souls, mode callers, tool policies |
| Execution-mode block | `chat.router.ts::executionModeSystemBlock` | Every non-default mode | Task, proposal, agent, team, cron, heartbeat | Role conditional | ~40–170 | Caller role text |
| Model capability block | `chat.router.ts::buildModelCapabilitySystemBlock` | Every provider generation | All `handleChat` roles | Provider/model conditional | ~20–60 | Current-model block and schema filtering |
| Current model block | `chat.router.ts::formatCurrentModelSystemBlock` | Every provider generation | All `handleChat` roles | Provider/model conditional | ~30–70 | Capability block and UI telemetry |
| Visual grounding policy | `chat.router.ts::buildBaseSystemPrompt` | Every `handleChat` turn | All roles | Vision capability conditional | ~100–250 | Browser/desktop policy and schemas |
| Skill recovery policy | `chat.router.ts::buildBaseSystemPrompt` | Every `handleChat` turn | All roles | Static | ~30 | Skills hint and skills policy |
| Team routing policy | `chat.router.ts::buildBaseSystemPrompt` | Managed teams exist and caller is not subagent | Main/manager | State conditional | ~100 | Tools menu and team callers |
| Creative policy | `chat.router.ts::buildBaseSystemPrompt` | Every turn; full when Creative active | All `handleChat` roles | State conditional | ~50 inactive; several thousand active | Creative schemas/category blocks |
| Plan protocol | `chat.router.ts::planProtocolInstruction` | Every turn | All `handleChat` roles | Role conditional | ~40–100 | Task/team caller planning |
| Visible-work-update rule | `chat.router.ts::buildBaseSystemPrompt` | Interactive only | Main/direct chat | Mode conditional | ~90 | Caller/status narration |
| Config soul | `src/config/soul.md` via `loadSoul()` | Main first/subsequent, switch-model, proposal | Prometheus-owned paths | File-backed | 8,906 chars / ~2,408 raw | Workspace SOUL and base identity |
| Subagent soul | `src/config/subagent-soul.md` | Direct/background/team subagent | Subagents only | Role conditional | 3,359 chars / ~908 | AGENT.md and caller identity |
| Voice soul | `src/config/voice-soul.md` | Voice-agent profile | Voice worker | Role conditional | 1,596 chars / ~432 | Workspace SOUL and voice contracts |
| USER | `workspace/USER.md` | Main, teach, voice, switch-model | Prometheus-owned paths | File-backed | 3,613 chars / ~977 raw | MEMORY and caller preferences |
| Workspace SOUL | `workspace/SOUL.md` | Main, teach, voice, background task/heartbeat | Prometheus-owned paths | File-backed | 3,542 chars / ~958 raw | Config soul |
| MEMORY | `workspace/MEMORY.md` | Main, switch-model, background task/heartbeat | Prometheus-owned paths | File-backed | 30,061 chars / ~8,125 raw; main path currently passes no explicit cap | Indexed retrieval and USER/SOUL |
| BUSINESS | `workspace/BUSINESS.md` | Business mode or applicable autonomous path | Prometheus-owned paths | State conditional | 3,007 chars / ~813 | CIS/entity context and menu |
| Intraday notes | `workspace/memory/*-intraday-notes.md` | Interactive main/manager | Prometheus-owned interactive | Volatile | ~0–800 | MEMORY/retrieval |
| Retrieved memory | `prompt-context.ts::buildRetrievedMemoryContext` | History cue | Interactive main only | Intent conditional | ~0–1,000 | Full MEMORY |
| CIS context | `business/cis-context-builder.ts` | Entity/business match | Most non-subagent Prometheus paths | Intent/state conditional | ~0–500 | BUSINESS and business entities |
| Project context | `projects/project-store.ts` | Project-bound session | Main, voice, task paths | State conditional | Variable | Caller/task context |
| Subagent roster | `prompt-context.ts::buildSubagentsRosterBlock` | Main subsequent turns | Main/manager interactive | State conditional | ~40–300 | Agent tools/menu |
| Always-on tools menu | `prompt-context.ts::buildToolsContext` | Nearly every non-local `handleChat` path | Main/tasks/subagents/teams | Static plus state | 12,876 chars legacy | Schemas, category policy, callers |
| Category policy | `prompt-context.ts::CATEGORY_POLICIES` | Category active | Tool-capable roles | Category conditional | ~88–1,503 tokens/category | Schemas and menu |
| Skill turn hint | `skills-runtime/skills-manager.ts::buildTurnContext` | Every applicable turn | Main/tasks/subagents/voice | Mixed | ~200–600 | Always-on skill block and schemas |
| Active skills digest | `prompt-context.ts::buildActiveSkillsContext` | A skill was read | Current session | State conditional | Variable | Matching hint and full `skill_read` result |
| Caller context | Task/team/cron/boot/voice builders | Mode entry | Assigned role | Caller conditional | ~0–several thousand | Mode, tools, AGENT.md |
| Browser state | `chat.router.ts::browserStateCtx` | Browser session active | Current role | State conditional | ~50–250 | Browser policy and tool results |
| Recent tool observations | `session.ts` → `handleChat` | Prior tool turns | Non-cron roles | Volatile | capped ~1,000–2,200 chars | Tool results/history |
| Onboarding | `onboarding/meet-prompt.ts` | Onboarding session | Main | Session conditional | Variable | Base identity/style |
| Pinned messages | `handleChat` message assembly | Pins supplied | Current session | Message conditional | Variable | Conversation history |
| Conversation history | `getHistoryForApiCall` | Non-cron | Current session | Dynamic | Variable | Compaction summary |
| Tool schemas | `tool-builder.ts::buildTools` | Before provider call | Tool-capable roles | Capability/category/build conditional | Often 12K–20K tokens | Menu/category policy |
| Browser result wrapper | `chat/chat-helpers.ts::wrapUntrustedBrowserToolContent` | After browser call | Next model round | Tool-call-time | ~50 + result | Universal/browser trust policy |
| Goal reminders / screenshot packets | `chat.router.ts` tool loop | After tool calls | Next model round | Tool-call-time | Variable | Caller/plan state |
| OpenAI compatible Codex preamble | `providers/openai-compat-adapter.ts` | Only compat adapter with id `openai_codex` | That provider path | Provider conditional | ~30 | Prometheus/base identity |
| OpenAI Codex Responses instructions | `providers/openai-codex-adapter.ts` | Every Codex OAuth call | Codex provider | Provider conditional | Uses runtime system unchanged; fallback ~20 | Base identity |
| Anthropic Claude Code preamble | `providers/anthropic-adapter.ts` | OAuth calls | Anthropic OAuth | Provider conditional | ~15 | Prometheus/base identity |
| Anthropic prompt trimming | `anthropic-adapter.ts::trimSystemForBudget` | Context pressure | Anthropic | Provider/model conditional | Can remove notes, MEMORY, USER, and truncate SOUL | Runtime ownership guarantees |
| Cache marker | `providers/LLMProvider.ts` + `content-utils.ts` | Prompt assembly/provider dispatch | All providers | Provider conditional | No model-visible tokens | Stable/volatile ordering |
| Realtime voice pack | `routes/realtime.router.ts`, `chat.router.ts` voice builders | Voice endpoint | Voice runtimes | Separate runtime | Several thousand to ~18K chars | Main identity, voice worker rules |
| Reactor prompt | `agents/reactor.ts` + `soul-loader.ts` | Legacy/native reactor execution | Reactor agents | Separate path | Variable | Main/subagent soul and tool schema text |
| AGENT.md | `agents/agent-prompt-file.ts` and callers | Subagent/team run | Specific subagent | File-backed role conditional | Variable | Subagent soul/caller identity |

## Role/personality matrix

| Runtime | Effective context |
|---|---|
| Main interactive | Base + config soul + USER + workspace SOUL + MEMORY + optional BUSINESS/project + intraday/retrieval/CIS + tools + skills |
| Local primary | Condensed USER + time/delegation + optional BUSINESS + active skills; no normal tools/persona block |
| Direct subagent | Base worker identity + subagent soul + AGENT.md/caller + tools + skills; no main USER/SOUL/MEMORY/BUSINESS/CIS/retrieval |
| Background agent | Same isolation plus spawning prompt/reference hint and task caller |
| Team subagent | Same isolation plus team AGENT.md, workspace/room/assignment caller; caller currently contains contradictory “You are Prometheus” text |
| Team manager | Main interactive personality plus manager execution/caller context |
| Background task | Base + workspace SOUL + MEMORY + optional BUSINESS/project/CIS + tools + skills; USER excluded |
| Proposal execution | Base + config soul + optional BUSINESS/project/CIS + tools + skills; USER/MEMORY excluded |
| Prometheus cron | Cron base block but interactive personality branch; history is empty |
| Heartbeat | Base + workspace SOUL + MEMORY + optional BUSINESS/project/CIS + tools + skills |
| Voice agent | Voice soul + USER + workspace SOUL + project + BOOT/self voice docs + retrieval + skills |
| Realtime | Separate voice identity/authority/tool pack |

## Confirmed duplication and legacy fragments

1. Config soul and workspace SOUL overlap in main chat.
2. Full MEMORY can overlap indexed retrieval and intraday notes.
3. Tool behavior repeats across schemas, the ~3.2K-token menu, category policies, caller contexts, and result wrappers.
4. Skills repeat in the base recovery rule, always-on skills block, turn hint, possible/user-selected matches, active digest, schemas, and full skill results.
5. Browser/desktop behavior repeats in base capability policy, category policies, schemas, session state, approvals, and result wrappers.
6. Team caller text says “You are Prometheus” while the execution-mode/base identity says the team member is not Prometheus.
7. `TOOL_BLOCKS.web`, `task`, `schedule`, `browser_vision`, and `agent_builder` are not direct current category-policy owners. Web guidance is duplicated in the always-on SEARCH section.
8. `ui-action-policy.ts::evaluateUiActionRisk` has no execution-path callers outside its own module; prompt/schema approval prose still carries part of the burden.
9. `buildPersonalityContext` retains a compatibility calling convention for obsolete skill-window arguments.
10. Documents 21–23 contain old `system_prompt.md`, AGENTS/TOOLS injection, voice, line-number, role, and token-budget fragments beneath newer correction notes.

## Deterministic injection design

Always-on: role identity, instruction precedence, truthful verification, authorization/final-action boundary, untrusted-content rule, short tool contract, escalation target.

Capability/state: provider, model, vision, platform, available categories, project/business/browser state.

Intent-triggered: file edits, command execution, runtime proposal workflow, web/current research, and business/entity context.

Tool-call-time: detailed operation mechanics, approval fields, untrusted-output wrappers, recovery/postconditions.

Role-specific: main, direct/background/team subagent, manager, task, proposal, cron, heartbeat, voice.

Migration gates: manifest first; canonical category registry with legacy/shadow/canonical modes; stable segment IDs; low-risk category-policy pilot; large independent trigger suite; exact legacy restoration; per-segment and whole-stage rollback; live canonical-gateway smoke tests.
