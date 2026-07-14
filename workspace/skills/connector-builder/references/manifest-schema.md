# Manifest schema (`prometheus.extension.json`)

The manifest is validated by `src/extensions/schema.ts`. Invalid manifests are
rejected by the install endpoint with a precise error. Fields:

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | lowercase `[a-z0-9_-]`, 1–64 chars, unique |
| `kind` | yes | `"connector"` \| `"mcp_preset"` \| `"provider"` |
| `name` | yes | display name shown on the Connections card |
| `description` | yes | one sentence |
| `category` | no | e.g. `"CRM"`, `"Finance"`, `"Email"` — groups the card |
| `runtime.binding` | yes | freeform id, e.g. `"user/airtable"` |
| `runtime.entrypoint` | for code connectors | relative path to the module, use `"./index.js"` |
| `ui.color` | no | hex, used for the card monogram |
| `ui.permissions` | no | `[{ icon, label }]` shown in the detail view |
| `ownership.tools` | yes (connector) | list every tool name your `index.js` registers |
| `ownership.capabilities` | no | e.g. `["crm"]` |
| `contracts.tools` | yes (connector) | same list as `ownership.tools` |
| `setup.authType` | yes | `"api_key"` \| `"oauth"` \| `"browser_session"` \| `"none"` |
| `setup.fields` | for api_key | credential inputs the user fills in |
| `setup.docsUrl` / `setup.docsHint` | no | help the user find their key |
| `connection.aliases` | MCP/connection plugins | natural service names resolved by `connection_ops` |
| `connection.domains` | no | official provider hosts used for high-confidence identity matching |
| `connection.strategies` | MCP/connection plugins | adapter, auth, capabilities, verification, and adapter config |
| `connection.toolPolicy` | recommended | default exposure and unknown-tool behavior |

## `setup.fields` entry

```json
{ "key": "apiKey", "label": "API Key", "input": "password", "secret": true, "required": true, "placeholder": "key_...", "help": "Find this in Account → API." }
```

`input` is one of `text | password | select | textarea | checkbox`. The `key` is
what you pass to `ctx.getCredential(key)` in `index.js`.

## Full REST connector example

```json
{
  "id": "airtable",
  "kind": "connector",
  "name": "Airtable",
  "description": "Read and write Airtable bases, tables, and records.",
  "category": "Database",
  "runtime": { "binding": "user/airtable", "entrypoint": "./index.js" },
  "ui": {
    "color": "#FCB400",
    "permissions": [
      { "icon": "@", "label": "List bases and tables" },
      { "icon": "?", "label": "Query and search records" },
      { "icon": "->", "label": "Create and update records" }
    ]
  },
  "ownership": {
    "capabilities": ["database"],
    "tools": ["airtable_list_bases", "airtable_list_records", "airtable_create_record"]
  },
  "contracts": {
    "tools": ["airtable_list_bases", "airtable_list_records", "airtable_create_record"]
  },
  "setup": {
    "authType": "api_key",
    "docsUrl": "https://airtable.com/create/tokens",
    "docsHint": "Create a personal access token with data.records:read/write scopes.",
    "fields": [
      { "key": "apiKey", "label": "Personal Access Token", "input": "password", "secret": true, "required": true, "placeholder": "pat..." }
    ]
  }
}
```
