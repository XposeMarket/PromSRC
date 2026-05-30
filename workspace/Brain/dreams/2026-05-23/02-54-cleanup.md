# Dream Cleanup - 2026-05-23
_Generated: 2026-05-24 02:54 local_

## Cleanup Summary
Memory was mostly solid after the main dream. The only safe durable-memory cleanup was a tight USER.md dedupe: two adjacent wake-phrase bullets from the same date said the same thing with slightly different framing, so the older/weaker one was merged into the newer correction.

The skill curator review found the main dream's accepted Thought/Dream updates healthy overall. Two auto-applied generic workflow resources failed the quality gate because they did not name a concrete future trigger or behavior; they were deleted from their target skills. The file-surgery recovery resource and recent smoke-test/desktop/product-carousel skill changes were preserved because they were specific, evidenced, and scoped.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | deduped | Merged two adjacent 2026-05-24 wake-phrase bullets into the newer correction, preserving both the intended phrase “hey Prometheus” and the mis-transcription guardrail. |
| SOUL.md | none | No exact duplicate or clearly stale operational rule was safe enough to remove. |
| MEMORY.md | none | Long-term entries are dense but behavior-changing; no obvious redundant or obsolete item passed the conservative cleanup gate. |

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_3f2af49d3c095262 / Add workflow recipe to web-researcher | web-researcher | revert | deleted resource `references/workflows/web-researcher-2026-05-23.md` | Failed FUTURE_TRIGGER/FUTURE_BEHAVIOR: resource only said “same operating pattern” and “consider adding” a resource, with no concrete workflow. It was meta-curation, not reusable guidance. |
| sc_09565eaec654b56b / Add workflow recipe to browse-sh-web-skills | browse-sh-web-skills | revert | deleted resource `references/workflows/browse-sh-web-skills-2026-05-23.md` | Same quality failure as above: generic auto-applied recipe, no concrete Browse.sh pattern, no selector/API/tool lesson despite evidence links. |
| sc_33e5f07aa01b3a25 / Add recovery to file-surgery | file-surgery | accept | none | Specific failure (`find_replace_source` text-not-found in `realtime.router.ts`), clear recovery behavior, evidenced, safe additive scope. |
| sc_612e2673cbe90b2b / Add recovery to file-surgery | file-surgery | accept | none | Prior duplicate-like recovery had already been removed from the skill resource list; audit item is review-only/pending, and the general behavior is valid but not worth re-adding during cleanup. |
| sc_62e20108fce8710c / Add recovery to file-surgery | file-surgery | accept | none | Similar source/web-ui text-not-found recovery is valid, but the referenced resource is no longer present; no cleanup mutation needed beyond preserving current lean file-surgery state. |
| sc_99efa424a9f0497c / Add recovery to file-surgery | file-surgery | accept | none | Same patch-context drift lesson is valid; current skill only retains the 2026-05-23 realtime-router note, so no further deletion needed. |
| sc_52371b93c278f640 / Review skill change: file-surgery resource_delete | file-surgery | accept | none | Review-only deletion audit aligns with current lean resource list; no bad resource remains. |
| sc_4d61a0732988e6f9 / Review skill change: file-surgery resource_delete | file-surgery | accept | none | Review-only deletion audit aligns with current lean resource list; no bad resource remains. |
| sc_637e59bde9dcc222 / Review skill change: file-surgery resource_delete | file-surgery | accept | none | Review-only deletion audit aligns with current lean resource list; no bad resource remains. |
| sc_443f48f4d1a1cffa / Review skill change: product-carousel-builder skill_created | product-carousel-builder | accept | none | New skill is specific, discoverable, scoped to shopping/product carousel output, includes Amazon example, and does not overlap dangerously with generic web research. |
| sc_48c1831c10ce6457 / mermaid-diagrams metadata_update | mermaid-diagrams | needs_review | none | Review-only metadata audit; not inspected deeply enough in this cleanup to safely accept/reject. |
| sc_25d1e7116a0eae89 / svg-diagrams metadata_update | svg-diagrams | needs_review | none | Review-only metadata audit; not inspected deeply enough in this cleanup to safely accept/reject. |
| sc_e0a1aaf61edbdd09 / chart-visualizer metadata_update | chart-visualizer | needs_review | none | Review-only metadata audit; not inspected deeply enough in this cleanup to safely accept/reject. |
| sc_3cb2773009c73cbf / html-interactive metadata_update | html-interactive | needs_review | none | Review-only metadata audit; main dream already considered visual overlays useful, but this pass did not need broad metadata action. |
| sc_82e61c4ff34d28df / interactive-visuals metadata_update | interactive-visuals | needs_review | none | Review-only metadata audit; main dream accepted discoverability direction, but no direct cleanup action was safe/necessary. |
| sc_f2968c87183e0b5c / browse-sh-web-skills skill_created | browse-sh-web-skills | needs_review | none | High-risk new-skill review item; skill existed before this cleanup and should be judged in a dedicated skill review, not deleted here. |
| ai-surface-smoke-research Thought updates | ai-surface-smoke-research | accept | none | Trigger additions and interrupted browser target-closed example are concrete, evidenced, future-triggered, and narrow. |
| desktop-automation-playbook stress-test updates | desktop-automation-playbook | accept | none | Stress-test resource captures real tool availability/fallback lessons, stale screenshot recovery, File Explorer fallback, and foreground-only desktop limitations. |

## Preserved On Purpose
- USER.md line about foreground tool-use sentence was kept even though action-first instructions elsewhere can conflict; it is a direct, dated user preference and not safe to remove in cleanup.
- MEMORY.md source/build/runbook entries overlap somewhat, but each serves a different future trigger: general source/mobile flow, dev-live `prom_apply_dev_changes`, and proposal-executor validation.
- Review-only metadata/new-skill curator audit items were mostly left pending/needs_review rather than mutated because this cleanup pass is intentionally conservative.
