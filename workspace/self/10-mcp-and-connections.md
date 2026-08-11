## 22) MCP System

Prometheus has a real MCP client manager in `src/gateway/mcp-manager.ts`.

Current MCP features:

- transport support:
  - `stdio`
  - `sse`
  - `http` (streamable HTTP alias accepted)
- config file path: `<configDir>/mcp-servers.json`
- imports object configs in `{ mcpServers: { ... } }` form
- resolves `vault:` secrets in env vars and headers
- sanitizes dangerous env vars
- validates stdio executables against an allowlist
- rejects shell metacharacters in stdio command strings
- injects connected tools as `mcp__<serverId>__<toolName>`

### P11-37 setup import boundary

Settings → General exposes a separate MCP/setup import job. It stages and
previews local JSON configuration and setup metadata before commit, preserves
memory/skill/instruction files as inactive review snapshots, imports MCP
definitions disabled, and creates a versioned `mcp-servers.json` backup. API
keys, OAuth tokens, cookies, bearer values, and other secret-like fields are
redacted to pending reauthorization markers; the importer never connects or
spawns an imported server. Conflicts are previewed and skipped by default,
with explicit opt-in replacement and rollback. See
[36-external-imports.md](36-external-imports.md).

MCP presets are now registry-backed runtime objects (Phase 5). Each
`mcp_preset` manifest's `mcpPreset` block (transport/command/args/env/url) is
registered into the extension runtime registry at load by `runtime-loader.ts`.
The registry is the single source of truth — no hardcoded preset list:

- `src/extensions/runtime-registry.ts` — `registerMcpPreset` + `getMcpPreset` /
  `listMcpPresets`
- `src/extensions/mcp-preset-service.ts` — `listMcpPresets()` (id/name/transport +
  credential fields) and `buildMcpServerConfigFromPreset(id, credentials)` which
  resolves empty env slots and `{{credential:<id>:<field>}}` placeholders into a
  concrete MCP server config
- routes: `GET /api/extensions/mcp-presets`, `POST /api/extensions/mcp-presets/build`
- consistency: every `mcp_preset` manifest must have a launchable `mcpPreset`
  block and be registered (checked in `consistency.ts`)

Bundled presets: `brave`, `filesystem`, `github`, `memory`, `postgres`, `sqlite`,
`windows`. (`supabase` is referenced in older prompt text but has no manifest;
add one if it should be a real preset.) The `integration_quick_setup` tool def in
`cis-system.ts` is currently inert (no executor) — wire it to
`buildMcpServerConfigFromPreset` if reviving it.

## 23) Connections and Connectors

Prometheus now has both connector registry logic and a wider bundled connector extension set.

Current connector/plugin architecture facts:

- connector/plugin metadata begins in bundled `prometheus.extension.json` descriptors
- extension manifests can now declare explicit `contracts`, activation hints, and trust level
- active connector tools are surfaced through the extension runtime registry, not directly from `connector-tools.ts`
- active connector tool calls execute through the extension runtime registry, with the host-owned `src/connections/tool-surface.ts` availability check applied before native execution
- `connector_list` is still core/always available, but its status text is built through `getExtensionRuntimeRegistry().buildConnectorStatus()`
- `connector_list` status is cached briefly inside `PrometheusExtensionRuntimeRegistry` (currently 5 seconds) and built with a single pass over connector `isConnected()` results. This keeps repeated connector discovery calls cheap without making connection state sticky for long.
- `external_apps` is wrapper-first for the largest bundled surfaces: X/xAI uses `x_search_ops`, `x_posts`, `x_users`, `x_lists`, `x_dm`, and `x_admin`; Vercel uses `vercel_ops`. Granular connector/extension tools remain executable internals and auth still flows through the connector runtime.
- the migration target is to convert each connector from the legacy adapter into a native `definePrometheusExtension(...)` module with `runtime.entrypoint`, then remove the duplicate old connector maps/handlers
- validation command for this layer: `npx tsc --noEmit --pretty false`
- full backend validation command: `npm run build:backend`

### 23B) Native Connector Extension Contract (migration target + state)

As of 2026-06-06 the connector layer is being migrated from the legacy adapter to
native, manifest-owned extension modules — the same runtime contract user plugins
already use (§23A). The end state: `src/extensions` is the single source of truth;
the legacy maps/handlers shrink to migration glue and are then deleted.

Migration status (update as connectors move):

- Native (own a `runtime.entrypoint` module): `stripe`, `ga4`, `gmail`, `github`,
  `slack`, `notion`, `google_drive`, `reddit`, `hubspot`, `salesforce`, `obsidian`
- `CONNECTOR_TOOL_MAP` is now `{}`, `getConnectorToolDefs()` returns `[]`, and
  `handleConnectorTool` is a retired stub — every `connector_*` tool is native and
  routes through the registry (both `subagent-executor` and `platform-executor`).
- Out of scope for the connector-handlers migration (separate subsystems):
  - `x` — `x_api_*` tools are registered by `xai-extension-adapter.ts`; its connector
    record + `refreshXAITools()` still live in `legacy-connector-adapter.ts`.
  - `vercel` — `vercel_*` tools are not `connector_*` and live under `integration_admin`.
  These two keep `legacy-connector-adapter.ts` alive as a narrow bridge; the legacy
  connector maps/switch themselves are dead.
- Phase 6 done: `connector-tools.ts` and `connector-handlers.ts` are **deleted**.
  `legacy-connector-adapter.ts` is now a slim extension bootstrap (load native
  modules) + X/xAI status-record bridge — no connector maps/handlers. Both
  `subagent-executor` and `platform-executor` route `connector_*` through the
  registry.

What "native" means for a bundled connector:

- the manifest (`prometheus.extension.json`) declares `runtime.entrypoint`
  (e.g. `"./runtime.js"`) and the full `ownership.tools` list
- a sibling `runtime.ts` exports a `PrometheusExtensionDefinition`
  (`{ id, register(api) }`) that:
  - calls `api.registerConnector({ id, name, authType, capabilities, toolNames,
    isConnected, hasCredentials, describeStatus })` — the connector status record
  - calls `api.registerTool({ name, description, parameters, connectorId, execute })`
    once per tool, with the JSON-Schema and an `execute(args, ctx)` closure
- **auth stays central.** The native `execute` still calls the existing
  `integrations/connectors/<id>.ts` connector CLASS (via `getConnector(id)`),
  which owns OAuth token refresh / credential vault access. Native migration moves
  *schemas + dispatch*, not auth. Only credential-light REST connectors (and user
  plugins) read secrets directly via `ctx.getCredential`.
- shared helpers live in `src/extensions/bundled/connectors/_runtime/connector-helpers.ts`
  (`toolOk`, `toolError`, `notConnected`, `getLiveConnector`, `connectorConnected`).

Required fields when adding/migrating a native connector:

- connector record: `id`, `name`, `kind`, `capabilities`, `toolNames`, `authType`,
  `isConnected`, `hasCredentials`, `describeStatus`
- per tool: `name` (prefixed `connector_<id>_`), `description`, `parameters`
  (JSON Schema), explicit `connectorId`, `execute(args, ctx)` returning
  `{ result, error }`; read-vs-write intent reflected in description/approval

Which extension surfaces are real today: **tools, connectors, providers, MCP
presets are real.** `registerRoute`, `registerHook`, `registerMemorySource`,
`registerContextProvider` exist but are **experimental** — do not depend on them in
steady-state until a real consumer ships and they get capability scoping.

Guardrails (`src/extensions/consistency.ts`, run at load + via
`scripts/verify-extensions.ts`):

- every connector manifest `ownership.tools` must match the tools actually
  registered for that connector
- connector/provider/MCP-preset ids and tool names must be collision-free
- `connector_list` status comes only from `getExtensionRuntimeRegistry().buildConnectorStatus()`
- connected connector tool defs come only from
  `getExtensionRuntimeRegistry().listConnectedConnectorToolDefinitions()`, which
  uses canonical `availableTools` for managed records and the legacy runtime
  status fallback for unmigrated records
- native connector and dynamic MCP calls re-check the same availability decision
  at execution time; `exposedTools` is the safe/read-only automatic subset, not
  the only way a write action can reach the normal approval queue
- native connector manifests and runtime connector `toolNames` are checked for
  exact parity by `src/extensions/consistency.ts`, not just one-way missing
  tool registration
- the legacy adapter skips any connector that has a native `runtime.entrypoint`, so
  native and legacy can never double-register during the transition

### 23A) Plugin/MCP interoperability baseline — 2026-08-11

The connector-only Prometheus surface follows the common interoperability
patterns used by OpenAI Apps, Claude/MCP, Hermes Agent, and OpenClaw without
folding model-provider credentials into the Plugins catalog:

- **One connection, one host-owned tool surface.** A plugin/MCP connection
  keeps the discovered/registered implementation names, an explicit
  `availableTools` model-facing allowlist, and an `exposedTools` automatic
  read-only subset. Writes and unknown side effects may remain available so the
  normal per-call approval policy can run; disabling a tool removes it from the
  model-facing allowlist entirely.
- **Discover, authorize, expose, and execute are separate stages.** OAuth/API
  key/browser/MCP setup produces a canonical connection record. Tool access is
  then adjustable independently, and execution checks that record again rather
  than trusting a stale prompt/tool list. This mirrors app permission controls,
  MCP tool configuration, and OpenClaw's install/enable/runtime boundaries.
- **MCP discovery is refreshable.** stdio `notifications/tools/list_changed`, an
  explicit Plugins “Refresh discovered tools” action, and the
  `POST /api/mcp/servers/:id/refresh` route update the canonical tool snapshot.
  Explicit user allowlists survive refresh by intersection with the newly
  registered names; removed tools cannot remain executable. Managed MCP detail
  views use the same `availableTools`/`exposedTools` grant controls as native
  connectors; older manually configured servers retain a visible compatibility
  list until they enter the canonical connection-v2 flow.
- **Remote MCP auth remains standards-based.** HTTP/SSE servers use the
  existing OAuth metadata discovery, PKCE/state, vault-backed credentials, and
  bearer/header handling. Prometheus does not silently treat a remote server as
  trusted or auto-authorize newly discovered write tools.
- **Tool schemas remain discoverable and deterministic.** Catalog/runtime
  validation requires exact manifest/runtime ownership parity, while MCP
  discovery preserves server-provided schemas and deterministic ordering. Tool
  list changes invalidate the managed snapshot before a subsequent call.
- **Scope boundary:** this baseline applies to connector/integration plugins,
  custom MCP servers, local integrations, browser-session connectors, and
  developer/advanced setup. Model providers, chat-model credentials, voice/
  realtime providers, reasoning defaults, and provider authentication remain in
  their existing Settings surfaces.

Per-connector migration checklist:

1. add `runtime.entrypoint` to the manifest; keep `ownership.tools` complete
2. create `runtime.ts` (connector record + tool schemas + `execute` closures
   calling the connector class)
3. remove the connector from `CONNECTOR_TOOL_MAP` and `getConnectorToolDefs()` in
   `connector-tools.ts`
4. remove the connector's branch from `handleConnectorTool` in `connector-handlers.ts`
5. add a happy-path test and a disconnected/no-credentials test
6. confirm it appears in `connector_list` and exposes tools only when connected
7. run `npx tsc --noEmit` and `npx tsx scripts/verify-extensions.ts`

Deprecation: `CONNECTOR_TOOL_MAP`, `getConnectorToolDefs`, and `handleConnectorTool`
are migration-only and marked `@deprecated`. Do not add new connector branches to
`handleConnectorTool`; new connectors are native from day one.

OAuth/API-key connector registry currently instantiates:

- Gmail
- Slack
- GitHub
- Notion
- Reddit
- Google Drive
- HubSpot
- Salesforce
- Stripe
- Google Analytics

Bundled connector extension folders currently include:

- `ga4`
- `github`
- `gmail`
- `google_drive`
- `hubspot`
- `instagram`
- `linkedin`
- `notion`
- `obsidian`
- `reddit`
- `salesforce`
- `slack`
- `stripe`
- `tiktok`
- `x`
- `vercel`

Connections routes currently include:

- `GET /api/connections`
- `POST /api/connections/credentials`
- `POST /api/connections/save`
- `POST /api/connections/disconnect`
- `POST /api/connections/oauth/start`
- `GET /api/connections/oauth/poll`
- `POST /api/connections/browser-open`
- `POST /api/connections/browser-verify`
- `GET /api/connections/activity`

Browser-session verification is currently implemented for:

- Instagram
- TikTok
- X
- LinkedIn

### X Connector, xAI/Grok OAuth, and X API Tools

As of 2026-05-20, Prometheus treats the bundled `x` connector as the Social-category owner for official X API/xurl-style tools. These tools require X Developer app credentials plus OAuth 2.0 User Context tokens. xAI/Grok OAuth is separate and only powers Grok models, `x_search`, `xai_live_search`, TTS, and STT.

Canonical files for this surface:

- `src/auth/x-api-oauth.ts` resolves X API OAuth user-context credentials. It must not fall back to xAI OAuth, xAI API keys, `XAI_API_KEY`, or app-only bearer tokens for user-context X API endpoints.
- `src/auth/xai-oauth.ts` owns xAI/Grok OAuth token storage, refresh, and runtime credential generation.
- `src/gateway/routes/settings.router.ts` owns xAI/Grok model auth and the separate Settings-side X API OAuth controls.
- `src/gateway/routes/connections.router.ts` owns the desktop Plugins detail surface's `x` connector credential save, OAuth start/poll, and disconnect flow.
- `src/extensions/catalog-service.ts` reports X connected only when X API OAuth user-context tokens exist. Saved app credentials mean `hasCredentials`, not connected.
- `src/extensions/xai-extension-adapter.ts` registers xAI-backed tools; `x_search` and `xai_live_search` remain connector/provider id `xai`, while tool names beginning with `x_api_` are connector id `x`.
- `src/gateway/tools/defs/xai-tools.ts` defines both xAI search tools and official X API tool schemas.
- `src/gateway/tools/handlers/xai-handlers.ts` executes `x_search`, `xai_live_search`, and all `x_api_*` tools.
- `src/extensions/bundled/connectors/x/prometheus.extension.json` declares X connector metadata, Social category, ownership tools, OAuth/API-key setup, and browser-session fallback.
- `web-ui/src/pages/SettingsPage.js` and the lazy-loaded `web-ui/src/pages/ConnectionsPage.js` plus generated public copies must stay in sync when the auth UX changes. Desktop navigation reaches the connector catalog through More → Plugins; model-provider settings remain in Settings.

Important behavior:

- Connecting xAI/Grok OAuth or an xAI API key in Settings must not mark the `x` connector connected.
- Connecting the `x` connector in Connections saves X Developer app credentials, then starts X OAuth 2.0 User Context authorization. It must not populate xAI/Grok model credentials.
- The X OAuth `client_id` must be the OAuth 2.0 Client ID from X Developer app Keys and tokens, not the API Key / Consumer Key. The default callback URL mirrors xurl: `http://localhost:8080/callback`. The callback URL must exactly match an X app Callback URL.
- The recommended X connector setup path is button-driven xurl CLI auth, not model/tool freeform shell: `xurl auth apps add/update prometheus`, `xurl auth apps redirect-uri set prometheus ...`, `xurl auth oauth2 --app prometheus`, `xurl auth default prometheus`, then `xurl whoami`. Prometheus may install/repair xurl with `npm install -g @xdevplatform/xurl` from that setup button.
- `src/auth/x-api-oauth.ts` treats the `prometheus` app entry in `~/.xurl` as a valid X API user-context token source, so `x_api_*` tools can use xurl-authenticated OAuth tokens when Prometheus vault tokens are absent.
- Disconnecting `x` should clear X API tokens and X app credentials, leave xAI/Grok credentials intact, and refresh registered xAI/X tools.
- `x_api_*` tools are not core tools. They belong to the `x` connector in the Social category, even though they are registered by the xAI extension adapter.
- `x_search` and `xai_live_search` are xAI/Grok search tools; `x_api_*` tools call `https://api.x.com/2`.
- Composer 2.5 / Grok Composer is exposed through the xAI/Grok OAuth subscription path as curated model id `grok-composer-2.5-fast`. xAI's announcement says Composer 2.5 is selected from Grok Build's `/models` menu and is available to SuperGrok and X Premium+; Hermes Agent mirrors this by adding the id as an OAuth-only curated extra immediately after `grok-build-0.1` in `oss-agents/hermes-agent/hermes_cli/models.py` and regression-testing it in `tests/hermes_cli/test_xai_curated_models.py` (checkout `88d1d62`).

- Write tools such as post, delete, like, repost, follow, block, mute, list mutation, and DM send should be used only when the user explicitly asks.
- Many X endpoints are scope/tier gated. Prometheus should surface real X API 401/403/429 errors rather than hiding them or falling back to browser automation silently.
- `x_api_request` is the generic authenticated X API v2 escape hatch for endpoints that X adds before Prometheus gets a dedicated schema.

Current dedicated `x_api_*` tool coverage:

- identity/generic: `x_api_me`, `x_api_request`
- posts/search: `x_api_get_post`, `x_api_get_posts`, `x_api_search_recent`, `x_api_search_all`, `x_api_create_post`, `x_api_delete_post`
- bookmarks: `x_api_get_bookmarks`, `x_api_create_bookmark`, `x_api_delete_bookmark`
- likes: `x_api_like_post`, `x_api_unlike_post`, `x_api_get_liked_posts`, `x_api_get_liking_users`
- reposts: `x_api_repost`, `x_api_unrepost`, `x_api_get_reposted_by`, `x_api_get_reposts_of_me`
- users/social graph: `x_api_get_user`, `x_api_get_user_by_username`, `x_api_get_user_posts`, `x_api_get_user_mentions`, `x_api_get_followers`, `x_api_get_following`, `x_api_follow_user`, `x_api_unfollow_user`, `x_api_mute_user`, `x_api_unmute_user`, `x_api_block_user`, `x_api_unblock_user`
- lists: `x_api_get_list`, `x_api_get_owned_lists`, `x_api_get_list_posts`, `x_api_create_list`, `x_api_update_list`, `x_api_delete_list`, `x_api_add_list_member`, `x_api_remove_list_member`, `x_api_follow_list`, `x_api_unfollow_list`, `x_api_pin_list`, `x_api_unpin_list`
- Spaces/trends/DMs/usage: `x_api_search_spaces`, `x_api_get_space`, `x_api_get_trends`, `x_api_get_personalized_trends`, `x_api_get_dm_events`, `x_api_send_dm`, `x_api_get_usage`

When self-editing this area:

- Keep `XAI_TOOL_NAMES`, `getXAIToolDefs()`, handler dispatch in `handleXAISearchTool(...)`, and `ownership.tools` in the `x` connector manifest consistent.
- Verify consistency by comparing `export const X_API_*_TOOL_NAME = 'x_api_*'` in `xai-tools.ts` against `ownership.tools` in `src/extensions/bundled/connectors/x/prometheus.extension.json`.
- Run `npx tsc --noEmit --pretty false` after changing auth, handlers, tool defs, connector manifests, or Settings/Connections auth UI.
- Do not edit `workspace/oss-agents/hermes-agent` when working on this Prometheus X/xAI integration unless the user explicitly asks for Hermes changes.

Obsidian is implemented as a local bridge rather than OAuth.
Current Obsidian routes:

- `GET /api/obsidian/status`
- `POST /api/obsidian/vaults`
- `PATCH /api/obsidian/vaults/:vaultId`
- `DELETE /api/obsidian/vaults/:vaultId`
- `POST /api/obsidian/sync`
- `POST /api/obsidian/writeback`

Obsidian connector tools currently include:

- `connector_obsidian_status`
- `connector_obsidian_connect_vault`
- `connector_obsidian_sync`
- `connector_obsidian_writeback`

Note:

- `connector_list` text still names the original core connector set
- the actual bundled connector surface is now broader than that description


### Agent operating rule (from SOUL 2026-07-07)

Before claiming you can read email, pull CRM/social data, or use an external platform API, call **`connector_list`** (core) and use connected tools only. Browser-auth connectors (Instagram, TikTok, X, LinkedIn) use the live Chrome session via browser tools when connectors are not wired. Full panel list and routes: §23 above; MEMORY `operational_rules` → Connections.

## Persistent Chat Sources boundary — 2026-08-08

MCP, connector, and account-backed resources are intentionally excluded from the first Persistent Chat Sources release. The resource registry already has origin/locator fields and a future adapter boundary, but a connector must not become a thread resource until its account/workspace permissions, refresh behavior, revocation, and audit events are specified. Continue using `connector_list` and the existing connector authorization contract for live connector reads.

### 23C) OAuth-first connector-v2 migration — 2026-08-09

The native OAuth connector family now uses the shared host contract in
`src/connections/adapters/connector-oauth.ts` and
`src/connections/connector-oauth-bridges.ts`: GitHub, Gmail, Google Drive, GA4,
Notion, Slack, HubSpot, Salesforce, and Reddit. The manifest is the source of
truth for provider-app requirements, exact loopback callback, read-only scopes,
PKCE/state/nonce requirements where the provider supports them, capability
contracts, verification checks, and fail-closed unknown-tool policy.
The connection record carries account identity, resource scope, token/health
metadata, granted capabilities, and exposed tool counts without copying raw
tokens out of the vault.

Legacy reads and existing OAuth sessions remain compatible. A connection-v2
marker is additive and rollback-capable; migration alone does not force
reauthorization. The Plugins page uses the orchestrator and shared adapter for
managed connect, verify, repair, reauthorize, revoke/clear, and disconnect. Own
OAuth app, API key, setup-token, browser-session, local, and custom MCP paths
remain explicit Advanced alternatives.

X remains a separate X API user-context/xurl OAuth implementation until its
app/tier/callback/resource contract is migrated; do not conflate it with xAI
model OAuth. Instagram, TikTok, and LinkedIn remain browser-session/provider
review paths. Vercel and Stripe remain API-key/provider-specific, and Obsidian
remains local.

Remote MCP OAuth is a separate standards-based adapter. The gateway now matches
the callback path exactly, redacts provider/token errors, supports optional
RFC 7009 revocation before local clear, and retains metadata discovery,
dynamic-registration, PKCE/state, loopback, refresh, and conservative tool
classification. A remote MCP server without trustworthy OAuth metadata is
manual configuration, not a guessed OAuth connection.

See `docs/P9-OAUTH-FIRST-PLUGIN-PLATFORM-IMPLEMENTATION-2026-08-08.md` for the
connector matrix, callback/client configuration, provider prerequisites,
scope decisions, risks, and test evidence.
