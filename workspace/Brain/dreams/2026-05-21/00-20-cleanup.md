# Dream Cleanup - 2026-05-21
_Generated: 2026-05-22 00:20 local_

## Cleanup Summary
Memory was already solid overall. The 23:35 Dream reported no new durable memory additions because the only clear preference had already been written live, and the existing USER/SOUL/MEMORY files mostly preserved useful behavior-changing rules with evidence.

I made one tiny memory cleanup: USER.md had a duplicated `[2026-05-21]` date tag on the new voice/desktop screenshot-proof preference. I removed only the duplicate tag and left the wording intact.

Skill curator state was reviewed through the latest curator report and recent additive resources. The 2026-05-21 Brain/Thought resources were generally specific, evidence-backed, and routed correctly. I did not apply pending items, create skills, rewrite SKILL.md, or delete skill resources.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | deduped | Removed a duplicated trailing `[2026-05-21]` tag from the voice-driven browser/desktop screenshot preference; safe because it changed no behavior or fact content. |
| SOUL.md | none | No exact duplicate, contradiction, or clearly stale operational rule was safe enough to remove. |
| MEMORY.md | none | Several entries overlap by theme, but they preserve different dates/evidence/workflows; no safe deletion without losing nuance. |

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_d9b7a00a68919bfd / desktop text-UIA fallback | desktop-automation-playbook | accept | none | Specific future trigger and behavior: if UIA/text helpers are unavailable, fall back to screenshot evidence instead of looping or blocking. Evidence-backed and routed to the right desktop automation skill. |
| sc_03192add612f6ac1 / mobile screenshot updates review-only audit | voice-browser-desktop-smoke-test | accept | none | The reviewed resource has a clear trigger, concrete screenshot-delivery behavior, explicit skip conditions, and a guardrail not to read Codex/Claude content unless asked. Review-only item needs no mutation. |
| sc_51e3e970a8dd9f61 / repeated no-activity scheduled-job failures | scheduler-operations-playbook | accept | none | Meets quality gate: repeated concrete failure pattern, future trigger, diagnostic steps, safe scope, and evidence from cron runs. Correctly routed to scheduler operations. |
| sc_5c4f16d2c5a59bcd / HyperFrames transition slab reset | gsap | accept | none | Useful component/animation recipe with concrete failure mode, GSAP reset pattern, QA note, and evidence. Narrowly improves future HyperFrames/GSAP animation cleanup. |
| sc_eb21d1aa4bf0c1df / voice smoke-test stop-steer guardrail | voice-browser-desktop-smoke-test | accept | none | Strong future behavior lesson: honor stop/steer immediately and do not leak stale completion after cancellation/restart. Evidence-backed and correctly scoped. |
| sc_b843f20c90e35d4b / Reddit OpenClaw scan + live steering | ai-surface-smoke-research | accept | none | Resource is an example, not a broad rewrite; it captures lightweight read-only browser research choreography and live steering behavior with guardrails. Useful despite being less central to tonight's Dream. |
| sc_ef8a97757b882dee / current-chat Creative export Codex handoff | dev-debugging | accept | none | Specific trigger (`same/current chat` Creative export debugging), concrete handoff details, proof-delivery recovery, and evidence. Correctly belongs in dev-debugging. |
| sc_4da1ac077219ab96 / managed-team schedule false-success | scheduler-operations-playbook | accept | none | Clear scheduled-team false-success diagnostic with concrete unhealthy patterns, recovery steps, and evidence. Correct skill and safe additive scope. |
| sc_d680c7718f8e2a99 / Creative stitch rough-cut truncation | prometheus-creative-mode | accept | none | High-value known issue: identifies too-short stitched exports, explicit composite-layer recovery, verification steps, and source-level follow-up candidate. Evidence-backed and narrow. |
| sc_4fd0619ffa02b37c / file-surgery source find_replace recovery | file-surgery | needs_review | none | Curator report listed it as pending, while suggestions.json marks it applied but no corresponding resource exists in the current skill resource list. The lesson is generally valid, but state/resource mismatch makes cleanup unsafe. |
| sc_2682c7d1f6d124fd / file-surgery source find_replace recovery | file-surgery | needs_review | none | Same mismatch as above: applied in suggestions.json, absent from file-surgery resources. Also near-duplicates sc_4fd... but references a different source file; needs tool/state reconciliation, not cleanup mutation. |
| sc_762b76fec9ca194e / Creative export Failed-to-fetch but artifact exists | prometheus-creative-mode | accept | none | The exact suggested resource path is absent, but prometheus-creative-mode already has `references/known-issues/hyperframes-export-failed-fetch-file-exists-2026-05-15.md`, so the lesson appears preserved elsewhere. No deletion/refine needed without inspecting manifest history. |

## Preserved On Purpose
- USER.md keeps both the general desktop coordinate-click preference and the more specific Codex coordinate/shortcut notes because they trigger in different workflows.
- SOUL.md keeps both the general write_note guidance and the more forceful 2026-04-20 write_note operational rule; they overlap, but the later one changes recovery behavior during real work.
- MEMORY.md keeps the source/mobile runbook, dev-live tool rule, proposal executor safety rule, and build/sync key decision even though they overlap; each applies to a different execution lane and removing one could weaken future source-edit behavior.
- MEMORY.md keeps older Xpose Market and team entries even where some “next step” language may be aged, because they preserve project chronology and no newer direct contradiction was present in the inspected files.
