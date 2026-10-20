---
name: connector-github
description: "Use the connected GitHub account for pull requests, issues, commits, CI checks, files and code search via the connector_github wrapper. Use instead of the gh CLI, which is not installed."
---

# GitHub (connected account)

Call `connector_github({action, ...args})`. If it is not in your tool list, call `tool_search({query:"github <task>"})` and then `tool_call`, or `request_tool_category({category:"external_apps"})`.

| Task | action | Key args |
|---|---|---|
| List / read PRs | `list_prs`, `get_pr` | owner, repo, number |
| Open PR | `create_pr` | owner, repo, title, head, base, body, draft |
| Merge PR | `merge_pr` | owner, repo, number (asks for approval) |
| Close PR | `close_pr` | owner, repo, pr_number, comment? (e.g. "Superseded by #464") |
| Edit / reopen PR | `update_pr` | owner, repo, pr_number, state?, title?, body?, base?, comment? |
| Comment on PR/issue | `comment` | owner, repo, issue_number, body |
| Review a PR (asks for approval) | `create_review` | owner, repo, pr_number, body, event? (COMMENT default, REQUEST_CHANGES, APPROVE), comments? (max 50: path, line, body, side? RIGHT default, start_line?, start_side?), commit_id? |
| Read inline review comments | `list_review_comments` | owner, repo, pr_number, per_page? (default 30, max 100) |
| Close / edit issue | `update_issue` | owner, repo, issue_number, state?, state_reason?, title?, body?, labels?, assignees? |
| Anything else | `api_request` | path (/repos/...), method, body: reviews, labels, releases, workflows, branches |
| CI status | `list_check_runs` | owner, repo, ref (branch or sha) |
| Issues | `list_issues`, `create_issue` | owner, repo |
| Files / search | `get_file`, `search` | path + ref / query |
| History | `list_commits` | owner, repo, sha? |

Rules:
- Local git (worktree, branch, commit, push) stays in the terminal. Only the GitHub API goes through this connector.
- Reviews: prefer `create_review` over `api_request`. Example, a P1 finding as a COMMENT review: `connector_github({action:"create_review", owner:"XposeMarket", repo:"PromSRC", pr_number:123, event:"COMMENT", body:"One blocking issue inline.", comments:[{path:"src/foo.ts", line:42, body:"P1: this drops the auth check when the token is missing."}]})`. Use REQUEST_CHANGES or APPROVE only when asked. Each inline comment needs a real line in the PR diff; pass start_line for a range.
- Before `merge_pr`, check `get_pr` (mergeable state) and `list_check_runs` on the head sha. Never self-merge without explicit approval.
- Missing a first-class action? Use `api_request` with the GitHub REST path instead of telling the user it can't be done. GET is read-only; writes go through approval.
- A 401/403 means the token needs re-auth: run `connection_ops` (integration_admin), don't retry in a loop.
