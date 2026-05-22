# Dream Cleanup - 2026-05-18
_Generated: 2026-05-19 15:56 local_

## Cleanup Summary
Memory was already solid enough to preserve as-is. USER.md, SOUL.md, and MEMORY.md contain some overlapping operational themes, but the apparent overlap is mostly layered context with different scope: user preference, assistant operating rule, and project/source runbook. No memory text met the strict bar for safe deletion.

The skill curator review found the main Dream-applied scheduler guardrail and Thought-side source/voice updates useful and scoped. Three auto-applied low-risk recovery resources were removed because they either duplicated an existing stronger known-issue note or stored overly narrow/raw `find_replace_source` failures in the broad `file-surgery` skill.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact/near-exact duplicate was clearly safe to remove; preference bullets are specific and still useful. |
| SOUL.md | none | Operational rules are dense but not clearly redundant enough for conservative cleanup. |
| MEMORY.md | none | Some source/build guidance overlaps by design across runbook/tool/proposal-executor layers; preserving nuance was safer than merging. |

None - memory already looked solid enough to preserve as-is.

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| Dream update: `notes/failure-looking-success-results-2026-05-18.md` | scheduler-operations-playbook | accept | none | Passes the quality gate: clear future trigger for scheduled jobs with success status but error-like output, concrete verification behavior, correct scheduler skill, and direct evidence from the Weekly Opportunity Radar false-success run. |
| Thought update: `notes/restart-continuity-and-dirty-state-2026-05-18.md` | src-edit-proposal-rigor | accept | none | Specific, source-edit relevant, evidence-backed, and changes future behavior after restart/resume by requiring actual approval/dirty-state/build verification before summarizing. |
| Thought update: `notes/source-path-and-mutation-scope-2026-05-18.md` | src-edit-proposal-rigor | accept | none | Specific to Prometheus source-edit proposal/execution rigor, with a clear trigger around source-relative paths, mutation scope, and recovery from syntax-rejected edits. |
| Thought manifest overlay triggers/categories | voice-browser-desktop-smoke-test | accept | none | The overlay routes Raul's repeated voice/browser/desktop smoke-test phrases to the right skill and tool categories without broad instruction changes. |
| sc_4fd0619ffa02b37c / Add recovery to file-surgery | file-surgery | revert | deleted resource `references/recovery/recovery-note-find-replace-source-failed-text-not-found-in-src-gateway-s-2026-05-18.md` | Fails right-skill/safe-scope quality gate. It captured a narrow Prometheus source-tool failure as a generic file-surgery recovery and duplicated existing file-surgery guidance to re-read exact lines after drift. |
| sc_2682c7d1f6d124fd / Add recovery to file-surgery | file-surgery | revert | deleted resource `references/recovery/recovery-note-find-replace-source-failed-text-not-found-in-src-gateway-c-2026-05-18.md` | Same issue as above: too narrow/raw and source-tool-specific for `file-surgery`; the useful behavior is already covered by the skill's core loop and the accepted `src-edit-proposal-rigor` source-path/mutation-scope note. |
| sc_762b76fec9ca194e / Add recovery to prometheus-creative-mode | prometheus-creative-mode | revert | deleted resource `references/recovery/creative-export-failed-to-fetch-but-artifact-exists-2026-05-15.md` | Duplicated the stronger existing known-issue note `references/known-issues/hyperframes-export-failed-fetch-file-exists-2026-05-15.md`, which has better failure signature, recovery checklist, and evidence. |
| Latest curator status report pending items at `skill_curator_2026-05-19T19-22-57-144Z.md` | file-surgery / prometheus-creative-mode | needs_review | none | The report listed three pending suggestions mirroring the same resources above, but the canonical `suggestions.json` showed those IDs as applied. I removed only the actual applied resources and did not mutate the curator registry directly. |

## Preserved On Purpose
- MEMORY.md lines 8-10 all discuss Prometheus source/mobile/build/dev-live safety, but they apply at different levels: broad source/mobile runbook, `prom_apply_dev_changes` dev-live preference, and proposal-executor completion requirements. Kept all three.
- SOUL.md has both general conversational-turn/tool-call rules and later skill-check preferences; they overlap but serve different trigger contexts, so no deletion was safe.
- USER.md local/Frederick/Xpose notes may look repetitive, but one records positioning preference while another records the actual lead-generation starting market. Kept both.
