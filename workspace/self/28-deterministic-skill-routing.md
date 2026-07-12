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

1. Explicit `$skill-id`, `skill:skill-id`, direct use/apply/read requests, UI selections, and strong trigger matches produce at most three compact candidates.
2. Candidates contain metadata only. Matching is evidence that a skill may be relevant, never authority to inject its instructions.
3. Prometheus compares candidate descriptions with the complete request and calls `skill_read` for only the single genuinely relevant skill. If none fits, it reads none. It must never read every matching skill.
4. A user-selected skill remains subject to relevance checking; an explicitly requested skill should normally be read unless unavailable, excluded, or clearly unrelated.
5. Definitional mentions such as “what does market research mean?” produce no candidates.
6. A specialized workflow with no plausible candidate receives `SKILL_DISCOVERY_REQUIRED`: call `skill_list` once, then read at most one strong result. Continue without a skill if discovery remains weak.
7. No skill instructions are automatically injected by the resolver. Complete instructions enter the reasoning context only through `skill_read` after Prometheus chooses.
8. After a reusable unmatched workflow, Prometheus may offer a new skill or submit an evidence-backed candidate. It must not mutate the catalog automatically.

## Modes and rollback

- `PROMETHEUS_SKILL_ROUTING_MODE=legacy`: exact pre-Stage-5 prompt builder.
- `PROMETHEUS_SKILL_ROUTING_MODE=shadow`: preserve legacy output while recording deterministic decisions.
- `PROMETHEUS_SKILL_ROUTING_MODE=active`: deterministic candidate filtering, model relevance judgment, and `skill_read`-only instruction loading.

Default source mode is `active`. Whole-stage rollback requires one environment-variable change and a graceful restart.

## Agent surfaces

- Main, teach, local, direct-subagent, background-agent, team-subagent, and tiered prompt paths all call `buildTurnContext`; they share the resolver.
- Realtime voice consumes the same candidate decisions and leaves the final `skill_read` choice to the voice model. Its automation scout no longer auto-reads the first lexical result.
- Prompt manifests retrieve the per-session resolver report immediately before provider dispatch.

## Benchmark and live gates

The deterministic corpus contains 552 cases:

- 120 typed positives.
- 96 voice/transcription variants.
- 240 collision/negative cases.
- 96 no-match discovery cases.

Additional assertions cover explicit multi-skill candidates, explicit-only skills, unrelated UI selection, no automatic instruction injection, complete simple/bundle reads, and legacy/shadow/active rollback behavior.

Live validation must confirm: neutral, explicit skill, strong implicit skill, collision, missing-skill discovery, direct subagent, and Realtime voice metadata behavior after a canonical gateway restart.

## Canonical live validation

The PromSRC gateway was gracefully restarted and verified healthy under a new PID before testing.

Observed pre-dispatch manifests:

| Case | Result |
|---|---|
| Neutral greeting | No skill candidate and no discovery |
| Definitional collision | “What does market research mean?” produced no candidate metadata |
| Explicit main-chat skill | `$market-research` surfaced as a candidate; Prometheus chose it and called `skill_read` |
| Natural specialized request | Product-launch candidates were shown; Prometheus chose the relevant one rather than loading every match |
| Missing specialized workflow | Payroll reconciliation required one `skill_list`, found zero strong matches, and continued without force-loading a weak result |
| Direct subagent | `runtimeRole=direct_subagent`; manifest confirmed candidate metadata only and `autoInjectedInstructions=false` |
| Realtime voice explicit | Matching candidates shown; voice model chooses at most one `skill_read` |
| Realtime voice collision | No matched skills and an empty skill context |
| Realtime voice missing workflow | Required one compact discovery pass and allowed continuation without a skill |

No live validation prompt performed file, proposal, business-record, browser, or external mutations.

## Prompt cost behavior

On the current 145-skill catalog:

- Neutral active skill context: 570 characters / approximately 143 tokens, versus 1,519 characters / approximately 380 tokens in legacy mode—a saving of roughly 238 tokens per unrelated turn.
- A two-candidate product-launch context is approximately 415 tokens versus approximately 602 in legacy mode, before the chosen skill is read.
- Missing-workflow discovery context: 729 characters / approximately 183 tokens, still smaller than legacy while making discovery mandatory.
- Candidate metadata remains compact. A complete skill entrypoint is added only to the next reasoning round after Prometheus calls `skill_read`.
- `skill_read` bypasses the generic 12,000-character tool-result clip, so the complete chosen `SKILL.md` reaches the model. Bundle reads also include the complete resource index; resource contents remain progressive through `skill_resource_read` so templates, examples, assets, and references do not pollute the prompt unless needed.
