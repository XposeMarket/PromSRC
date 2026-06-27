---
# Dream Cleanup - 2026-06-20
_Generated: 2026-06-21 00:40 local_

## Cleanup Summary
Memory was already solid enough to preserve as-is. `USER.md`, `SOUL.md`, and `MEMORY.md` contain some long operational entries and a little formatting roughness, but I did not find an exact duplicate, stale contradiction, or low-value item that was safe to remove under the cleanup rules.

The 23:40 Dream also reported zero direct durable memory updates, so there was no new USER/SOUL/MEMORY text from the main Dream pass to dedupe. The main Dream routed durable project/business state to entity/business artifacts and proposals instead of memory, which is the safer routing.

Skill curator review was constrained by the exposed tool surface: `skill_curator`, `skill_audit_all`, and `skill_repair_metadata` were not available as callable tools in this cron context. I inspected the canonical curator files directly instead: `Brain/skill-curator/suggestions.json` and the latest report `Brain/skill-curator/reports/skill_curator_2026-06-21T03-56-22-181Z.md`.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact/near duplicate or contradiction was safe to remove. The current preference/project entries remain behavior-changing. |
| SOUL.md | none | Workspace persona/rules are lean and not contradicted by the latest Dream. |
| MEMORY.md | none | Some source-edit/runbook entries overlap, but each preserves distinct operational context; conservative cleanup kept them. |

None - memory already looked solid enough to preserve as-is.

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| Latest curator status report `skill_curator_2026-06-21T03-56-22-181Z.md` | all | needs_review | none | Tool action `skill_curator action=status` was not exposed, so I used the status report as source of truth. Report shows 955 candidates reviewed, 115 recent skill changes audited, 159 suggestions generated, Applied: 0. |
| Pending generic workflow recipe suggestions, e.g. `sc_fc7916be8fc0acb7`, `sc_baaefdea6e6a5c77`, `sc_7aec6362d937771c`, `sc_cf8d48b37f2ac3d4` | prometheus-x-posts-workflow / prometheus-x-research-replies / browser-automation-playbook / x-browser-automation-playbook | needs_review | none | These are pending, auto-eligible recipe-resource suggestions with evidence, but the displayed learned behavior is generic “consider adding a compact example” language. That is not enough to safely apply in cleanup, and the reject tool was unavailable. |
| Pending business-workflow recipe suggestions, e.g. `sc_3f773664530f15b8`, `sc_d5df904bb7dbc069`, `sc_5ef19b61b35cfdf8`, `sc_5a60facf09afc0b5` | prometheus-x-posts-workflow / prometheus-x-research-replies | needs_review | none | Medium-risk pending items route vague business/social/outreach signals into X skills. They need curator or Dream review with transcript evidence before approval or rejection; no cleanup mutation made. |
| Pending file-surgery recovery suggestions visible in latest report | file-surgery | needs_review | none | Similar prior cleanup passes found broad/raw file-surgery recovery notes risky. I did not delete or reject without the curator API and a full resource/evidence inspection. |
| Review-only metadata repair audit items, e.g. `sc_c4a2c170ef7c100f`, `sc_8a015f1bf148347f`, `sc_95bf160b390704da`, `sc_f1e966c29a847498` and related manifest repairs | many skills | needs_review | none | Review-only ledger items are explicitly not auto-applied. Many report no direct evidence links beyond the skill-change ledger; cleanup should not bulk-accept or mutate them. |
| Recent applied curator resources in `suggestions.json` | hook-library / browser automation / X skills / file-surgery / scheduler / others | needs_review | none | Applied low-risk resources found were mainly from 2026-06-14 or older. No 2026-06-20/06-21 auto-applied item was found in the latest status; latest report says Applied: 0. No revert target was clear enough. |

## Fleet Metadata Regression Check
| Check | Result | Action |
|-------|--------|--------|
| `skill_audit_all` | Not available as a callable tool in this cron context. Latest curator report instead audited 115 recent skill changes. | deferred to Dream / no action |
| `skill_repair_metadata mode="preview"` | Not available as a callable tool in this cron context. Latest report shows many metadata repair review-only items, mostly from 2026-06-19 manifest trigger cleanup. | deferred to Dream / no action |
| Direct curator report/file inspection | `Brain/skill-curator/reports/skill_curator_2026-06-21T03-56-22-181Z.md`: 955 candidates, 115 recent skill changes, 159 suggestions, Applied: 0, Auto-rejected: 0, Quarantined: 0. | no cleanup mutation |

## Preserved On Purpose
- `MEMORY.md` source-edit/dev-live/proposal-executor runbook bullets look overlapping, but they encode distinct source-edit, live-apply, and proposal-executor rules. Kept to avoid losing operational nuance.
- `MEMORY.md` subagent roster/naming entries are adjacent and somewhat redundant, but one answers count/identity and the other enforces display-name wording. Kept both.
- `USER.md` desktop automation/Codex entries overlap around coordinate clicks and Ctrl+N, but they apply to different contexts and have been repeatedly corrected by Raul. Kept both.
- Curator pending workflow suggestions were not rejected directly because the required `skill_curator action=reject` tool was unavailable in this run.
---
