# Wave 2 durability

External tool operations are journaled to `operations/ledger.jsonl` under the configured Prometheus configuration/state directory. Intent and completion are appended synchronously and fsynced before dispatch and before returning success respectively. Arguments are hashed using stable key order; bodies, addresses, resource IDs and other semantic values remain significant. Gateway-only force/approval and request/trace identifiers are excluded. Raw arguments and credentials are not stored; result summaries are capped at 2,000 characters.

The shared tool executor applies the ledger after wrapper normalization and policy/approval checks, before the dispatch continuation. Read-only tools and local/scheduling tools do not initialize or write the ledger. This covers Gmail sends, the specified GitHub mutations, non-read connector API requests, X posts/reposts/likes/DM sends, and Vercel deployment creation/deletion/API writes, including direct connector tool names.

An identical session/tool/argument operation committed in the preceding 24 hours is refused. Open intents are also refused, including simultaneous duplicate dispatches. At startup, intents predating process start are appended as uncertain, logged with their IDs, and exposed through `getUncertainOperations()`. Recovery reports their existence; it never automatically retries them. `force_reexecute:true` is a gateway-only explicit override, stripped before external dispatch; all normal approval checks still run. Overrides do not erase the historical uncertain operation.

A tool error or thrown exception may be a lost reply after a successful remote write. Accordingly, the executor leaves its intent open rather than automatically marking it failed/retryable. `failOperation` is reserved for an outcome independently established as definitively failed. Commit write failures also leave the durable intent open. A corrupt journal fails closed instead of discarding earlier intents.

Timer boot recovery resets timers left running before process start to `due_waiting`, matching the existing due queue; old one-shot timers are not silently lost. Background verification only completes for an affirmative response, rejecting leading/summary failure or blocked language and preferring structured status.

## Limits

This is a single-gateway-writer journal, not a distributed lock or upstream exactly-once guarantee. Independent processes sharing one config directory are not coordinated. Browser/desktop purchases, arbitrary MCP/plugin writes and external mutations outside the explicit classifier are not covered. Operators must externally reconcile uncertain outcomes. No retention/rotation policy is introduced for this append-only journal. A truncated/corrupt final record requires operator repair and blocks external dispatch in the meantime. Local tests use temporary files and mocked effects; no real email/post/deployment is performed.
