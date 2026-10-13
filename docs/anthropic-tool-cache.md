# Anthropic tool-prefix caching

Anthropic caches `tools -> system -> messages`. Changing even one tool invalidates all downstream cache segments; appending tools is not a cache-preserving operation. See https://platform.claude.com/docs/en/build-with-claude/prompt-caching.

The Anthropic adapter canonicalizes schema object keys and orders wire tools by name. It does not strip arbitrary description text: that could erase real capability or security changes. The tool builder's static descriptions contain no generated clock/elapsed fields, and its dynamic definitions already sort by name; dynamic registry content changes are legitimate invalidations.

For Anthropic main-chat sessions, the first eight activated static categories are retained in session storage. Explicit deactivation, rollback, category reset, switching providers, and the config opt-out clear retained state. New categories still incur one cache rewrite. Categories beyond the bound keep their existing scopes. `external_apps` and `mcp_server_tools` are excluded because their registries can grow without bound and account/disconnection state must remain authoritative. Tools are always rebuilt against current config, distribution policy, and connection state; old schemas are never replayed.

Opt out in config alongside the existing volatile-context option:

```json
{"llm":{"providers":{"anthropic":{"sticky_tool_categories":false,"volatile_context_in_system":false}}}}
```

Default retention is enabled. The limit bounds added category packs (and hence the finite bundled static schema catalog), not arbitrary MCP tools. Ordinary active tools remain subject to existing provider/context budgets. All desktop, web, mobile and channel main-chat surfaces share this session implementation. Other providers and standalone agent execution retain existing scope semantics. Native deferred loading is real, but this adapter uses direct HTTP, not an Anthropic SDK; integrating server-side tool search requires separate result/dispatch support and is deliberately not silently introduced here.

Verification: `npm run test:anthropic-tool-cache`, `npm run test:anthropic-continuation`, `npm run test:prompt-cache`, and `npx tsc --noEmit -p tsconfig.json`.
