# MCP preset connectors (zero code)

When a service already ships an MCP server, you don't write any code — just a
manifest with `kind: "mcp_preset"`. Prometheus's MCP manager launches the server
and auto-injects its tools under the `mcp_server_tools` category.

## Manifest shape

```json
{
  "id": "mcp-airtable",
  "kind": "mcp_preset",
  "name": "Airtable (MCP)",
  "description": "Airtable via the official MCP server.",
  "category": "Database",
  "runtime": { "binding": "mcp" },
  "setup": {
    "authType": "api_key",
    "fields": [
      { "key": "apiKey", "label": "Airtable Token", "input": "password", "secret": true, "required": true }
    ]
  },
  "mcpPreset": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "airtable-mcp-server"],
    "envTemplate": { "AIRTABLE_API_KEY": "{{credential:airtable:apiKey}}" }
  }
}
```

- `transport` — `"stdio"` (npm/local process), `"sse"`, or `"http"`.
- `command` + `args` — how to launch a stdio server.
- `urlTemplate` + `headersTemplate` — for `sse`/`http` servers instead of command/args.
- `envTemplate` — env vars passed to the server; use `{{credential:<id>:<fieldKey>}}`
  placeholders so the user's saved secret is injected at launch, never hardcoded.

## Install

Same `POST /api/extensions/install` endpoint, but body is just
`{ "manifest": { ...the mcp_preset manifest... } }` — **no `indexJs`**.

After install, verify the MCP server appears (catalog `kind=mcp_preset`) and tell
the user to enter the credential in Connections. Once connected and the
`mcp_server_tools` category is active, the server's tools appear as
`mcp__<id>__<toolName>`.
