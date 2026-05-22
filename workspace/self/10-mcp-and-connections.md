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

Quick-setup MCP presets currently include:

- `supabase`
- `github`
- `windows`
- `brave`
- `postgres`
- `sqlite`
- `filesystem`
- `memory`

## 23) Connections and Connectors

Prometheus now has both connector registry logic and a wider bundled connector extension set.

Current connector/plugin architecture facts:

- connector/plugin metadata begins in bundled `prometheus.extension.json` descriptors
- extension manifests can now declare explicit `contracts`, activation hints, and trust level
- active connector tools are surfaced through the extension runtime registry, not directly from `connector-tools.ts`
- active connector tool calls execute through the extension runtime registry, which currently delegates legacy tools to `handleConnectorTool(...)`
- `connector_list` is still core/always available, but its status text is built through `getExtensionRuntimeRegistry().buildConnectorStatus()`
- the migration target is to convert each connector from the legacy adapter into a native `definePrometheusExtension(...)` module with `runtime.entrypoint`, then remove the duplicate old connector maps/handlers
- validation command for this layer: `npx tsc --noEmit --pretty false`
- full backend validation command: `npm run build:backend`

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
- `src/gateway/routes/connections.router.ts` owns the right-side Connections panel `x` connector credential save, OAuth start/poll, and disconnect flow.
- `src/extensions/catalog-service.ts` reports X connected only when X API OAuth user-context tokens exist. Saved app credentials mean `hasCredentials`, not connected.
- `src/extensions/xai-extension-adapter.ts` registers xAI-backed tools; `x_search` and `xai_live_search` remain connector/provider id `xai`, while tool names beginning with `x_api_` are connector id `x`.
- `src/gateway/tools/defs/xai-tools.ts` defines both xAI search tools and official X API tool schemas.
- `src/gateway/tools/handlers/xai-handlers.ts` executes `x_search`, `xai_live_search`, and all `x_api_*` tools.
- `src/extensions/bundled/connectors/x/prometheus.extension.json` declares X connector metadata, Social category, ownership tools, OAuth/API-key setup, and browser-session fallback.
- `web-ui/src/pages/SettingsPage.js` and `web-ui/src/pages/ConnectionsPage.js` plus generated public copies must stay in sync when the auth UX changes.

Important behavior:

- Connecting xAI/Grok OAuth or an xAI API key in Settings must not mark the `x` connector connected.
- Connecting the `x` connector in Connections saves X Developer app credentials, then starts X OAuth 2.0 User Context authorization. It must not populate xAI/Grok model credentials.
- The X OAuth `client_id` must be the OAuth 2.0 Client ID from X Developer app Keys and tokens, not the API Key / Consumer Key. The default callback URL mirrors xurl: `http://localhost:8080/callback`. The callback URL must exactly match an X app Callback URL.
- The recommended X connector setup path is button-driven xurl CLI auth, not model/tool freeform shell: `xurl auth apps add/update prometheus`, `xurl auth apps redirect-uri set prometheus ...`, `xurl auth oauth2 --app prometheus`, `xurl auth default prometheus`, then `xurl whoami`. Prometheus may install/repair xurl with `npm install -g @xdevplatform/xurl` from that setup button.
- `src/auth/x-api-oauth.ts` treats the `prometheus` app entry in `~/.xurl` as a valid X API user-context token source, so `x_api_*` tools can use xurl-authenticated OAuth tokens when Prometheus vault tokens are absent.
- Disconnecting `x` should clear X API tokens and X app credentials, leave xAI/Grok credentials intact, and refresh registered xAI/X tools.
- `x_api_*` tools are not core tools. They belong to the `x` connector in the Social category, even though they are registered by the xAI extension adapter.
- `x_search` and `xai_live_search` are xAI/Grok search tools; `x_api_*` tools call `https://api.x.com/2`.
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
