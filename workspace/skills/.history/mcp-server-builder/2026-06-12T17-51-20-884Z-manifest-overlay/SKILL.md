# MCP Server Builder

Use this skill when Prometheus should add tools through MCP.

## Current State

Status: mostly usable for registration; building the server itself depends on the target.

Current support:

- MCP manager: `src/gateway/mcp-manager.ts`
- API routes: `/api/mcp/servers`, `/api/mcp/tools`
- Dynamic tool names: `mcp__<serverId>__<toolName>`
- Extension schema supports `kind: "mcp_preset"` and `mcpPreset`.
- Runtime registry supports `registerMcpPreset(...)`.

## Procedure

1. Decide whether this is better as MCP or a native connector.
2. For existing MCP servers, create an MCP preset manifest.
3. For local scripts/services, prefer a small MCP server with typed tools over arbitrary shell.
4. Register through `/api/mcp/servers` or extension MCP preset.
5. Connect, list tools, then activate `mcp_server_tools`.
6. Smoke-test one read-only tool before any side effect.

## Guardrails

- Do not pass secrets in command args; use env templates or vault-backed setup.
- Do not expose broad filesystem or shell tools without explicit approval boundaries.
- Prefer stdio for local trusted servers and HTTP/SSE only when transport/security is understood.
