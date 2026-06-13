---
# Dream Cleanup - 2026-06-11
_Generated: 2026-06-12 01:43 local_

## Cleanup Summary
Memory looked solid enough to preserve as-is. I read `USER.md`, `SOUL.md`, `MEMORY.md`, and the latest main Dream artifact at `Brain/dreams/2026-06-11/00-43-dream.md`. The Dream's newly-added context was specific and mostly reconciled into project/entity state rather than bloating durable memory.

No memory edits were made. A few entries are long and overlapping by design, especially Prometheus source-edit/runbook guidance, but the distinctions still change future behavior and were safer to keep than compress during a cleanup pass.

The skill-curator critic pass found recent low-risk curator output that is mostly too generic to be valuable as permanent skill resources. However, the explicit `skill_curator` status/reject tool was not exposed in this cleanup runtime, and skill resource mutation tools were not available in this tool namespace, so I inspected the queue/resources directly and recorded the critic decisions without mutating skills.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact/near duplicate or stale user preference was safe to remove. Desktop-click rules overlap, but each has a different trigger/date and preserves important nuance. |
| SOUL.md | none | Operational rules are dense but not clearly redundant enough for safe deletion. No broad prose polish performed. |
| MEMORY.md | none | Source-edit guidance is intentionally layered across 2026-05-16 and 2026-05-17 entries; kept because each entry captures a different runtime/proposal safety contract. |

_None - memory already looked solid enough to preserve as-is._

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_cd8de9f2b8766cc6 / Add recovery to file-surgery | file-surgery | revert / refine candidate | none - mutation tool unavailable in cleanup runtime | Applied resource is directionally about a real recovery, but it fails the quality gate as written: future trigger preserves raw `find_replace` error text and one specific path fragment, duplicates the existing stronger generic context-drift recovery note, and does not narrow why this 2026-06-12 case adds new behavior. Safe future action: delete it or rewrite it into the already-existing generic context-drift lesson. |
| sc_726fba73b35bc7d5 / Add workflow recipe to browser-automation-playbook | browser-automation-playbook | revert / reject candidate | none - mutation tool unavailable in cleanup runtime | Applied resource is generic placeholder text: "Use this when the user asks for this same operating pattern" and "Consider adding a compact example". It does not state the actual X posting/browser sequence, future trigger, avoid note, or concrete recovery behavior. Fails Future Behavior and Future Trigger. |
| sc_8704b72edb388bef / Add workflow recipe to prometheus-x-posts-workflow | prometheus-x-posts-workflow | needs_review | none | Applied item likely points at real Mara/X posting evidence, but the saved lesson is generic placeholder wording rather than the actual keyboard-first posting/browser-close/no-em-dash workflow. It should be reviewed by Dream or a skill-maintenance pass before keeping. |
| sc_7b64e6b879ce5d07 / Add workflow recipe to x-browser-automation-playbook | x-browser-automation-playbook | needs_review | none | Recent applied workflow recipe likely comes from a successful X browser run, but queue evidence shows the curator pattern tends to save generic template text. Needs direct resource inspection before accept/revert. |
| sc_d1847923e5153913 / Add workflow recipe to prometheus-x-posts-workflow | prometheus-x-posts-workflow | reject candidate | none | Pending business-workflow duplicate for the same 2026-06-12 X posting evidence. Wording is generic and overlaps the applied `sc_8704...` item; not safe to apply as-is. |
| sc_18e1f5e6c2745198 / Review skill change: prometheus-x-research-replies metadata_update | prometheus-x-research-replies | accept review-only | none | Review-only audit item for Brain Dream metadata update. Reason is evidence-backed by the Dream artifact: stale skill IDs earlier; metadata now surfaces browser-first X research/reply workflows and Mara-owned runs. No mutation needed in cleanup. |
| sc_0697f118f1ab230b / Review skill change: prometheus-x-posts-workflow metadata_update | prometheus-x-posts-workflow | accept review-only | none | Review-only audit item matches the Dream artifact and recent successful Mara-owned X posting run. No skill file mutation needed in cleanup. |
| sc_9c56aa850cbe56bd / Review skill change: ai-surface-smoke-research metadata_update | ai-surface-smoke-research | accept review-only | none | Review-only audit item matches today's smoke-test evidence and Raul's screenshot-proof preference for visible desktop actions. No cleanup mutation needed. |
| sc_47ea8672bd7ae38d / Review skill change: local-lead-hunting metadata_update | local-lead-hunting | needs_review | none | Review-only item was a tool smoke-test metadata repair rather than Dream evidence. Not obviously wrong, but should be reviewed in a normal skill-maintenance pass, not mutated here. |
| older pending generic workflow recipes, e.g. sc_3da4aec196ba030a, sc_a68aa5ebf44bb55b, sc_5a60facf09afc0b5, sc_5ef19b61b35cfdf8 | various | reject candidate | none | Pattern is generic "same operating pattern" / "consider adding a template" text. These do not pass Future Behavior or Not Raw/Not Placeholder gates. Cleanup did not bulk reject because `skill_curator action=reject` was unavailable. |

## Fleet Metadata Regression Check
| Check | Result | Action |
|-------|--------|--------|
| skill_audit_all | Scanned 123 skills; 69 flagged at threshold 80. Five severe skills scored 15: `market-research`, `pitch-deck-builder`, `pptx-writer`, `skill-creator`, `social-intel`. Additional low scores included `craigslist-car-search`, `exact-logo-brand-kit-workflow`, and `competitor-profile`; many 90-score flags were only `description_missing_usage_guidance`. | deferred to Dream / no action |
| skill_repair_metadata preview | Preview returned 69 candidate repairs. No apply was run, per cleanup rules. | deferred to Dream; use a curated batch later, not cleanup |
| direct curator status | The requested `skill_curator action=status` tool was not exposed in this cleanup runtime. I inspected `Brain/skill-curator/suggestions.json` and recent skill resources directly instead. | recorded blocker and continued with closest viable audit path |

## Preserved On Purpose
- USER.md desktop automation click guidance looks duplicate-ish across 2026-04-24, 2026-06-11, and Codex-specific notes, but each applies to different surfaces and reinforces a behavior Raul corrected multiple times. Kept.
- MEMORY.md source-edit/dev-live/proposal-executor entries overlap, but one is the source/mobile runbook, one is the smart live-apply tool rule, and one is proposal executor safety. Kept.
- SOUL.md contains both general action-first rules and specific tool routing rules. They are repetitive, but deletion could weaken behavior in future sessions. Kept.
---
