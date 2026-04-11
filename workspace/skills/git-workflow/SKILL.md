---
name: Git Workflow
description: Execute git and GitHub CLI operations correctly. Use for committing, pushing, branching, diffing, creating PRs, resolving conflicts, or any source control task. Triggers on: git, commit, push, branch, PR, pull request, GitHub, version control, save work, sync changes, merge, rebase, stash.
emoji: 🌿
version: 1.0.0
triggers: git, commit, push, pull, branch, PR, pull request, merge, rebase, stash, diff, GitHub, version control, save work, sync changes, checkout, clone
---

# Git Workflow

Don't guess git commands. Use this reference for all git and GitHub CLI operations.

---

## Status & Inspection

```bash
git status                        # What's changed?
git diff                          # Unstaged changes
git diff --staged                 # Staged changes (what's in next commit)
git log --oneline -10             # Last 10 commits
git log --oneline --graph --all   # Visual branch graph
git show <commit>                 # Inspect a specific commit
```

---

## Staging & Committing

```bash
git add <file>                    # Stage specific file
git add .                         # Stage everything
git commit -m "type: message"     # Commit with message
git commit --amend --no-edit      # Amend last commit (keep message)
git reset HEAD <file>             # Unstage a file
git restore <file>                # Discard unstaged changes
```

### Commit Message Format
Use conventional commits:
- `feat: add X` — new feature
- `fix: resolve Y` — bug fix
- `chore: update deps` — maintenance
- `docs: update README` — documentation
- `refactor: restructure Z` — code reorganization
- `test: add tests for W` — tests

---

## Branching

```bash
git checkout -b feature/name      # Create + switch to new branch
git switch main                   # Switch to main
git switch -c feature/name        # Create + switch (modern)
git branch -d feature/name        # Delete branch (safe)
git branch -D feature/name        # Force delete
git merge feature/name            # Merge into current branch
git rebase main                   # Rebase current onto main
```

---

## Remote Operations

```bash
git fetch origin                  # Fetch without merging
git pull origin main              # Pull latest
git push origin HEAD              # Push current branch
git push -u origin feature/name   # Push + set upstream
git push --force-with-lease       # Safe force push (own branches only)
```

---

## GitHub CLI (gh)

```bash
# PRs
gh pr create --title "Title" --body "Description" --base main
gh pr create --draft
gh pr list
gh pr view
gh pr merge 123 --squash
gh pr review 123 --approve

# Issues
gh issue create --title "Bug: X" --body "Details"
gh issue list
gh issue close 42

# Repo
gh repo view --web               # Open in browser
gh run list                      # List CI runs
```

---

## Conflict Resolution

```bash
git status                        # Identify conflicting files
# Edit conflicting files — resolve <<<<<<, =======, >>>>>>>
git add <resolved-file>
git commit                        # Complete merge
# Abort instead:
git merge --abort
git rebase --abort
```

---

## Stashing

```bash
git stash                         # Save changes temporarily
git stash pop                     # Re-apply latest stash
git stash list                    # See all stashes
git stash apply stash@{2}         # Apply specific stash
```

---

## Undo / Recovery

```bash
git revert HEAD                   # New commit that undoes last
git reset --soft HEAD~1           # Undo commit, keep staged
git reset --mixed HEAD~1          # Undo commit, keep unstaged
git reset --hard HEAD~1           # Undo commit + DISCARD changes ⚠️
git reflog                        # Full HEAD history (recovery lifeline)
```

---

## Prometheus-Specific Git Patterns

### Repository Structure
- **Main repo root**: `D:\Prometheus` (Windows) / `/d/Prometheus` (bash)
- **Submodule**: `workspace/xposemarket-site` (a separate git repository tracked as mode 160000)
- Only one `.git` directory at the root level

### Working with Submodules

Initialize submodules after cloning:
```bash
git submodule status                    # Check submodule state
git submodule update --init --recursive # Initialize/pull all submodules
```

**For main Prometheus repo**:
```bash
# Direct commands work from root
git status
git log --oneline -5
git branch --show-current
```

**For submodule (`workspace/xposemarket-site`)**:
⚠️ **NEVER** use just `xposemarket-site` — always use the full relative path:

```bash
# ✅ CORRECT - use full path from project root
cd workspace/xposemarket-site && git status
git -C workspace/xposemarket-site status

# ❌ WRONG - this will fail with "path not found"
cd xposemarket-site && git status
```

### Recommended Pattern for Scripts & Tools
Use `git -C` to run commands in subdirectories without changing directories. This is more reliable in automated contexts:

```bash
git -C workspace/xposemarket-site status --short
git -C workspace/xposemarket-site log --oneline -5
git -C workspace/xposemarket-site branch --show-current
git -C workspace/xposemarket-site remote -v
```

**Why `git -C`**: Avoids directory state persistence issues, works consistently on Windows and Unix, and is ideal for tools and run_command operations.

---

## Common Prometheus Workflows

### Save and push work
```bash
git add .
git commit -m "feat: describe the change"
git push origin HEAD
```

### Create feature branch → open PR
```bash
git checkout -b feature/my-thing
# ... make changes ...
git add .
git commit -m "feat: implement my thing"
git push -u origin feature/my-thing
gh pr create --title "feat: my thing" --body "What and why" --base main
```

### Sync branch with upstream main
```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

### Check submodule status
```bash
# From project root
git -C workspace/xposemarket-site status
git -C workspace/xposemarket-site log --oneline -5
```

---

## Safety Rules

- ❌ Never `git push --force` on shared branches (main, develop)
- ✅ Use `--force-with-lease` only on your own branches
- ✅ Always `git status` before committing
- ❌ Never commit API keys, secrets, or .env files
- ✅ When unsure about destructive ops, stash or create a backup branch first
- ⚠️ **Submodules**: Always use full path `workspace/xposemarket-site` — relative `cd` commands fail in tools
