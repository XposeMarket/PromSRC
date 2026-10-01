---
name: promsrc-pr-worktree
description: "Raul's mandatory workflow for any Prometheus source change - isolated linked worktree under C:\\Users\\rafel\\promsrc-pr, validate, PR via GitHub connector, merge only on explicit ask, then pull/build/restart the live PromSRC checkout and verify on the real surface (phone/desktop). Use for every PromSRC code change, bug fix, feature PR, live hotfix, merge, or post-merge restart."
---

# PromSRC PR Worktree Workflow

Live gateway runs from `C:\Users\rafel\PromSRC`. Repo: `XposeMarket/PromSRC` (owner `XposeMarket`, NOT raulreyes2). PR work happens in `C:\Users\rafel\promsrc-pr\<slug>`.

## Invariants

1. Default: never author PR work in the live checkout.
   **Exception, live-hotfix mode:** when Raul says "edit live -> restart -> verify" (he did this repeatedly 9/25), edit PromSRC directly, build, restart, verify, THEN move the diff into a worktree PR. Write a note listing the uncommitted live files so nothing is lost.
2. **Merge only when Raul explicitly says so in the current conversation** ("merge it", "ship it", "yes merge"). Otherwise stop after opening the PR. Never merge on implied approval.
3. No `gh` CLI. GitHub = connector via `tool_search` -> `tool_call` (`connector_github_create_pr`, `_get_pr`, `_merge_pr`, `_list_prs`). Use **`pr_number`** (not `pull_number`).
4. Stage explicit paths. Never `git add -A` (PromSRC has generated/, artifacts/, .cache churn).

## 1. Inspect real state (one batched call)

```powershell
# cwd C:\Users\rafel\PromSRC
git status --short | Select -First 30; git log --oneline -3; git fetch origin -q; git log origin/main --oneline -1; git worktree list | Measure-Object | % Count
```
Uncommitted live edits from another session? Leave them alone and note them. If one of them overlaps your fix, diff it (`git diff -- <file>`) before duplicating work.

## 2. Worktree

```powershell
git worktree add -b fix/<slug> C:\Users\rafel\promsrc-pr\<slug> origin/main
# new worktree has no node_modules - junction the live one (seconds, no install):
cmd /c mklink /J C:\Users\rafel\promsrc-pr\<slug>\node_modules C:\Users\rafel\PromSRC\node_modules
```
Before reusing an existing worktree, verify its branch + dirty state first.

## 3. Edit canonical source

`src/` and `web-ui/src/`, never `dist/` or `generated/`. Keep scope tight. Rejected work (Liquid Glass, the "Use your Chrome" approval-card redesign) stays out.

## 4. Validate (in the worktree)

- Add or extend a `*.regression.ts` that reproduces the actual failure (use the exact bad input from `tool_audit.log`). Add an npm script `test:<name>`.
- `npx tsx src/.../<name>.regression.ts` (no build needed)
- `npx tsc --noEmit -p tsconfig.json` (use workspace_run start + wait)
- Web UI touched? `npm run sync:web-ui` is REQUIRED before build or the generated bundle ships stale (missed repeatedly on 9/22-23).
- Known baseline: ~52 unrelated test scripts already fail on main. Compare against main, don't chase them.

## 5. Commit + push + PR

```powershell
git add <explicit paths>; git commit -q -m "<imperative summary>"; git push -u origin fix/<slug> 2>&1 | Select -Last 3
```
PR body: root cause (with log evidence: timestamps, counts), fix, validation output, blast radius.

## 6. STOP. Report the PR number + URL.

## 7. Merge (only on explicit ask)

`tool_call connector_github_merge_pr {owner:"XposeMarket", repo:"PromSRC", pr_number:N, merge_method:"squash"}`. Then `connector_github_get_pr` and confirm merged + sha.

## 8. Pull, build, restart, VERIFY ON THE REAL SURFACE

```powershell
# cwd C:\Users\rafel\PromSRC
git pull --ff-only origin main 2>&1 | Select -Last 3; git log --oneline -1
npm run sync:web-ui   # if web-ui changed
npm run build 2>&1 | Select -Last 15
```

**Pick the restart scope:**
| Changed | Needed |
|---|---|
| backend `src/**` | gateway restart |
| `web-ui/**`, mobile JS/CSS | sync:web-ui + build; phone needs a reload (the service worker updates as of #415/#416) |
| Electron main / preload / packaging | full app relaunch (a gateway restart is NOT enough; #428 was falsely called PASS) |
| skills / workspace files | nothing |

**Prove the live process is new.** The gateway PID's start time must be later than the build's `dist` mtime. On 9/20-21 restart tests ran against a gateway still on the old build twice.

```powershell
(Get-Item dist\gateway\server.js).LastWriteTime; Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -match 'gateway' | Select ProcessId,CreationDate
```

**Verify where Raul sees it.** Server-side PASS does not count as PASS for UI/mobile/restart behavior. #389 passed on the server and failed on the phone. Use a screenshot, the phone, or an actual tool call that exercised the fix, and quote the evidence. If you can't verify on the device, say "unverified on device", not PASS.

## 9. Cleanup (after a verified merge)

```powershell
git worktree remove C:\Users\rafel\promsrc-pr\<slug>; git branch -d fix/<slug>; git worktree prune
```
Periodic sweep (61 worktrees on 9/25): list them, check each branch with `git branch --merged origin/main`, and remove only the merged ones with a clean status. Never force-remove a dirty worktree.

## Direct-edit exception

Outside live-hotfix mode, a direct edit in `C:\Users\rafel\PromSRC` is allowed only when Raul explicitly asks for a direct local edit. Still inspect state, preserve dirty work, edit canonical source, validate, and report evidence. The old `request_dev_source_edit` / `prom_apply_dev_changes` proposal ceremony is not part of this workflow.

## Worktree safety

- Before creating, reusing, or removing a worktree: `git worktree list --porcelain`, `git status --short`, and the branch. Never delete a dirty worktree, reuse an unknown path, or pull/reset/clean a PR worktree to resolve unrelated state.
- Never `git add .`, `git commit -a`, `git clean`, or `git reset --hard` as a convenience.
- A worked example of a larger change (runtime tool moved into a tool category) is in `references/example-runtime-to-tool-category-pr.md`.

## Completion report

Separate **Changed** (worktree, branch, files, PR), **Verified** (commands and output, on-device evidence), and **Not verified** (and why). A commit, a PR, or a restart on its own never proves the feature works.

## Auto-PR rule

A genuine Prometheus tool/runtime fault during normal work (not user error, not a transient network blip) means opening a fix PR through this workflow unprompted. Find the failing call in `tool_audit.log` first: `rg -n 'FAIL <tool>' tool_audit.log | Select -Last 10`.
