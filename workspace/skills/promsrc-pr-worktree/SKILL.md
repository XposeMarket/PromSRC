---
name: PromSRC PR Worktree Workflow
description: Raul's mandatory workflow for making any Prometheus source change via an isolated Git linked worktree under C:\Users\rafel\promsrc-pr, opening a PR through the GitHub connector, and only pulling/restarting the live checkout after he approves the merge. Use for every PromSRC code change, bug fix, or feature PR.
---

# PromSRC PR Worktree Workflow

Prometheus source work never happens in the live checkout. This is a hard rule, not a
preference: the live gateway runs from `C:\Users\rafel\PromSRC`, and editing it directly
can break the running app mid-session.

## Non-negotiable invariants

1. **Live gateway + main checkout:** `C:\Users\rafel\PromSRC` — read it, build from it,
   restart it. Never author PR work in it.
2. **Every PR gets its own linked worktree:** `C:\Users\rafel\promsrc-pr\<pr-or-task-slug>`.
3. **Never self-merge.** Stop after opening the PR and wait for Raul's explicit approval.
   Astra (Codex) reviews and merges Prom-created PRs.
4. **`gh` CLI does not exist on this machine.** All GitHub API/PR operations go through the
   GitHub connector tools. Local git (worktree, branch, commit, push) uses normal git.

## Procedure

### 1. Inspect real state first

Never create or switch a worktree blind. Confirm what actually exists:

```bash
git -C C:\Users\rafel\PromSRC status -sb
git -C C:\Users\rafel\PromSRC worktree list
git -C C:\Users\rafel\PromSRC branch -a --sort=-committerdate
```

Preserve unrelated dirty files. If a worktree for this task already exists, verify its
branch and uncommitted state before reusing it. Do **not** pull into, reset, clean, delete,
or reuse a PR worktree until that verification is done.

### 2. Create the linked worktree

```bash
git -C C:\Users\rafel\PromSRC fetch origin
git -C C:\Users\rafel\PromSRC worktree add -b <branch-name> C:\Users\rafel\promsrc-pr\<slug> origin/main
```

Branch off `origin/main`, not off a stale local main.

### 3. Edit canonical source only

Work inside the worktree. Edit `src/`, never `dist/`. Use native workspace edit tools.
Keep the change scoped to the task — unrelated or explicitly rejected work (for example
broken Liquid Glass changes) stays out.

### 4. Validate before committing

Run the real checks in the worktree, not the live checkout:

```bash
npm run build
node dist/<path>/<relevant>.regression.js
```

If the change touches routing/skills/tools, run the matching regression file and paste the
pass output as evidence.

### 5. Commit only task files

```bash
git -C C:\Users\rafel\promsrc-pr\<slug> status -sb
git -C C:\Users\rafel\promsrc-pr\<slug> add <explicit paths>
git -C C:\Users\rafel\promsrc-pr\<slug> commit -m "<imperative summary>"
git -C C:\Users\rafel\promsrc-pr\<slug> push -u origin <branch-name>
```

Stage explicit paths. Never `git add -A` in a worktree that may contain unrelated churn.

### 6. Open the PR via connector

```
connector_github_create_pr(owner, repo, title, head:"<branch-name>", base:"main", body)
```

Body should state: root cause, the fix, validation evidence, and blast radius.

### 7. STOP

Report the PR number and URL. Do not merge. Wait for Raul.

### 8. After Raul confirms merge

Only then, and only into the live checkout:

```bash
git -C C:\Users\rafel\PromSRC pull origin main
git -C C:\Users\rafel\PromSRC log --oneline -3
npm run build   # in PromSRC
```

Restart the gateway from the updated PromSRC, run the exact feature/build checks the PR
claimed to fix, and report pull + restart + verification results explicitly.

## Auto-PR rule

When you hit a genuine error or fault in Prometheus tools/runtime during normal work —
not user error, not transient network — open a fix PR immediately via this workflow
without waiting to be asked.

## Cleanup

Only after the branch is merged and verified:

```bash
git -C C:\Users\rafel\PromSRC worktree remove C:\Users\rafel\promsrc-pr\<slug>
git -C C:\Users\rafel\PromSRC worktree prune
```

Never remove a worktree with unverified uncommitted state.

## Common failure modes

- **Editing PromSRC directly** — breaks the running gateway. Always use the worktree.
- **Reaching for `gh`** — not installed. Use the GitHub connector.
- **Branching off stale local main** — fetch first, branch from `origin/main`.
- **Self-merging** — Astra merges, not Prom.
- **Verifying in the wrong checkout** — build/test in the worktree pre-merge, in PromSRC post-merge.
