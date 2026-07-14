---
name: "mcp-server-builder"
description: "Build or register a local or remote MCP server with typed tools and a Prometheus MCP preset. Use when creating an MCP server, wrapping a local service as MCP, or defining its transport and security boundary; do not use merely to connect an already-defined integration."
---

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
2. For existing MCP servers, create a plugin-owned MCP preset manifest with connection aliases/domains, strategies, auth, verification, and conservative tool policy.
3. For local scripts/services, prefer a small MCP server with typed tools over arbitrary shell.
4. Register the preset, then use `connection_ops` for discovery, planning, user auth, connection, and verification.
5. Reserve `mcp_server_manage` for advanced lifecycle/debug work.
6. Verify initialization, complete Streamable HTTP/SSE framing, tool discovery, approved exposure, and one safe read.

## Guardrails

- Do not pass secrets in command args; use env templates or vault-backed setup.
- Do not expose broad filesystem or shell tools without explicit approval boundaries.
- Prefer stdio for local trusted servers and HTTP/SSE only when transport/security is understood.
