---
# Dream Cleanup - 2026-06-19
_Generated: 2026-06-20 00:46 local_

## Cleanup Summary
Memory was already solid enough to preserve as-is. USER.md, SOUL.md, and MEMORY.md contain a few overlapping Prometheus self-edit and desktop/Codex operating rules, but the overlaps carry different recall triggers or operational nuance, so cleanup did not remove them.

The latest main Dream artifact, `Brain/dreams/2026-06-19/00-01-dream.md`, reported no durable memory updates for the night and focused on PromSite pricing, mobile drawer close-button placement, Codex desktop recovery, and skill-trigger cleanup. Nothing in that artifact made an existing durable memory clearly stale or contradictory.

Skill curator review was conservative. The callable `skill_curator`, `skill_audit_all`, and `skill_repair_metadata` tools were not exposed in this cron runtime, so I inspected the available Brain Skill Gardener files, recent skill history ledger entries, and relevant skills directly. No safe rejection/revert/refine action was available through the exposed tools, and no skill resource clearly needed deletion.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact duplicate or clearly stale preference found. Self-doc/source-edit rules overlap with MEMORY.md but are useful in USER as Raul-specific preferences. |
| SOUL.md | none | Workspace persona and mechanics are compact and current; no cleanup-safe duplicate found. |
| MEMORY.md | none | Some Prometheus self-edit/build/doc rules are redundant by design across runbooks, but each preserves different detail. The post-footer subagent naming rule is messy formatting, but not safe to move/delete during conservative cleanup because it changes recall surface. |

_None - memory already looked solid enough to preserve as-is._

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sg_a9c2dba8ca2080a0 / close Claude + Edge failure note | browser-automation-playbook | needs_review | none | Evidence is a desktop app close workflow but routed to browser-automation-playbook. RIGHT SKILL fails; however it was only a captured candidate, not an applied resource visible to revert. |
| sg_7f25e42a95d38884 / close Claude + Edge workflow template | browser-automation-playbook | needs_review | none | Same routing issue: desktop window/app control belongs in desktop automation or a Codex/app recovery skill, not browser automation. No exposed curator queue action available. |
| sg_50c67a76ec493fe4 / terminal smoke-test recovery | windows-shell-playbook | accept | none | Evidence-backed and future-actionable: direct PowerShell shell avoids cmd-wrapped `$i` variable mangling. The skill now contains `references/terminal-tool-smoke-test.md`, which is specific and useful. |
| sg_d30267d79df1e44c / skill update run should add resource to skill-creator | skill-creator | needs_review | none | The actual lesson belongs to windows-shell-playbook, not necessarily skill-creator. The candidate is generic “add compact example” wording, so it should not be auto-applied in cleanup. |
| sg_72d1b15c5c0a3506 / update_existing_skill after terminal update | windows-shell-playbook | accept | none | The terminal smoke-test lesson is already captured in the right skill with a concrete trigger and guardrail. No duplicate resource cleanup needed. |
| sg_f01dea17e2ba349c / workflow recipe from skill update session | windows-shell-playbook | accept | none | Accept as raw evidence only. The existing resource is better than a transcript-style generic workflow recipe, so no additional edit. |
| sg_807c0cf47f71e3fb / check whether Codex is frozen | dev-debugging | needs_review | none | The user asked for visible desktop status inspection, while dev-debugging is mainly Codex handoff. Directionally related, but better handled by the proposed Codex desktop recovery skill from the main Dream. |
| sg_44a4dbafc8b9cd37 and repeated Codex close/reopen candidates | none / Codex recovery candidate | accept | none | Repeated evidence supports the main Dream’s proposal for a dedicated Codex desktop recovery skill. Cleanup must not create new skills or proposals, so preserved as evidence. |
| sg_cf25773aa458a8d7 / “Again” Codex close-reopen episode | none | accept | none | Low-context repeat strengthens the recurring workflow signal but is not independently actionable as a skill resource. Preserved as raw evidence only. |
| 2026-06-19 metadata repair batch in `skills/.history/skill-change-ledger.jsonl` | fleet manifests | accept | none | Ledger shows trigger cleanup across many skills with metadata-repair entries and no resource rewrites. Main Dream reported flagged=0 avgScore=100. No regression obvious from sampled matched skills. |

## Fleet Metadata Regression Check
| Check | Result | Action |
|-------|--------|--------|
| skill_audit_all | Not run: tool was not exposed in this cron runtime. Existing main Dream evidence reported fleet trigger cleanup: 123 skills, flagged=0, avgScore=100. | deferred to Dream / no action |
| skill_repair_metadata preview | Not run: tool was not exposed in this cron runtime. Cleanup did not apply any metadata repair. | deferred to Dream / no action |
| Manual ledger/skill spot check | Recent ledger entries were metadata-only trigger cleanup; sampled matched skills still had realistic trigger phrases and no obvious broad SKILL.md pollution. | no action |

## Preserved On Purpose
- USER.md line 47 and MEMORY.md line 95 both mention `workspace/self/`; preserved because USER captures Raul-facing preference, while MEMORY keeps operational source-edit context.
- USER.md lines 49-51 and MEMORY.md lines 8-10/92/94 overlap on Prometheus self-edit workflow; preserved because MEMORY carries build/sync/restart detail and USER carries Raul’s direct preference for dev edits and live verification.
- MEMORY.md lines 100 and 104 both concern subagent naming/roster behavior; preserved because one records current roster/count and one records the naming rule. Formatting is imperfect, but the facts are useful.
- Browser/desktop skill resources with generic historical workflow recipes were left alone because they predate this cleanup and are not clearly bad auto-applied 2026-06-19 resources.
---
