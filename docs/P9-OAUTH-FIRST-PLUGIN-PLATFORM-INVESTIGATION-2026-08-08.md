# P9 — OAuth-first plugin platform investigation

Date: 2026-08-08  
Scope: current Prometheus workspace; research and implementation plan only  
Decision boundary: this document makes no runtime, credential, plugin, gateway, or backend behavior changes.

## Executive conclusion

Prometheus already contains most of the host primitives needed for an OAuth-first connection platform:

- an encrypted vault with Electron OS-protected key handling;
- loopback-browser OAuth helpers for OpenAI, xAI, X API, native connectors, and remote MCP;
- PKCE support in the newer MCP and connection adapters;
- durable connection attempts, secure-input sessions, verification, repair, disconnect, activity, and conservative tool exposure;
- extension manifests that can describe OAuth, API keys, browser sessions, local resources, MCP transports, scopes, callbacks, permissions, and connection strategies.

The current product experience is not yet OAuth-first because the bundled connector manifests mostly use the legacy `setup.authType: oauth` metadata while the generic connection orchestrator only resolves manifests that declare a `connection` block. The result is two parallel planes:

1. The newer host-owned plane: `connection-attempts` → plan → user action → verify → canonical `connections-v2.json` record.
2. The compatibility plane: `ConnectionsPage` → legacy credential save → connector-specific OAuth start/poll → `connections.json` and connector classes.

The recommended strategy is therefore an incremental migration, not a platform rewrite:

1. Make the new connection contract the source of truth for user-facing connection cards.
2. Ship Prometheus-owned provider applications for the high-value OAuth candidates where vendor policy permits it.
3. Keep API-key, setup-token, browser-session, local bridge, and custom MCP configuration as explicit advanced paths.
4. Use capability-specific consent and tool exposure, not a single “connected” boolean, especially for write, financial, destructive, and credential-sensitive operations.

The best near-term candidates are Gmail, Google Drive, Google Analytics 4, GitHub, Notion, Slack, and HubSpot. OpenAI Codex OAuth and Robinhood remote MCP OAuth are already the strongest examples of the desired flow. Stripe should remain API-key-first for the current connector; Obsidian should remain local; generic custom MCP should remain configuration-first unless the server advertises standards-based OAuth.

## Evidence and current architecture

### Extension and plugin inventory

Bundled extensions are loaded from `src/extensions/bundled/**/prometheus.extension.json` by `src/extensions/loader.ts` and indexed by `src/extensions/registry.ts`. User plugins resolve to `<configDir>/user-plugins`; the current workspace has no `.prometheus/user-plugins` directory, so there are no installed user-plugin manifests in this checkout. The installer in `src/extensions/install-service.ts` can write a manifest and optional `index.js`, then hot-reload it.

The current bundled inventory is:

- 16 connector extensions: `ga4`, `github`, `gmail`, `google_drive`, `hubspot`, `instagram`, `linkedin`, `notion`, `obsidian`, `reddit`, `salesforce`, `slack`, `stripe`, `tiktok`, `vercel`, `x`.
- 23 provider extensions: `anthropic`, `arcee`, `deepseek`, `gemini`, `huggingface`, `kilocode`, `llama_cpp`, `lm_studio`, `minimax`, `moonshot`, `nvidia`, `ollama`, `openai_codex`, `openai`, `opencode-go`, `opencode`, `openrouter`, `perplexity`, `qwen`, `vercel-ai-gateway`, `xai`, `xiaomi`, `zai`.
- 8 MCP presets: `brave`, `filesystem`, `github`, `memory`, `postgres`, `robinhood-trading`, `sqlite`, `windows`.

Manifest evidence: `src/extensions/schema.ts:49-163` defines setup auth types, fields, scopes, callbacks, browser login, MCP recipes, permissions, and the optional `connection.schemaVersion: 1` contract. Most current connector manifests declare `setup`, but not `connection`.

### Connection lifecycle

The intended lifecycle is documented in `docs/UNIVERSAL_PLUGIN_CONNECTIONS.md:3-36` and implemented across `src/connections/orchestrator.ts`, `src/connections/plugin-plan-resolver.ts`, `src/connections/runtime.ts`, and `src/connections/schema.ts`:

`discover → plan → await user action → connect/register → verify → connected`, with repair, reauthorization, cancellation, degraded, and failed states.

The newer gateway routes are in `src/gateway/routes/connections-v2.router.ts:6-87`:

- `GET /api/connection-discovery`
- `POST /api/connection-attempts`
- attempt `connect`, `continue`, `verify`, `repair`, and `cancel`
- secure-input session creation/consumption
- `GET /api/connections-v2`
- `POST /api/connections-v2/:id/disconnect`

The legacy routes remain in `src/gateway/routes/connections.router.ts:245-660`, including generic credential save, manual save, OAuth start/poll, browser-session open/verify, disconnect, and activity. `web-ui/src/pages/ConnectionsPage.js` is still wired mainly to this legacy surface and renders connector-specific branches.

### Credential storage and migration

`src/security/vault.ts:2-26` describes AES-256-GCM encrypted storage. In Electron, `electron/main.js` uses `safeStorage` (DPAPI on Windows / Keychain on macOS) to protect the vault master key, then hands the key to the gateway over the child-process bootstrap channel. Standalone mode can fall back to a plaintext local master-key file and is therefore a different security tier.

Observed storage patterns:

| Data | Current location / key | Assessment |
|---|---|---|
| Native OAuth connector tokens | `integration.<id>.oauth_tokens` | Encrypted vault; refresh handled by `src/integrations/oauth-base.ts`. |
| Native connector client credentials | `integration.<id>.credentials` | Encrypted vault; current UX requires user-entered client ID/secret for most connectors. |
| X API OAuth | `x.api.oauth_tokens`, `x.api.oauth_credentials` | Encrypted vault; distinct from xAI/Grok OAuth. |
| xAI/Grok OAuth | `xai.oauth_tokens` and account-specific suffixes | Encrypted vault; refresh and expiry handling exist. |
| OpenAI Codex OAuth | `openai.oauth_tokens` | Encrypted vault; legacy OAuth file migration exists in `src/auth/openai-oauth.ts`. |
| Remote MCP OAuth | `mcp.oauth.<id>.client`, `mcp.oauth.<id>.tokens` | Encrypted vault; dynamic registration, PKCE, refresh, state validation, and clear are implemented in `src/gateway/mcp-oauth.ts`. |
| API keys / generic fields | connector-specific vault entries and `vault:` references | Encrypted when routed through the secure path; legacy generic save can mark state connected before verification. |
| Legacy connection projection | `<configDir>/connections.json` | Non-secret connected/auth metadata; `src/connections/legacy-migration.ts` projects it into `connections-v2.json`. |
| Canonical connection records | `<configDir>/connections-v2.json` | Stores lifecycle state, granted scopes/capabilities, exposed tools, opaque credential references, health, and verification. |
| MCP configuration | `<configDir>/mcp-servers.json` | Typed server definitions; `vault:` values can be resolved into env vars and headers. |

Migration should preserve vault entries and add canonical records, never copy raw token material into connection records, logs, chat, or manifests. Existing OAuth sessions should be recognized as connected even when their client credentials were previously entered manually; the UI should then offer “Manage access” rather than forcing a reconnect.

## OAuth readiness classification

Readiness labels:

- **Viable now** — Prometheus already has the complete flow, or the provider offers a standard flow that can be used without asking each end user to register an app.
- **Technically possible; app/vendor work** — the provider supports OAuth, but Prometheus needs a provider app, review/verification, scope approval, redirect policy, or product-specific agreement before the consumer flow can be shipped.
- **API-key/manual** — OAuth is not the right current mechanism, is not exposed for the relevant API, or the existing product is intentionally developer-oriented.
- **Local/MCP/manual by nature** — the connection depends on a local process, filesystem, user-owned server, CLI, or custom endpoint.
- **Uncertain** — the provider/API capability is account-, product-, or approval-dependent and needs a focused validation before promising it in the UI.

### Connectors

| Integration | Current path | Classification | OAuth design requirements and blockers |
|---|---|---|---|
| Gmail | Native OAuth connector; client ID/secret fields; local callback 19420 | Technically possible; app/vendor work | Prometheus Google desktop/web client, external browser + loopback/PKCE, minimal Gmail scopes, `userinfo.email`, offline refresh, revoke handling, Google app verification for sensitive/restricted scopes. Prefer `gmail.readonly`; request send/modify only when the user enables those capabilities. |
| Google Drive | Native OAuth connector; callback 19425 | Technically possible; app/vendor work | Google app, Drive scopes, account identity, refresh/revoke. Prefer `drive.file` plus a file picker where feasible; broad Drive scopes are restricted and may trigger verification/security-assessment work. |
| GA4 | Native OAuth connector; manifest has OAuth but sparse callback/scope metadata | Technically possible; app/vendor work | Google Analytics Data API enabled, OAuth app, `analytics.readonly`, property selection after sign-in, refresh/revoke, Google verification if required. The property ID must be a post-consent resource selection, not a secret field. |
| GitHub | Native OAuth connector; callback 19422 | Technically possible; app/vendor work | Prefer a GitHub App with fine-grained repository/org permissions over a broad OAuth App. Use external browser, PKCE where supported, short-lived installation/user tokens, account/org selection, and revoke/uninstall reconciliation. Existing `repo` scope is too broad for a default consumer card. |
| Slack | Native OAuth connector; callback 19421 | Technically possible; app/vendor work | Slack app, HTTPS redirect in production, bot/user token decision, workspace selection, granular scopes, token rotation/refresh, workspace uninstall/revocation. Separate “read messages” from “post messages”; show workspace and bot identity. |
| Notion | Native OAuth connector; callback 19423 | Technically possible; app/vendor work | Public Notion connection, redirect URI, authorization code exchange, access/refresh storage, workspace selection, page/database scope explanation, revocation/uninstall handling. The current connector’s client ID/secret fields should become an advanced developer path. |
| HubSpot | Native OAuth connector; callback 19426 | Technically possible; app/vendor work | HubSpot app, CRM scopes, portal selection, access/refresh tokens, token revocation and portal permission checks. Access tokens do not fully encode portal-user permissions; verification must test the selected portal and required CRM capabilities. |
| Salesforce | Native OAuth connector; callback 19427 | Technically possible; app/vendor work | Connected App, external browser, PKCE/public-client posture where supported, API/openid/refresh scopes, instance/org identity, admin approval edge cases, refresh and revoke. Salesforce’s client-secret handling is a desktop security concern. |
| Reddit | Native OAuth connector; callback 19424 | Technically possible; app/vendor work | Reddit app registration, identity/read/submit/history scopes, refresh-token storage, subreddit/user identity, rate limits, moderator/private-subreddit errors, and product approval if Reddit changes app access rules. Keep submit as separately enabled capability. |
| X | X API OAuth 2.0 PKCE plus optional xurl/browser fallback; default callback `http://localhost:8080/callback` | Technically possible; app/vendor work | X Developer Project/App, exact callback match, OAuth 2 client ID (not API key/consumer key), fine-grained scopes, billing/endpoint availability, refresh/revoke. Prometheus must keep X API user-context OAuth separate from xAI/Grok OAuth. The repo already enforces this separation. |
| Vercel | API token plus project/team fields | Technically possible; app/vendor work | Vercel OAuth/Integration app, registered callback, scopes, team/project selection, access-token refresh/revoke/introspection, and explicit environment-variable/deploy capability consent. API tokens remain the simplest advanced fallback. |
| Stripe | Secret API key; current tools read-only | API-key-first; OAuth only for a different product model | Stripe Connect OAuth is designed for a platform connecting Standard accounts, not a generic “connect my own Stripe dashboard” shortcut. It also requires a registered platform, redirect URI, secret API key, account ID, webhook/deauthorization handling, and read/write scope decisions. Keep API key as the honest path unless Prometheus becomes a Stripe Connect platform/extension. |
| Instagram | Browser session | Uncertain; likely app/vendor work | Official Meta/Instagram APIs are product- and account-type-dependent, with app review and permission restrictions. Validate Professional-account coverage, permissions, data retention, and redirect/review requirements before replacing browser session. Keep browser session as advanced fallback. |
| TikTok | Browser session | Technically possible; app/vendor work | TikTok Login Kit/OAuth, approved app, redirect URIs, basic and product-specific scopes, refresh tokens, account-type limitations, and app review. Keep browser session for unsupported or personal-account cases. |
| LinkedIn | Browser session | Technically possible; app/vendor work | LinkedIn 3-legged OAuth, registered HTTPS redirect, app-approved scopes, access-token expiry, limited/partner-dependent refresh, and reauthorization UX. Keep browser session where the API product does not grant the needed permissions. |
| Obsidian | Local bridge and vault path | Local/manual by nature | Local filesystem permission, read-only default, explicit writeback mode, vault selection, indexing consent, and removal of indexed notes. OAuth would be misleading. |

### Providers

| Provider extension(s) | Classification | Recommended path |
|---|---|---|
| `openai_codex` | **Viable now** | Keep the existing browser OAuth/PKCE flow, encrypted tokens, refresh, account identity, and legacy migration. This is the reference model for account-scoped provider auth. |
| `xai` | **Viable now for the existing account-specific OAuth path; not a general API OAuth promise** | Keep Settings-side xAI/Grok OAuth distinct from the `x` connector. Continue to offer API key for API billing/accounts and explain entitlement/refresh behavior. |
| `anthropic` | **Manual/setup-token** | `claude setup-token` paste flow is a developer/manual credential exchange, not consumer OAuth. Keep setup token and API key paths; label it accurately. |
| `openai` | **API-key** | Platform API key and model configuration; no assumption that Codex account OAuth substitutes for API billing access. |
| `arcee`, `deepseek`, `gemini`, `huggingface`, `kilocode`, `minimax`, `moonshot`, `nvidia`, `opencode`, `opencode-go`, `openrouter`, `perplexity`, `qwen`, `vercel-ai-gateway`, `xiaomi`, `zai` | **API-key/manual** | Keep secure API-key entry, environment references, endpoint/model configuration, and provider-specific billing/region errors. Some may later add provider OAuth, but no current consumer OAuth contract is evidenced in the workspace. |
| `ollama`, `llama_cpp`, `lm_studio` | **Local/manual by nature** | Local endpoint discovery/configuration, optional local auth, health check, and clear network-boundary messaging. |

### MCP and custom integrations

| Surface | Classification | Recommended path |
|---|---|---|
| Robinhood remote MCP | **Viable now** | Use the existing MCP OAuth 2.1/PKCE discovery, dynamic registration, loopback callback, vault tokens, refresh, conservative read-only exposure, and explicit review for financial mutations. |
| Brave MCP | API-key/manual | Secure API key in the preset; keep scope and rate-limit messaging. |
| GitHub MCP preset | API-key/manual preset | Do not infer that the GitHub connector’s OAuth connection configures this separate stdio server. Offer “connect GitHub connector” and “configure GitHub MCP” as distinct accounts. |
| Filesystem, Memory, Postgres, SQLite, Windows MCP | Local/MCP/manual by nature | Package/process approval, filesystem/database target review, command allowlisting, environment sanitization, and per-tool classification. |
| Custom remote HTTP/SSE MCP | **Conditional OAuth** | Attempt standards-based protected-resource/auth metadata discovery and PKCE. If the server does not advertise compatible metadata, require explicit URL/header/token configuration. Never silently convert a bearer header into a consumer connection. |
| Custom stdio MCP | Local/MCP/manual by nature | Require package/command approval, explicit process and filesystem boundary review, and fail-closed tool exposure. |

## Provider app, redirect, token, and revocation policy

### Provider-owned applications

The product should use Prometheus-owned applications for the default consumer flow, with provider-specific credentials stored as deployment configuration, not entered by each user. A developer-entered client ID/secret remains available under “Use your own app.”

The host should maintain a provider registration record containing:

- provider and app/client ID;
- client type: public PKCE, confidential, device-code, or vendor-specific;
- authorization/token/revocation/introspection endpoints;
- exact redirect strategy and environment (desktop loopback, hosted callback, or device code);
- approved scopes and capability mapping;
- refresh/revocation behavior and expected token lifetime;
- provider verification, consent-screen, domain, security-review, and rate-limit status.

Desktop OAuth should open the system browser. Google’s native-app guidance recommends an external browser and loopback redirect for installed apps; its policies also require an owned/authorized domain and may require verification for sensitive/restricted scopes. Slack requires HTTPS redirect URLs for production OAuth and exact redirect matching. X requires exact callback matching and separates OAuth 2 client IDs from API keys. These are reasons the host needs provider-specific metadata rather than a generic form with two credential fields.

### Token lifecycle

Every OAuth account should have:

- opaque account ID and display identity, such as email, workspace, portal, org, team, or property;
- access token encrypted in the vault;
- refresh token encrypted in the vault when issued;
- expiry and last-refresh metadata;
- granted scopes and Prometheus capability grants separately recorded;
- provider revocation/deauthorization status;
- last verified time and a repair/reauthorize action.

Refresh failures should transition to `reauth_required`, preserve the account label and requested capability choices, and avoid deleting the record until the user explicitly disconnects. Disconnect should revoke remotely when the provider supports it, then clear local token/client state and remove exposed tools. If remote revocation is unavailable, the UI should say “local access removed; revoke access at [provider]” and link to the provider account page.

## Electron and local-gateway security implications

The desktop boundary is favorable but not sufficient by itself:

- `README-DESKTOP.md` describes an Electron wrapper with a gateway child on `http://127.0.0.1:18789`.
- `electron/main.js` uses OS sealing for the vault key where available and passes the plaintext key only through the gateway bootstrap channel.
- `electron/preload.js` exposes a narrow API; renderer node integration is disabled, context isolation is enabled, and external links open in the system browser.
- `src/gateway/gateway-auth.ts` permits trusted loopback access without a configured token, but requires gateway/pairing auth for remote access and validates trusted origins.
- OAuth callback listeners are local loopback listeners, not renderer endpoints. They must bind only to loopback, use an unpredictable state, use PKCE for public clients, validate exact redirect/state/issuer/resource, and close after one callback.

Risks to address in a future implementation phase:

1. The gateway default host can be `0.0.0.0`; a browser callback or local API must not become a LAN credential relay. Remote access requires explicit auth and should not reuse a local-only callback assumption.
2. Provider callbacks must not accept arbitrary paths, ports, or origins supplied by a plugin without validation. A manifest callback is metadata, not permission to bind a public listener.
3. Standalone mode can use an unencrypted local vault master key. The product should clearly mark this deployment mode and recommend OS-sealed Electron or an external secret manager for long-lived refresh tokens.
4. User plugin entrypoints are loaded into the gateway process. Manifest `permissions` are valuable review metadata, but the current loader does not constitute a general sandbox for arbitrary JavaScript. Third-party plugins must be treated as trusted code and given a separate trust/install confirmation.
5. `mcp-preset-service` builds concrete MCP config from credential placeholders. Secret values must stay in the secure-input/vault path and never be returned in logs, tool descriptions, chat, or persisted MCP JSON.
6. The OAuth callback success page should disclose the service, account, granted capabilities, and “return to Prometheus”; it should not expose tokens or sensitive account details.

## Permissions and tool exposure model

The current model is directionally correct and should become part of the connection contract:

- `src/connections/types.ts` defines read-only, write, financial mutation, destructive, credential/security, and unknown risks.
- `src/connections/tool-classifier.ts` combines trusted annotations, plugin classifiers, and conservative heuristics. Highest risk wins; unknown defaults to blocked/review.
- `src/gateway/tool-capabilities.ts` separately classifies local write, external write, destructive, credential use, command, and connector tools.
- `docs/UNIVERSAL_PLUGIN_CONNECTIONS.md:32-36` states that verified read-only MCP tools may be exposed automatically; write, financial, destructive, credential/security, and unknown tools remain blocked until review.
- Existing bundled connector tools already reflect this split: read/report/search tools are mostly read-only; send/post/create/update/deploy/env/writeback tools are external writes or higher risk.

Recommended permission shape:

1. **Authentication consent:** what the provider can give Prometheus, expressed in provider scopes.
2. **Capability consent:** what Prometheus may use, expressed in product language: “read mail,” “draft mail,” “send mail,” “read workspace,” “post messages,” “manage deployments.”
3. **Execution policy:** automatic read-only exposure, approval-required writes, blocked destructive/financial/credential tools.
4. **Resource scope:** account, workspace, repository, portal, team, property, project, vault, database, or MCP server.

The connection card should never say only “connected.” It should show account identity, resource scope, granted capabilities, exposed tool count, last verification, token health, and the actions that remain blocked pending approval.

## Recommended plugin page and account-management design

### Plugin catalog card

Each card should have one primary action based on the best available strategy:

- `Connect with Google`, `Connect with GitHub`, `Connect with Slack`, etc. for provider-owned OAuth.
- `Use your own app` for client ID/secret entry.
- `Add API key` for key-based providers.
- `Sign in in browser` for browser-session integrations.
- `Choose local folder` / `Choose local vault` for local resources.
- `Configure MCP` for custom/local MCP; `Connect` for standards-based MCP OAuth.

The secondary copy should state the identity/resource and access level before opening the browser. “Install” should mean load the extension; “Connect” should mean authorize/configure an account; “Enable tools” should mean expose a selected capability set. These are separate states.

### Connection detail page

Use a provider-neutral detail view with:

- account/workspace/org identity;
- status: connected, needs reauthorization, degraded, blocked by admin, or disconnected;
- granted provider scopes translated to plain language;
- Prometheus capability toggles;
- exposed/read-only/approval-required/blocked tool counts;
- resource selectors such as Slack workspace, GitHub org/repo, Salesforce org, HubSpot portal, Google property, Vercel team/project;
- last verification and next health check;
- `Reauthorize`, `Manage access`, `Use your own app`, `Disconnect`, and provider revocation link.

### Advanced paths

Advanced mode should retain the current functionality but make its tradeoff explicit:

- custom OAuth app credentials;
- API key / bearer token / setup token;
- browser-session login;
- local bridge or filesystem;
- MCP URL, transport, command, headers, env, and package approval;
- developer plugin install and trust review.

Do not hide these paths; hide them behind an “Advanced setup” disclosure so the normal path stays consumer-simple without making developer workflows impossible.

## Migration path from existing connections

1. **Read existing state:** inspect vault tokens/client credentials, `connections.json`, browser-session registry, Obsidian bridge state, and `mcp-servers.json` without emitting secret values.
2. **Project identities:** create or update canonical connection records with provider/account/resource identity, auth state, opaque credential reference, known scopes, and current exposure/verification state.
3. **Preserve sessions:** if a valid legacy refresh token exists, mark the account connected and offer “Manage access”; do not force reauthorization merely because the record moved to `connections-v2.json`.
4. **Split capability grants:** infer only safe read-only grants from existing state. Treat send/post/create/update/deploy/writeback as not granted until the user confirms the new capability card.
5. **Migrate client credentials:** keep user-owned provider app credentials under the advanced account record, but prefer Prometheus-owned app credentials for new connections. Never migrate raw secrets into the canonical record.
6. **Handle ambiguous state:** if legacy `connections.json` says connected but token health cannot be verified, show “Needs verification,” not connected.
7. **Retire legacy writes:** after each connector is migrated, make the v2 orchestrator the writer, keep legacy reads for one compatibility window, then remove duplicate status projections.
8. **Provide rollback:** keep a versioned migration marker and do not delete legacy entries until the new record has passed a real provider/tool health check.

## Prioritized implementation plan

### Phase 0 — contract and inventory (no user-facing behavior change)

- Add a provider-app registry and capability vocabulary to the extension/connection design.
- Add explicit `connection` blocks to the seven first-wave connector manifests.
- Define account identity/resource selectors, scope-to-capability mappings, revocation semantics, and health checks.
- Add tests that assert no raw secret appears in connection records, MCP config, logs, or tool output.
- Document plugin trust: manifest permissions are review metadata; in-process entrypoints are trusted code.

### Phase 1 — host OAuth and account primitives

- Make one host OAuth adapter support public PKCE, confidential code exchange, device code where needed, and provider-specific callback requirements.
- Centralize state/PKCE/loopback callback handling and external-browser launch.
- Add account identity, scopes, capability grants, expiry, refresh, revoke, and reauth to the canonical record.
- Add callback collision protection and a per-attempt flow nonce.
- Make disconnect call provider revocation where available and report partial revocation honestly.

### Phase 2 — first-wave consumer connections

Recommended order: Gmail → Google Drive → GA4 → GitHub → Notion → Slack → HubSpot.

- Register Prometheus-owned apps and complete provider review/verification.
- Use least-privilege read-only defaults.
- Keep send/post/create/update as opt-in capability grants and approval-required tools.
- Route `ConnectionsPage` through attempt cards and canonical status while retaining “Use your own app” for developers.

### Phase 3 — hard or account-specific providers

- Salesforce and Reddit after first-wave patterns are stable.
- X after verifying current product tiers, billing, endpoint availability, exact callback, and scope approval.
- Vercel after deciding whether Prometheus is an OAuth integration/platform rather than a personal API client.
- TikTok, LinkedIn, and Instagram only after product-specific app review and account-type testing.

### Phase 4 — compatibility retirement and ecosystem

- Convert remaining built-in connectors to native connection strategies.
- Keep legacy routes read-only for a deprecation period, then remove duplicate status and credential writers.
- Add provider conformance tests and a plugin certification checklist.
- Add explicit marketplace metadata for OAuth ownership, privacy policy, data retention, scope review, and revocation.

## Risks, costs, and edge cases

| Risk | Impact | Mitigation |
|---|---|---|
| Provider app verification/review | Delays launch, especially Google restricted scopes and Meta/LinkedIn/TikTok products | Ship read-only scopes first; maintain own-app fallback; track app-review status in provider registry. |
| Desktop client-secret exposure | Secret cannot be treated as confidential in a distributed Electron binary | Prefer PKCE/public clients; keep confidential exchange server-side when required; never ship a provider secret in the app bundle. |
| Local callback hijacking/collision | Account takeover or failed connections | Loopback-only listener, random state/PKCE, exact path/port validation, one-shot listener, short timeout. |
| Gateway exposed on LAN | Token and account control plane exposure | Require gateway/pairing auth for remote clients; do not accept local callback credentials from remote origins. |
| Refresh-token revocation/rotation | “Connected” account stops working | Proactive refresh, one retry, then `reauth_required`; retain resource/capability choices. |
| Admin-managed SaaS workspaces | User can sign in but cannot grant the requested scope | Distinguish provider denial, workspace admin denial, and missing Prometheus scope approval. |
| Multi-account ambiguity | Wrong Gmail, workspace, org, or team used | Show identity/resource selector and require explicit default account. |
| Scope drift | Provider changes scopes or token grants | Compare granted scopes to requested capabilities at every verification; downgrade exposure on mismatch. |
| Dangerous MCP tools | OAuth success could expose financial or destructive tools | Keep classifier fail-closed; read-only automatic exposure only; review high-risk tools separately. |
| Plugin code trust | Third-party entrypoint runs in gateway process | Install/trust review, signed marketplace metadata, permissions display, future sandbox/capability isolation. |
| Legacy state false positives | UI says connected while tools are unusable | Separate configured/authenticated/registered/exposed/verified, as already modeled by the canonical record. |
| Provider API billing and limits | OAuth authorization does not mean the API is usable | Verify entitlement, billing, quota, account type, and endpoint access after authorization. |
| Data retention/privacy | OAuth access may expose large private datasets | Minimize scopes, avoid unnecessary indexing, expose retention controls, and provide provider/privacy links. |

## Recommended decision matrix

| Priority | Candidates | Why |
|---|---|---|
| P0 | OpenAI Codex, Robinhood MCP | Already demonstrate the target OAuth/PKCE or MCP OAuth architecture. |
| P1 | Gmail, Google Drive, GA4 | High user value, mature OAuth, shared Google app, but verification/restricted-scope work must be planned. |
| P1 | GitHub, Notion, Slack, HubSpot | Strong OAuth support and clear account/workspace identity; good capability-based permission surfaces. |
| P2 | Salesforce, Reddit, X | Valuable but more complex enterprise, scope, billing, or product-policy edge cases. |
| P3 | Vercel, TikTok, LinkedIn, Instagram | OAuth exists in relevant products but requires product-specific app/review/account validation. |
| Keep advanced | Stripe API key, Anthropic setup token, all API-key providers, Obsidian, local MCP, custom MCP | The credential or local model is currently the honest and lowest-risk path. |

## Evidence index

Primary workspace evidence:

- `docs/UNIVERSAL_PLUGIN_CONNECTIONS.md:3-36` — intended host-owned lifecycle, secure input, migration, MCP policy, Robinhood example.
- `workspace/self/10-mcp-and-connections.md:3-36,142-216,244-257` — MCP manager, presets, connector registry, legacy routes, X separation, Obsidian bridge.
- `workspace/self/feature-index/18-settings-plugins-connectors.md:44-70,151-227,312-353` — user-facing surfaces, state distinctions, lifecycle, MCP configuration/OAuth.
- `src/extensions/schema.ts:49-163` — manifest setup, scopes, callbacks, MCP, permissions, and connection schema.
- `src/extensions/loader.ts:30-64` and `src/extensions/install-service.ts:29-156` — user-plugin directory, installation, reload, and in-process entrypoint implications.
- `src/connections/orchestrator.ts:53-170`, `src/connections/plugin-plan-resolver.ts`, `src/connections/connection-store.ts`, `src/connections/legacy-migration.ts` — v2 lifecycle, strategy resolution, durable records, and compatibility migration.
- `src/gateway/mcp-oauth.ts:2-15,71-104,308-387` — remote MCP discovery, dynamic registration, PKCE, loopback callback, vault tokens, refresh, and clear.
- `src/integrations/oauth-base.ts` and `src/integrations/connector-registry.ts` — legacy connector OAuth client-credential model, token refresh, and connector list.
- `src/gateway/routes/connections.router.ts:317-582` and `src/gateway/routes/connections-v2.router.ts:6-87` — parallel legacy/v2 APIs.
- `web-ui/src/pages/ConnectionsPage.js` and `web-ui/src/pages/SettingsPage.js` — current connector/provider UX split.
- `src/security/vault.ts:2-26,180-220`, `electron/main.js`, `electron/preload.js`, `src/gateway/gateway-auth.ts`, `README-DESKTOP.md` — storage, Electron, gateway, and browser boundary.

Provider references used for feasibility checks:

- [Google OAuth for installed applications](https://developers.google.com/identity/protocols/oauth2/native-app) and [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).
- [Google Drive authorization and restricted scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- [GitHub OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) and [OAuth app creation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
- [Slack OAuth v2](https://api.slack.com/authentication/oauth-v2) and [Slack token rotation](https://api.slack.com/authentication/rotation).
- [HubSpot OAuth quickstart](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide).
- [Notion public connections](https://developers.notion.com/guides/get-started/public-connections) and [Notion authorization](https://developers.notion.com/guides/get-started/authorization).
- [Salesforce external-browser OAuth flow](https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-useragent-flow.html).
- [TikTok Login Kit](https://developers.tiktok.com/doc/login-kit-overview).
- [LinkedIn authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow) and [native-app guidance](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow-native).
- [X OAuth 2.0 PKCE user access](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token), [X OAuth scopes and callback requirements](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), and [X access setup](https://docs.x.com/x-api/getting-started/getting-access).
- [Stripe Connect OAuth reference](https://docs.stripe.com/connect/oauth-reference) and [Stripe Standard-account OAuth guidance](https://docs.stripe.com/connect/oauth-standard-accounts).
- [Vercel authorization server](https://vercel.com/docs/sign-in-with-vercel/authorization-server-api) and [Vercel REST API integrations](https://vercel.com/docs/integrations/create-integration/vercel-api-integrations).

## Final recommendation

Adopt an OAuth-first product direction, but implement it as a migration to the existing host-owned connection plane. The platform is already capable of the desired “Install → Sign in → Allow → Connected” experience for a meaningful subset of integrations; the main missing work is provider app ownership/approval, manifest strategy coverage, capability-aware UX, and retiring legacy credential-first writes. Keep API keys and manual/local/MCP paths visible as advanced, intentional connection types rather than treating them as failures of the OAuth design.

## Implementation audit update — 2026-08-09

The incremental implementation followed this recommendation. The native
connection-v2 adapter and bridge now cover GitHub, Gmail, Google Drive, GA4,
Notion, Slack, HubSpot, Salesforce, and Reddit. They share the existing OAuth
connector classes and vault rather than introducing a second browser credential
store. Their manifests now carry exact callback, provider-app, scope, capability,
verification, and unknown-tool policy metadata. The managed card is available in
Plugins, but every one of these providers still needs a deployment-owned app or
provider registration; the repository contains no client secret and no live
provider app was registered.

The contract is deliberately conservative: read-only scopes and tools are the
default; send/post/create/update/deploy/delete, financial, and credential-sensitive
capabilities are explicit approval-gated or blocked; account identity and
resource/workspace/org/property scope are recorded; unknown tools fail closed.
Legacy vault tokens and connected sessions remain usable and are not forced
through reauthorization solely because a v2 record is available. Migration
records include a version marker, source, timestamp, and rollback support.

The standards-based remote MCP path remains configuration-first but is now
documented as a separate compatible case: protected-resource/auth-server
discovery, dynamic registration, PKCE/state, loopback callback, refresh, optional
RFC 7009 revocation, vault clear, and conservative tool discovery are centralized
in `src/gateway/mcp-oauth.ts` and `src/connections/adapters/mcp-oauth.ts`.

The remaining matrix is intentionally unchanged where OAuth would be unsafe or
misleading: X has an existing but separate X API/xurl OAuth product and still
needs shared account/resource migration; Instagram, TikTok, and LinkedIn remain
browser-session/product-review paths; Vercel remains token/API-key-first; Stripe
remains API-key-first because Stripe Connect OAuth authorizes connected Standard
accounts rather than the current merchant-key semantics; Obsidian remains local.
The Plugins page exposes these as explicit Advanced or provider-specific paths,
not as failed OAuth cards.

The new implementation evidence is in
`docs/P9-OAUTH-FIRST-PLUGIN-PLATFORM-IMPLEMENTATION-2026-08-08.md` under the
2026-08-09 follow-up section. Provider-app registration, consent-screen/provider
review, tenant/admin approval, production callback deployment, rate-limit or
billing enablement, and live credential verification remain external work.
