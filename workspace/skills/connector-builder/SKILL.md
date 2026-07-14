---
name: "connector-builder"
description: "Use this skill when building, editing, or designing a Prometheus connector/plugin for an external app or service, including tool contracts, auth, polling, webhooks, data mapping, tests, and integration UX."
---

# Connector & Plugin Builder

Build a new connector, MCP server, or tool plugin for Prometheus **on demand**, when
the user asks to integrate a service Prometheus doesn't already support — e.g.
"connect to Airtable", "add my company's REST API", "hook up Shopify",
"make a plugin for X".

You write the plugin into the user's writable data dir and hot-reload it. **No
source-code access and no restart required.** This works in the public Electron
build because user plugins live in `<DATA_DIR>/plugins/`, never in `src/`.

## Decide the path first

| Situation | Path | What you write |
|-----------|------|----------------|
| Service has a published MCP server (npm/docker) | **MCP preset** | one manifest, no code |
| Service has a plain REST/HTTP API + a key/token | **REST connector** | manifest + `index.js` |
| User pasted a plugin URL/repo | **Install from URL** | fetch, validate, install |

Always prefer an MCP preset when an official MCP server exists. The preset must
contribute to the universal `connection_ops` lifecycle; registration alone is not setup.
Fall back to a REST connector otherwise.

## Workflow (REST connector)

1. **Research the API.** Use `web_search({ fetch_top_k })` for compact discovery and `web_fetch_batch` for selected docs pages to find: base URL, auth
   scheme (API key header? bearer token?), and the 4–8 most useful endpoints
   (list/get/search/create). Note the exact header name and any prefix.
2. **Pick an id.** Lowercase, `[a-z0-9_-]`, 1–64 chars, e.g. `airtable`. It must
   not collide with a built-in connector.
3. **Write the manifest** (`manifest` object) — see `references/manifest-schema.md`.
   Declare `setup.fields` for every credential the user must enter, and list every
   tool name in both `ownership.tools` and `contracts.tools`.
4. **Write `index.js`** — a CommonJS module exporting `{ id, register(api) }` that
   calls `api.registerTool(...)` once per endpoint. See
   `references/index-js-pattern.md`. **Never hardcode secrets** — read them with
   `ctx.getCredential('<fieldKey>')`.
5. **Install** via the install endpoint (below). It validates, writes the files,
   and hot-reloads. A non-2xx response means the manifest failed validation — read
   the error and fix it.
6. **Verify.** Call `connector_list` and confirm the new connector appears. Then
   tell the user: *"<Name> is ready — open the Connections panel and enter your
   <credential> to activate it."* The tools only go live to the model after the
   user saves credentials AND the `external_apps` category is active.

## Installing (HTTP API)

All endpoints are on the local gateway. Use `terminal`/`run_command` with `curl`,
or any HTTP tool. Auth uses the gateway token already in this session.

```
POST /api/extensions/install
  body: { "manifest": { ...manifest object... }, "indexJs": "<index.js source>" }
  → { success, id, dir, reload: { connectors, tools } }

POST /api/extensions/reload          # re-scan data dir after manual edits
POST /api/extensions/remove          # body: { "id": "airtable" }
GET  /api/extensions/user            # list installed user plugins
GET  /api/extensions/catalog?kind=connector   # full catalog (incl. built-ins)
```

For an **MCP preset**, install the same way but the manifest has `kind: "mcp_preset"`,
an `mcpPreset` block, and a `connection` contribution, with **no `indexJs`**. See
`references/mcp-preset.md`.

## Rules

- **Secrets never touch the manifest or index.js.** They come from the Connections
  panel and are read at runtime via `ctx.getCredential`.
- One connector = one folder = one id. Keep tool names prefixed with the id
  (`airtable_list_bases`) so they're easy to attribute.
- Keep each tool's `description` one line, starting with `[ServiceName]`.
- After install, use `connection_ops` to plan/connect/verify and run a safe real
  tool. Neither install nor OAuth completion proves readiness.
- If the user just wants to remove something they added, use the remove endpoint —
  built-in connectors cannot be removed and will error, which is expected.

## Reference files

- `references/manifest-schema.md` — every manifest field, with a full example
- `references/index-js-pattern.md` — the runtime module contract + worked example
- `references/mcp-preset.md` — zero-code MCP server connectors
