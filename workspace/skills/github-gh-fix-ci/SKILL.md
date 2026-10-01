---
name: "github-gh-fix-ci"
description: "Diagnose and fix failing GitHub Actions checks on a pull request or branch using the GitHub connector: find the failing check runs, pull the job logs, reproduce locally, fix narrowly, and confirm the rerun goes green. Use when CI, checks, or an Actions workflow is red. Not for reviewing a diff (code-review), answering review comments (receiving-code-review), or general GitHub lookups (connector-github)."
---

# GitHub CI Fix

CI is evidence from another machine. Read its log before forming a theory, reproduce it locally, and never call CI fixed until the check reruns green. The `gh` CLI is not installed; everything remote goes through `connector_github` (load it with `request_tool_category("external_apps")` or `tool_search` if it is not in your tool list).

## 1. Resolve the target

- Owner, repo, and PR number or branch come from the user's URL or words. For "my PR" on the current checkout, read `git remote get-url origin` and `git branch --show-current`, then `connector_github({action:"list_prs", owner, repo, state:"open"})` and match `head`.
- `connector_github({action:"get_pr", owner, repo, pr_number})` gives the head sha and branch. For Prometheus source, follow `promsrc-pr-worktree` instead of this generic PR flow.

## 2. Find what failed

- `connector_github({action:"list_check_runs", owner, repo, ref:"<head sha or branch>"})` lists each check with status and job URL. The trailing number in `/job/<id>` is the job id.
- Run context, when needed: `api_request` `GET /repos/{owner}/{repo}/actions/runs?head_sha=<sha>&per_page=10`.
- Checks whose URL is not a GitHub Actions job (Vercel, external CI) are link-only evidence: report the URL and stop on those.

## 3. Read the log

- `connector_github({action:"api_request", path:"/repos/{owner}/{repo}/actions/jobs/<job_id>/logs"})` returns the plain-text job log. Logs are long: search the returned text for `##[error]`, `Error`, `FAIL`, `AssertionError`, `exit code`, and read about 40 lines above the first hit. The first failure is the cause; later failures are usually fallout.
- A job still running returns a partial log. Wait and re-check rather than diagnosing a partial run.
- Record: check name, job URL, the failing step, and a short verbatim log excerpt.

## 4. Decide whether it is new

Compare against the base branch: `list_check_runs` on `main` (or the PR base). If the same check fails on base with the same error, the failure is pre-existing. Say so, and do not fix unrelated breakage inside this PR unless the user asks.

## 5. Reproduce locally, then fix

- Run the same command the workflow step ran (read `.github/workflows/*.yml` for the exact script) inside the PR's checkout or worktree. If it passes locally, look for environment differences in the log: OS (Linux vs Windows paths and line endings), Node version, missing env, case-sensitive imports.
- Follow `root-cause-debugging` for anything non-obvious. Make the smallest fix for the demonstrated cause. Do not skip, delete, or loosen tests, add retries, or edit workflow triggers just to turn the check green without telling the user that tradeoff.
- Pushing to someone else's branch or a shared branch needs the user's go-ahead. Read-only diagnosis never does.

## 6. Verify

- Re-run the failing command locally and show the passing output.
- After pushing, `list_check_runs` on the new head sha until the check completes; report the final conclusion with its job URL. Rerun a flaky job with `api_request` `POST /repos/{owner}/{repo}/actions/jobs/<job_id>/rerun` only after the user agrees.

## Output

Repo and PR, each failing check with job URL and log excerpt, new vs pre-existing, root cause, files changed, local verification output, and the post-push check conclusion (or exactly what is still unverified).
