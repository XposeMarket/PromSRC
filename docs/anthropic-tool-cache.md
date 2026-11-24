# Anthropic tool-prefix caching

Anthropic caches `tools -> system -> messages`. Changing even one tool invalidates all downstream cache segments; appending tools is not a cache-preserving operation. See https://platform.claude.com/docs/en/build-with-claude/prompt-caching.

The Anthropic adapter canonicalizes schema object keys and orders wire tools by name. It does not strip arbitrary description text: that could erase real capability or security changes. The tool builder's static descriptions contain no generated clock/elapsed fields, and its dynamic definitions already sort by name; dynamic registry content changes are legitimate invalidations.

Category retention is provider-neutral (`src/gateway/tool-category-retention.ts`). A category whose tools are being called stays loaded between turns. Once it has gone two user turns without a call it is unloaded, but only at a cold start (more than five minutes since the last model activity), because removing a tool while the cache is warm re-writes the whole conversation. A category that was requested and never called is unloaded at the next cold start. At most eight categories are kept, most recently used first. New main chats start with `workspace_write` loaded and lose it the same way if they never use it. Explicit deactivation, rollback, category reset and the config opt-out clear retained state. New categories still incur one cache rewrite. `external_apps`, `mcp_server_tools` and the Prometheus source categories are never kept implicitly: connector registries can grow without bound and account/disconnection state must remain authoritative, and source access follows its approval. Tools are always rebuilt against current config, distribution policy, and connection state; old schemas are never replayed.

Opt out in config alongside the existing volatile-context option:

```json
{"llm":{"providers":{"anthropic":{"sticky_tool_categories":false,"volatile_context_in_system":false}}}}
```

Default retention is enabled. The opt-out above applies to Anthropic sessions and restores plain scope expiry there. The limit bounds added category packs (and hence the finite bundled static schema catalog), not arbitrary MCP tools. Ordinary active tools remain subject to existing provider/context budgets. All desktop, web, mobile and channel chats, agents and teams share this session implementation. Native deferred loading is real, but this adapter uses direct HTTP, not an Anthropic SDK; integrating server-side tool search requires separate result/dispatch support and is deliberately not silently introduced here.

Verification: `npm run test:tool-category-retention`, `npm run test:anthropic-continuation`, `npm run test:prompt-cache`, and `npx tsc --noEmit -p tsconfig.json`.
