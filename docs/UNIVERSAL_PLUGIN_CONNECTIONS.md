# Universal plugin-backed connections

Prometheus uses the general extension system as the only packaging and runtime boundary for connectors, MCP servers, model providers, APIs, CLIs, and local resources. The connection orchestrator is a host-owned lifecycle service; it is not a second plugin framework.

## Ownership

- Plugin manifests declare strategies, capabilities, permissions, setup metadata, and verification hints.
- Plugin runtimes may register connection adapters, verifiers, and tool classifiers.
- The host owns durable attempts, cards, secure input, the vault, OAuth callbacks, auditing, tool exposure, health, repair, and cancellation.
- Secrets move from privileged UI endpoints directly to the vault. They never become chat text.

## Lifecycle

`requested -> discovering -> planning -> awaiting user action -> installing/registering -> verifying -> connected`

Attempts can also become `degraded`, `reauth_required`, `failed`, or `cancelled`. Canonical connection records separately track installed, enabled, configured, authenticated, registered, exposed, and verified state.

## Model interface

Use `connection_ops` for new setup flows. Lower-level `mcp_server_manage`, connector tools, and legacy connection routes remain compatibility/control-plane surfaces during migration.

## Extension contributions

Manifests may declare `connection.schemaVersion`, ordered `strategies`, requested capabilities, verification checks, and default tool policy. Runtime definitions may register adapters, verifiers, and classifiers through the extension API.

## Compatibility migration

Existing connector state is projected once into `connections-v2.json`. Existing provider-specific routes remain operational while connectors are moved to native plugin strategies. New integrations must not be added to the legacy connector registry.

## Tool policy

MCP tools are classified conservatively. Verified read-only tools may be exposed automatically when read-only setup was requested. Write, financial, destructive, credential/security, and unknown tools remain blocked until explicitly reviewed.

## Reference flow

The bundled Robinhood MCP preset exercises the generic MCP OAuth path. It creates a durable attempt, shows an OAuth card, completes authorization on Robinhood's site, discovers tools, exposes only conservative read-only matches, verifies the connection, and supports reauthorization and disconnect.
