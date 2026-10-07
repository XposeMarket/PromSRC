# Social API escape hatches

Instagram, LinkedIn and TikTok keep their existing browser-session connection strategy. A browser login is not a provider API grant: these optional raw API tools require a separately issued provider `access_token`, saved through the connector's secure credential field, an existing `integration.<id>.oauth_tokens` vault entry, or `<ID>_ACCESS_TOKEN` environment variable. No browser cookies are used. Tokens must be replaced/refreshed externally when expired; this change does not introduce a new OAuth authorization or refresh flow.

The tools reuse the shared relative-path, fixed-base, manual-redirect and response/body bounds. GET/HEAD use ordinary credential-read policy; POST/PUT/PATCH/DELETE use the existing external-write approval gate. They do not accept arbitrary hosts, headers or credentials in tool arguments. Provider permissions and app approval still apply.

- Instagram uses `https://graph.instagram.com` for Instagram Login tokens. Facebook Login tokens and `graph.facebook.com` are deliberately not supported by this connector.
- LinkedIn uses `https://api.linkedin.com`; versioned Marketing APIs may need a future explicitly configured LinkedIn-Version header. Caller-supplied headers are not supported.
- TikTok uses `https://open.tiktokapis.com` for the public developer API, not TikTok's separate business API.

## Obsidian: HTTP API not applicable

The bundled Obsidian connector is a configured local-vault bridge (`src/gateway/obsidian/bridge.ts`), not an HTTP client. There is no Local REST API plugin integration, API base, stored plugin token or HTTP connection in this codebase. It already exposes status, vault connect, sync and assisted/full-mode Markdown writeback. Accordingly no misleading `connector_obsidian_api_request` HTTP tool is added, and the existing completeness-test exemption remains. Adding arbitrary file operations would expand the local filesystem blast radius and bypass the bridge's existing writeback semantics; a future Local REST API plugin connector should be an explicit, separately authenticated loopback integration.
