---
# Dream Cleanup - 2026-06-27
_Generated: 2026-06-28 00:31 local_

## Cleanup Summary
Memory was already solid enough to preserve. `USER.md`, `SOUL.md`, and `MEMORY.md` contain some long operational bullets, but the potentially duplicate-looking items still carry distinct future triggers: dev-source safety, dev-live apply behavior, self-doc path correction, Codex/desktop preferences, and subagent naming/roster behavior.

No memory cleanup edits were made. The latest main Dream (`Brain\dreams\2026-06-27\23-34-dream.md`) also reported that no new memory items passed the gate, so there was no fresh memory insertion to reconcile or dedupe.

Skill curator critic review was blocked by the available cleanup tool surface: `skill_curator`, `skill_audit_all`, `skill_repair_metadata`, and skill resource read/write/delete tools were not exposed in this run. I did not emulate curator mutation through broad skill edits, because the cleanup rules explicitly forbid broad changes and require conservative handling.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | Current entries are behavior-changing preferences/projects; duplicate-looking desktop/Codex notes have different triggers and should be preserved. |
| SOUL.md | none | Workspace persona/operating contract is concise and no exact duplicate or stale rule was found. |
| MEMORY.md | none | Long source-edit/self-doc/schedule/skill rules overlap by topic but are not exact duplicates; each preserves a distinct operational trigger or historical correction. |

_None - memory already looked solid enough to preserve as-is._

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| unavailable curator queue | n/a | needs_review | none | `skill_curator action=status` was not available in this cron tool surface, so pending/applied curator items could not be enumerated or judged safely. |
| latest Dream deferred trigger: `Run the AI smoke test for me` | ai-surface-smoke-research | needs_review | none | Main Dream identified this as a high-confidence targeted trigger patch, but cleanup lacked `skill_update_metadata`/curator tooling; deferred rather than applying outside allowed cleanup tools. |
| Codex desktop recovery workflow proposal | no live matching skill identified by main Dream | needs_review | none | Main Dream says an existing pending skill proposal remains correct; cleanup must not create new skills or proposals. |
| operations-manager terminal echo / `switch_model_low` failure | operations-manager / model routing | accept no-op | none | Main Dream judged this as config-level model-routing failure, not skill content; no cleanup action needed. |
| skill-gardener businessContext false positives | skill-gardener classifier | needs_review | none | Classifier/source reliability issue, not a safe cleanup skill-resource edit. Deferred. |

_(Curator state itself could not be reviewed because the required curator/audit tools were unavailable in this run.)_

## Fleet Metadata Regression Check
| Check | Result | Action |
|-------|--------|--------|
| skill_audit_all | unavailable in this cron tool surface | deferred to Dream / no action |
| skill_repair_metadata preview | unavailable in this cron tool surface | deferred to Dream / no action |

## Preserved On Purpose
- Preserved overlapping Prometheus source-edit rules in `MEMORY.md` lines 8-10 and later fast-route/self-doc rules because they govern different execution contexts: manual build/restart runbook, `prom_apply_dev_changes`, proposal executor validation, dev-edit approval route, and self-doc path correction.
- Preserved Codex desktop notes in `USER.md` because coordinate click, Ctrl+N shortcut, and screenshot/desktop-action preferences each apply to different UI states.
- Preserved subagent roster and subagent naming rules in `MEMORY.md` because one answers “who/how many,” while the other controls display-name wording.
---
