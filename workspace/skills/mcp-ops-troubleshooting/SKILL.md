---
name: "mcp-ops-troubleshooting"
description: "Diagnose an existing MCP server, preset, connection, discovery, authentication, schema, transport, or tool-execution failure. Use for MCP operations and recovery; use mcp-server-builder to create/register a new MCP server and integration-setup for broader service setup."
---

# MCP operations troubleshooting

Locate the failing layer before changing configuration.

1. Inspect the durable `connection_ops` attempt and canonical connection record before lower-level MCP state.
2. Separate discovery, plan, OAuth/token exchange, MCP initialization, session negotiation, tool discovery, exposure policy, and tool execution.
3. For Streamable HTTP, inspect status, content type, `Mcp-Session-Id`, protocol version, and complete SSE event framing. Never parse a network chunk as a complete SSE event.
4. Use `mcp_server_manage` for targeted status/connect/list-tools diagnostics without replacing the durable setup flow.
5. Inspect one failing schema and run the smallest exposed read-only tool.
6. Change one layer at a time and repeat the identical probe.
7. Finish with `connection_ops(action:"verify", ...)`, non-empty approved tool exposure, and a real safe read.

Never print secrets or “fix” auth by broadening scopes blindly. An empty tool list is a state to explain, not proof that the runtime is broken.

Read [detailed-guide.md](references/detailed-guide.md) for transport-specific checks, logs, preset fields, schema issues, timeout recovery, and test matrices.
