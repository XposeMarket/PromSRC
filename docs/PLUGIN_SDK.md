# Plugin SDK permissions and MCP process environment

An extension's `prometheus.extension.json` can declare top-level permissions:

```json
{
  "permissions": {
    "network": { "hosts": ["api.example.com"] },
    "filesystem": { "read": ["C:\\data\\reports"], "write": [] },
    "tools": ["connector_example_search"],
    "secrets": ["api_key"],
    "sideEffects": "read"
  }
}
```

## Semantics and enforcement

Unknown permission properties are rejected, including nested ones. Hosts are exact,
case-insensitive DNS names, not URLs, suffix matches, or glob patterns. `*` is only
accepted alongside `network.allowWildcardHosts: true`; avoid this broad grant.
Paths must be absolute, non-root paths without globs. Filesystem grants apply to a
path and its lexical descendants; callers must resolve symlinks before checking.
Tools and secret names are exact identifiers without wildcards. Omitted `tools`
allows the extension's own registered tools; an empty list denies all. Other omitted
resources deny access. Side-effect levels are ordered `none < read < write < external`
and default to `none` for a declared permission block.

`assertPluginPermission(manifest, request)` is the common exported checker.
`ExtensionRuntimeRegistry.executeTool` checks tool membership and scopes asynchronous
execution using AsyncLocalStorage; SDK `getCredential` checks secret names. The shared
connector `api_request` helper checks the resolved destination host and method's
side-effect level **before** retrieving a token or sending a request. Redirects remain
manual, so no redirect target receives credentials. Concurrent plugin calls do not
share permission contexts.

Filesystem and side-effect checks are available to SDK integrations; arbitrary
in-process JavaScript can still call Node APIs directly. This is **not** an OS sandbox
or a complete network/filesystem interception layer. Native connector first-class
methods remain governed by their existing tool and approval gates; the host policy
here specifically covers the shared raw API escape hatch. Approval gates still apply:
a manifest is not user consent for external writes.

Missing permissions preserve legacy behavior (allowed, with one warning per extension
per process). Existing advisory `network: string[]`, `filesystem: string[]`, `process`,
and `credentials` manifests are accepted and normalized; `process` is historical
metadata, not a grant to spawn. Empty modern permissions is restrictive, not legacy.
Slack and Notion provide bundled examples. Setup UI `setup.permissions` labels are
unrelated to runtime permission grants.

## MCP stdio environment policy

All local MCP stdio launches in `MCPManager.connectStdio` use `buildMcpServerEnv`.
The base environment is only PATH, PATHEXT, SystemRoot/SYSTEMROOT, ComSpec, TEMP, TMP,
HOME, USERPROFILE, APPDATA, LOCALAPPDATA, ProgramFiles, ProgramData, LANG, and TERM
(case-insensitive base names preserve Windows `Path`). NODE_OPTIONS and provider
API keys/tokens are not implicitly inherited. This policy also applies on macOS/Linux.
It isolates the child environment, not the child's OS user or filesystem permissions.

Per-server configuration supports:

```json
{
  "id": "example", "name": "Example", "enabled": true, "transport": "stdio",
  "command": "node", "args": ["server.js"],
  "env": { "SERVICE_TOKEN": "vault:service-token" },
  "envPassthrough": ["SERVICE_REGION"]
}
```

`envPassthrough` copies only explicitly named parent variables (exact names); missing
variables are omitted. Explicit `env` values override inherited values. Vault resolution
and the existing dangerous-config-variable sanitizer still run before launch. Therefore
configured PATH/NODE_OPTIONS etc. remain blocked as before. Explicit passthrough is a
user opt-in and can expose sensitive variables (including provider keys); review each
entry. Remove an entry to stop passing it on the next connection/restart. Existing
explicit server credentials remain supported. No new runtime dependency is required.
