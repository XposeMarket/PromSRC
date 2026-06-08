# Dream Cleanup - 2026-05-30
_Generated: 2026-05-31 00:15 local_

## Cleanup Summary
Memory was already solid enough to preserve. USER.md, SOUL.md, and MEMORY.md contain some overlapping operational rules, but the overlaps carry different scope or chronology and did not meet the safe-removal bar for this conservative second pass.

The latest main dream artifact reviewed was `Brain/dreams/2026-05-30/23-30-dream.md`. Its new durable additions were mostly project/entity-level mobile realtime voice findings and HyperFrames promo status; I did not find a clear stale/contradictory memory entry that should be removed from the main memory files.

Skill curator audit found one clearly bad auto-applied curator resource: a generic, path-specific duplicate `file-surgery` recovery note that repeated an existing better recovery note. I deleted that resource from the skill. The `skill_curator` action tool was not available in this cleanup runtime, so the matching suggestion could not be formally marked rejected through `skill_curator action=reject`.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact/near duplicate or contradicted preference was safe to remove. Recent voice language preference is scoped differently from older voice/personality preferences. |
| SOUL.md | none | Some rules overlap with runtime/developer instructions, but they remain durable behavioral rules with distinct triggers/evidence; removing them would be riskier than preserving them. |
| MEMORY.md | none | Some Prometheus mobile/source-edit memories overlap, but they encode different runbooks, product state, and date-specific evidence. No small stale bullet was clearly safe to delete. |

_(If no edits: "None - memory already looked solid enough to preserve as-is.")_

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_a765be80bf35f5a3 / AI smoke Chrome fallback example audit | ai-surface-smoke-research | accept | none | Additive example with concrete failure/recovery evidence; passes future behavior/trigger/evidence gate. |
| sc_b4deb4af96b796d3 / dev-debugging manifest update audit | dev-debugging | accept | none | Metadata/triggers reflect Raul's explicit Codex/Claude routing request and are narrow. |
| sc_5e415683e221a44e / dev-debugging SKILL.md review | dev-debugging | accept | none | Read the skill: target-confirmation, Claude secondary path, screenshot proof, and two-minute timer are explicit, evidenced, and actionable. Broad entrypoint change was worth review, but content is good. |
| sc_7a5ad832dfac86d5 / desktop clear-chatbox trigger audit | desktop-automation-playbook | accept | none | Inspected manifest: triggers are narrow (`clear chat box`, `clear composer`, etc.) and point to a useful Raul-requested desktop pattern. |
| sc_7a4f71e88167af42 / clear-chatbox example audit | desktop-automation-playbook | accept | none | Read resource: concrete, non-send guardrailed workflow for clearing composer text; right skill and future-triggered. |
| sc_60467161efc49dbe / permission-click/raw-reporting guardrail | dev-debugging | accept | none | Additive guardrail with concrete 2026-05-30 failure evidence; safe and useful. |
| sc_171f26a2695162d1 / source-vs-workspace tool routing note | src-edit-proposal-rigor | accept | none | Narrow recovery note for source/tool routing mismatch; evidence-backed and routed to proposal/source-edit rigor. |
| sc_98df81bd21c69fbc / file-surgery web-ui text-not-found recovery | file-surgery | revert | deleted resource | Deleted `references/recovery/recovery-note-find-replace-webui-source-failed-text-not-found-in-web-ui--2026-05-30.md`. It was an auto-applied curator resource with a truncated title/trigger, path-specific noise, and duplicated the existing stronger generic note `references/recovery/recovery-note-find-replace-source-failed-text-not-found-in-src-gateway-r-2026-05-23.md`. |
| sc_df132908aa13e612 / HyperFrames MP4 freeze issue | hyperframes-cli | accept | none | Concrete no-ship QA guardrail from a real frozen export; right skill and evidence-backed. |
| sc_66b3c99676b9f748 / hyperframes-cli trigger addition | hyperframes-cli | accept | none | Trigger-only change improves retrieval for CLI/render troubleshooting without broad behavior change. |
| sc_7215ac25881f1cb9 / Claude terminal input targeting example | desktop-automation-playbook | accept | none | Concrete desktop targeting failure/recovery example; right skill. |
| sc_797615f21dade0dc / Claude terminal input targeting example | desktop-automation-playbook | accept | none | Same resource family as above; additive and evidence-backed. |
| sc_b0fc06ccbff51d96 / desktop workflow resource delete review | desktop-automation-playbook | needs_review | none | The referenced deleted resource is no longer present, but the audit item had no evidence links. Preserve for human/curator ledger review rather than manually editing state. |
| sc_be7bb4b8505dc6fa / desktop workflow recipe auto-resource | desktop-automation-playbook | needs_review | none | Resource named in old applied suggestion is no longer present. The original lesson text was generic; no deletion needed because resource is already gone, but the queue state should be reconciled by curator tooling. |
| sc_ba201abdff743e2c / promo pacing readability known issue | prometheus-creative-mode | accept | none | Specific Raul correction with future trigger for promo/explainer pacing; useful and safe. |
| sc_568631a415f81421 / Add recovery to file-surgery | file-surgery | revert | deleted resource | Same as `sc_98df81bd21c69fbc`; auto-applied weak duplicate resource deleted. Could not formally reject suggestion because `skill_curator` action tool was unavailable. |
| sc_69facb82ffc316ea / Add workflow recipe to desktop automation | desktop-automation-playbook | needs_review | none | Suggestion is marked applied but resource is absent. Since there is nothing left to delete and the content was generic, leave queue reconciliation to skill_curator. |
| sc_d2a8fb1d0881441b / business workflow recipe to desktop automation | desktop-automation-playbook | reject | none | Pending item is generic, business-workflow wording is not clearly a desktop automation lesson, and target/resource duplicates an old absent resource path. No manual reject possible without `skill_curator`. |
| sc_fe0c2f52032da268 / file-surgery web-ui text-not-found recovery | file-surgery | needs_review | none | The referenced resource is absent from current `file-surgery`; likely already cleaned. No file action needed; queue state should be reconciled by curator tooling. |
| sc_2843224bbab780e4 / hyperframes style pattern | hyperframes | needs_review | none | Suggestion says applied but resource is absent; original lesson text is generic (“consider adding...”). No current resource pollution remains to delete. |
| sc_becac58cf91eded9 / hyperframes-cli style pattern | hyperframes-cli | needs_review | none | Suggestion says applied but resource is absent; original lesson is generic and not CLI-specific. No current resource pollution remains to delete. |
| sc_ab41d8e2e4897938 / business style pattern to hyperframes | hyperframes | reject | none | Pending item is generic and routed from a vague vendor/business signal rather than a concrete HyperFrames style lesson. No manual reject possible without `skill_curator`. |
| sc_33e5f07aa01b3a25 / file-surgery source text-not-found recovery | file-surgery | accept | none | Existing current generic resource covers this well and is better than path-specific duplicates; no additional mutation needed. |
| sc_3f2af49d3c095262 / web-researcher workflow recipe | web-researcher | needs_review | none | Pending recipe text is generic and evidence may hide a useful pattern, but not enough was inspected to safely reject/apply in cleanup. |
| sc_09565eaec654b56b / browse-sh-web-skills workflow recipe | browse-sh-web-skills | needs_review | none | Same as above; potential Browse.sh reuse matters but this cleanup pass should not create/apply broad resources. |
| sc_612e2673cbe90b2b / file-surgery self-doc text-not-found recovery | file-surgery | needs_review | none | Likely duplicate of generic text-not-found recovery, but referenced resource is absent; preserve queue for curator reconciliation. |
| sc_62e20108fce8710c / file-surgery web-ui text-not-found recovery | file-surgery | needs_review | none | Likely duplicate/absent-resource state; no safe file mutation required. |
| sc_99efa424a9f0497c / file-surgery gateway text-not-found recovery | file-surgery | accept | none | Current generic text-not-found resource is useful and non-polluting; no change needed. |
| sc_e0a1aaf61edbdd09 / chart visualizer metadata review | chart-visualizer | accept | none | Review-only item; evidence says metadata was missing despite SKILL.md content. Retrieval metadata update is appropriate. |
| sc_03192add612f6ac1 / voice browser/desktop smoke-test review | voice-browser-desktop-smoke-test | needs_review | none | Review-only older audit item not inspected deeply enough in this pass; no mutation. |

_(If no curator items needed action: "Reviewed curator state; one weak auto-applied skill resource was removed; no broad skill cleanup was performed.")_

## Preserved On Purpose
- USER.md line 25 says Xpose positioning should avoid explicitly naming Frederick, while USER.md line 49 says Raul lives in Frederick and wants local lead generation there first. Kept both because one is messaging preference and the other is private/local targeting context.
- SOUL.md has both `skill_read` bundled-resource guidance and Browse.sh import guidance in adjacent bullets. Kept both because one is skill-reading behavior and one is catalog-growth behavior.
- MEMORY.md has several mobile/source edit runbooks from 2026-05-16 through 2026-05-30. Kept them because they cover different layers: general source sync, prom_apply_dev_changes, proposal executor safety, mobile self-doc prerequisites, and current xAI/OpenAI realtime voice state.
- Some skill curator pending/applied queue items appear stale because resources are already absent. I did not manually edit `Brain/skill-curator/suggestions.json`; the intended `skill_curator action=reject` tool was unavailable in this runtime, and direct JSON surgery would be riskier than preserving queue state.
