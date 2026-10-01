---
name: gh-address-comments
description: Address actionable GitHub pull request review feedback. Use when the user wants to inspect unresolved review threads, requested changes, or inline review comments on a PR, then implement selected fixes. Use the GitHub connector for review comments and GraphQL thread state; judge feedback with receiving-code-review.
---

# GitHub PR Comment Handler

Use this skill to work through requested changes on a GitHub pull request. The directory id remains `github-gh-address-comments`; its existing frontmatter name remains `gh-address-comments`. GitHub API access uses `connector_github_api_request`, not a CLI or the bundled legacy script.

## Workflow

1. Resolve the repository owner, name, and PR number from the URL or user context. For a current-branch PR, inspect local git branch/remotes and use available `connector_github_*` PR lookup tools; if ambiguous, ask for the PR URL or number through `ask_prometheus_questions`.
2. Fetch PR metadata and diff with available GitHub connector tools. Fetch review comments with `connector_github_api_request`: REST `GET /repos/{owner}/{repo}/pulls/{n}/comments` and reviews with REST `GET /repos/{owner}/{repo}/pulls/{n}/reviews`. Paginate both endpoints so older comments and reviews are not missed. The REST comments contain inline positions and reply relationships; reviews contain overall review state and body.
3. Fetch thread resolution state with `connector_github_api_request`: `POST /graphql` and query `repository(owner:$owner, name:$repo) { pullRequest(number:$number) { reviewThreads(first:100, after:$cursor) { nodes { id isResolved isOutdated path line comments(first:100) { nodes { id databaseId body author { login } path line createdAt } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } } }`. Supply owner, repo, number, and cursor as GraphQL variables. Paginate reviewThreads, and paginate comments on any thread with more than 100; use GraphQL node ids and REST database ids to reconcile records. Treat unavailable or incomplete GraphQL data as unknown resolution state, never as all threads resolved.
4. Cluster feedback by thread and file/behavior area. Distinguish unresolved actionable requests, resolved or outdated threads, duplicates, informational remarks, and overall reviews. Follow `receiving-code-review` to verify each suggestion against code and requirements before agreeing; explain evidence-based pushback when a suggestion would cause a regression or needless scope. Do not treat every reviewer comment as a command.
5. Present numbered actionable threads and a one-line intended change for each. If the user asked to fix everything, interpret that as all unresolved actionable threads and call out ambiguity. Otherwise confirm selected scope through `ask_prometheus_questions` before editing. If comments conflict, show the tradeoff rather than guessing.
6. Implement selected fixes locally with each change traceable to its thread. For explanation-only comments, draft a response instead of forcing a code change. Run focused checks and inspect the diff; report addressed, intentionally open, and blocked threads, with check output.

## Write safety and failure handling

- Do not post replies, resolve threads, or submit reviews on GitHub unless the user explicitly authorizes that remote write. Use connector tools for authorized API writes, subject to the normal approval gates.
- A flat REST comment list does not prove thread resolution. If GraphQL access is denied or rate-limited, report the exact limitation and continue with labelled unknown thread state; do not infer it from the absence of comments.
- If PR scope or access is missing, report which owner/repo/PR identifier or connector authorization is needed. Never request CLI login or use the old `scripts/fetch_comments.py` path.
