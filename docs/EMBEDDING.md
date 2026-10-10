# Embedding the Prometheus agent runtime

`prometheus/embed` runs the real Prometheus agent loop inside your own Node
process. You get context assembly, the tool surface and categories, dispatch
policy, approvals, tool execution, loop control and compaction, with no HTTP
gateway, Electron app or UI.

```js
const { createPrometheusRuntime } = require('prometheus/embed');

const rt = await createPrometheusRuntime({
  dataDir: '/var/lib/my-agent',     // config, sessions, runtime state
  provider: myLLMProvider,          // optional; omit to use dataDir's configured provider
  approve: async (a) => a.toolName === 'lookup_order', // gated calls; default denies
});

rt.registerTool({
  name: 'lookup_order',
  description: 'Look up an order by id.',
  parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  readOnly: true,
  execute: async ({ id }) => `order ${id}: shipped`,
});

const run = await rt.runTurn('Where is order 42?', {
  onEvent: (e) => console.log(e.type),   // token, tool_call, tool_result, …
  signal: abortController.signal,       // cancel
  allowedTools: ['lookup_order'],       // optional hard allowlist
});
console.log(run.text, run.toolResults);
await rt.close();
```

A complete, runnable consumer lives in `examples/embed-consumer/`. CI runs it
as a separate project on every pull request (`npm run test:embed`): it links
this repo as its `prometheus` dependency and uses only the public export.

## API

| Call | Purpose |
|---|---|
| `createPrometheusRuntime(options)` | Boot the runtime. `dataDir`, `workspaceDir`, `provider`, `approve`, `verbose`. |
| `runtime.registerTool(tool)` | Add a tool. Declare `readOnly` / `localWrite` / `externalWrite` / `destructive`; undeclared tools fail closed to approval. |
| `runtime.unregisterTool(name)` | Remove it. |
| `runtime.runTurn(message, options)` | One agent turn. `sessionId` continues a conversation; `onEvent`, `signal`, `allowedTools`, `categories`, `timeoutMs`. Returns `{ text, toolResults, aborted, timedOut, elapsedMs, sessionId }`. |
| `runtime.close()` | Unregister tools, flush state, release the provider override. |

`provider` is any object implementing `LLMProvider`
(`src/providers/LLMProvider.ts`): `chat(messages, model, options)`,
`generate`, `listModels`, `testConnection`, `id`. The built-in Anthropic,
OpenAI/Codex, xAI, Gemini and local adapters all implement it.

## Guarantees and limits

- **Same policy as the app.** Embedded tools go through the offered-surface
  check, allowlists and approvals described in `SECURITY.md`. `approve` is the
  only way a gated call runs; the default denies.
- **One runtime per process.** Configuration and state are process-wide. Call
  `close()` before creating another.
- **In-process tools are trusted code.** `execute` runs in your process.
- `EMBED_API_VERSION` is `1`. Breaking changes bump it.
