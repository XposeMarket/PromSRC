---
name: "linear-connector"
description: "Connect or operate Linear teams, projects, issues, cycles, and comments when Linear is explicitly requested. Use integration-setup for generic connection setup and connector-builder if implementation is missing; not for arbitrary task tracking."
---

# Linear connector

Linear is not a bundled connector, but it is in Prometheus's hosted MCP catalog (`https://mcp.linear.app/mcp`, OAuth with dynamic client registration; see `src/gateway/hosted-mcp-catalog.ts`). Once connected, its tools appear as MCP tools. Do not invoke imaginary `linear_*` tools.

1. Check `connector_list`, then `tool_search({query:"Linear list teams projects search issues"})`; inspect any real schema with `tool_describe` and use `tool_call` with exact accepted arguments. Verify organization, team, project and issue identifiers before action.
2. If absent, connect the hosted Linear MCP server through `integration-setup` (Plugins / Connections, Linear entry; the user completes the OAuth screen). Only if that route fails, follow `connector-builder` for an approved GraphQL user plugin. Keep API tokens in Connections/vault, never in skill files, and only request necessary scopes.
3. Use GraphQL variables rather than interpolated user text. Respect pagination and preserve issue IDs, human-readable keys, status IDs, cycle IDs and URLs. Read team-specific status/label schemas before updates.
4. Creating/updating issues, assigning people and posting comments require the applicable side-effect approval. For retries, check the issue state first to avoid duplicates. Read back the issue/comment to confirm the actual result.

If no supported integration exists, report that constraint and offer a proposed issue draft rather than claiming a Linear change.
