---
# Dream Cleanup - 2026-06-03
_Generated: 2026-06-04 01:41 local_

## Cleanup Summary
Memory was already solid enough to preserve as-is. USER.md, SOUL.md, and MEMORY.md contain some overlapping operational rules, but the overlaps mostly preserve different scopes: Raul preference, Prom operating rule, and project/source runbook.

The latest main Dream artifact (`Brain/dreams/2026-06-03/23-56-dream.md`) added one durable MEMORY.md follow-up cluster for 2026-06-03. That entry is specific, source-grounded, and useful for future Prometheus UX/source work, so no memory dedupe edits were made.

Skill curator review found one freshly auto-applied low-risk workflow resource that failed the quality gate because it was generic placeholder text rather than a real repeatable desktop workflow. I removed that resource from the target skill. The `skill_curator` action tool was not exposed in this cleanup runtime, so I could not mark the suggestion rejected in the curator queue.

## Memory Edits
| File | Action | Reason |
|------|--------|--------|
| USER.md | none | No exact/near duplicate was clearly safe to remove; older-looking entries still preserve Raul preferences or workflow triggers. |
| SOUL.md | none | Operational-rule overlap is intentional across tool rules, creative rules, memory rules, and identity/persona sections; no stale contradiction was safe to delete. |
| MEMORY.md | none | The new 2026-06-03 product UX cluster is specific and actionable; older Prometheus/product memories remain behavior-changing and historically useful. |

_None - memory already looked solid enough to preserve as-is._

## Skill Curator Critic
| Suggestion | Skill | Decision | Action Taken | Reason |
|------------|-------|----------|--------------|--------|
| sc_9a04d71878026bfd / Review skill change: interactive-visuals trigger_addition | interactive-visuals | accept | none | Review-only audit item was low-risk and evidence-backed: exact shorthand triggers “visual” / “visuals” match a real user request and improve routing. |
| sc_abe5a483a6312778 / Add workflow recipe to desktop-automation-playbook | desktop-automation-playbook | revert | deleted resource `references/workflows/desktop-automation-playbook-2026-06-03.md` | Auto-applied resource failed the quality gate: future trigger was vague (“same operating pattern”), learned behavior was meta-placeholder text (“consider adding…”), right-skill/value was unclear, and evidence links did not encode a concrete reusable workflow. |
| sc_a68aa5ebf44bb55b / Add workflow recipe to desktop-automation-playbook | desktop-automation-playbook | needs_review | none | Pending medium-risk business-workflow item appears generic and possibly misrouted to desktop automation; left untouched because cleanup rules prohibit broad/high-risk pending applications and the reject tool was unavailable. |
| sc_fdbb96f85899c287 / Add workflow recipe to prometheus-x-growth-operator | prometheus-x-growth-operator | accept | none | Applied/pending report text points at X Growth Operator fallback workflow; likely useful if the actual resource is concrete. No resource cleanup was clearly safe from the report alone. |
| sc_8f1724e2a938e578 / Add recovery to file-surgery | file-surgery | accept | none | Specific recovery note for find/replace text-not-found drift matches existing file-surgery recovery guidance and has a clear future trigger. |
| sc_568631a415f81421 / Add recovery to file-surgery | file-surgery | accept | none | Specific source patch/context-drift recovery note; same narrow lesson and evidence pattern as other useful file-surgery recovery resources. |
| Recent review-only items for skill_created/resource_delete/instructions_update | multiple | needs_review | none | Review-only ledger/audit items are intentionally not auto-applied; no destructive cleanup was safe without deeper per-skill inspection. |

## Preserved On Purpose
- USER.md desktop/Codex click/shortcut entries look related, but they are not exact duplicates: one records screenshot-grounded coordinate-click preference, one records a known Codex new-chat coordinate, and one records Ctrl+N as the preferred Codex shortcut.
- SOUL.md has several creative/HyperFrames rules that overlap in theme, but each captures a different failure mode: source-backed HyperFrames, true-3D visual contract, launch-video routing, asset/logo fidelity, and one-shot provider output presentation.
- MEMORY.md Prometheus source/edit runbook entries are dense and overlapping, but they cover different scopes: repo/mobile runbook, `prom_apply_dev_changes` live workflow, and proposal-executor safety gates.
---
