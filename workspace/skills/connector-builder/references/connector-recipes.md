# Connector implementation recipes

Select the matching operation; this reference is part of `connector-builder`.

Use this reference to choose a connector implementation recipe. Verify the target runtime feature exists before committing to it.

## Runtime substrate
Current substrate:

- `connector-builder` describes user plugin install, discovery, and connection verification.
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
- Webhook receiver: confirm the installed extension actually mounts the route; if it does not, use the separate `prometheus-triggers-webhooks` workflow instead.

## Acceptance Check

Every recipe must define status, auth, read, write/side-effect confirmation, pagination/rate limits, artifacts, and tests before being called production-ready.
