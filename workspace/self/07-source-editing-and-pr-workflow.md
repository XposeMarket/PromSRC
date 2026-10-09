# 07 — Source editing & PR workflow

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/coding/`, `src/gateway/dev-source-approvals.ts`, `src/gateway/tools/defs/`, `src/gateway/agents-runtime/subagent-executor.ts`, `.github/workflows/`
> **Read this when:** changing Prometheus itself, requesting an in-product source edit, creating a source PR, applying a merged change to the live checkout, or diagnosing the guarded self-edit pipeline.

## TL;DR
- **Use the linked PR worktree, not live `C:\Users\rafel\PromSRC`, for normal source changes.** `C:\Users\rafel\PromSRC` is the live checkout; task branches/worktrees go under `C:\Users\rafel\promsrc-pr\<slug>`.
- The installed dev-source surface is gated and still exists: `request_dev_source_edit`, `dev_source_read`, `dev_source_edit`, `apply_dev_source_patchset`, and `prom_apply_dev_changes` are current names; compatibility schemas `read_source`, `write_source` and line-edit helpers also remain defined. Executor normalization routes these names into the scoped edit/read/apply flow—verify schemas and dispatch before changing them.
- Request the exact project-relative `src/` or `web-ui/` files and reason before making edits. Approved scope is bound to session/files, and source-writing category activation requires an approved dev edit/proposal.
- Workspace-first development tools remain the default for ordinary tasks: `workspace_read`, `workspace_edit`, `workspace_run`, `workspace_git`, code navigation and safety wrappers. They do not turn an arbitrary PromSRC file write into an approved source change.
- `prom_apply_dev_changes` is the guarded local apply/sync/build/restart/reload coordinator after an approved source edit. For web/mobile it calls `npm run sync:web-ui`; backend source builds and restarts the gateway; mixed surfaces sync first then build/restart/reload.
- Per the local human workflow: make a PR worktree with `git worktree`; link/junction shared `node_modules` where appropriate; stage/commit only task files; push; open PR through `connector_github` (no `gh` CLI); request Astra/Codex review; do not merge unless explicitly authorized.
- After merge, pull the merged commit into the live PromSRC checkout, build/sync the touched surface, restart the gateway if backend/runtime changed, then smoke-test the real desktop/mobile/runtime surface. Do not assume CI means the live runtime is updated.
- Package scripts verified: `build = npm run build:backend && npm run build:web`; `build:backend` runs `tsc` and runtime-asset copy scripts; `sync:web-ui` prepares public UI output then runs `check:web-ui`.
- CI is under `.github/workflows/`; `pr-regression.yml` runs `npx tsc --noEmit`, focused regression jobs, web sync, and self-doc-drift checks. Inspect current file because exact job list evolves.
- Fault response rule from Raul's workspace instructions: when Prometheus itself faults, open a repair PR. Treat this as an owner operational rule, not a code-enforced auto-PR daemon.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Guarded dev edit request | `src/gateway/tools/defs/cis-system.ts` → `request_dev_source_edit`, `update_dev_source_edit`, `await_dev_source_edit_approval` | Request scoped file list and reason; wait/steer flow can revise pending request. |
| Guarded source read | `src/gateway/tools/defs/file-web-memory.ts` → `dev_source_read` | Read-only source wrapper over supported roots/actions. |
| Guarded source editor | `src/gateway/tools/defs/file-web-memory.ts` → `dev_source_edit`, `apply_dev_source_patchset`, `write_source`, line-edit/write legacy schemas | `dev_source_edit` dispatches its action; compatibility schemas remain defined and are normalized into the scoped executor path. |
| Dev approval lifecycle | `src/gateway/dev-source-approvals.ts` → request/resolve/continue helpers | Queue/continuation and activation of read/write source categories. |
| Apply coordinator | `src/gateway/tools/defs/cis-system.ts` → `prom_apply_dev_changes`; executor handler | `apply_live` / `verify_only` modes; checks batch readiness and chooses sync/build/restart/reload. |
| Coding context/cache helpers | `src/gateway/coding/workspace-context.ts`, `workspace-session.ts`, `git-read-cache.ts`, `terminal-change-tracker.ts` | Git cache/context and changed-file tracking; this folder is not the whole self-edit system. |
| Tool scope checks | `src/gateway/tool-builder.ts` → source tool sets/classifier; `src/gateway/tool-category-request.ts` | Category cannot self-authorize source writes. |
| Test/build scripts | `package.json`, `src/gateway/*.regression.ts`, `src/runtime/*.regression.ts` | Exact script names listed in [tests inventory](generated/tests.md). |
| PR CI | `.github/workflows/pr-regression.yml`; `privacy-secret-scan.yml` | Main PR regressions and secret scanning; review workflow file for current checks. |
| Live app | `C:\Users\rafel\PromSRC` | Human-designated live checkout; source brief marks it read-only to documentation worker. |
| Task worktrees | `C:\Users\rafel\promsrc-pr\<slug>` | Human-established source PR root; one worktree per task/branch. |

## How it works

### Product self-edit path (in-product guarded source changes)
1. **Inspect the task first.** Use `dev_source_read` or workspace-native tools on the authorized worktree to search definitions/callers/tests. Record exact affected `src/` and/or `web-ui/` paths; source approval should be narrow.
2. **Request approval.** `request_dev_source_edit({files, reason, ...})` requests scoped, dev-only permission. The schema permits a concise plan/evidence and verification profiles for non-trivial work; do not fabricate observed evidence. The request waits for the user approval card.
3. **Handle steering while waiting.** `update_dev_source_edit` can revise a pending request in the current session; `await_dev_source_edit_approval` resumes its interruptible wait. Approval is specific to the requested files/scope, not a global safe-write switch.
4. **Edit only approved files.** `dev_source_edit` exposes guarded operations; `apply_dev_source_patchset` batches approved patch operations. For ordinary workspace or non-PromSRC files, use the appropriate native workspace wrapper instead.
5. **Verify then apply.** Run the edit's selected regression/typecheck/verification profile. `prom_apply_dev_changes` can record `verify_only` against exact current file hashes or coordinate `apply_live`; live applies may wait for concurrent/overlapping edits to be ready before a shared deployment.
6. **Check the real post-apply evidence.** Backend changes build and gracefully restart the gateway. Web/mobile changes synchronize generated UI and request connected UI reload; mixed changes sync first, then build/restart/reload. Report only steps confirmed by the apply result and actual smoke test.

This permissioned in-product mechanism is not the same thing as the local GitHub PR workflow below. Do not invoke `prom_apply_dev_changes` to deploy an unmerged PR branch to the live checkout unless the human procedure explicitly calls for an authorized local hotfix.

### Repository workflow (human-established operating procedure)
The following repository workflow is the owner's standing local process. Tool implementation proves the guarded dev-apply path; it does **not** create or guarantee each git/worktree convention here.

1. **Pick the correct base and scope.** Inspect branch/status/log, current task diff and applicable CI; do not disturb unrelated dirty files in the live checkout. Confirm the target issue/change and whether it is an authorized urgent live hotfix or normal PR work.
2. **Use a dedicated worktree.** Keep the live checkout at `C:\Users\rafel\PromSRC`. Create a task branch/worktree beneath `C:\Users\rafel\promsrc-pr\<slug>` with `git worktree add`; do not branch/commit in PromSRC for normal PR work.
3. **Share dependencies without duplicating large installs.** The owner workflow uses an `node_modules` junction from each worktree to the live checkout's installed dependencies where compatible. Verify the junction target and branch's dependency lockfile/package version before use; rebuild native modules if required. Never delete the target install while removing the junction.
4. **Implement and verify in the worktree.** Search first; edit narrow files; add/update focused regressions; run appropriate `npx tsc --noEmit`, test(s), `npm run sync:web-ui` or `npm run build` as relevant. Check `git status`/diff before staging.
5. **Commit only task files.** Stage explicit paths, review staged diff and secret scan. Do not stage unrelated user work, generated build output or credentials. Commit with a descriptive message on the task branch.
6. **Push and open a PR.** Push the task branch. Create the PR through connected `connector_github` tooling; the local `gh` CLI is not installed and should not be assumed. Include summary, tests and risk/restart notes.
7. **Review before merge.** Request Astra/Codex review, address findings and confirm CI. Merge only when the owner explicitly asks; “open a PR”, “review it”, or “ready” does not mean permission to merge.
8. **Apply after merge.** Fetch/pull the merged target into the live `C:\Users\rafel\PromSRC` checkout through the owner-approved workflow. Confirm the pulled commit matches the PR merge SHA; never sync a stale or unrelated worktree into live.
9. **Build/sync the live checkout.** Run only the needed approved scripts (see below). Check output/exit status before restarting. Backend changes require build and gateway restart; web UI/mobile changes require generated/static sync and UI reload/device verification; mixed changes need both, in the proper order.
10. **Smoke-test and communicate.** Check gateway health/default port (`18789`), logs, exact repaired behavior, and connected desktop/mobile clients if affected. Report commit/PR, tests, build, restart and smoke evidence separately.

### Build and sync scripts (verified in `package.json`)
- `npm run build` = `npm run build:backend && npm run build:web`.
- `npm run build:backend` first runs `scripts/prune-dist.js` (removes `dist/` files whose source no longer exists, keeping tsc's incremental state), then `tsc`, then `scripts/copy-creative-renderers.js`, `scripts/copy-runtime-prompt-assets.js`, and `scripts/copy-extension-descriptors.js`.
- Release builds (`build:win`, `build:mac`, `prepare:public:desktop`) start with `npm run clean:dist` (deletes `dist/` entirely) so packages never ship compiled copies of retired modules. `npm run check:dist` reports orphaned `dist/` files without changing anything.
- `npm run build:web` is currently `npm run check:web-ui`.
- `npm run sync:web-ui` runs `build:thinking-orb`, `scripts/prepare-public-build.js --web-only`, then `check:web-ui`.
- `npm run check:web-ui` runs `scripts/check-public-web-ui-sync.js` and `scripts/check-web-ui-module-globals.mjs`.
- Do not assume every change needs every build. Backend/runtime prompt changes need backend build; `web-ui/` or mobile changes need UI sync/check; public web source changes may need both source prep and sync; mixed changes sync before the backend build/restart as the current apply coordinator does.
- If script behavior has changed since this verification, `package.json` and the relevant script file are authoritative. Don't manually edit generated/static copies as a substitute for running the supported synchronization script.



### Practical worktree, review and integration controls
- Use a slug that identifies the work, not an ambiguous shared branch name. Record the base commit and PR number in the task note so later pull/apply can prove which revision was tested.
- A linked worktree shares Git object storage but has its own checkout/index; dependency sharing is an independent filesystem junction. Creating or removing one does not create/delete the other.
- Before creating the `node_modules` junction, check the worktree's dependency manifest/lockfile matches the install. If it does not, install dependencies in a separate compatible location rather than pointing at a knowingly incompatible dependency tree.
- Junctions can make package scripts write generated output or caches into shared dependencies; inspect target and path before cleanup. Remove the link itself with the appropriate Windows link operation; do not recursively delete the target.
- Run `git status --short` before editing, after tests/build, and before staging. `git diff --check`, staged diff review and the secret scanner should precede commit/push.
- Stage explicit relative paths. Generated/static bundles should be included only when the repository's source workflow requires them; otherwise let supported sync/build produce them and check status again.
- A local `git worktree` can point at the correct branch but still contain task-specific untracked files. Confirm no untracked secret/log/build artifact travels to the PR.
- The PR title/body should name user-visible effect, affected surface, tests/builds, risks, rollout/restart needs and any deliberately deferred checks. Do not claim a smoke test from a unit test or from CI.
- Use GitHub connector actions to create/update/review the PR and read checks. If the connector is unavailable, stop and report that specific blocker; do not substitute an uninstalled `gh` command or push to an unrelated remote.
- Review comments from Astra/Codex are input to the author. Resolve each finding in code/test/docs or explicitly explain why it is not applicable; wait for expected CI jobs to finish before asking to merge.
- If an urgent owner-authorized local hotfix is needed, preserve the original live status/diff, snapshot or create a recovery point, restrict edited paths, run targeted verification, then restore/verify the usual PR route. Do not silently turn an emergency in-place patch into the normal workflow.
- Post-merge verification should compare the merged SHA against what was reviewed. If the merge introduced extra commits, rebuild/test that final merge result rather than treating the branch tip's old check as proof.
- After backend restart, check health and logs for startup completion before testing a client. After web/mobile sync, ensure the client has loaded the updated bundle (request reload/reconnect) rather than testing a cached tab.


### After a deployment or smoke-test failure
- First separate build failure, gateway startup failure, provider/upstream failure and UI cache/reload failure. Capture the exact command/exit status or gateway health/log evidence; don't call all of them “the PR failed.”
- Do not repeatedly restart a gateway that has not produced startup/health evidence. Preserve relevant logs and check whether the runtime has recovered before retrying an action that could duplicate a side effect.
- If the backend build fails, leave the verified merged SHA recorded but report that live deployment is incomplete; fix in a new scoped branch/PR unless an explicitly authorized emergency hotfix applies.
- If UI sync fails after backend success, avoid claiming the UI change is live. Resolve source-vs-generated mismatch using the supported sync script, reload the actual client and retest.
- If post-merge smoke fails, open/follow the repair issue/PR path even if CI is green; CI did not exercise the failing device/provider state.
- Record the applied merge SHA, local checkout status, build/sync result, restart result and target smoke result separately in the task note.
- A rollback is also a source change: choose the known-good SHA or revert commit, inspect dirty state and user work before switching, and follow the same PR/hotfix authorization rule.
- Remove a task worktree only after its PR is merged/closed and no in-progress changes need recovery. Confirm the worktree list and branch before removing it; clean up junction separately from its target.

- A PR with docs-only changes normally needs no backend restart. Do not restart or mutate the live runtime just because this workflow section discusses it.

### CI and PR review
`.github/workflows/pr-regression.yml` runs on PRs targeting `main` and pushes to `main`. At this revision it installs dependencies, builds the native terminal dependency, installs Playwright Chromium, type-checks, runs focused regressions spanning provider/status, proposals, memory, connectors, category routing/provisioning/activation, prompts, composites and UI, runs `npm run sync:web-ui`, and executes self-doc drift validation. The privacy workflow adds secret scanning. CI is an evolving safety net: open the current workflow for exact jobs and read individual step outputs; a green unrelated workflow is not proof of a touched surface.

## Config & knobs
| Setting / command | Meaning |
|---|---|
| `tools.permissions.shell.approval_mode` | `default` or `lite`; affects terminal command approval, not source category access or `workspace_mode`. |
| `tools.workspace_mode` | `prometheus` (default) or `terminal-first`; selects visible native file editing surface, not permissions. |
| Approved dev edit request | Exact `files`, `reason`, optional plan and verification profiles; in-product write is scoped. |
| `prom_apply_dev_changes.mode` | `verify_only` or `apply_live`; apply-live coordinates sync/build/restart/reload for approved development changes. |
| Live checkout | `C:\Users\rafel\PromSRC` (do not use as normal PR authoring checkout). |
| PR worktree root | `C:\Users\rafel\promsrc-pr\<slug>`; one task branch/worktree per independent change. |
| GitHub PR integration | `connector_github`; no `gh` CLI. |
| Gateway default port | `18789`; use runtime health/logging, not port alone, for smoke evidence. |
| Dependency sharing | `node_modules` junction convention is a human workflow optimization; verify target and compatible lockfile before use. |

## Gotchas / sharp edges
- **Dirty live checkout.** PromSRC can contain unrelated local edits. Never reset, clean, checkout over, stage-all or build there for a PR task without explicit authorization and a precise recovery plan.
- **Current and compatibility tool schemas coexist.** `dev_source_read`/`dev_source_edit` are present alongside `read_source`/`write_source` and granular legacy source edit names; executor normalization/approval checks determine the current path. Do not claim the legacy schemas are absent.
- **Approval scope and category activation are separate.** `request_tool_category(prometheus_source_write)` is refused without an already approved source edit/proposal scope.
- **Editing is not applying.** A passing test in a worktree does not sync to live. Conversely, a successful `prom_apply_dev_changes` is not a merged PR.
- **Do not merge from a review outcome alone.** Astra/Codex review, approvals and green CI are evidence; merge remains a separate owner-authorized action.
- **`npm run build` does not run `sync:web-ui`.** The build script is backend plus web check, not the generated/static UI synchronization script. Run the right operation explicitly.
- **`build:web` is currently a check.** Do not infer that it generates the public web UI without reading its command.
- **Junction hygiene.** Confirm with `Get-Item`/`fsutil`/appropriate Windows link inspection that the worktree points to intended `node_modules`; deleting junction vs target has different effects. Never share a dependency tree across incompatible lockfile revisions without reinstall/build verification.
- **Secrets and generated artifacts.** Scan staged diff; do not commit tokens, local auth files, `node_modules`, build output or unrelated generated artifacts. See [21 Security](21-security-approvals-permissions.md).
- **Auto-PR rule is unverified as code.** The requirement to open a repair PR when Prometheus faults is a standing owner/workspace instruction, not a hook found in source. If investigating automation, search current fault/report workflow rather than asserting a PR is created automatically.
- If source approval is denied or task files change, stop and resubmit an exact file-scoped request; do not silently broaden the original approval.
- If `prom_apply_dev_changes` returns a pending batch/coordination result, wait for overlapping edits to be ready and inspect actual hash/scope before apply.
- `verify_only` records checks against selected files/hashes; it does not push, merge, sync or deploy.
- The manifest’s source read/write categories filter both current and compatibility names; changing only one alias set can expose another schema incorrectly.
- Validate patch previews and expected files before `apply_dev_source_patchset`; a green PR plus successful live sync is still not user-path smoke evidence.

## How to change it safely
1. Read [05 Tools & categories](05-tools-and-categories.md), [21 Security](21-security-approvals-permissions.md), and the subsystem guide; read the mobile prerequisite [18 Mobile app](18-mobile-app.md) for any mobile-file changes.
2. For self-edit wrapper changes, trace definitions in `cis-system.ts` / `file-web-memory.ts`, runtime handlers in `dev-source-approvals.ts` and executor, and all tests with `rg` before editing.
3. Add tests for approval scope, path allowlist, batch coordination, verify-only/apply-live behavior and failure/recovery state as affected. Use [generated tests](generated/tests.md) to locate exact coverage.
4. Use the PR worktree, maintain task-only scope, run source typecheck/regressions/sync/build and inspect staged diff/secret scan.
5. Open PR via `connector_github`; request Astra/Codex review; address comments; wait for CI; merge only on explicit authorization.
6. After merge, pull into live PromSRC, run appropriate sync/build/restart, check health and smoke the actual user path. Preserve rollback evidence and do not leave a stale branch deployed.
7. If a Prometheus fault triggers repair work, open the repair PR per owner rule and keep the live checkout unmodified except for explicitly authorized emergency hotfixes.

## Related
- [05 Tools & categories](05-tools-and-categories.md) · [08 Agents, tasks & background](08-agents-tasks-background.md)
- [17 Desktop web UI](17-desktop-web-ui.md) · [18 Mobile app](18-mobile-app.md) · [21 Security, approvals & permissions](21-security-approvals-permissions.md)
- [Generated tests](generated/tests.md) · [Generated source map](generated/source-map.md) · [Sharp edges](25-sharp-edges.md)

### Final report checklist
- List changed paths and PR number or approval ID; identify the reviewed/applied commit SHA.
- Separate regression/typecheck, build/sync, restart and smoke-test results. Say “not run” when not run.
- State whether changes are only in a task worktree, pushed/open in PR, merged, or applied live; never collapse those statuses into “done.”
- Note any CI/review findings still pending, known limitations, and rollback/recovery point.
- Mention any unverified owner-workflow assumption explicitly instead of presenting it as repository-enforced behavior.
