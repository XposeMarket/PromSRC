# P9 implementation handoff — OAuth-first connector pilot

Date: 2026-08-08

This is the implementation addendum to
`docs/P9-OAUTH-FIRST-PLUGIN-PLATFORM-INVESTIGATION-2026-08-08.md`. It records
the additive slice that is actually present in the worktree. It does not claim
that every connector is OAuth-ready.

## Delivered

GitHub is the only bundled connector migrated end-to-end in this slice. The
Plugins page now starts a host-owned connection attempt, requires approval of
the requested read-only capabilities, opens the existing vault-backed GitHub
OAuth flow with PKCE, records safe account/resource/scope/capability metadata,
verifies the provider identity, and supports repair and disconnect. Disconnect
attempts GitHub OAuth App revocation and always clears the local vault session.

All other current connectors — Gmail, Google Drive, GA4, Notion, Slack,
HubSpot, Salesforce, Reddit, Stripe, plus X, Instagram, LinkedIn, TikTok,
Vercel, and Obsidian — retain their existing legacy, API-key, browser-session,
local, or manual paths. Remote MCP OAuth and stdio/manual flows retain their
existing v2 adapters. They are not represented as completed consumer OAuth
migrations by this change.

## File-path evidence

- `src/connections/types.ts` adds the additive contract marker, account/resource
  identity, capability-grant, provider-app, and migration-marker types.
- `src/connections/connector-contract.ts` normalizes non-secret identities,
  classifies connector tools, and makes read-only capability grants explicit.
- `src/connections/adapters/connector-oauth.ts` is the shared host adapter for
  provider OAuth lifecycle, account continuity, provider verification, remote
  revoke, and local clear.
- `src/connections/runtime.ts` registers the GitHub bridge without replacing
  the native `GitHubConnector`.
- `src/connections/orchestrator.ts`, `connection-store.ts`,
  `legacy-migration.ts`, and `schema.ts` preserve legacy reads, add v2/rollback
  markers, sort latest records deterministically, reject account switches, and
  validate safe canonical metadata.
- `src/extensions/schema.ts`, `src/extensions/types.ts`, and
  `src/connections/plugin-plan-resolver.ts` carry provider-app, callback,
  PKCE, revocation, scope, capability, and registered-tool contracts from the
  manifest into the plan.
- `src/extensions/bundled/connectors/github/prometheus.extension.json` declares
  the GitHub `connector-oauth` strategy, exact callback, provider-app env
  boundary, capabilities, verification, and fail-closed tool policy.
- `src/integrations/oauth-base.ts`, `connector-registry.ts`, and
  `connectors/github.ts` centralize credential readiness, PKCE/state, loopback
  callback collision handling, token refresh metadata, account continuity,
  HTML/error escaping, and GitHub OAuth App revoke. No client secret is in the
  repository or Electron bundle.
- `src/extensions/catalog-service.ts` projects canonical account, resource,
  capability, tool, scope, provider-app, verification, and live token-health
  state into connector cards without exposing `credentialRef`.
- `web-ui/src/pages/ConnectionsPage.js` adds the managed GitHub flow and keeps
  Advanced: Use your own OAuth App, API-key, browser, local, and MCP flows
  intact. `web-ui/src/styles/pages.css` renders identity, grant, scope, and
  tool-health details. The generated copy is
  `generated/public-web-ui/static/pages/ConnectionsPage.js` plus its synced
  stylesheet.
- `scripts/test-connector-oauth-contract.mjs` covers PKCE, state mismatch,
  collision behavior, account identity, grants, safe exposure, verify, revoke,
  and disconnect. `scripts/test-plugins-page-contract.mjs` covers Plugins
  navigation, canonical routes, search, and legacy-flow preservation.
- `workspace/self/feature-index/18-settings-plugins-connectors.md` documents
  the pilot, migration/rollback behavior, provider scope limitation, and
  advanced alternatives.

## External prerequisite and provider limitation

The deployment owner must register/configure a GitHub OAuth App and provide
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` through the existing environment
or vault setup. The exact callback is
`http://localhost:19422/auth/callback/github`. This worktree does not register
the app, submit a review, deploy it, or change production credentials.

The current OAuth App compatibility path requests `repo` for private-repository
coverage. Prometheus exposes only classified read-only tools by default, but
that provider scope can carry broader GitHub authority than the tool grant.
The next hardening step is a fine-grained GitHub App with read-only repository
permissions. See GitHub's [OAuth App authorization guide](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/authorizing-oauth-apps),
[OAuth App best practices](https://docs.github.com/en/enterprise-cloud@latest/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app),
and [OAuth App revocation endpoint](https://docs.github.com/en/rest/apps/oauth-applications?apiVersion=2026-03-10).

## Verification

Passed:

- `npm run build:backend`
- `npm run test:connector-oauth`
- `npm run test:connections`
- `npm run test:integrations`
- `npm run test:plugins-page`
- `npm run sync:web-ui` / `npm run check:web-ui`
- Node syntax checks for the new regression scripts
- `git diff --check` for the scoped implementation files

No model-provider, model-selection, reasoning-default, or voice/realtime
credential behavior was changed by the implementation files above.

## Next connector slice

Notion is the recommended next migration after the GitHub provider-app
hardening boundary: the existing OAuth connector already has a provider app
and callback path, and its OAuth result can naturally expose workspace identity
and selected page/database resources. Reuse the same bridge/manifest contract,
start with read-only search/page/database tools, and keep page creation/update
as explicit approval-gated capabilities. Do not migrate it until provider app
registration, redirect configuration, scopes, and workspace-selection behavior
are verified in the target deployment.

## Follow-up implementation status — 2026-08-09

The next slice was completed additively. The host-owned `connection-v2` contract
is now shared by the native OAuth connector cards listed below; legacy connector
classes, vault keys, connected sessions, and manual credential paths remain
readable. This work does not install provider applications, add client secrets,
or force an existing user through authorization again.

### What is genuinely OAuth-first now

- `src/connections/adapters/connector-oauth.ts` is the single native connector
  adapter. It resolves a bridge by connector id, carries manifest scopes into
  the OAuth flow, builds the account/resource/capability record, verifies the
  provider account, and owns repair/disconnect behavior.
- `src/connections/connector-oauth-bridges.ts` maps the existing native
  connector runtimes to that adapter. Verification uses provider-safe identity
  or read probes and never places access or refresh tokens in a connection
  record. Resource discovery is best effort during connect and is rechecked by
  verify so a discovery failure does not silently make an account unusable.
- `src/integrations/oauth-base.ts` now accepts a requested scope set, preserves
  account continuity, centralizes vault-backed refresh and RFC 7009-compatible
  revoke where a connector advertises it, and keeps callback/state failures
  secret-safe. OIDC-capable Google and Salesforce flows also bind and validate
  a per-attempt nonce in the returned ID token. It also supports provider
  token-endpoint client authentication methods, including Notion's Basic
  client authentication. Existing connector-specific behavior remains available
  for the advanced/manual path.
- Native manifests declare `connection-v2` provider-app metadata, exact loopback
  callback registration, read-only defaults, explicit write/high-impact
  capability contracts, and fail-closed unknown-tool policy.
- The Plugins page calls the shared managed connection path for every native
  OAuth strategy. It shows provider-app prerequisites, identity/resource scope,
  read-only defaults, verification/repair/disconnect controls, and leaves own
  OAuth app, API key, setup-token, browser-session, local, and custom-MCP paths
  under Advanced setup.
- `src/gateway/mcp-oauth.ts` remains the standards-based remote-MCP path. It
  uses metadata discovery, dynamic registration where advertised, PKCE/state,
  a loopback callback, vault refresh, exact callback-path matching, safe error
  rendering, and optional revocation before local clear. Unknown discovered MCP
  tools remain blocked by `src/connections/adapters/mcp-oauth.ts`.

### Connector status matrix

“Verified” below means deterministic manifest/contract/security tests and local
fixture verification. No live provider credential or provider application was
used in this workspace, so managed sign-in still remains gated by the stated
external prerequisite.

| Connector | Implementation status | Managed default and current prerequisite |
| --- | --- | --- |
| GitHub | Migrated and contract-verified | Read-only native OAuth contract; deployment-owned GitHub OAuth App is still required. Existing broad `repo` compatibility scope remains an explicit limitation; a fine-grained GitHub App is the next hardening step. |
| Gmail | Migrated and contract-verified | `gmail.readonly` + identity scopes; Google OAuth app, Gmail API enablement, consent-screen verification, and restricted/sensitive-scope review where applicable. Send/modify stays approval-only and advanced. |
| Google Drive | Migrated and contract-verified | `drive.readonly` + identity scopes; Google OAuth app/API enablement and verification. File/resource selection should be narrowed further before requesting write access. |
| GA4 | Migrated and contract-verified | `analytics.readonly` + identity scopes; Google Analytics Data API, OAuth app, property selection, and any Google verification/admin consent. |
| Notion | Migrated and contract-verified | Public connection OAuth with workspace identity; a Notion public integration, redirect registration, workspace/page sharing, and Basic client authentication are required. Notion does not use a conventional scope string and does not assume offline refresh. |
| Slack | Migrated and contract-verified | Read-only workspace scopes; Slack app installation, workspace/admin approval, redirect registration, and provider token/rotation policy are required. Posting/message mutation stays approval-only and advanced. |
| HubSpot | Migrated and contract-verified | CRM read scopes plus portal identity; public app, exact redirect, selected portal, and requested-scope approval are required. |
| Salesforce | Migrated and contract-verified | API/identity/refresh scopes plus org/instance identity; Connected App, callback, tenant/admin consent, org policy, and Connected App ID-token configuration for nonce validation are required. |
| Reddit | Migrated and contract-verified | `identity read history`; Reddit web app, exact redirect, rate-limit/product approval, and user consent are required. Submit/moderation mutation remains advanced. |
| X | OAuth-supported but implementation remains | Existing X API user-context OAuth/xurl path stays separate and intact. It requires an X Developer app, exact callback, product/tier access, scopes, and often billing; it is not yet on the shared connection-v2 native bridge. xAI/Grok model OAuth remains out of scope. |
| Instagram | Browser-session/manual by nature today | Current connector is browser-session based. Graph/API OAuth requires an approved Meta app, product permissions, account type, review, and a separate resource model; deferred. |
| TikTok | Browser-session/manual by nature today | Current connector is browser-session based. Login Kit/content/analytics APIs require an approved app, product access, redirect registration, and scope review; deferred. |
| LinkedIn | Browser-session/manual by nature today | Current connector is browser-session based. LinkedIn products and organization/member scopes require application approval and product-specific review; deferred. |
| Vercel | API-key/manual today | Current account/team/project flow is token-based. Vercel OAuth/authorization-server integrations are a different app/integration model and need a product decision plus app registration before migration. |
| Stripe | API-key/manual today | A Stripe Connect OAuth flow authorizes connected Standard accounts, not a general replacement for the current merchant secret-key connector. Keep API keys/Connect configuration explicit until account semantics and financial approval are designed. |
| Obsidian | Local/manual by nature | Local vault path, access mode, sync, and writeback; OAuth would be the wrong trust model. |
| Standards-based remote MCP | Migrated and contract-verified where advertised | Remote servers can use MCP protected-resource/auth-server discovery, dynamic registration, PKCE, loopback callback, vault refresh, optional revocation, and conservative tool classification. Servers without trustworthy metadata remain custom/manual Advanced setup. |

### Provider apps, callbacks, scopes, and lifecycle

The provider-app boundary is explicit in each manifest; no secrets are bundled
in Electron or source. The current advanced/managed configuration names are:

| Connector | Client configuration | Loopback callback |
| --- | --- | --- |
| Gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | `http://localhost:19420/auth/callback/gmail` |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | `http://localhost:19421/auth/callback/slack` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `http://localhost:19422/auth/callback/github` |
| Notion | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | `http://localhost:19423/auth/callback/notion` |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | `http://localhost:19424/auth/callback/reddit` |
| Google Drive | `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET` | `http://localhost:19425/auth/callback/google-drive` |
| HubSpot | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | `http://localhost:19426/auth/callback/hubspot` |
| Salesforce | `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` | `http://localhost:19427/auth/callback/salesforce` |
| GA4 | `GA4_CLIENT_ID`, `GA4_CLIENT_SECRET` | `http://localhost:19429/auth/callback/ga4` |

Refresh material stays in the encrypted vault and only opaque credential
references plus non-secret refresh/health metadata enter connection state.
GitHub and Google connectors use provider revoke endpoints where supported;
other native disconnects clear the vault and canonical record while reporting
that provider-side revocation is unavailable or provider-specific. Notion's
non-expiring public-connection token is treated as a provider-specific case.
Reauthorize starts a fresh state/nonce/PKCE attempt and rechecks account
identity before replacing the usable session. A callback collision, timeout,
state mismatch, wrong account, unavailable app, denied consent, or failed
read probe produces a repair/reauthorization state rather than a connected
record.

Salesforce deployments must enable the Connected App ID-token configuration
when using the managed nonce-bound path; the provider documents that OpenID
tokens require this Connected App configuration. See the [Salesforce OpenID
token setup guidance](https://developer.salesforce.com/docs/platform/mobile-sdk/guide/auth-openid-tokens.html).

Provider scopes are not the same as host capability grants: Salesforce's `api`
scope and GitHub's current compatibility `repo` scope are broader than the
default exposed read-only tool set. The host therefore blocks/approval-gates
mutations, but a deployment should move to a finer-grained provider app or
resource selector before presenting the managed flow as least privilege.

### Before/after behavior and remaining work

Before, a connector card often stopped at manual client fields and a
connector-specific OAuth route. After, the catalog card selects a manifest
strategy, the host starts the browser flow, the provider returns through its
registered loopback callback, the host verifies identity/resources, grants
only read-only tools by default, and records a versioned rollback-capable
connection-v2 record. Existing records continue to use legacy reads and are
not reauthorized merely because the new contract exists.

The next safe native slice is X after its app/tier/callback contract is made
explicit, or a fine-grained GitHub App/resource selector if GitHub ownership is
available first. Instagram, TikTok, LinkedIn, Vercel, and Stripe remain
external-prerequisite/product-design work, not candidates for fake OAuth
completion. The provider applications, reviews, tenant consent, production
redirects, billing, and live credential verification remain deployment work.

### Verification performed

- `node scripts/test-connector-oauth-contract.mjs` — passed, including native
  strategy coverage, scope/nonce propagation, PKCE/state/collision checks, account
  continuity, capability grants, unknown-tool blocking, MCP discovery/path and
  revocation contract checks, disconnect, and secret-safe records.
- `node scripts/test-plugins-page-contract.mjs` — passed.
- `npx tsx scripts/verify-extensions.ts` — passed: 14 connectors, 106 tools,
  0 errors, 0 warnings.
- `npm run sync:web-ui` and `npm run check:web-ui` — passed; generated public
  Plugins UI is in parity with `web-ui/`.
- `node --check` passed for the edited source/test web scripts. `npx tsc
  --noEmit --pretty false` also passed after the final changes.
- Live provider sign-in, refresh, revoke, and resource selection remain
  fixture/contract verified only because no external apps or production
  credentials were changed.
