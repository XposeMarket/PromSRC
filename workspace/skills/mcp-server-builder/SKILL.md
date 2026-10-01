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
3. For local scripts/services, prefer a small MCP server with typed tools over arbitrary shell. Prefer workflow-shaped tools over 1:1 endpoint wrappers when this reduces calls without obscuring safety boundaries. Use consistent service-prefixed `verb_noun` names, bounded typed arguments, pagination for listings, and concise/default versus detailed/opt-in response modes. Return actionable errors stating what the caller can fix or try next. Annotate every tool's `readOnly`, `destructive`, and `idempotent` behavior accurately; never mislabel a write as a read.
4. Register the preset, then use `connection_ops` for discovery, planning, user auth, connection, and verification.
5. Reserve `mcp_server_manage` for advanced lifecycle/debug work.
6. Verify initialization, complete Streamable HTTP/SSE framing, tool discovery, approved exposure, and one safe read. Write 5 to 10 realistic read-only evaluation questions with independently verifiable answers; run them through the registered server and compare returned results with source-of-truth data before calling it ready. Test pagination and concise/detailed response modes with representative cases.

## Guardrails

- Do not pass secrets in command args; use env templates or vault-backed setup.
- Do not expose broad filesystem or shell tools without explicit approval boundaries.
- Prefer stdio for local trusted servers and HTTP/SSE only when transport/security is understood.
- Every native Prometheus connector also exposes an approval-gated `<connector>_api_request` escape hatch. Do not duplicate it as an unrestricted arbitrary-request tool or bypass that approval boundary.
