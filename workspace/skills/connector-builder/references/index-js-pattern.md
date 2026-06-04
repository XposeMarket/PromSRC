# `index.js` runtime module contract

A code connector's `index.js` is a **CommonJS** module that exports an object with
`id` and `register(api)`. `register` is called once at load time; inside it you
call `api.registerTool(...)` for each tool.

## The contract

```js
module.exports = {
  id: 'airtable', // must match the manifest id
  register(api) {
    api.registerTool({
      name: 'airtable_list_bases',        // must be listed in manifest ownership.tools
      description: '[Airtable] List all accessible bases.',
      parameters: { type: 'object', properties: {}, required: [] }, // JSON Schema
      connectorId: 'airtable',            // ties the tool to the connector's connected state
      execute: async (args, ctx) => {
        // ...do work, return { result, error }...
      },
    });
  },
};
```

### `api.registerTool(tool)` fields

- `name` — unique tool name (prefix with the connector id).
- `description` — one line, starts with `[ServiceName]`.
- `parameters` — JSON Schema object describing the args the model passes.
- `connectorId` — set to the connector id so the tool only appears once the user
  has connected (saved credentials). Omit only for tools with no auth.
- `execute(args, ctx)` — async. Return `{ result: string, error: boolean }`.
  `result` is what the model sees. On failure return `{ result: 'message', error: true }`.

### `ctx` (the execution context)

- `ctx.getCredential(fieldKey, connectorId?)` — returns the saved credential string
  (whatever the user typed in the Connections panel for that `setup.fields` key),
  or `undefined`. `connectorId` defaults to this tool's connector. **This is the
  only correct way to access secrets.**
- `ctx.extensionId`, `ctx.trustLevel` — informational.

## Worked example (full file)

```js
const BASE = 'https://api.airtable.com/v0';

async function authedFetch(ctx, urlPath, init = {}) {
  const token = ctx.getCredential('apiKey');
  if (!token) return { error: 'Airtable not connected. Enter your token in Connections.' };
  const res = await fetch(BASE + urlPath, {
    ...init,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) return { error: `Airtable ${res.status}: ${text.slice(0, 300)}` };
  try { return { data: JSON.parse(text) }; } catch { return { data: text }; }
}

module.exports = {
  id: 'airtable',
  register(api) {
    api.registerTool({
      name: 'airtable_list_bases',
      description: '[Airtable] List all accessible bases.',
      parameters: { type: 'object', properties: {}, required: [] },
      connectorId: 'airtable',
      execute: async (_args, ctx) => {
        const r = await authedFetch(ctx, '/meta/bases');
        if (r.error) return { result: r.error, error: true };
        return { result: JSON.stringify(r.data), error: false };
      },
    });

    api.registerTool({
      name: 'airtable_list_records',
      description: '[Airtable] List records in a table.',
      parameters: {
        type: 'object',
        required: ['baseId', 'table'],
        properties: {
          baseId: { type: 'string', description: 'Base id (appXXXXXXXX).' },
          table: { type: 'string', description: 'Table name or id.' },
          maxRecords: { type: 'number', description: 'Max records (default 50).' },
        },
      },
      connectorId: 'airtable',
      execute: async (args, ctx) => {
        const max = args.maxRecords ? `?maxRecords=${args.maxRecords}` : '';
        const r = await authedFetch(ctx, `/${args.baseId}/${encodeURIComponent(args.table)}${max}`);
        if (r.error) return { result: r.error, error: true };
        return { result: JSON.stringify(r.data), error: false };
      },
    });

    api.registerTool({
      name: 'airtable_create_record',
      description: '[Airtable] Create a record in a table.',
      parameters: {
        type: 'object',
        required: ['baseId', 'table', 'fields'],
        properties: {
          baseId: { type: 'string' },
          table: { type: 'string' },
          fields: { type: 'object', description: 'Field name → value map.' },
        },
      },
      connectorId: 'airtable',
      execute: async (args, ctx) => {
        const r = await authedFetch(ctx, `/${args.baseId}/${encodeURIComponent(args.table)}`, {
          method: 'POST',
          body: JSON.stringify({ fields: args.fields }),
        });
        if (r.error) return { result: r.error, error: true };
        return { result: JSON.stringify(r.data), error: false };
      },
    });
  },
};
```

## Sending it to the install endpoint

`index.js` must be a JSON string in the `indexJs` field. When building the request
body, JSON-encode the whole file content as one string. The endpoint writes it to
`<DATA_DIR>/plugins/<id>/index.js` and hot-reloads.
