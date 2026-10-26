# Stable model-facing tool surfaces

Natural-language keyword routing is hint-only. `TOOL_CATEGORY_MATCH` remains the discovery hint; explicit `request_tool_category` and declared worker categories load tools. Existing turn/next-turn/TTL/session scopes, expiry, rollback and permission checks are unchanged. This avoids permanently accumulating false-positive keyword packs or silently upgrading short-lived scopes.

The builder emits core tools first, then category groups in activation insertion order, sorted by tool name within each group. Cache keys include category order. Adding a category to an unchanged ordered set appends its tools; category expiry/removal, mode/config changes and dynamic connector revisions can still change the prefix. This is not a permission grant or a promise that every session transition is append-only.

Anthropic caches tools -> system -> messages. Its automatic prefix lookup covers only the previous 20 block positions and only positions written by an earlier cache breakpoint. Therefore appending fewer than 20 tool blocks can reuse a prior tools-end entry; appending 20 or more may require an explicit stable-core breakpoint placed before dynamic tools. Even a tool-only prefix hit does not preserve the old system/history cache entry after new tools are inserted before those sections. Provider-adapter breakpoint work is a separate lane, not hidden in this backend PR.

Reference: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

Offline audit projections are counterfactual, not measured live savings: disabling keyword provisioning removes planner-caused changes but necessary explicit requests can add a round and reintroduce category changes. Keep explicit tool scopes narrow unless the user requests an ongoing workflow.
