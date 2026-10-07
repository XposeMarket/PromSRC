# 12 — Connectors & MCP Integrations

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/extensions/`, `src/integrations/connectors/`, `src/connections/`, `src/gateway/`
> **Read this when:** Adding, troubleshooting, or exposing a native connector, OAuth/browser-session connection, MCP server, imported plugin, or provider integration.

## TL;DR
- Connectors are runtime-loaded extensions: a manifest describes an extension; a runtime registers connector state and tools; the connection layer chooses an adapter and persists/validates connection state.
- Start with `connector_list` for discovered connectors and tool availability, `connection_ops` for normal service setup, and generated inventories for complete tool/manifests lists.
- `mcp_server_manage` is advanced MCP administration/debugging. Use `connection_ops` first for normal MCP setup because it preserves discovery, durable attempts/cards, secure input, and verification.
- Bundled MCP presets and LLM-provider manifests are different extension kinds: a preset helps configure an MCP server; provider manifests describe built-in model-provider settings/fields.
- Native connectors with an API escape hatch register `<connector>_api_request`. It reuses authenticated connection state, accepts a constrained relative path, and routes non-GET/HEAD methods through ordinary external-write approval.
- Do not let a request choose its host. Host/base URL belongs to the connector specification; credential and redirect handling must not weaken this boundary.
- The generated inventory currently marks GitHub/Gmail/Drive account rows as gaps, but these are skill-bundle/alias manifests, not missing native connector runtimes. The actual native connectors expose API request tools.
- The four actual connector runtimes lacking the escape hatch are Instagram, LinkedIn, Obsidian, and TikTok. Treat these as true coverage gaps pending their API/auth design, not as inventory aliases.
- MCP tools are dynamic (`mcp__serverId__toolName`); inspect a trusted server's advertised tools before use. Provider/MCP manifests are not a list of native connector tools.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Extension discovery/runtime | `src/extensions/registry.ts` → bundled extension discovery; `src/extensions/runtime-loader.ts` → runtime loading | Sources bundled, user-installed, and imported extensions. |
| Connector contracts | `src/extensions/runtime-api.ts` → `PrometheusExtensionApi`; `src/extensions/runtime-registry.ts` | Tool/connector registration and lifecycle boundary. |
| Bundled connector manifests | `src/extensions/bundled/connectors/<id>/prometheus.extension.json` | Identity, capabilities, tool exposure and OAuth metadata. |
| Bundled connector runtimes | `src/extensions/bundled/connectors/<id>/runtime.ts` | Registers tools/connection state and often the provider client. |
| Shared API escape hatch | `src/extensions/bundled/connectors/_runtime/api-request.ts` → `registerConnectorApiRequestTool()` | Fixed HTTPS base(s), relative-only paths, bounds, standard write gate. |
| Connection orchestration | `src/connections/runtime.ts`; `src/connections/connection-ops-summary.ts` | Attempts, status, resolution, availability and verification summaries. |
| Adapter lookup | `src/connections/adapter-registry.ts` | Selects native connector OAuth, browser session or MCP adapter. |
| OAuth adapter | `src/connections/adapters/connector-oauth.ts`; `src/connections/connector-oauth-bridges.ts` | OAuth lifecycle/bridges to native connectors. |
| Browser-session adapter | `src/connections/adapters/browser-session.ts` | Web-login-backed integrations; not a provider API client. |
| MCP preset mapping | `src/extensions/mcp-preset-service.ts` → `buildMcpServerConfigFromPreset()` | Translates a selected preset and supplied secrets into MCP server configuration. |
| MCP setup tools | `src/gateway/tools/defs/cis-system.ts` → `connection_ops`, `mcp_server_manage` | Prefer setup orchestrator; advanced control plane remains available. |
| Connector discovery | `src/gateway/tool-builder.ts` → `connector_list` | Runtime-derived discovery; no provider allowlist. |
| X unified wrappers | `src/gateway/tool-builder.ts` → `x_search_ops`, `x_posts`; native `x_api_request` | Wrapper routes to real connector handlers/policy. |
| Vercel wrapper | `src/gateway/tool-builder.ts` → `vercel_ops`; native Vercel runtime | Convenience action routing, not a replacement for connector capability/policy. |
| Plugin import | `src/extensions/plugin-import/import-service.ts`, `formats.ts`, `plugin-ops.ts` | Imports/normalizes supported packages; then runtime/manifest validation applies. |
| Canonical inventories | [`generated/connectors.md`](generated/connectors.md), [`generated/tools.md`](generated/tools.md) | Generated; use these for the current catalog instead of hand-maintaining lists. |

## How it works

### Native extension path
1. Discovery reads extension manifests and identifies bundled/user-installed integrations. `src/extensions/registry.ts` owns discovery; `runtime-loader.ts` loads enabled runtimes.
2. A connector manifest declares stable ID, display/capability metadata and tool names. Runtime code implements connection behavior and registers tools through the extension API.
3. `src/connections/adapter-registry.ts` resolves the connection strategy. OAuth adapters bind a provider account; browser-session adapters rely on the in-app browser state; MCP adapters start/configure a server.
4. `connection_ops` resolves a natural service, plans/reuses an attempt, connects or resumes user-assisted auth, then verifies readiness. Do not report success based only on an attempted login: `verify` is the readiness check.
5. `connector_list` queries discovered registrations and their connected status/tool surface. A skill bundle that mentions a service is not proof that an independent connector runtime exists.
6. Tool exposure is a separate concern from having a manifest. `connection_ops` can inspect/change available names; normal write actions retain their approval policy.

### MCP setup and dynamic tools
- Use `connection_ops(discover)` to resolve a service first, then `plan`/`connect`/`continue`/`verify` as indicated by its returned durable attempt. Secrets go through secure input; never send credentials in ordinary chat arguments.
- For routine MCP setup, let the orchestrator preserve identity resolution, approvals, resumable user input, and verification. Use `mcp_server_manage` for advanced administration/debug only.
- Presets live under `src/extensions/bundled/mcp_presets/`; provider manifests live under `src/extensions/bundled/providers/`. Neither is itself a native connector runtime. Inspect the manifest and preset builder before extending either.
- Once connected, MCP server tools are namespaced `mcp__serverId__toolName`. List tools from the connected/trusted server and use only tools/capabilities the user intended to expose.
- `src/extensions/mcp-preset-service.ts` contains preset-to-server mapping; actual process/transport lifecycle is owned by the connection/MCP runtime. Never hard-code credentials into preset manifests.

### API escape hatch contract
- `_runtime/api-request.ts` creates a tool named `connector_<id>_api_request`; the provider client must already be connected. It fetches the live authenticated connector and obtains its valid token, preserving refresh behavior.
- Parameters select a method, provider-relative path, optional body, and (only for multiple fixed bases) a named API base. Callers cannot provide a URL/host.
- Current helper methods are GET, HEAD, POST, PUT, PATCH, DELETE. Paths must begin with a single `/`; scheme, host, whitespace, control characters, backslash, `@`, traversal segments, and overlong paths are rejected. Body/result sizes are bounded.
- Redirects are manual. The Authorization header is composed by the runtime; do not log or return credentials. A provider-specific extra base must still be fixed, HTTPS, and explicit in the connector spec.
- GET/HEAD are classified read-only. Other methods use normal external-write approval; an absent method fails conservatively as a write in connector regression coverage. Do not add a second “approval bypass” inside an API tool.
- Add provider-specific examples and a coverage hint so the model knows what this endpoint unlocks beyond first-class tools. Prefer first-class operations for common, strongly typed actions; keep raw requests the bounded escape hatch.

### Adding a connector safely
1. Identify the auth/API contract and capability surface. Decide whether the integration is a native API connector, browser-session connector, MCP preset, or provider manifest; do not conflate them.
2. Add a unique bundled extension directory and valid `prometheus.extension.json` with ID, capabilities, tool names, connection metadata and only supported auth declarations.
3. Implement the runtime and provider client in that extension. Register explicit first-class operations and connection state. Add `<connector>_api_request` using the shared helper when a native API/token model supports it.
4. Register/select the appropriate adapter in the connection setup model. Ensure credential collection stays in secure auth/input handling (OAuth/browser/login cards as appropriate), not model-visible secrets.
5. Mark writes accurately with tool capability metadata; test missing method, GET, and write calls. The global approval gate must be the authority for writes.
6. Add regression tests for manifest/runtime agreement, token refresh, disconnection, path validation/host-locking and API failure cases. Update generated inventory only by running its generator in the authorized source workflow.
7. Check `connector_list` and a connected-account flow at runtime. Confirm each declared tool is actually registered and exposed; a manifest-only row is not sufficient.


### Plugins page contract (desktop + mobile)
- **More → Plugins** is **connector-only**. It's built from `GET /api/extensions/catalog?kind=connector` (`web-ui/src/pages/ConnectionsPage.js`, mobile `web-ui/src/mobile/mobile-plugins-page.js`) and never lists model providers, credentials or voice providers; those stay in Settings. Names are sorted deterministically, and loading/empty/error/stale-catalog/no-search-match states render in the page itself.
- **OAuth connector audit (2026-08-11, still accurate at a48712ccc):** provider OAuth client secrets are not bundled. "Connect" is a direct click-through only when the provider app client ID (and secret where needed) already exists in the deployment env or the vault. Otherwise the attempt fails with provider-app-not-configured and **Advanced: Use your own OAuth App** is the setup path. Even configured deployments show a capability-grant approval before the provider window.
- **Vercel and Stripe are not OAuth** connectors; they use API keys (Vercel takes a token plus optional project/team IDs). Instagram, LinkedIn and TikTok use browser-session login plus Verify; PR #570 adds separately stored API tokens for their `api_request`. Obsidian is a local vault bridge.
- `scripts/test-plugins-page-contract.mjs` asserts these phrases exist in this doc. If you reword them, update the test.

## Config & knobs
- Connector account tokens are owned by each connector/OAuth adapter and the configured vault; use the connector's settings/setup path rather than reading vault values into prompts.
- MCP server configuration is mediated by connection/MCP administration. Preset manifests map known server transport fields; custom servers need explicit transport/command/args/env configuration and trusted ownership.
- `connection_ops` actions include discovery, planning, connect/continue/verify, repair/status/cancel/disconnect/list, and tool/exposure controls. Use the tool schema for current fields rather than inventing arguments.
- `<connector>_api_request` supports a connector-defined default base and optionally a connector-defined named base. The server determines the API host.
- `x_search_ops` and `x_posts` are convenience wrappers; write actions still dispatch through the X connector and its established policy.
- Provider manifests under `src/extensions/bundled/providers/` are not credentials. Secret keys are stored via provider/config settings, not committed in manifests.

## Gotchas / sharp edges
- **Inventory alias rows:** `generated/connectors.md` has eight “❌ GAP” occurrences: seven connector rows plus the explanatory rule. `connector-github`, `connector-gmail`, and `connector-google-drive` point to `skill/skill.json` bundles, not a separate runtime. Actual native IDs are `github`, `gmail`, `google_drive`; their runtime/manifests include API request tools. Do not file three false connector bugs from these aliases.
- **True API-request gaps (verified at `a48712ccc`):** `instagram`, `linkedin`, `obsidian`, `tiktok` have native manifest/runtime but no `<id>_api_request`. Instagram/LinkedIn/TikTok currently use browser-session integration rather than an API-token runtime; design the right provider/auth/approval surface before adding an escape hatch. Obsidian is a real local-vault connector with status/connect/sync/writeback but no raw API tool. Count is four actual native-runtime gaps. Full capability completeness beyond this missing escape hatch is UNVERIFIED.
- **Naming mismatch:** the inventory uses `connector_<id>_api_request` for most but X uses `x_api_request` and Drive's tool prefix is `gdrive`; verify runtime registrations and manifest allowlists, not spelling assumptions.
- **Native runtime vs imported/plugin bundle:** a `SKILL.md` that says to call a connector does not install its extension or create an authenticated client. Check `connector_list` and the manifest/runtime directory.
- **Provider-mapped manifests:** test after reconnect/update as manifest tool names and stored tool snapshots can drift; the connection layer reconciles snapshots to current manifest capabilities.
- **MCP trust boundary:** a server can expose arbitrary tools/side effects. Verify server identity, transport and scopes, expose only intended tools, and retain approval for writes.
- **Raw request host lock:** never accept `url`, `host`, or a freeform base from tool args; keep relative-only path validation and the manual redirect behavior.
- **User-visible readiness:** OAuth completion or server process start is not verification. Run `connection_ops(verify)` and check discovered tools/status before claiming connection is ready.
- **Potential docs/inventory drift:** generated inventories reflect their generation commit/time. Re-run the inventory generator only in a sanctioned PR/worktree after source changes; never hand-edit generated tables.

## How to change it safely
- Read the targeted regression files beside the change and search [`generated/tests.md`](generated/tests.md) for connector, MCP, plugin-import, or capability tests.
- Relevant source-owned checks include `_runtime/api-request.regression.ts`, `github/runtime.regression.ts`, `vercel/runtime.regression.ts`, `plugin-import/plugin-import.regression.ts`, and extension/connection regressions. Confirm the exact runnable command from `package.json`/test inventory in the PR worktree.
- Test both manifest/runtime agreement and runtime behavior. Include one connected read, one approval-gated write, an invalid/traversal path, and disconnected-client behavior for an API connector.
- For OAuth, test account selection/callback/cancellation and secure credential storage; for browser-session, test login resume in the in-app profile; for MCP, test configure, launch, list-tools, status and disconnect.
- Build/check in an isolated PR worktree, not the dirty live source checkout. Inspect only your changed paths before committing; do not clean other work.
- At runtime, verify `connector_list`, tool exposure, connection status, and that write confirmation still fires. Update [`generated/connectors.md`](generated/connectors.md) through its generator after changing source.

## Related
[05 Tools & categories](05-tools-and-categories.md) · [13 Browser & desktop](13-browser-desktop.md) · [20 Skills runtime](20-skills-runtime.md) · [21 Security & approvals](21-security-approvals-permissions.md) · [`generated/connectors.md`](generated/connectors.md) · [`generated/tools.md`](generated/tools.md) · [`generated/tests.md`](generated/tests.md)


## Operational checklists

### Quick triage: “connector missing”
- Call `connector_list`; record the exact runtime ID, connection state, and exposed tools.
- Open the manifest path reported by [`generated/connectors.md`](generated/connectors.md). Check whether it is a `skill/skill.json`, `prometheus.extension.json`, MCP preset, or provider manifest before describing it as a connector.
- For a native extension, inspect the exact ID directory for both `prometheus.extension.json` and `runtime.ts`, then inspect registration names and the current availability/exposure settings.
- If the account is disconnected, use `connection_ops(status|plan|continue|verify)` rather than trying the tool repeatedly with stale credentials.
- If the extension is installed but the tool is missing, compare manifest tool names to runtime registration and the connection's saved tool snapshot. Reconcile/reconnect; do not manually fabricate a tool schema.

### Add an API operation and escape hatch
1. Identify fixed API origin(s), auth token lifecycle, base path, allowed redirects, request body formats, response bounds, and rate-limit behavior from the actual provider contract.
2. Implement common, stable user workflows as strongly typed tools. Their names/description should make read vs write behavior obvious.
3. Register the API escape hatch via `registerConnectorApiRequestTool()` with a fixed host, credential provider, safe default method, examples/capability guide, and response sanitization.
4. Review every optional host/base mapping. The tool argument may choose only among enumerated fixed server-side bases; it must not invent a host or URL.
5. Ensure GET/HEAD are the only implicitly read-only methods; classify POST/PUT/PATCH/DELETE and unknown/missing methods as writes that pass through standard policy.
6. Test redirects crossing origin, encoded path traversal, repeated slashes, absolute URLs, oversized body and oversized response. Reject unsafe redirects and paths instead of “fixing” them permissively.
7. Verify logs, errors and response summaries never contain bearer tokens, OAuth refresh material, or secure setup input.

### OAuth vs browser-session vs MCP decision
| Need | Use | Avoid |
|---|---|---|
| Provider's supported API with account-scoped OAuth | Native OAuth adapter + API connector runtime | Scraping account cookies to replace supported OAuth |
| Web product with no useful public API but a supported user session | Browser-session adapter and in-app browser | Calling it a full API connector or accepting credentials in chat |
| Existing service exposes a user-trusted MCP server | MCP connection adapter/preset and namespaced tools | Treating MCP preset metadata as a runtime or blindly exposing every tool |
| New model provider configuration | Provider extension manifest/settings | Registering it as a user data connector without an account client |

### PR review checklist
- [ ] Manifest ID is unique and matches runtime registration/connector ID.
- [ ] User-facing name, auth method, capabilities and declared tools match actual behavior.
- [ ] Token is scoped, stored in the vault and refreshed/revoked correctly; secret values never enter chat logs.
- [ ] Tool exposure is least-privilege and tool descriptions match their real side effects.
- [ ] All remote writes remain approval-gated, including arbitrary `api_request` methods.
- [ ] API base is fixed, TLS-only, paths constrained, redirects checked and responses bounded.
- [ ] `connector_list` shows expected runtime status after setup; `connection_ops(verify)` checks a live authenticated operation.
- [ ] Disconnect/revoke clears effective credentials and stale cached tools; reconnect reconciles against the newest manifest.
- [ ] Focused regressions pass and generated connector inventory is regenerated in the source PR after the feature lands.

## Source landmarks and lineage
- `src/extensions/bundled/connectors/_runtime/connector-helpers.ts` contains shared connector support helpers; read its current public API before duplicating token/client logic.
- `src/extensions/bundled/connectors/_runtime/api-request.regression.ts` is the central shared-helper test target for path, host, method and transport invariants.
- The API escape hatch landed as shared infrastructure for Gmail, HubSpot, Notion, Reddit, Salesforce, Slack, Stripe and GA4; the GitHub connector later added raw request support and synced manifest allowlists. Changelog entries are in [`generated/changelog.md`](generated/changelog.md).
- `src/extensions/bundled/connectors/x/x-api-tools.ts` and `x-api-client.ts` own X's differently named API request implementation; wrappers in `tool-builder.ts` dispatch into those native operations.
- The Vercel extension owns its wider project/deployment/API request operations. `vercel_ops` is a unified routing wrapper, not a standalone authenticated runtime.
- Plugin import should not be used as an alternate, unchecked execution path. Imported manifest/hooks still pass extension trust, validation, permission and lifecycle checks.
- Browser-session connectors sit at the intersection of [13 Browser, desktop & media assets](13-browser-desktop.md) and connection adapters. Use the in-app login handoff and verify the resulting browser-backed connection.


## Operational ownership
- A connector runtime owns provider API requests and its auth-aware tool handler; connection orchestration owns setup/attempt state; the global tool/policy layer owns approvals. Keep these roles separate when debugging a failure.
- For an API 401, first verify the intended account and token refresh path; do not ask for a raw token or disable host/path checks. For an MCP tool failure, inspect server health and advertised schema independently of native connector state.
- A failed call may mean unavailable capability or unconnected account, not an absent implementation. Confirm with manifest, runtime, `connector_list`, and current exposure before editing.
- New tools added to a manifest may require reloading/reconciling a stored connection snapshot. After rollout, verify a new tool becomes visible without granting unrelated scopes.
- Extension import supports several manifest/package shapes. Check `src/extensions/plugin-import/formats.ts` for accepted input formats, `import-service.ts` for normalization, and `plugin-ops.ts` for management actions before designing a new import route.
- Keep external API calls idempotent where possible; document method, path and response shape in the connector tool description. Do not automatically retry a non-idempotent write after an uncertain timeout.
- When a write result is ambiguous, check remote state before retrying. The approval gate answers “may this write run?” but cannot guarantee a provider did not process a timed-out request.
- For social connectors that authenticate through browser session, prefer visible, user-assisted account steps and ordinary post-action confirmation; never disguise a browser-session action as an API scope/token capability.

- Source-based gap classification is narrower than the generated table: inventory “❌ GAP” marks seven rows, three of which are skill-bundle entries and therefore not native runtime connectors. Among the actual listed native connector manifests, Instagram, LinkedIn, Obsidian and TikTok lack the raw API tool. Verify full feature completeness separately; an API-request escape hatch alone does not prove every provider capability is covered.

- **Inventory rule needs attention:** the bottom of `generated/connectors.md` quotes Raul's 2026-09-28 rule that every connector must expose full capability plus an approval-gated raw API tool and says any ❌ GAP is a fix-PR, not a question. The three GitHub/Gmail/Drive rows are false-positive *native connector rows* because they index skills, but the three capabilities still exist as separate native runtimes; four genuine native runtimes remain without any raw API tool. Don't silently discard the user's coverage rule: treat the inventory schema/aliases as needing correction and evaluate the four real gaps against the owner's requirement.
