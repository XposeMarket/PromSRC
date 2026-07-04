---
name: src-edit-proposal-rigor
description: Pragmatic workflow for Prometheus self-source edits, including scoped dev approvals and full proposals only when risk or scope requires them.
emoji: "ðŸ§©"
version: 2.1.0
triggers: src edit, source edit, Prometheus source, change Prometheus source code, self-edit Prometheus, request_dev_source_edit, dev source edit, proposal code change, code_change proposal, edit src, edit web-ui, edit mobile app, edit generated web ui, edit gateway, edit route, edit tool execution, edit approvals, edit scheduler, edit memory, edit connector, patch Prometheus internals, fix Prometheus bug, implement Prometheus feature
---

# SRC Edit Approval Workflow

Use this skill for any change that edits Prometheus product source or source-adjacent runtime surfaces:

- `src/**`
- `web-ui/**`
- `generated/public-web-ui/**`
- `package.json`, `package-lock.json`, `tsconfig*`
- gateway/server/routes/tools/agents/scheduler/memory/connectors
- mobile app/PWA code
- approval, filesystem, shell, browser, desktop, credential, or audit code

This is a Codex-style engineering workflow. The job is not to describe how to change Prometheus. The job is to inspect the repo, make or propose the smallest correct patch through the approved route, verify it, repair failures, and report exactly what changed. Use the lightest approval shape that preserves scoped source safety.

---

## Two Approved Source-Edit Routes

### Route A: Full Proposal Execution

Use full proposal execution when:

- the user asks for a proposal;
- the change is medium/large;
- the change touches core runtime/tool/scheduler/memory/auth/security/connectors;
- the change is risky, ambiguous, or broad;
- secondary review is required;
- the user is not in the dev build / dev source approval path.

For `write_proposal`, use `execution_mode="code_change"` and the canonical source executor.

### Route B: Dev-Only Fast Approval

Use `request_dev_source_edit` when all of these are true:

- the current environment is the dev Prometheus build/session;
- the user explicitly wants Prometheus to make the source edit now;
- the requested scope can be expressed as a small file list;
- the change is not weakening safety/security/approval boundaries unless the user explicitly requested that exact area;
- the task can be verified in the current turn.

`request_dev_source_edit` asks Raul for approval/rejection inline. For ordinary small edits, call it with exact files and a short user-grounded reason; add a concise plan/evidence only when the edit is non-trivial, broad, or near safety/approval/runtime boundaries. When approved, source-write tools unlock only for the approved chat/session/scope. Approval is not permission to skip inspection or verification. After approval:

1. Re-inspect the exact current files and dirty work.
2. Patch only approved files/surfaces.
3. Run required sync/build/checks.
4. Use `prom_apply_dev_changes` when available with accurate `changed_surfaces`.
5. Verify live behavior when backend/gateway/UI behavior changed.
6. Report exact files and verification.

Do not use the fast route in the public Electron app. Public builds should not expose dev source edit unlocks.

---

## Core Behavior Rules

- Read before proposing or editing.
- Trust repo files over memory, user descriptions, and previous plans.
- Never claim file paths, functions, line ranges, scripts, or architecture without reading/listing them.
- Make the smallest behaviorally complete patch.
- Preserve existing behavior unless the user asked to change it.
- Do not reformat unrelated files.
- Do not introduce frameworks, dependencies, build steps, or architecture unless explicitly requested.
- Do not commit or push unless Raul explicitly asks.
- Do not overwrite unrelated dirty work.
- Never claim success without verification evidence.

Evidence contract:

- When making claims about the codebase, cite file/function/line evidence in the plan or internal notes.
- If memory conflicts with source files, trust source files.
- If a previous plan conflicts with source files, trust source files.

---

## Prometheus-Specific Source Facts

- Prometheus web UI is currently a static vanilla JS app, not React.
- Do not introduce React, JSX, Tailwind, Next routing, or a new build step unless explicitly requested.
- Desktop page switching uses `setMode()` in `web-ui/src/app.js`.
- Static assets are served through Express routes in `src/gateway/core/app.ts`.
- For web UI changes, edit `web-ui/src/**` first, then run `npm run sync:web-ui`.
- Do not hand-edit `generated/public-web-ui/**` unless explicitly doing emergency verification or the current source pattern requires generated output to be committed after sync.
- For mobile app/PWA edits, source lives under `web-ui/src/mobile/**`; generated served files are under `generated/public-web-ui/static/mobile/**`.
- For backend/gateway edits under `src/**`, run `npm run build:backend` at minimum, or `npm run build` when web/static sync is also relevant.
- In dev/server mode after Prometheus source, web UI, or mobile edits, prefer `prom_apply_dev_changes` over manual sync/build/restart when available.
- Use `changed_surfaces: ["web-ui"]` after `web-ui/src/**`, `["mobile"]` after `web-ui/src/mobile/**`, `["backend"]`/`["src"]`/`["gateway"]` after backend changes, and mixed surfaces when both changed.
- `gateway_restart` is the lower-level fallback when only build+restart is explicitly needed.

Memory-backed operational rule:

Approved proposal execution or `request_dev_source_edit` scope is permission to edit only the scoped files/surfaces, not permission to skip validation. Completion requires generated web sync when relevant, build gate, live restart/reload when needed, and a final verification note.

---

## Self-Modification Safety

When editing Prometheus itself:

- Do not modify safety, approval, filesystem, shell, browser, desktop, or credential-handling code without explicit user intent.
- Never weaken approval gates.
- Never broaden filesystem access silently.
- Never store secrets in source files.
- Never log credentials, tokens, cookies, OAuth codes, or API keys.
- Never remove audit logging unless explicitly requested and reviewed.
- Before modifying tool execution, permissions, scheduler, background tasks, memory, auth, or connectors, create a rollback note and inspect related tests/logging/audit behavior.

Risk routing:

- Small edit: <=80 lines, <=2 files, non-critical UI/text behavior. Fast approval can be appropriate in dev.
- Medium edit: 3-6 files or an architectural touchpoint. Prefer proposal or fast approval plus secondary review.
- Large/risky edit: core runtime, tool execution, scheduler, memory, auth, filesystem, shell commands, browser/desktop control, credentials, or self-modifying internals. Plan first, get secondary critique when available, patch, verify, then final review.

---

## Mandatory Pre-Edit / Pre-Proposal Workflow

### 1. Scope Discovery

- Run/search repo with `rg`/source tools for relevant symbols, routes, handlers, and call sites.
- List nearby directories before inventing paths.
- Check `git status --short` when available.
- Inspect `package.json` scripts before choosing verification.

Evidence list format:

- `file`: exact path
- `function/component`: symbol or block
- `lines`: approximate/actual range
- `why impacted`: short reason

### 2. Evidence Capture

- Read each impacted file directly.
- For large files, locate relevant functions/classes first and read focused ranges.
- Read callers/callees/imports/exports and neighboring patterns.
- Summarize current flow from source evidence, not memory.

### 3. Short Plan

Before patching or proposing, produce a short plan:

- Files likely to change
- Why those files
- Verification command(s)
- Risk/rollback areas

Do not over-plan. Small tasks can use 3-5 bullets.

### 4. Patch or Proposal

If using `request_dev_source_edit`, request only the necessary files and a short reason. Add a verification profile/command or concise plan only when it helps the user understand risk or completion. After approval, patch only the approved scope.

If using `write_proposal`, use the proposal template below and include deterministic execution instructions.

### 5. Verification and Repair

After every meaningful patch:

- Reread changed areas.
- Run the most relevant available verification.
- If verification fails, read the error, decide patch-caused vs pre-existing, fix patch-caused failures, and rerun.
- Repeat up to 3 automatic repair cycles.

After 3 failed repair attempts, stop and report:

- command run
- failing error
- suspected cause
- files already changed
- next recommended patch

---

## Verification Selection

- Backend/gateway TypeScript: `npm run build:backend` or `npm run build`.
- Web UI/mobile: `npm run sync:web-ui`, then browser smoke/console check when behavior changed.
- Package/dependency: install/build impact, package lock consistency.
- CSS-only: browser smoke and visual check.
- Tool/scheduler/memory/security: targeted tests if available plus build.
- Docs-only: readback/format check unless docs generation exists.

For UI changes:

1. Start or use the local gateway/dev server.
2. Open the affected page.
3. Check for visible rendering issues.
4. Check browser console errors.
5. Exercise the changed interaction.
6. Screenshot if useful.

---

## Proposal Requirements

Use these exact headings in `write_proposal.details` for source proposals:

- `Why this change`
- `Exact source edits`
- `Deterministic behavior after patch`
- `Acceptance tests`
- `Risks and compatibility`

Pin the canonical src executor:

- `executor_agent_id` must be `code_executor_synthesizer_v1` for `src/` proposals in this workspace.
- Never leave `executor_agent_id` blank.
- Never use `main`, brainstorm, summarizer, or research executors for source edits.
- If unavailable, run `agent_list`/`agent_info`, resolve the canonical replacement, and state the decision before submitting.

Executor prompt must say:

- this is source-edit execution, not analysis-only;
- apply only listed file edits;
- inspect current dirty state first;
- run required sync/build/tests;
- use `prom_apply_dev_changes` with accurate surfaces when available;
- report exact changed files and verification;
- stop on mismatch/blocker.

Preflight checks before submitting:

- `executor_agent_id` is exactly `code_executor_synthesizer_v1`;
- executor exists in `agent_list`;
- proposal `type` is `src_edit` or `feature_addition` when touching `src/`;
- `affected_files` matches the plan exactly;
- acceptance tests are executable and observable.

---

## Proposal Detail Template

## Why this change
- Problem statement:
- Why current behavior is insufficient:
- Source evidence (file + lines):

## Exact source edits
- `src/...fileA.ts` (lines X-Y):
  - Current flow summary:
  - Planned edit:
- `web-ui/src/...fileB.js` (lines A-B):
  - Current flow summary:
  - Planned edit:
- Any new file(s): path + purpose

## Deterministic behavior after patch
- Happy path:
- Edge cases:
- Error handling:
- Explicit non-changes:

## Acceptance tests
1. Build/typecheck steps:
2. Web/mobile sync steps:
3. Runtime/browser verification steps:
4. Expected outputs/logs/UI states:
5. Regression checks:

## Risks and compatibility
- Potential risks:
- Backward compatibility:
- Mitigations/rollback:

---

## Dev Fast Approval Shape

Use this minimal shape when calling `request_dev_source_edit`:

- `files`: exact source files/surfaces to unlock, no extras
- `reason`: short user-grounded reason
- optional `verification_profile` or `verification_command`: narrowest relevant check, for example:
  - `npm run sync:web-ui`
  - `npm run build:backend`
  - `npm run build`
- optional `plan`: 1-3 grounded bullets or file/line evidence when the edit is non-trivial

After approval, final report must include:

- Changed
- Files modified
- Verification run
- Live restart/reload status if relevant
- Remaining issues

---

## Quality Gate Checklist

- [ ] Every impacted source file was read directly.
- [ ] Current flow is described from evidence, not memory.
- [ ] Exact edits are specified per file.
- [ ] Dirty work/user changes were checked or consciously scoped around.
- [ ] No hallucinated paths/scripts/frameworks.
- [ ] No architecture drift.
- [ ] Safety/approval/credential/audit gates are preserved.
- [ ] Verification commands were selected from actual scripts/tools.
- [ ] Repair loop was used for patch-caused failures.
- [ ] Final answer distinguishes verified, unverified, and pre-existing failures.

If any required box is unchecked, do not submit the proposal or claim completion yet.
