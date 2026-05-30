---
# Dream Cleanup - 2026-05-28
_Generated: 2026-05-29 00:39 local_

## Cleanup Summary
Current USER.md, SOUL.md, and MEMORY.md were reviewed against the 2026-05-28 Dream artifact. The latest Dream additions were already conservative: the mobile self-doc prerequisite was accepted without duplicate memory, and the promo pacing correction exists as a specific user/creative rule rather than noisy session detail.

No memory edits were made. A few areas are naturally overlapping (Creative presentation/pacing rules, source/mobile edit runbooks, and Browse.sh adaptation rules), but they each have distinct triggers or enough nuance that deleting them would risk losing useful future behavior.

Skill curator cleanup found one auto-applied low-risk resource that failed the quality gate because it was generic placeholder text rather than an actionable workflow. That resource was deleted from `desktop-automation-playbook`; other recent applied resources were accepted or left as review-only/needs-review items.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | Current entries are specific user preferences/projects; no exact duplicate or clearly stale wording found. |
| SOUL.md | none | Operational rules are dense but still behavior-changing; overlapping tool/skill rules have distinct triggers and should be preserved. |
| MEMORY.md | none | Project/source/mobile memories overlap by design but preserve separate runbook, dev-live, and executor-safety contexts. |

_None - memory already looked solid enough to preserve as-is._

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_ba201abdff743e2c / prometheus-creative-mode pacing guardrail | prometheus-creative-mode | accept | none | Evidence-backed, narrow trigger, clear future behavior for readable promo/explainer pacing. |
| sc_79c86a2a6715234b / Claude terminal approval loop recovery | desktop-automation-playbook | accept | none | Specific desktop trigger, concrete recovery behavior, and cited audit evidence; not raw log. |
| sc_05775356694d44eb / hyperframes-media metadata correction | hyperframes-media | accept | none | Restores/keeps useful overlay metadata and routing for audio/captions/avatar workflows; evidence-backed. |
| sc_bf005108534f9334 / hyperframes-media trigger addition | hyperframes-media | accept | none | Narrow trigger patch routed to the right HyperFrames media skill; supported by Raul's audio/captions/avatar question. |
| sc_69facb82ffc316ea / generic desktop workflow recipe | desktop-automation-playbook | revert | deleted resource `references/workflows/desktop-automation-playbook-2026-05-28.md` | Auto-applied resource failed quality gate: generic placeholder wording, vague trigger, no actual workflow details, and duplicated the stronger Claude approval-loop example from the same day. |
| sc_fe0c2f52032da268 / file-surgery 2026-05-27 text-not-found recovery | file-surgery | needs_review | none | Suggestion says applied, but current resource list shows this specific resource has already been deleted/merged. Existing refined generic recovery note covers the lesson, so no further deletion was needed. |
| sc_2843224bbab780e4 / hyperframes style placeholder | hyperframes | accept | none | The weak auto-applied placeholder resource is already absent from the skill, apparently removed by later cleanup; current HyperFrames resources contain stronger style/readability references. |
| sc_becac58cf91eded9 / hyperframes-cli style placeholder | hyperframes-cli | accept | none | The weak auto-applied placeholder resource is already absent from the skill; current CLI resources are focused runtime/troubleshooting references. |
| sc_33e5f07aa01b3a25 / file-surgery generic text-not-found recovery | file-surgery | accept | none | Current resource has been refined into a reusable context-drift recovery note with a general trigger and avoid guidance. |
| sc_09565eaec654b56b / browse-sh-web-skills workflow placeholder | browse-sh-web-skills | accept | none | Placeholder resource is already absent; current Browse.sh resources are specific adaptations and design notes. |
| sc_3f2af49d3c095262 / web-researcher workflow placeholder | web-researcher | accept | none | Placeholder resource is already absent; current web-researcher resources are specific provider/routing/research notes. |
| sc_99efa424a9f0497c / file-surgery source text-not-found recovery | file-surgery | accept | none | Applied item no longer exists as a separate noisy resource; current refined recovery note preserves the useful general behavior. |
| sc_62e20108fce8710c / file-surgery web-ui text-not-found recovery | file-surgery | accept | none | Applied item no longer exists as a separate noisy resource; current refined recovery note covers the reusable lesson. |
| sc_612e2673cbe90b2b / file-surgery self-doc text-not-found recovery | file-surgery | accept | none | Applied item no longer exists as a separate noisy resource; current refined recovery note covers the reusable lesson. |
| sc_5d3c057835ed6774 and related resource_delete review-only items | file-surgery / hyperframes / hyperframes-cli / browse-sh-web-skills / web-researcher | accept | none | Review-only ledger items correspond to later cleanup/deletion of weak placeholder resources; no skill mutation needed here. |
| sc_a733aebedc70a71a, sc_ccd4f72c7a995661, sc_443f48f4d1a1cffa / new-skill or high-risk review-only audits | prometheus-ash-archive-style / product-carousel-builder | needs_review | none | New-skill and high-risk review-only items are outside cleanup's safe mutation scope; preserve for fuller human/curator review. |
| sc_e0a1aaf61edbdd09, sc_3cb2773009c73cbf, sc_82e61c4ff34d28df, sc_48c1831c10ce6457, sc_25d1e7116a0eae89, sc_03192add612f6ac1 / metadata or example review-only audits | chart-visualizer / html-interactive / interactive-visuals / mermaid-diagrams / svg-diagrams / voice-browser-desktop-smoke-test | accept | none | Review-only audit items have concrete reasons/evidence and do not request mutation; nothing unsafe or polluting found in this pass. |

## Preserved On Purpose
- SOUL.md contains both general skill-maintenance guidance and specific bundled-resource reading rules; they look overlapping, but one governs behavior after real work and the other corrects resource-loading assumptions.
- MEMORY.md keeps separate Prometheus source/mobile runbook, dev-live tool rule, and proposal-executor safety rule because they trigger in different execution contexts.
- USER.md keeps both Creative artifact presentation and one-shot provider presentation corrections because one is a user-facing preference and one is an operational tool rule with slightly different recall surfaces.
---
