# Connector Recipe Library

Use this skill to pick the right implementation recipe for a new Prometheus integration.

## Current State

Status: usable as guidance; needs reusable templates/resources for 110%.

Current substrate:

- Existing `connector-builder` skill explains user plugin install.
- Extension manifest schema: `src/extensions/schema.ts`
- Runtime API: `src/extensions/runtime-api.ts`
- Runtime registry: `src/extensions/runtime-registry.ts`
- Install route: `POST /api/extensions/install`
- Reload route: `POST /api/extensions/reload`
- Credential access: `src/extensions/credential-access.ts`
- Legacy OAuth connectors: `src/integrations/connectors/*`

## Recipe Choices

- REST connector: extension runtime tool with `fetch`, vault credentials, pagination handling.
- GraphQL connector: typed queries/variables; never string-concatenate user input into query text.
- OAuth connector: declare setup scopes and use Connections/vault.
- API-key connector: setup fields with `secret: true`; retrieve with `ctx.getCredential`.
- CLI adapter: use `cli-adapter-framework`, not raw shell.
- MCP preset: use `mcpPreset` manifest and `/api/mcp/servers`.
- Memory source: runtime `registerMemorySource`; verify search/read wiring before relying on it.
- Webhook receiver: not fully ready until extension routes are mounted.

## Acceptance Check

Every recipe must define status, auth, read, write/side-effect confirmation, pagination/rate limits, artifacts, and tests before being called production-ready.
