# SRC Code Audit & Remediation Plan
**Generated:** 2026-03-25  
**Prepared by:** Prometheus (manager-synthesized from SRC Code Intelligence Team outputs)

---

## Executive Summary
This plan consolidates findings from the multi-agent `src/` audit and defines a phased path to stabilize runtime behavior, complete the SmallClaw→Prometheus cleanup safely, and improve maintainability.

Primary outcomes:
- **Legacy branding references:** `smallclaw`/`SmallClaw` appears broadly in `src/` and requires staged cleanup.
- **Runtime risk defects:** route-level module resolution issues were identified as likely `MODULE_NOT_FOUND` failure points.
- **Improvement backlog:** architecture and reliability improvements are ready once breakages and naming cleanup are handled.

---

## Audit Scope
- Target: **`src/` code only**
- Agents executed:
  1. SmallClaw reference finder
  2. Bug scout
  3. Improvement suggester (after 1+2)
  4. Plan architect
- Objective: identify references, likely bugs, and produce execution plan.

---

## Results Snapshot

| Area | Result |
|---|---|
| SmallClaw references | **246 matches across 164 files** |
| High-priority likely runtime defects | **3 require/import path issues** |
| Planning output | **Phased plan (stabilize → rename UX → compatibility/internal cleanup)** |
| Improvement output | Prioritized backlog (P1/P2/P3) |

---

## 1) SmallClaw Reference Findings
### Summary
Legacy `SmallClaw`/`smallclaw` strings still exist across environment names, compatibility paths, comments/docs, and some user-facing text.

### Notable user-facing/sensitive examples
- `src/auth/openai-oauth.ts:330` — user-visible text: **"Connected to SmallClaw"**
- `src/gateway/prompt-context.ts:230` — contains **`@Small_Claw_`**
- `src/gateway/comms/webhook-handler.ts` — legacy webhook/header naming patterns

### Interpretation
- Not all references should be removed immediately; some are compatibility-critical.
- User-visible references should be prioritized for consistency.
- Internal/legacy aliases should be retired only after compatibility checks.

---

## 2) Bug / Potential Error Findings
### High-priority likely runtime issues
The bug scout identified these as likely endpoint-time failures due to incorrect module paths:

1. `src/gateway/routes/goals.router.ts:79`  
   - `require('./goal-decomposer')` likely wrong relative path.
2. `src/gateway/routes/goals.router.ts:168`  
   - `require('./prompt-mutation')` likely wrong relative path.
3. `src/gateway/routes/connections.router.ts:139,153`  
   - `require('./browser-tools.js')` likely wrong relative path.

### Risk
If unresolved, these can trigger `MODULE_NOT_FOUND` and break route handlers at runtime.

---

## 3) Improvement Backlog (post-fix stage)
### Priority 1 (after hotfixes)
- Replace fragile dynamic `require(...)` patterns with stable static imports where possible.
- Normalize user-facing naming (remove lingering SmallClaw language in responses/UI text).

### Priority 2
- Centralize and document legacy alias handling (env vars, path aliases, webhook naming).
- Add guardrails for route-level dynamic loading and module resolution errors.

### Priority 3
- Broader maintainability cleanup:
  - tighten typing,
  - improve error boundaries,
  - reduce path fragility,
  - standardize logging/telemetry labels.

---

## Consolidated Phased Execution Plan

## Phase 0 — Stabilize Runtime (Immediate)
**Goal:** eliminate known route crash risks.

### Actions
- Correct path resolution in:
  - `src/gateway/routes/goals.router.ts`
  - `src/gateway/routes/connections.router.ts`
- Verify all affected endpoints load dependencies successfully.
- Add short regression checks for those routes.

### Exit Criteria
- No `MODULE_NOT_FOUND` on targeted endpoints.
- Route handlers execute normally in local validation.

---

## Phase 1 — User-Facing Rename Cleanup (High)
**Goal:** remove inconsistent branding in user-visible outputs while preserving compatibility.

### Actions
- Patch user-facing SmallClaw text first (messages, prompts, status labels).
- Validate auth/connection flows and visible notifications.
- Keep internal aliases untouched in this phase unless clearly safe.

### Exit Criteria
- No user-visible “SmallClaw” strings remain in active UX paths.
- No behavior regressions in auth/prompt/comms flows.

---

## Phase 2 — Internal Compatibility Cleanup (Controlled)
**Goal:** reduce technical debt from legacy identifiers.

### Actions
- Inventory legacy env vars/headers/paths and classify:
  - required compatibility aliases,
  - safe-to-deprecate items,
  - removable items.
- Introduce explicit compatibility shims (if needed) before removals.
- Stage deprecations with logs/warnings and migration notes.

### Exit Criteria
- Compatibility preserved for expected integrations.
- Legacy internals reduced with clear migration path.

---

## Phase 3 — Reliability & Maintainability Improvements
**Goal:** harden the codebase and prevent recurrence.

### Actions
- Prefer static imports where feasible; reduce runtime dynamic loading.
- Add targeted tests around route module resolution and startup checks.
- Add lint/static checks for suspicious relative requires.
- Standardize naming conventions and logging labels post-rebrand.

### Exit Criteria
- Reduced module resolution risk.
- Clearer diagnostics and fewer fragile code paths.

---

## Validation Checklist
- [ ] Reproduce current route failures (if present) and capture baseline.
- [ ] Fix all three high-priority path issues.
- [ ] Run build/type checks and route smoke tests.
- [ ] Verify user-facing text cleanup in auth/prompt/comms touchpoints.
- [ ] Confirm compatibility behavior before internal alias removals.
- [ ] Document all changed files and risk notes.

---

## Risks & Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Removing compatibility-critical legacy keys too early | Integration breakage | Use staged deprecation + alias shims |
| Renaming internal constants broadly in one sweep | Hidden regressions | Execute in phases, with route-first smoke tests |
| Dynamic require cleanup changes load timing | Subtle runtime differences | Prefer incremental refactors with focused tests |

---

## Recommended Immediate Next Move
Execute **Phase 0** as a focused patch set, then immediately follow with **Phase 1** user-facing cleanup. Defer broad internal rename/deprecation work until runtime stability and UX consistency are confirmed.

---

## Appendix: Confirmed Key Findings (as reported)
- SmallClaw references: **246 matches / 164 files** in `src/`.
- High-priority likely runtime defects:
  - `src/gateway/routes/goals.router.ts:79`
  - `src/gateway/routes/goals.router.ts:168`
  - `src/gateway/routes/connections.router.ts:139,153`
- Plan structure produced by planning agent: **stabilize → user-facing cleanup → compatibility/internal cleanup → improvements**.
