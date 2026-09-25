---
name: "GitHub connector"
description: "Use the connected GitHub account for pull requests, issues, commits, CI checks, files and code search via the connector_github wrapper. Use instead of the gh CLI, which is not installed."
triggers: ["github pr", "pull request", "open a pr", "merge the pr", "github issue", "ci checks", "check runs"]
requiredTools: ["connector_github"]
---

# GitHub connector

Call `connector_github({action, ...args})`. If it is not in your tool list, call `tool_search({query:"github <task>"})` and then `tool_call`, or `request_tool_category({category:"external_apps"})`.

| Task | action | Key args |
|---|---|---|
| List / read PRs | `list_prs`, `get_pr` | owner, repo, number |
| Open PR | `create_pr` | owner, repo, title, head, base, body, draft |
| Merge PR | `merge_pr` | owner, repo, number (asks for approval) |
| CI status | `list_check_runs` | owner, repo, ref (branch or sha) |
| Issues | `list_issues`, `create_issue` | owner, repo |
| Files / search | `get_file`, `search` | path + ref / query |
| History | `list_commits` | owner, repo, sha? |

Rules:
- Local git (worktree, branch, commit, push) stays in the terminal. Only the GitHub API goes through this connector.
- Before `merge_pr`, check `get_pr` (mergeable state) and `list_check_runs` on the head sha. Never self-merge without explicit approval.
- A 401/403 means the token needs re-auth: run `connection_ops` (integration_admin), don't retry in a loop.
