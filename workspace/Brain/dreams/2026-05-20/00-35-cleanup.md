# Dream Cleanup - 2026-05-20
_Generated: 2026-05-21 00:35 local_

## Cleanup Summary
Memory looked solid enough to preserve as-is. I read `USER.md`, `SOUL.md`, `MEMORY.md`, and the recovered main dream artifact at `Brain/dreams/2026-05-20/23-53-dream.md`; I did not find an exact duplicate or clearly stale memory item safe enough to remove under the conservative cleanup rules.

The requested `skill_curator action=status` tool surface was not exposed in this execution environment, so I inspected the canonical curator files directly: `Brain/skill-curator/suggestions.json` and the latest visible status report `Brain/skill-curator/reports/skill_curator_2026-05-21T00-31-50-937Z.md`. No new skill mutations were made. Previously deleted bad auto-applied curator resources are absent from the current skill resource lists, and the remaining low-risk additions/read-only audit items did not require cleanup.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact or safely removable duplicate found; entries are still actionable preferences/project context. |
| SOUL.md | none | Some operational rules overlap conceptually, but the distinctions still matter and no surgical deletion was clearly safe. |
| MEMORY.md | none | Dense, but durable project/history entries still have recall triggers or future behavior value; no safe stale item removed. |

_None - memory already looked solid enough to preserve as-is._

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_ef8a97757b882dee / dev-debugging resource_addition | dev-debugging | accept | none | Additive, evidence-backed note for same-chat Codex Creative export handoff; low-risk and scoped. |
| sc_4da1ac077219ab96 / scheduler idle-or-quota false success note | scheduler-operations-playbook | accept | none | Specific scheduler false-success/quota pattern with cited cron/Brain evidence; changes future verification behavior. |
| sc_d680c7718f8e2a99 / creative stitch rough-cut truncation known issue | prometheus-creative-mode | accept | none | Specific Creative failure/recovery pattern with evidence; routed to the right creative skill. |
| sc_3d3d6ee5a182df91 / AI smoke research trigger addition | ai-surface-smoke-research | accept | none | Trigger-only patch matches the observed repeated shorthand and preserves workflow semantics. |
| sc_f27d9aef67b685c9 / ai-surface-smoke-research skill_created review | ai-surface-smoke-research | needs_review | none | New skill creation is high-risk/review-only and had no evidence recorded in the ledger; cleanup pass should not approve or delete it. |
| sc_a280038c38aaca75 / creative resource_delete review | prometheus-creative-mode | accept | none | Review-only audit of a prior deletion. The deleted resource is absent and a stronger known issue resource remains, so no restoration needed. |
| sc_d2a73d6a2993153e / file-surgery resource_delete review | file-surgery | accept | none | Review-only audit of prior cleanup deletion; narrow source-specific recovery note is absent and the current file-surgery resource list is clean. |
| sc_e4fa03da7bbccdfb / file-surgery resource_delete review | file-surgery | accept | none | Same as above: prior deletion of a narrow duplicate curator resource remains appropriate. |
| sc_2bd47042c1c6b225 / scheduler failure-looking-success note | scheduler-operations-playbook | accept | none | Concrete cron-success/tool-failure verification guardrail with evidence; safe additive skill memory. |
| sc_6f1643c62d22dcd1 / desktop stale screenshot recovery note | desktop-automation-playbook | accept | none | Specific recovery lesson for stale screenshot/no-op scroll loops; future trigger and evidence are present. |
| sc_3bc6be26593f037a / file-surgery resource_delete review | file-surgery | accept | none | Listed in latest report as review-only; corresponding bad/narrow resource is absent, so no cleanup mutation needed. |
| sc_2d58f0be7146535f / applied file-surgery recovery resource | file-surgery | revert | none | The resource is already absent from `skill_resource_list`; prior cleanup removed the over-specific source-path recovery note. No additional delete possible. |
| sc_24dd7abdec0951a8 / applied file-surgery recovery resource | file-surgery | revert | none | Same pattern: stale applied registry entry, but resource already absent; no new mutation needed. |
| sc_d86f73f36dd3ca38 / applied file-surgery recovery resource | file-surgery | revert | none | Same pattern: resource no longer present, avoiding duplicate/narrow file-surgery pollution. |
| sc_d42069a998de0e1c / applied creative failed-fetch recovery resource | prometheus-creative-mode | revert | none | Resource is already absent; stronger `references/known-issues/hyperframes-export-failed-fetch-file-exists-2026-05-15.md` remains. |
| sc_c936d7c1ebc30967 / voice browser desktop trigger addition | voice-browser-desktop-smoke-test | accept | none | Trigger metadata patch is narrow, evidence-backed, and improves skill matching without broad rewrite. |
| sc_4fd0619ffa02b37c / stale pending duplicate of file-surgery recovery | file-surgery | reject | none | Latest report showed it as pending, but canonical suggestions now show the same lesson as applied/stale and the resource is absent; no safe tool surface to reject here. |
| sc_2682c7d1f6d124fd / stale pending duplicate of file-surgery recovery | file-surgery | reject | none | Duplicate/stale recovery candidate; over-specific to source find-replace drift and already cleaned from resources. |
| sc_762b76fec9ca194e / stale pending duplicate of creative failed-fetch recovery | prometheus-creative-mode | reject | none | Duplicate of stronger known issue resource; stale report entry only, with no resource currently present. |

## Preserved On Purpose
- Preserved the Prometheus source/mobile edit runbook plus dev-live tool/proposal-executor safety entries in `MEMORY.md` even though they overlap, because they apply at different levels: general source workflow, smart live-apply tool usage, and proposal executor completion requirements.
- Preserved both Xpose Market local targeting context and the preference not to explicitly name Frederick in positioning, because they are not contradictory: lead sourcing can start local while public messaging avoids over-narrow geographic copy.
