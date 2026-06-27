# Dream Cleanup - 2026-06-26
_Generated: 2026-06-27 00:29 local_

## Cleanup Summary
Current USER.md, SOUL.md, and MEMORY.md were reviewed against the recovered 2026-06-26 Dream artifact. The Dream did not add broad new memory; it only recovered a pending-proposal verification note about `inspect_console`, so there was no fresh durable-memory text to dedupe.

Memory looked safe to preserve as-is. I did not remove the subagent/Mara rules even though they overlap, because one records roster/count behavior and the other records display-name wording behavior.

Skill curator state was reviewed through the latest Brain Skill Curator report and suggestions store because the dedicated `skill_curator`, `skill_audit_all`, and `skill_repair_metadata` tools were not exposed in this cleanup runtime. One already-applied low-risk file-surgery resource was clearly useful but contained raw truncated patch-error text in the trigger, so I refined only that same resource path into a reusable context-drift recovery note.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact duplicate, contradiction, or stale preference was safe to remove. |
| SOUL.md | none | Workspace operating contract is compact and not contradicted by the latest Dream. |
| MEMORY.md | none | No safe deletion after review; overlapping subagent/Mara entries preserve distinct future behaviors. |

None - memory already looked solid enough to preserve as-is.

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_2b631d268829a7aa / Daily audit item for applied `file-surgery` resource | file-surgery | refine | rewrote resource `references/recovery/recovery-note-apply-workspace-patchset-failed-applied-0-failed-1-results-2026-06-24.md` | Accepted the underlying recovery lesson, but the resource title/trigger preserved raw truncated tool-error text and a one-off filename. Refined it to a reusable future trigger: workspace patch exact-text/context drift, reread surrounding lines, shrink patch, validate narrowly. |
| sc_842c2ae22dd7d930 / Add recovery to file-surgery | file-surgery | accept | none | Same lesson as the applied audited resource: specific recovery behavior, right skill, evidence-backed, safe scope. No further action after refinement. |
| sc_fc7916be8fc0acb7 / Add workflow recipe to prometheus-x-posts-workflow | prometheus-x-posts-workflow | needs_review | none | Pending generic “consider adding compact example” workflow recipe. Evidence-backed but not concrete enough for cleanup to accept/apply. |
| sc_baaefdea6e6a5c77 / Add workflow recipe to prometheus-x-research-replies | prometheus-x-research-replies | needs_review | none | Pending generic recipe candidate. Better handled by a normal Dream/curator pass with evidence expansion. |
| sc_7aec6362d937771c / Add workflow recipe to browser-automation-playbook | browser-automation-playbook | needs_review | none | Pending generic workflow recipe; not harmful but not actionable enough for cleanup mutation. |
| sc_cf8d48b37f2ac3d4 / Add workflow recipe to x-browser-automation-playbook | x-browser-automation-playbook | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_3f773664530f15b8 / business workflow recipe to prometheus-x-posts-workflow | prometheus-x-posts-workflow | needs_review | none | Medium-risk business workflow routing candidate; not safe for cleanup to decide without fuller evidence. |
| sc_e85e5ed7a3afb1f8 / Add workflow recipe to hook-library | hook-library | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_d5df904bb7dbc069 / business workflow recipe to prometheus-x-research-replies | prometheus-x-research-replies | needs_review | none | Medium-risk business workflow candidate; deferred. |
| sc_afc546066c75cc1a / Add workflow recipe to prometheus-x-posts-workflow | prometheus-x-posts-workflow | needs_review | none | Duplicate-looking generic recipe candidate; deferred rather than rejected because evidence may differ. |
| sc_6df6f11a9588fc84 / Add workflow recipe to browser-automation-playbook | browser-automation-playbook | needs_review | none | Duplicate-looking generic recipe candidate; deferred. |
| sc_f3fa2cb4a6c7a769 / Add workflow recipe to x-browser-automation-playbook | x-browser-automation-playbook | needs_review | none | Duplicate-looking generic recipe candidate; deferred. |
| sc_07414b44666ad405 / business workflow recipe to prometheus-x-posts-workflow | prometheus-x-posts-workflow | needs_review | none | Medium-risk business workflow candidate; deferred. |
| sc_bc3d5d983b196735 / Add recovery to file-surgery | file-surgery | needs_review | none | Pending recovery candidate appears similar to context-drift lessons but references dev-source/mobile patch failure; needs normal curator evidence review before applying. |
| sc_ebbf87ce80633cb1 / Add recovery to file-surgery | file-surgery | needs_review | none | Pending recovery candidate appears similar to existing text-not-found lessons; possible duplicate, but preserved pending review. |
| sc_03459fc4b45ed247 / Add workflow recipe to connector-builder | connector-builder | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_95b0963e4de59001 / Add workflow recipe to context-pack-builder | context-pack-builder | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_ccf012e4fb6af6be / Add workflow recipe to deal-analyzer | deal-analyzer | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_bb7b4842560224a2 / Add workflow recipe to ghostwriter | ghostwriter | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_37d403f4040fb74a / Add workflow recipe to file-surgery | file-surgery | needs_review | none | Pending generic recipe. Existing file-surgery already has several strong resources; avoid adding vague duplicates in cleanup. |
| sc_5db241fcb87a5797 / Add workflow recipe to scheduler-operations-playbook | scheduler-operations-playbook | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_2006a3888f549993 / Add workflow recipe to skill-creator | skill-creator | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_2cc56c79db5a6abf / Add workflow recipe to prometheus-x-research-replies | prometheus-x-research-replies | needs_review | none | Duplicate-looking generic recipe candidate; deferred. |
| sc_31b8ba36d9a81af8 / Add workflow recipe to hook-library | hook-library | needs_review | none | Duplicate-looking generic recipe candidate; deferred. |
| sc_f16bbef2cc36291e / business workflow recipe to deal-analyzer | deal-analyzer | needs_review | none | Medium-risk business workflow candidate; deferred. |
| sc_9c0748b52e612c37 / Add style pattern to prometheus-x-posts-workflow | prometheus-x-posts-workflow | needs_review | none | Pending style resource is generic; not enough future behavior/trigger for cleanup application. |
| sc_b189b553ddd2a1b3 / Add style pattern to browser-automation-playbook | browser-automation-playbook | needs_review | none | Pending style resource is generic; deferred. |
| sc_51c95a63a6bdd829 / Add style pattern to x-browser-automation-playbook | x-browser-automation-playbook | needs_review | none | Pending style resource is generic; deferred. |
| sc_a8093c697a0f3beb / business style pattern to prometheus-x-posts-workflow | prometheus-x-posts-workflow | needs_review | none | Medium-risk business/style routing candidate; deferred. |
| sc_0ee485a674e1c481 / business workflow recipe to prometheus-x-research-replies | prometheus-x-research-replies | needs_review | none | Medium-risk business workflow candidate; deferred. |
| sc_74ca878d8b196d69 / style quote to prometheus-x-posts-workflow | prometheus-x-posts-workflow | reject | none | Pending quote is mostly phrasing/raw style, not a clear operational behavior. No reject tool was available, so left pending and recorded recommendation. |
| sc_d0446e1adfd835c9 / style quote to browser-automation-playbook | browser-automation-playbook | reject | none | Same quote routed to browser skill; weak future trigger and likely wrong skill. No reject tool available, so left pending and recorded recommendation. |
| sc_ade6ba9853b5119b / style quote to x-browser-automation-playbook | x-browser-automation-playbook | reject | none | Same quote routed to X browser skill; weak future behavior and duplicate. No reject tool available, so left pending and recorded recommendation. |
| sc_2be5a2f072ddae8a / Add workflow recipe to desktop-automation-playbook | desktop-automation-playbook | needs_review | none | Pending generic workflow recipe; deferred. |
| sc_aaa88f94f1857d46 / Add workflow recipe to dev-debugging | dev-debugging | needs_review | none | Pending generic workflow recipe; deferred. |

## Fleet Metadata Regression Check
| Check | Result | Action |
|-------|--------|--------|
| Latest Skill Curator report | Candidates reviewed: 522; recent skill changes audited: 1; suggestions generated: 34; applied: 0; quarantined: 0. Daily audit accepted the applied `file-surgery` resource as low-risk/additive. | One resource refined; broader pending queue deferred to Dream/curator. |
| skill_audit_all / skill_repair_metadata preview | Dedicated tools were not exposed in this cleanup runtime. No bulk metadata repair was attempted. | deferred to Dream / no action |

## Preserved On Purpose
- MEMORY.md lines 100 and 104 both mention Mara/subagent naming, but they encode distinct behaviors: answer roster/count questions with human names, and always refer to subagents by display name instead of technical ID.
- The large Prometheus source-edit runbook entries in MEMORY.md overlap with newer dev-edit tooling rules, but each captures different execution contexts and fallback behavior, so no safe deletion was made.
- Pending skill curator workflow/style suggestions that looked generic were not mutated because cleanup should not apply broad or uncertain skill changes.
