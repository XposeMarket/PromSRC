---
name: "git-workflow"
description: "Inspect and operate Git repositories safely: status, diffs, commits, branches, remotes, conflict recovery, submodules, GitHub CLI, and authenticated publication. Use for concrete Git or GitHub operations, not generic coding."
---

# Git Workflow

Inspect first and preserve unrelated work. Existing changes belong to the user unless their provenance is known. This skill also absorbs the useful parts of Claude's `commit-commands`: exact commit preparation, optional commit/push/PR sequencing, and stale-branch cleanup. Those actions remain explicitly authorized operations, not automatic side effects.

## Workflow

1. Resolve the exact repository root, current branch, worktree status, remotes, and nested repository/submodule boundaries.
2. Inspect scoped diffs before staging. Never use blanket staging when unrelated changes exist.
3. Run relevant validation before committing, then stage only intended paths and write a precise commit message. Review the staged diff before the commit.
4. Fetch before operations that depend on remote state. Use non-interactive commands and avoid rewriting shared history.
5. Push, open PRs, merge, publish releases, or modify remote state only when the user requested that external action. A request to “commit” does not by itself authorize push, PR creation, merge, or release publication.
6. Use `git -C <repo>` for nested repositories in automation so working-directory state cannot drift.
7. For conflicts, identify every conflicted path, edit deliberately, validate, then continue or abort. Never discard work to escape a conflict.
8. For an explicitly requested commit: confirm the exact paths, message, and staged diff; create one focused commit; then report its hash. For an explicitly requested push/PR: verify branch and remote, push non-destructively, create the PR with the requested title/body, and report the URL. Do not chain these operations without clear scope.
9. For stale branches or worktrees, list exact candidates and their tracking state first. Prefer a recoverable archive or a user-confirmed deletion. Never run a blanket `git branch -D`, delete a worktree with uncommitted changes, or remove a branch merely because it is absent from the remote.
10. Report branch, commit, pushed remote/PR when applicable, tests, and any remaining dirty paths.

Never run `git reset --hard`, force-push a shared branch, delete branches, discard worktree changes, or expose tokens without explicit scope and authorization. Prefer `--force-with-lease` only for the user’s own rewritten branch.

Read [the detailed guide](references/detailed-guide.md) for command examples. Treat its historical paths as examples, not current machine truth. For GitHub authentication and token hygiene, read [github-authentication.md](references/github-authentication.md). Development distributions may provide an additional private release reference; public builds intentionally omit it.
