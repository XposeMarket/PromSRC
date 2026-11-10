# Stop tracking personal workspace data
Tier: 1; privacy fix for a public repository, no runtime behavior change.
Surface: backend
Parity: n/a, no UI.
Size justification: 2,880 file deletions are index-only (git rm -r; files stay on disk for the owner). Hand-written change is small: .gitignore section, one guard module, one audit hook, one test, CI step, npm scripts, one test skip.
## Problem
4,486 files under workspace/ were tracked, including USER.md, MEMORY.md, BUSINESS.md, SOUL.md, memory/ daily notes, Brain/, uploads/, exports/ and skills/.history/. .gitignore deliberately un-ignored workspace/** and scripts/audit-repo-privacy.mjs skipped workspace/ entirely, so nothing stopped it.
## Chosen approach
Untrack everything under workspace/ except workspace/skills/** (minus .history/ and .cache/), which build and tests read, and workspace/self/** (developer docs that tests read). Rewrite the .gitignore section to ignore /workspace/* except those two subtrees. Add scripts/check-workspace-tracking.mjs (allow-list); audit-repo-privacy.mjs now always fails when a tracked workspace path is outside it. scripts/test-workspace-tracking-guard.mjs proves allowed passes and disallowed fails, at unit level and against a throwaway git repo. It runs in the Privacy and secret scan CI job and in npm run audit:privacy. memory-atoms.regression.ts skips when workspace/MEMORY.md is absent (same pattern as memory-atoms-real-corpus.stress.ts). prom-repo-sync behavior unchanged.
## Files
- .gitignore
- scripts/check-workspace-tracking.mjs
- scripts/audit-repo-privacy.mjs
- scripts/test-workspace-tracking-guard.mjs
- .github/workflows/privacy-secret-scan.yml
- package.json
- src/gateway/memory-index/memory-atoms.regression.ts
- .pr/SPEC.md
- workspace/** (index removals only, outside skills/ and self/)
## Acceptance
Test: node scripts/test-workspace-tracking-guard.mjs && node scripts/audit-repo-privacy.mjs --strict-current && npx tsc --noEmit -p .
git ls-files workspace lists only workspace/skills/** (no .history) and workspace/self/**. Skill and self-doc tests still pass.
## Risks
Personal files remain in Git history; this change does not rewrite history (needs a separate, owner-approved filter-repo and force-push). prom_repo_sync will no longer sync personal workspace files through this repo, because they are now ignored; the owner needs another backup path for them. Rollback: revert this commit (files are still on disk).

## Scope notes
- .gitmodules: git rm -r removed the stale workspace/PromSite submodule entry automatically, because that gitlink was under workspace/.
- Every workspace/** deletion (including non-ASCII paths under workspace/games/) is an index-only removal covered by the workspace/** line in Files.
