# Dream Cleanup - 2026-05-22
_Generated: 2026-05-23 02:06 local_

## Cleanup Summary
Memory was mostly solid and worth preserving. USER.md and SOUL.md had no safe duplicate/stale removals under this conservative pass.

One tiny MEMORY.md formatting cleanup was safe: the 2026-05-22 Telegram duplicate-output note had been appended after the closing footer, so it was moved back under `## task_outcomes` before the file footer. No new memory facts were added.

Skill curator review found three newly auto-applied file-surgery recovery resources that repeated the same generic patch-drift lesson already covered by File Surgery's core playbook. They were over-specific to individual source/file-tool misses, so the resources were deleted from the skill bundle.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact/near duplicate or clearly stale user-memory entry was safe to remove. |
| SOUL.md | none | Recent operational rules are somewhat dense but not exact duplicates; preserving nuance was safer than compression. |
| MEMORY.md | moved footer-adjacent bullet into `## task_outcomes` | The 2026-05-22 Telegram duplicate-output note was below the closing footer. Moving it above the footer repaired structure without adding or changing facts. |

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_bc837098119d3216 / web-researcher provider status note | web-researcher | accept | none | Dated provider-health snapshot has a clear trigger, concrete blockers, safe scope, and evidence. |
| sc_f37719d5d2e9a337 / AI smoke-test example | ai-surface-smoke-research | accept | none | Specific reusable workflow example with tool order, caveats, output pattern, and evidence. |
| sc_ac84f0de67d33585 / browser session recovery guardrail | browser-automation-playbook | accept | none | Strong future trigger for no-session/user-Chrome/about:blank/screenshot-before-open failures; correctly routed and evidence-backed. |
| sc_612e2673cbe90b2b / file-surgery find_replace self doc recovery | file-surgery | revert | deleted resource `references/recovery/recovery-note-find-replace-failed-error-text-not-found-in-self-11-run-an-2026-05-23.md` | Failed right-skill/usefulness quality gate: over-specific to one missing text span and duplicated File Surgery's existing read-again/smaller-patch/recovery protocol. |
| sc_62e20108fce8710c / file-surgery find_replace_webui_source recovery | file-surgery | revert | deleted resource `references/recovery/recovery-note-find-replace-webui-source-failed-text-not-found-in-web-ui--2026-05-23.md` | Same generic patch-drift behavior, routed into broad file-surgery as a narrow source-tool failure; also had a truncated title/header. |
| sc_99efa424a9f0497c / file-surgery find_replace_source recovery | file-surgery | revert | deleted resource `references/recovery/recovery-note-find-replace-source-failed-text-not-found-in-src-gateway-a-2026-05-22.md` | Duplicated existing source/file editing recovery guidance and added noise rather than a new future behavior. |
| sc_48c1831c10ce6457 / mermaid-diagrams metadata review | mermaid-diagrams | accept | none | Review-only audit item; current skill_inspect shows useful diagram triggers/categories and safe overlay metadata. |
| sc_25d1e7116a0eae89 / svg-diagrams metadata review | svg-diagrams | accept | none | Review-only metadata audit appeared narrow and consistent with visual-skill discoverability. No cleanup mutation needed. |
| sc_e0a1aaf61edbdd09 / chart-visualizer metadata review | chart-visualizer | accept | none | Review-only metadata audit appeared narrow and consistent with chart-skill discoverability. No cleanup mutation needed. |
| sc_3cb2773009c73cbf / html-interactive metadata review | html-interactive | accept | none | Current skill_inspect shows clear dashboard/widget triggers and safe overlay metadata. |
| sc_82e61c4ff34d28df / interactive-visuals metadata review | interactive-visuals | accept | none | Review-only router metadata audit looked scoped to discoverability, not a broad rewrite. |
| sc_f2968c87183e0b5c / browse-sh-web-skills skill_created review | browse-sh-web-skills | needs_review | none | New skill creation is high-risk/review-only. Current inspect shows coherent scope and resources, but cleanup pass should not formally approve new-skill creation or delete it. |
| sc_03192add612f6ac1 / voice-browser-desktop smoke-test screenshot example | voice-browser-desktop-smoke-test | accept | none | Resource has clear future trigger, behavior, skip condition, and guardrail not to inspect app contents unless asked. |

## Preserved On Purpose
- USER.md lines 25 and 44 look tensioned: Xpose messaging should avoid explicitly naming Frederick, but lead generation still starts with local Frederick businesses. This distinction matters, so both were preserved.
- SOUL.md has overlapping action-first/tool/skill rules, but they encode different scopes and dates; no safe deletion without weakening behavior.
- The recovered main Dream artifact for 2026-05-22 is messy, but it is an artifact record rather than durable behavior memory, so it was left untouched.
- Browse.sh skill creation remains review-only rather than deleted: it matches explicit 2026-05-22 operating memory, even though new-skill review is outside conservative cleanup scope.
