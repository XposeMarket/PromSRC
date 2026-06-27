# Dream Cleanup - 2026-06-25
_Generated: 2026-06-26 13:35 local_

## Cleanup Summary
Memory was already solid enough to preserve as-is. I read `USER.md`, `SOUL.md`, `MEMORY.md`, and the latest main Dream artifact for 2026-06-25 (`Brain/dreams/2026-06-25/23-44-dream.md`). The Dream artifact was only a recovery note saying the model-backed Dream completed 75 steps but did not write a fresh detailed artifact, so there was no new detailed memory text to dedupe against.

I did not make memory edits. A few entries look overlapping at first glance, especially Prometheus self-doc/dev-edit and desktop/Codex rules, but they encode different future triggers or live in different routing layers. Under the cleanup rule, preserving them is safer than merging away nuance.

The `skill_curator action=status`, `skill_audit_all`, and `skill_repair_metadata mode="preview"` tool surfaces were not exposed in this cron context, so I inspected the canonical curator files directly: `Brain/skill-curator/reports/skill_curator_2026-06-26T03-46-47-284Z.md`, `Brain/skill-curator/suggestions.json` metadata via stats/search, and bundled skill content via `skill_read` where available.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact duplicate or directly stale Raul preference/project memory was clear enough to remove safely. Some desktop/Codex rules overlap but differ by trigger and date. |
| SOUL.md | none | Workspace persona/operating contract is lean and internally consistent. No cleanup needed. |
| MEMORY.md | none | Some Prometheus self-edit/self-doc rules overlap with USER.md, but MEMORY.md keeps operational runbook context while USER.md keeps Raul preference/rule context. The subagent naming entries are related but not exact duplicates: one covers roster/count answers, one covers display-name wording. |

_None - memory already looked solid enough to preserve as-is._

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| `sc_2b631d268829a7aa` / Daily audit applied resource | file-surgery | accept | none | Additive low-risk recovery resource for `apply_workspace_patchset failed applied 0 failed 1`. It has a concrete future trigger, clear behavior (re-read exact surroundings, shrink patch, validate), and evidence paths. The lesson duplicates the broader file-surgery repair loop somewhat, but it is specific enough and scoped to a real patchset failure, so no revert. |
| `sc_842c2ae22dd7d930` / Add recovery to file-surgery | file-surgery | accept | none | Pending duplicate of the already-applied resource path above. The content itself passes the quality gate; no rejection/mutation was possible because the curator reject tool was unavailable, and cleanup should not broadly edit the registry by hand. |
| `sc_fc7916be8fc0acb7`, `sc_baaefdea6e6a5c77`, `sc_7aec6362d937771c`, `sc_cf8d48b37f2ac3d4` / generic 2026-06-14 workflow recipe cohort | prometheus-x-posts-workflow / prometheus-x-research-replies / browser-automation-playbook / x-browser-automation-playbook | needs_review | none | These pending auto-eligible workflow recipes are evidence-backed but their learned behavior is generic: “Consider adding a compact example/checklist/template.” They do not state the actual future behavior or trigger strongly enough to apply during cleanup. Left pending for a full Dream/curator pass rather than rejected without the live reject tool. |
| `sc_3f773664530f15b8`, `sc_2df3110c5625011d`, `sc_59a44dd94fd9621e`, `sc_e8e360ca0346429f`, `sc_6d76b879ce5d07`, `sc_664dbe6f0cb6d2e8` / generic 2026-06-12/13 workflow recipe cohort | prometheus-x-posts-workflow / browser-automation-playbook / x-browser-automation-playbook / hook-library | needs_review | none | Same issue as above: likely harmless but too template-like to be an obvious cleanup apply. Existing bundled resources already include some dated workflow notes; avoid adding more near-duplicate generic resources in the cleanup pass. |
| `sc_3f773664530f15b8`, `sc_b9ea97c015623652` and similar medium-risk business workflow recipe suggestions | prometheus-x-posts-workflow / prometheus-x-research-replies | needs_review | none | Medium-risk/business workflow suggestions need a higher-context curator pass. They may belong in business/entity/project workflow memory rather than X-posting/reply skills, so cleanup should not apply or reject them. |
| Other pending suggestions in `skill_curator_2026-06-26T03-46-47-284Z.md` | mixed skills | needs_review | none | Latest report shows 39 suggestions, 0 newly applied by that run. Most visible pending items are low-risk workflow-resource proposals but generic in wording. No safe, obvious skill deletion/refinement was identified. |

## Fleet Metadata Regression Check
| Check | Result | Action |
|-------|--------|--------|
| `skill_audit_all` | Tool not exposed in this cron context. Latest curator report shows 583 candidates reviewed, 1 recent skill change audited, 39 suggestions generated, Applied: 0, Auto-rejected: 0, Quarantined: 0. | deferred to Dream / no action |
| `skill_repair_metadata mode="preview"` | Tool not exposed in this cron context. No bulk metadata repair preview was run or applied. | deferred to Dream / no action |
| Direct curator report/file inspection | Latest report audited one low-risk file-surgery curator resource and found it accepted; no quarantines or auto-rejections were reported. | no cleanup mutation |

## Preserved On Purpose
- `USER.md` desktop/Codex coordinate-click rules and Ctrl+N rules: overlapping but context-specific, repeatedly corrected by Raul, and still behavior-changing.
- `USER.md` and `MEMORY.md` self-documentation/dev-edit rules: overlapping but split between Raul preference memory and operational source-edit runbook memory.
- `MEMORY.md` subagent roster/naming rules: related but distinct; one answers “how many/who,” the other enforces display-name wording.
- Pending generic workflow recipe suggestions: left pending rather than rejected because the live curator reject tool was unavailable and manual registry edits would be too risky for cleanup.
---
