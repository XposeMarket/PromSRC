---
name: "connector-smoke-test-harness"
description: "Verify an existing Prometheus connector with status, authentication, read, pagination, rate-limit, error-shape, and dry-run write checks. Use when testing connector readiness or diagnosing an installed integration. Only use after a connector exists; exclude implementation and setup work."
---

# Connector Smoke-Test Harness

Use this skill when validating a connector before Prometheus relies on it.

## Current State

Manual smoke testing is available; do not assume a generic `connector_smoke_test` tool exists.

Current support:

- `connector_list` is core.
- Extension tools are listed by `getExtensionRuntimeRegistry().listToolDefinitions()`.
- Connector execution routes through `getExtensionRuntimeRegistry().executeTool(...)`.
- Connections/OAuth routes live in `src/gateway/routes/connections.router.ts`.
- Extension install/reload routes live in `src/gateway/routes/extensions.router.ts`.
- Tool observations record connector tool calls under category `connector`.

## Procedure

1. Run `connection_ops(action:"list_connections")` and inspect the canonical record.
2. If setup is incomplete, resume its durable attempt; do not start a parallel auth/config flow.
3. Require authenticated, registered, verified, and exposed states—not merely OAuth success.
4. Confirm discovered tools and conservative exposure classification.
5. Run a read-only status/self/profile call, then a small list/search call with pagination.
6. For write tools, run dry-run/preview first. If no dry-run exists, treat that as a connector gap.
7. Confirm:
   - auth status
   - least-privilege scopes
   - rate-limit behavior
   - pagination/cursor behavior
   - structured errors
   - artifact/output shape

## Gap To Implement

A generic `connector_smoke_test` tool is not currently exposed. To propose one, use the source PR workflow separately. For current tasks, report the manual check evidence without claiming an automated harness ran.
