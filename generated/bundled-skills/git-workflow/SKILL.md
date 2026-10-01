---
name: "git-workflow"
description: "Inspect and operate Git repositories safely: status, diffs, commits, branches, remotes, conflict recovery, submodules, GitHub connector operations, and authenticated publication. Use for concrete Git or GitHub operations, not generic coding."
---

# Git Workflow

Inspect first and preserve unrelated work. Existing changes belong to the user unless their provenance is known.

## Workflow

1. Resolve the exact repository root, current branch, worktree status, remotes, and nested repository/submodule boundaries.
2. Inspect scoped diffs before staging. Never use blanket staging when unrelated changes exist.
3. Run relevant validation before committing, then stage only intended paths and write a precise commit message.
4. Fetch before operations that depend on remote state. Use non-interactive commands and avoid rewriting shared history.
5. Push, open PRs, merge, publish releases, or modify remote state only when the user requested that external action.
6. Use `git -C <repo>` for nested repositories in automation so working-directory state cannot drift.
7. For conflicts, identify every conflicted path, edit deliberately, validate, then continue or abort. Never discard work to escape a conflict. Use `merge-conflict-arbitration` for nontrivial conflict decisions.
8. Report branch, commit, pushed remote/PR when applicable, tests, and any remaining dirty paths.

Never run `git reset --hard`, force-push a shared branch, delete branches, discard worktree changes, or expose tokens without explicit scope and authorization. Prefer `--force-with-lease` only for the user’s own rewritten branch.

## Non-Prometheus linked worktrees

If the repository has its own installed worktree/PR skill (for example the Prometheus source workflow), follow that instead. For other repositories:

1. Inspect `git worktree list`, current branch, `git status --short`, and `git rev-parse --git-dir` versus `git rev-parse --git-common-dir` to detect existing isolation, branch occupancy, and dirty state.
2. Prefer a linked worktree under `.worktrees/`; check `.worktrees/` is gitignored first. Create a new branch/worktree; never reuse or clean an existing worktree before verifying its branch, owner, dirty state, and intended disposition.
3. Run repository setup plus a baseline test inside the new worktree, recording pre-existing failures.
4. Never remove a worktree you did not create or one with uncommitted files; recheck branch and status before any cleanup.

GitHub API operations use GitHub connector tools (`connector_github_*` or `connector_github_api_request`). The `gh` CLI is not installed here.

Read [the detailed guide](references/detailed-guide.md) for command examples. Treat its historical paths as examples, not current machine truth. For GitHub authentication and token hygiene, read [github-authentication.md](references/github-authentication.md). Development distributions may provide an additional private release reference; public builds intentionally omit it.
