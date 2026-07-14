---
name: "linear-connector"
description: "Build or operate a vault-backed Linear GraphQL connector for teams, projects, issues, cycles, comments, statuses, and explicit task synchronization. Use when a request specifically concerns Linear integration or Linear issue operations; do not invoke for generic task planning."
---

# Linear Connector

Use this skill when Prometheus needs Linear-backed product, engineering, bug, or roadmap workflows.

## Prometheus Fit

Linear should be a GraphQL connector with typed issue/project/cycle tools. It should also map cleanly into Prometheus tasks and background jobs so local planning and Linear state do not drift.

## Tool Scope

Start with:

- `linear_list_teams`
- `linear_list_projects`
- `linear_search_issues`
- `linear_get_issue`
- `linear_create_issue`
- `linear_update_issue`
- `linear_add_comment`
- `linear_list_cycles`
- `linear_sync_task`

## Rules

- Use Linear GraphQL and typed variables. Avoid ad hoc query string construction.
- Store API keys/OAuth tokens only through Connections/vault.
- Return Linear identifiers, URLs, team/project/cycle names, assignees, priority, labels, and status.
- Creating, assigning, closing, deleting, or bulk-updating issues requires explicit confirmation.
- Keep Prometheus task links in issue comments or metadata only when the user asks for sync.
- Paginate searches and make cursors explicit.

## Implementation Route

1. Inspect Prometheus task/team structures before deciding sync shape.
2. Build a connector with read tools first.
3. Add mutation tools with confirmation and dry-run previews.
4. Add a task sync helper that creates cross-links instead of silently replacing either system.
5. Add mocked GraphQL tests for search, issue create, and issue update.

## Acceptance Check

Prometheus can turn chat plans into Linear issues and read Linear context back into planning without losing ownership of local task state.
