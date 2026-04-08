# Staleness Report

Generated: 2026-04-01
Scope: Workspace-wide stale/outdated reference sweep focused on source-of-truth docs, tool docs, and active runtime guidance.

## Summary
- Total findings: 10
- Critical: 2
- High: 5
- Medium: 3

---

## Findings

### 1) CRITICAL — Invalid/obsolete Anthropic model reference in pending proposal
- **File:** `proposals/denied/prop_1774676995409_a739fe.json`
- **Line:** 6
- **Stale reference:** Proposal text documents `claude-sonnet-4-6` as non-existent and recommends replacement paths. This creates conflicting operational guidance if reused as reference during future edits because denied proposals are not authoritative implementation state.
- **Suggested fix:** Add a clear “historical/denied proposal” disclaimer block in this file (or archive annotation policy) stating it must not be treated as current runtime truth. Optionally move model-validity guidance to a canonical live doc.

### 2) CRITICAL — Pending proposal still references unlabeled background response format as current baseline
- **File:** `proposals/pending/prop_1774665463085_51c30f.json`
- **Line:** 6
- **Stale reference:** Describes current behavior as single `Background agent response:` block and proposes labeled format. If backend/frontend has already changed elsewhere, this proposal can become stale and drive duplicate/redundant edits.
- **Suggested fix:** Before execution, re-validate current `src/gateway/routes/chat.router.ts` and `web-ui/src/pages/ChatPage.js` behavior; update proposal details with current evidence line refs or close as superseded.

### 3) HIGH — Team workspace inventory still labels canonicalized skill as legacy candidate
- **File:** `teams/team_mn6rnabz_a43f0e/workspace/skills-inventory.md`
- **Line:** 26
- **Stale reference:** `embedding-search` flagged as “legacy-candidate” with SmallClaw path assumptions, but subsequent approved work indicates it was modernized.
- **Suggested fix:** Refresh this inventory row to reflect post-remediation state and reduce false-positive drift scoring.

### 4) HIGH — Team workspace inventory still marks `smallclaw-team-design` as active legacy candidate without migration status
- **File:** `teams/team_mn6rnabz_a43f0e/workspace/skills-inventory.md`
- **Line:** 41
- **Stale reference:** Indicates rename/refresh needed, but canonical `prometheus-team-design` skill exists with explicit deprecated shim.
- **Suggested fix:** Update row to show migration complete, with compatibility shim retained for transition only.

### 5) HIGH — Remediation plan retains pre-remediation action item as unresolved
- **File:** `teams/team_mn6rnabz_a43f0e/workspace/skill-remediation-plan.md`
- **Line:** 41
- **Stale reference:** “smallclaw-team-design update (rename + refresh)” listed as pending despite existence of canonical replacement.
- **Suggested fix:** Mark milestone completed and add date/evidence link to replacement skill.

### 6) HIGH — Remediation plan still lists embedding-search as unresolved legacy candidate
- **File:** `teams/team_mn6rnabz_a43f0e/workspace/skill-remediation-plan.md`
- **Line:** 42
- **Stale reference:** Mentions SmallClaw assumptions likely stale; this appears outdated after modernization pass.
- **Suggested fix:** Re-audit `skills/embedding-search/SKILL.md`; if clean, mark plan item complete and remove “legacy-candidate” language.

### 7) HIGH — Legacy sweep report lacks closure markers and may be consumed as live issue list
- **File:** `LEGACY_SWEEP_2026-03-27.md`
- **Line:** 5
- **Stale reference:** “Likely Stale References” section is static historical output with no completion/invalidated status markers.
- **Suggested fix:** Add per-item status fields (`open`, `resolved`, `superseded`) or append a “Current validity” note at top.

### 8) MEDIUM — Audit plan references broad legacy burden without indicating what is already remediated
- **File:** `SRC_CODE_AUDIT_PLAN.md`
- **Line:** 11
- **Stale reference:** “Legacy branding references broadly in src/” may be true historically but is ambiguous without current counts/date.
- **Suggested fix:** Add timestamped metric snapshot (e.g., grep counts) and delta since last sweep.

### 9) MEDIUM — Tool documentation still exposes legacy round-based team APIs without explicit deprecation level
- **File:** `TOOLS.md`
- **Line:** 219
- **Stale reference:** `talk_to_teammate`, `update_my_status`, `update_team_goal` marked “Legacy round-based” but no migration recommendation adjacent.
- **Suggested fix:** Add explicit replacement path in same row (e.g., managed teams/coordinator APIs) and expected removal horizon.

### 10) MEDIUM — Context doc contains “legacy task runtime system prompt” marker without compatibility note
- **File:** `Context.md`
- **Line:** 672
- **Stale reference:** Labels a runtime path as legacy, but does not clarify whether it is still used, shimmed, or dead.
- **Suggested fix:** Add status annotation (`active legacy`, `compat shim`, or `retired`) to prevent incorrect assumptions during maintenance.

---

## Assumptions
- This pass focuses on stale-reference risk in workspace documentation, plans, and proposal artifacts that can mislead future engineering work.
- Findings are reference-quality risks, not direct code-execution defects unless explicitly marked critical.

## Recommended Next Pass
1. Reconcile team workspace planning docs (`skills-inventory.md`, `skill-remediation-plan.md`) against current skill files.
2. Add “historical artifact” disclaimers to denied/pending proposals that are frequently consulted.
3. Add machine-readable status tags to legacy sweep/audit docs to prevent stale re-triage.
