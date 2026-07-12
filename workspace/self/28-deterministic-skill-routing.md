# 28) Deterministic Skill Routing

Verified 2026-07-12 against canonical `C:\Users\rafel\PromSRC`.

## Pre-change inventory

The canonical workspace contains 145 ready skill packages. Their complete entrypoint instructions total approximately 594,308 characters. Median entrypoint size is approximately 1,589 characters; the largest observed entrypoint is 63,240 characters. Loading every skill is therefore impossible and unnecessary.

Current ownership before Stage 5:

| Concern | Source | Behavior before Stage 5 | Gap |
|---|---|---|---|
| Metadata ranking | `src/gateway/skills-runtime/skills-manager.ts::rankSkillMatches` | Scores names, triggers, metadata, descriptions, and domains | Full-name mentions could be mistaken for invocation |
| Main/subagent prompt | `SkillsManager.buildTurnContext` via `prompt-context.ts` | Always injects general rules and advises one high-confidence `skill_read` | Reading remains model-discretionary; no complete instructions are injected |
| Explicit UI selection | `forcedSkillIds` | Lists selected skills and asks the model to inspect relevance | No deterministic selected/rejected decision |
| Tool discovery | `skill_list` / `skill_read` | Compact ranked discovery; `skill_read` returns full entrypoint and activates session state | No-match workflow discovery remains discretionary |
| Active-session reminder | `buildActiveSkillsContext` | Description and “re-read if needed” | Does not preserve full instructions across later turns |
| Realtime voice | `buildRealtimeSkillContextForTranscript` | Separate matching path; up to five metadata matches | Could diverge from main routing and surface weak matches |
| Post-workflow learning | `recordSkillGardenerTurn`, candidates, Curator | Records evidence; mutations require review/direct request | Prompt wording did not clearly distinguish offering/candidate creation from automatic mutation |
| Observability | Runtime prompt manifest | Skill marker presence only | No selection reason, exclusion, discovery decision, or injected size |

Skill instructions are received in full only after a successful `skill_read` tool result. Activated-session reminders contain descriptions rather than the complete `SKILL.md`.

## Stage 5 decision model

The canonical resolver is `src/runtime/skill-routing-resolver.ts`.

1. Explicit `$skill-id`, `skill:skill-id`, or a direct use/apply/read instruction may select up to three skills.
2. A user-selected skill is loaded only when the current request ranks it at least medium relevance; unrelated selections are recorded but not injected.
3. Without an explicit selection, at most one implicit skill is selected. It must be high confidence, eligible, domain-consistent, and supported by an exact/strong trigger or multiple matching domains.
4. Definitional mentions such as “what does market research mean?” do not invoke a same-named skill.
5. Medium matches are advisory only and never loaded automatically.
6. A specialized workflow with no unambiguous match receives `SKILL_DISCOVERY_REQUIRED`: call `skill_list` once, then read at most one strong result. Continue without a skill if discovery remains weak.
7. Active selected skills are injected with their complete entrypoint content between `ACTIVATED_SKILL` markers. Content is not truncated.
8. After a reusable unmatched workflow, Prometheus may offer a new skill or submit an evidence-backed candidate. It must not mutate the catalog automatically.

## Modes and rollback

- `PROMETHEUS_SKILL_ROUTING_MODE=legacy`: exact pre-Stage-5 prompt builder.
- `PROMETHEUS_SKILL_ROUTING_MODE=shadow`: preserve legacy output while recording deterministic decisions.
- `PROMETHEUS_SKILL_ROUTING_MODE=active`: deterministic conditional context and complete selected instructions.

Default source mode is `active`. Whole-stage rollback requires one environment-variable change and a graceful restart.

## Agent surfaces

- Main, teach, local, direct-subagent, background-agent, team-subagent, and tiered prompt paths all call `buildTurnContext`; they share the resolver.
- Realtime voice now consumes the same resolver decisions, marks required versus advisory reads, and requires `skill_list` only for deterministic no-match workflow discovery.
- Prompt manifests retrieve the per-session resolver report immediately before provider dispatch.

## Benchmark and live gates

The deterministic corpus contains 552 cases:

- 120 typed positives.
- 96 voice/transcription variants.
- 240 collision/negative cases.
- 96 no-match discovery cases.

Additional assertions cover explicit multi-skill selection, explicit-only skills, unrelated UI selection, complete untruncated instruction injection, and legacy/shadow/active rollback behavior.

Live validation must confirm: neutral, explicit skill, strong implicit skill, collision, missing-skill discovery, direct subagent, and Realtime voice metadata behavior after a canonical gateway restart.

## Canonical live validation

The PromSRC gateway was gracefully restarted and verified healthy under a new PID before testing.

Observed pre-dispatch manifests:

| Case | Result |
|---|---|
| Neutral greeting | No selected or advisory skill; no discovery |
| Definitional collision | “What does market research mean?” selected nothing and exposed no advisory metadata |
| Explicit main-chat skill | `$market-research` selected by `explicit_mention`; all 953 entrypoint characters injected |
| Natural specialized request | Product-launch request selected `product-launch-video`; all 23,835 entrypoint characters injected |
| Missing specialized workflow | Payroll reconciliation selected nothing, required one `skill_list`, found zero strong matches, and continued without force-loading a weak result |
| Direct subagent | `runtimeRole=direct_subagent`; complete `market-research` instructions injected without main USER/MEMORY context |
| Realtime voice explicit | `market-research` marked `REQUIRED READ`; weaker candidates advisory only |
| Realtime voice collision | No matched skills and an empty skill context |
| Realtime voice missing workflow | Required one compact discovery pass and allowed continuation without a skill |

No live validation prompt performed file, proposal, business-record, browser, or external mutations.

## Prompt cost behavior

On the current 145-skill catalog:

- Neutral active skill context: 513 characters / approximately 129 tokens, versus 1,519 characters / approximately 380 tokens in legacy mode—a saving of roughly 251 tokens per unrelated turn.
- Missing-workflow discovery context: 672 characters / approximately 168 tokens, still smaller than legacy while making discovery mandatory.
- A selected skill intentionally increases the first provider call by its complete entrypoint size. For `product-launch-video`, this is approximately 5,959 instruction tokens. This replaces a discretionary later `skill_read` round and guarantees the complete instructions are present before reasoning/action.
- Selected skill content is volatile task context and therefore changes the prompt hash. Stable core prompt prefixes remain separately cacheable on providers that honor the existing cache marker.
