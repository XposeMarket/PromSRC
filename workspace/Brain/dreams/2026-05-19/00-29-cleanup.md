# Dream Cleanup - 2026-05-19
_Generated: 2026-05-20 00:29 local_

## Cleanup Summary
Read USER.md, SOUL.md, MEMORY.md, and the latest Dream artifact (`Brain/dreams/2026-05-19/23-44-dream.md`). The Dream artifact was a recovered/truncated response rather than a normal memory-writing report, and the durable memory files did not show clear new duplicate text from that pass.

Memory looked solid enough to preserve. I saw a few adjacent rules that overlap by theme, especially around source/web-ui build flow and Creative/HyperFrames handling, but they carry distinct operational details and are safer to keep than compress during a cleanup pass.

The skill curator state showed three low-risk recovery suggestions in the latest report. Two file-surgery suggestions were already/recently represented as applied items that fail the quality gate because they map source-tool `find_replace_source` misses into the broad workspace `file-surgery` skill and duplicate the generic recovery protocol. The Creative export suggestion was accepted in principle because the stronger known-issues resource already exists in `prometheus-creative-mode`.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact/near-exact duplicates or clearly stale user facts found. |
| SOUL.md | none | Some operational overlap exists, but each rule preserves specific trigger/evidence context; no safe deletion. |
| MEMORY.md | none | Source/build/runbook entries overlap but differ by scope (`mobile`, dev-live tool, proposal executor safety); preserving nuance is safer. |

None - memory already looked solid enough to preserve as-is.

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_4fd0619ffa02b37c / Add recovery to file-surgery | file-surgery | revert/needs_review | none | Quality gate weak: source-specific `find_replace_source` text-not-found in `src/gateway/session.ts` is not a useful future trigger for broad workspace file surgery, and the learned behavior duplicates the existing File Surgery recovery protocol. `skill_resource_list` showed no declared/discovered resource to delete, so no mutation was possible from the skill bundle surface. |
| sc_2682c7d1f6d124fd / Add recovery to file-surgery | file-surgery | revert/needs_review | none | Same failure as above: source-specific `find_replace_source` miss in `src/gateway/comms/telegram-channel.ts` is routed to the wrong skill and repeats generic re-read/smaller-patch guidance already present. No discovered resource existed to remove. |
| sc_762b76fec9ca194e / Add recovery to prometheus-creative-mode | prometheus-creative-mode | accept | none | Useful future behavior and trigger: when Creative/HyperFrames export reports `Failed to fetch`, verify artifact path, size, frames, and QA before treating it as a failed render. The bundle already contains the stronger scoped known-issue resource `references/known-issues/hyperframes-export-failed-fetch-file-exists-2026-05-15.md`, so no additional cleanup was needed. |
| legacy auto-rejected workflow dumps in suggestions.json | multiple | accept | none | The existing auto-rejections correctly identify transcript-like workflow dumps with no clear future trigger or learned behavior. No further action needed. |

## Preserved On Purpose
- Preserved USER.md Xpose location/lead-gen bullets even though they overlap: one is a positioning preference, one is a project fact, and one is a workflow requirement.
- Preserved MEMORY.md source/build/dev-live/proposal executor entries despite overlap because they describe different execution surfaces and failure-prevention gates.
- Preserved SOUL.md Creative/HyperFrames rules because they encode separate lessons: asset paths, imported-skill adaptation, promo routing, true-3D verification, and catalog-first recovery.
