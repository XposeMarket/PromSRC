# Connector Smoke-Test Harness

Use this skill when validating a connector before Prometheus relies on it.

## Current State

Status: mostly usable manually; needs a dedicated generic smoke-test tool for 110%.

Current support:

- `connector_list` is core.
- Extension tools are listed by `getExtensionRuntimeRegistry().listToolDefinitions()`.
- Connector execution routes through `getExtensionRuntimeRegistry().executeTool(...)`.
- Connections/OAuth routes live in `src/gateway/routes/connections.router.ts`.
- Extension install/reload routes live in `src/gateway/routes/extensions.router.ts`.
- Tool observations record connector tool calls under category `connector`.

## Procedure

1. Run `connector_list` and confirm the connector is visible.
2. If disconnected, guide setup through the Connections panel or `/api/connections/*`.
3. Request `external_apps` only after confirming credentials/status.
4. Run a read-only status or self/profile call.
5. Run a small list/search call with pagination.
6. For write tools, run dry-run/preview first. If no dry-run exists, treat that as a connector gap.
7. Confirm:
   - auth status
   - least-privilege scopes
   - rate-limit behavior
   - pagination/cursor behavior
   - structured errors
   - artifact/output shape

## Gap To Implement

Add a generic `connector_smoke_test` tool that discovers a connector's declared status/read/dry-run tools and writes a standard report artifact.
