# Settings, plugins, connectors, and MCP: how the system actually works

This is the operator-facing reference for the configuration and integration
systems. It separates things that are easy to conflate:

- **Settings** change Prometheus's local configuration and operating policy.
- **Credentials** are secret material and are stored separately from normal
  configuration when possible.
- A **connector** is a known service integration with an auth method, status,
  capabilities, and, when connected, model-callable tools.
- An **extension** is the runtime packaging system behind bundled connectors,
  provider definitions, MCP presets, and user-installed plugins.
- An **MCP server** is an external tool server configured by the user; its
  tools are discovered only after a successful connection.
- A **connection attempt** is the more deliberate lifecycle used when
  Prometheus is helping plan, authorize, verify, or repair a connection.

The intended result is that Prometheus can help a user find and set up an
integration without pretending a setup is complete before authentication,
tool registration, exposure, and a safe read have been checked.

## 1. Where configuration lives and what survives a restart

Prometheus resolves its data/config directory in this order:

1. `PROMETHEUS_DATA_DIR/.prometheus` when the environment variable is set.
2. A project-local `.prometheus/` when it exists next to the app/project.
3. `~/.prometheus/` otherwise.

The normal configuration file is `<configDir>/config.json`.  The default
workspace is a sibling `workspace/` directory unless
`PROMETHEUS_WORKSPACE_DIR` overrides it.  Older `.localclaw` data can be
migrated once into the selected `.prometheus` location at startup.

`ConfigManager.updateConfig(...)` updates the in-memory configuration and
writes it immediately.  Startup loads saved config over the defaults, with
special deep merges for provider definitions, image/video provider blocks,
channels, and tool permissions.  Invalid schema fields create warnings rather
than intentionally crashing the gateway.

### Secrets are not ordinary settings

Before `config.json` is written, known secret fields are moved to the local
vault and replaced by `vault:<key>` references.  This includes gateway and
channel tokens, search keys, configured provider secrets, and webhook secrets.
An `env:<VARIABLE>` reference is also left as a reference rather than copied
into the config file.  UI masking (`••••••••`) is not treated as a real
replacement secret.

This means a saved configuration can show an integration as configured while
the secret itself lives in the vault, or while an environment reference only
becomes usable in the process where that environment variable is available.
Do not read “configured” as “OAuth completed” or “tools currently exposed.”

## 2. Settings page: every top-level operating area

The desktop Settings modal selects among these tabs:

| Tab | What it controls / shows |
| --- | --- |
| **System** | Runtime snapshot, workspace/allowed/blocked paths, general appearance and onboarding-oriented controls. |
| **Heartbeat** | Whether the periodic heartbeat is enabled, its interval, and the editable heartbeat instruction/configuration surface. |
| **Search** | Preferred search provider, search rigor, and credentials for the supported web-search providers. |
| **Credentials** | Provider authentication and credentialed-model routing status, including the supported OAuth/manual connection paths. |
| **Security** | Gateway security and approval-related settings exposed through the authenticated settings routes. |
| **Migration** | Discovery, preview, import, conflict handling, and reports for supported legacy/user-data sources. |
| **Models** | Primary/provider model settings, provider model discovery/testing, agent-model defaults with per-default reasoning and multi-account routing, the Voice Agent provider/voice default, and reusable default templates. |
| **Agents** | Agent definitions, their model assignments, prompts, workspaces, and per-agent heartbeat-related configuration. |
| **Channels** | Delivery/channel status and its saved configuration. |
| **Integrations** | Webhooks and manually configured MCP servers. It is distinct from the More → Plugins page, while remaining the detailed manual MCP configuration surface. |
| **Shortcuts** | Saved site/application shortcuts used by the UI. |
| **Pairing** | Paired-device/pairing approval state and refreshes. |

Some Settings reads deliberately remain available even when a provider is
offline.  For example, the session settings endpoint uses a short bounded
model-list attempt and returns a context profile/budget using saved/default
information if live model metadata cannot be fetched.

### Model, provider, and session settings

The Settings API covers the active model/provider, model providers with usable
credentials, usage budgets, model tests, agent-model defaults, and named
agent-model-default templates.  OpenAI/Codex, xAI, Anthropic, and X API
controls have separate status/start/poll/manual/disconnect endpoints where
their authentication systems differ.  In particular, X API user-context OAuth
is separate from xAI/Grok model OAuth.

For each agent-model default, the API persists provider/model, provider-aware
reasoning, and an optional selected credential account.  The UI offers that
account picker only when the selected provider has multiple connected accounts.
The same Models payload exposes the separate Voice Agent default for the
supported realtime routes (Codex Voice/Live, OpenAI Realtime, and xAI).

The session controls are also the settings surface for context management:

- retained message limit (`maxMessages`);
- compaction and memory-flush thresholds;
- minimum messages before compaction;
- rolling-compaction enablement, message cadence, tool-turn cadence, summary
  word budget, and optional compaction model;
- optional model and reasoning selection for main-chat goal compaction.

The same session settings surface includes the auto-settle policy. It is Never
by default, or one of the 7/14/30/90-day presets, or a past Custom calendar
date. A Custom save explicitly chooses whether existing eligible chats should
be processed immediately or whether aging starts now. The setting only drives
the existing `session.settledAt` visibility state; it never deletes, compacts,
summarizes, detaches resources, marks read, changes memory, or cancels work.
Automatic runs use durable `lastActiveAt`, authoritative protected-state
checks, bounded batches, and `<configDir>/auto-settle/last-run.json` for an
auditable summary.

Values are bounded on save.  For example, the route constrains context
thresholds and compaction counts rather than trusting a malformed browser
request.  These controls steer continuity/summary behavior; they do not delete
the underlying audit artifacts.  Chat compaction artifacts are separately kept
under `workspace/audit/chats/compactions/` and can inform continuity and memory
indexing.

Auto-settle settings are returned by `GET /api/settings/session`, persisted by
`POST /api/settings/session` or `POST /api/settings/bulk`, and can be inspected
through `GET /api/settings/auto-settle/status`. The dry-run endpoint
`POST /api/settings/auto-settle/preview` reports eligible/skipped work without
changing a session. Manual `/api/sessions/:id/settle` and `/unsettle` remain
independent reversible actions.

### Search settings

Search Settings saves the preferred provider, search rigor, and credentials
for TinyFish, Tavily, Google, and Brave.  The setting chooses the fast default
for normal model-facing search; a tool call can still explicitly request a
provider or multi-provider research.  The feature does not turn an absent API
key into a hidden fallback claim: provider availability still depends on the
configured credentials and runtime behavior.

### Paths, shell policy, and security boundary

Settings exposes the workspace path and file allowed/blocked-path lists.  The
configuration also contains shell permissions such as workspace-only mode,
destructive-command confirmation, blocked patterns, allowlists, and approval
mode.  These are policy inputs to the execution system; a setting does not give
an arbitrary plugin or connector permission to bypass approvals.

The security API, approvals list/actions, user questions, gateway restart, and
open-path route use gateway authentication.  A settings action that changes a
file path or security policy should therefore be treated as a local operator
change, not a model-side preference toggle.

### Integrations in Settings: webhooks and MCP

The Settings **Integrations** tab has two subviews:

- **Webhooks** saves enabled state, a protected token, and a path.  The UI can
  generate a token, show the resulting `/agent` endpoint when configured, and
  run a test.  The page tells the user that a gateway restart is required for
  saved webhook configuration to be applied.
- **MCP** lists configured MCP servers with enabled/disconnected/connecting/
  connected/error state, tool count, tool names, and error text.  It can add,
  edit, connect, disconnect, or delete a server, and it can prefill from an
  extension-registered preset.  Manual server forms support `stdio`, `sse`,
  and HTTP/streamable-HTTP configuration shapes.

## 3. Plugins page: the user-facing connector setup surface

Desktop navigation exposes **More → Plugins** as a dedicated page. The page is
connector-only: it is built from the extension catalog
(`GET /api/extensions/catalog?kind=connector`) and does not enumerate model
providers, model credentials, reasoning defaults, or voice providers. It sorts
the user-facing connector names deterministically and searches the name,
description, category, tags, setup/auth metadata, declared capabilities, tool
names, and connection strategy metadata. User plugins are marked as custom and
can be removed from their detail surface.

The catalog is a page-owned adapter over the extension descriptor/state
contract; it does not copy a second connector registry into the browser. The
initial page load is lightweight: `ConnectionsPage.js` is imported when the
Plugins mode is entered, then the catalog, connection-attempt state, and
configured MCP servers are loaded. Loading, empty, error, stale-catalog, and
no-search-match states are rendered in the page itself.

Bundled connector cards use the real brand SVG marks in
`web-ui/src/assets/connectors/` (Simple Icons v16.28.0, copied into the
generated public mirror), not generated monograms. The marks are rendered
with each connector manifest's brand color; official monochrome brands such
as Vercel, X, Notion, and TikTok remain black by design. Custom or unknown
connector-style plugins retain a text fallback when no bundled mark exists.

The catalog is presented as vertical three-letter ranges (A–C, D–F, G–I,
and so on). Search filters the same sorted source list, so only ranges with
matching connectors remain visible and each range keeps its divider.

Clicking a catalog item opens the shared `#connector-view` detail surface.
Legacy OAuth/API-key/browser/local flows and the newer connection-attempt
continue/secure-input/verify/repair flows remain in `ConnectionsPage.js`, so
the page does not duplicate credential or OAuth logic. The detail surface keeps
install/discovery, connection/authentication, and tool exposure as separate
pieces when the underlying contract provides those states.

Configured MCP servers are shown in their own alphabetical section below the
connector catalog and reuse the same detail surface for connect, disconnect,
OAuth, token/header, local-stdio, and remove actions. The Add plugin surface
continues to own custom REST/MCP/URL installation. Model providers remain in
Settings.

The page chooses a setup flow based on the connector's declared auth type:

| Auth type / bridge | What the user does |
| --- | --- |
| **OAuth** | Save any required client credentials, open the authorization popup, then poll for completion. |
| **API key** | Enter/update the connector credential fields. |
| **Browser session** | Open the Prometheus browser window, sign in there, close/finish the site flow, then use Verify. |
| **Local bridge** | Provide a local target such as an Obsidian vault and select its access mode. |
| **MCP** | Configure the remote/local MCP server and authorize it when its strategy requires OAuth; configured servers are also visible in the Plugins page. |

### OAuth connector audit — 2026-08-11

The current connector page does not bundle provider OAuth client secrets. A
deployment is a direct click-through only when its provider app client ID (and,
where required, client secret) is already available from the deployment
environment or the local vault. In that case **Connect** creates the
host-owned connection attempt; the user approves the requested read-only
capability grant, then the attempt opens the provider authorization URL,
receives the code on a localhost callback, stores/refreshes tokens in the
vault, and verifies account/resource identity before exposing tools. If the
app is not configured, the managed attempt fails with a
provider-app-not-configured state; **Advanced: Use your own OAuth App** is the
setup path. That means this is not universally one-click for a fresh
installation, and even a configured deployment intentionally has an approval
step before the provider window.

The managed OAuth family and declared tool surface are:

| Connector | Provider app / callback | Default managed scopes and tools |
| --- | --- | --- |
| **GA4** | Google desktop OAuth app; `http://localhost:19429/auth/callback/ga4` | Analytics read-only, identity, and OpenID; 3 tools: reports, realtime users, and property listing. |
| **GitHub** | GitHub OAuth App; `http://localhost:19422/auth/callback/github`; PKCE | `repo`, `read:user`, `user:email`, `read:org`; 6 tools for repositories, issues, pull requests, issue/repository creation, and search. Read-only exposure is the default, while writes remain approval-gated. |
| **Gmail** | Google desktop OAuth app; `http://localhost:19420/auth/callback/gmail` | Gmail read-only, identity, and OpenID; 6 tools for listing/getting/preparing/sending mail, profile, and labels. |
| **Google Drive** | Google desktop OAuth app; `http://localhost:19425/auth/callback/google-drive` | Drive read-only, identity, and OpenID; 4 tools for listing, getting, reading, and searching files. |
| **HubSpot** | HubSpot public app; `http://localhost:19426/auth/callback/hubspot` | Contact/company/deal read scopes; 5 CRM tools including contact create and search. |
| **Notion** | Notion public integration; `http://localhost:19423/auth/callback/notion` | Provider-controlled workspace access with no scope query; 4 tools for search, page read/create, and database query. |
| **Reddit** | Reddit web app; `http://localhost:19424/auth/callback/reddit` | `identity`, `read`, `history`; 4 tools for posts, search, post submission, and comments. |
| **Salesforce** | Salesforce Connected App with nonce/ID-token configuration; `http://localhost:19427/auth/callback/salesforce` | `api`, `refresh_token`, `openid`; 4 tools for query, search, record create, and record read. |
| **Slack** | Slack app with OAuth redirect; `http://localhost:19421/auth/callback/slack` | Channel/history/user/search/file read scopes; 4 tools for channels, sending messages, history, and search. |
| **X / Twitter** | X Developer app with OAuth 2.0 User Context; default `http://localhost:8080/callback`, or the exact advanced redirect URI | 50 `x_api_*` tools covering identity, posts/search, likes/bookmarks, follows, lists, spaces/trends, DMs, usage, and generic API requests. X is a separate custom PKCE/browser/xurl path, not the nine-connector native bridge. |

The tool contract is deliberately separate from authentication: a token can be
present while a connection is still awaiting verification, or while tools are
registered but not exposed. The managed descriptors default to read-only tool
exposure; write/high-impact capabilities require the connection policy and
approval path. The X connector's OAuth 2.0 user context is also unrelated to
xAI/Grok model OAuth.

The compatibility **Advanced** path is not identical to the managed descriptor
path: it uses the legacy connector classes and their requested scopes. Today
that makes Gmail, HubSpot, Reddit, and Slack's legacy fallback scopes broader
than the managed read-only descriptor scopes (for example Gmail also declares
send/modify there, and Slack includes `chat:write`). This is an audit finding
to consolidate in a later hardening slice, not a claim that the managed default
already grants those write tools.

Vercel and Stripe are not OAuth connectors in the Plugins catalog. They use API
keys; Vercel's setup accepts a Vercel token plus optional project/team IDs.
Instagram, LinkedIn, and TikTok use the Prometheus browser-session login and
Verify flow. Obsidian is a local vault bridge. These must not be described as
provider OAuth merely because older runtime files share an OAuth base class.

### Managed connection-v2 pilot: GitHub

GitHub is the first bundled connector migrated end-to-end to the host-owned
managed connection contract. Its descriptor declares a `connector-oauth`
strategy, provider-app boundary, PKCE requirement, exact loopback callback,
scopes, capability contracts, verification checks, and a read-only/unknown-tool
policy. The Plugins detail surface starts the durable attempt and then reuses
the shared approve → OAuth → verify → repair/disconnect lifecycle; it does not
implement a second OAuth client in the browser.

The canonical record is additive. Existing legacy OAuth vault tokens and
connected sessions remain readable, and legacy migration records carry a
version/rollback marker. A user is not forced to reauthorize merely because a
record was projected into connection-v2. When a user explicitly starts the
managed GitHub flow, the selected existing provider account id is carried into
the OAuth state and is checked before new tokens are saved, preventing an
accidental account switch from replacing the old session.

Managed GitHub records display the provider account, account resource scope,
granted scopes, capability grants, exposed/approval-gated tool counts, PKCE/app
readiness, and verification/health state. Read-only capabilities and tools are
the default. Issue creation and repository creation remain explicit
write/high-impact grants and are not exposed by the pilot's default read-only
connection.

The current GitHub OAuth App compatibility path requests the provider's
existing `repo` scope when private-repository coverage is needed; that scope is
broader than Prometheus's read-only tool exposure and can include provider-side
write authority. This is a documented provider limitation of the OAuth App
path, not a claim that the token itself is least-privilege. A fine-grained
GitHub App with read-only repository permissions is the next GitHub hardening
slice before broad deployment.

The managed flow requires a deployment-owned GitHub OAuth App configuration;
Prometheus does not bundle a client secret. The loopback callback is exactly
`http://localhost:19422/auth/callback/github`. The detail surface keeps
**Advanced: Use your own OAuth App** (vault-backed client fields) for local or
developer setups, while API-key, setup-token, browser-session, local Obsidian,
custom MCP, and manual configuration paths remain explicit alternatives.
Disconnect attempts provider-side revocation when the provider app supports
it, then clears the local vault session even if remote revocation cannot be
confirmed. The result records the remote-revocation outcome in lifecycle
progress without logging tokens or secrets.

Browser-session verification currently uses URL-based logged-in/login-page
signals for Instagram, TikTok, X, and LinkedIn.  It is a pragmatic session
verification step, not a statement that every site action is authenticated or
allowed forever.

Connector credentials can be saved through the Connections routes, and a
disconnect removes that connector's stored connection state.  The X-specific
disconnect path deliberately separates X API credentials from xAI/Grok model
credentials.  Connector activity is also readable through the connection
activity route.

### Status vocabulary: the important distinction

Different portions of the system record more than a binary connected flag:

| State | Meaning |
| --- | --- |
| **has credentials / configured** | Secret or configuration was saved; authentication may still be absent or expired. |
| **authenticated / connected** | The relevant OAuth, API-key, browser-session, or local bridge check says usable access exists. |
| **registered** | Prometheus has registered the integration's tools. |
| **available** | A tool is in the connection's explicit model-facing `availableTools` allowlist. |
| **exposed** | A tool is in the automatic/read-safe `exposedTools` subset; consequential available tools still use per-call approval. |
| **verified / healthy** | Verification checks have passed, including safe-read when required. |
| **degraded / reauth required** | Some access exists but a check failed, or a runtime token error demands reauthorization. |

When extension tool execution returns token-refresh, revoked-token,
unauthorized, or equivalent authentication errors, the runtime records an
expired/invalid connector health state and a reauthorization requirement.  It
does not silently claim that the connector remains healthy.

## 4. How Prometheus assists with a new or broken connection

The connection orchestrator supports a more careful path than merely showing a
credential form:

1. **Create / discover.** A requested service name is normalized and matched
   against installed and bundled plugins.  If nothing trustworthy is known, the
   result is “research required,” not generated integration code by default.
2. **Rank options.** Installed plugins rank highest, then bundled plugins,
   trusted marketplace choices, official documentation/packages, community
   integrations, and finally generated proposals.  A community or generated
   option is excluded unless the request permits it.
3. **Plan.** The plan identifies a strategy, requested capabilities, auth type,
   read-only intent, configuration, and verification targets.  Ambiguous
   matches stop for a user selection; unfamiliar services require official
   source research before a proposal.
4. **Approval and user action.** The planned connection waits for approval.  It
   can ask for OAuth, a secure value, a device code, a browser login, a CLI
   login, external admin approval, or a desktop continuation.
5. **Connect, register, expose.** The chosen adapter carries out the supported
   setup and writes a connection record. The host records registered tools,
   the available allowlist, and the automatic/read-safe subset separately. A
   completed adapter may still move into a verification state rather than
   straight to “ready.”
6. **Verify.** Built-in verification checks authentication, registered tools,
   exposed tools, and a safe read unless the target explicitly disables that
   requirement.  Plugins can add custom checks.  A partial result is marked
   degraded; a reauth signal wins over otherwise-passing state.
7. **Repair or disconnect.** An adapter can offer repair.  If it does not,
   Prometheus reports `REPAIR_UNSUPPORTED` rather than inventing an automated
   repair.  Disconnect disables authentication and tool exposure in the saved
   connection record.

Attempts, connection records, and activity logs live under the selected config
directory.  The runtime also migrates legacy connector status into the newer
connection record shape on a compatibility basis; new lifecycle writes use the
newer connection lifecycle.

## 5. Extension and plugin system

### What can be an extension

An extension descriptor (`prometheus.extension.json`) has one of these kinds:

- `connector` — a service integration and, normally, its tools;
- `provider` — a model/provider definition;
- `mcp_preset` — a reusable MCP launch/configuration recipe;
- `integration` — a broader integration descriptor.

Descriptors can declare ownership, capabilities/contracts, setup metadata,
activation hints, compatibility, a trust level, and an optional runtime
entrypoint.  The runtime API allows an extension to register tools, connectors,
providers, MCP presets, connection adapters/verifiers/tool classifiers, and
some experimental extension surfaces (routes, hooks, memory sources, context
providers).

Tools, connectors, providers, and MCP presets are the real supported runtime
surfaces.  Routes, hooks, memory sources, and context providers exist in the
API but are explicitly experimental and should not be assumed to be stable
general-purpose plugin permissions.

### Bundled versus user-installed plugins

Bundled descriptors are loaded from the app's extension bundle.  User plugins
are loaded from the writable plugins directory under Prometheus's data area.
The registry combines them but refuses a user descriptor whose `(kind, id)`
would collide with a bundled extension.  A malformed user plugin is skipped
best-effort during discovery instead of preventing all other extensions from
loading.

The user-plugin install API:

1. validates the descriptor using the same schema as bundled extensions;
2. requires a lower-case safe id (1–64 characters, letters/digits/dash/
   underscore) and Plugin API version compatible with API 1;
3. refuses to overwrite a built-in extension;
4. requires JavaScript source when the manifest declares `runtime.entrypoint`;
5. writes manifest/source to a staging directory, re-validates it, promotes it
   into the user plugin directory, and hot-reloads extensions;
6. rolls the installation back and reloads the previous surface if promotion or
   reload fails.

Removal accepts only a safe user-plugin id, removes only the user-plugin
directory, and hot-reloads.  It cannot remove the read-only bundled extension
bundle.  A reload clears extension registry/runtime caches, unloads runtime
definitions, clears Node's module cache for modules beneath the user-plugin
directory, then discovers and loads extensions again.  This is why an edited
user plugin can take effect without a full app restart.

### What an executable plugin must provide

A runtime entrypoint is loaded as a module and must export a Prometheus
extension definition (directly, as the default export, or through the supported
named wrapper exports).  The definition is registered through
`definePrometheusExtension(...)`.  A tool registration supplies a name,
description, JSON Schema parameters, optional connector/capability identity,
explicit side-effect metadata, and an `execute(args, context)` implementation.

The execution context gives a plugin `getCredential(fieldKey, connectorId?)` so
the plugin can resolve a saved credential from the vault.  It should use this
instead of hardcoding secrets into plugin source.  Omitted side-effect metadata
fails closed in the approval policy; installing a plugin is not an automatic
grant for invisible external writes.

The registry refuses duplicate tool names across extensions.  It also checks
that connector ownership declarations and actual registrations agree, and that
connector/provider/MCP-preset IDs do not collide.  Native bundled connectors
retain central OAuth/credential-refresh behavior in the connector class; the
native extension owns schemas and dispatch rather than replacing auth logic.

### Activation and exposure

The activation planner can select an extension because it is enabled at
startup, its tool/capability contract matches a request, an activation hint
matches, or a connector is already connected.  A connector tool definition is
included in the connected-connector tool list only when the host-owned
`src/connections/tool-surface.ts` says its canonical connection is operational
and the tool is in `availableTools`. `registeredTools` is the runtime contract;
`exposedTools` is the automatically safe/read-only subset. Available write and
unknown tools still pass through the normal per-call approval/audit policy.
Legacy compatibility records fall back to the runtime connector's
`isConnected()` result until migration. The same availability check runs again
before native connector and dynamic MCP execution, and connection/allowlist
mutations invalidate the short-lived surface cache.

Canonical connection details expose `GET/POST /api/connections-v2/:id/tools`
for inspection and complete allowlist replacement. The Plugins detail view
uses this endpoint for a user-visible tool checklist; the agent/control plane
can use `connection_ops` with `set_tool_availability` or `set_exposure`.

## 6. MCP: configuration, security, OAuth, and dynamic tools

The MCP manager supports local `stdio`, `sse`, and `http` transports (the
streamable-HTTP name is accepted as an HTTP alias).  Server configuration is
persisted in `<configDir>/mcp-servers.json`; object-style imports using
`{ "mcpServers": { ... } }` are accepted.

For `stdio` servers, Prometheus validates the executable against an allowlist,
rejects shell metacharacters in command strings, and sanitizes dangerous
environment variables.  `vault:` values can be resolved in environment
variables and headers.  These controls are why MCP setup is a typed config
operation rather than a raw “run this command” box.

When a configured MCP server connects successfully, its advertised functions
are injected dynamically as:

```
mcp__<serverId>__<toolName>
```

They are not present merely because a server row was saved.  If a server is
disconnected, errors, or is disabled, its tools are not a connected dynamic MCP
surface.  The UI's tool count/names are therefore a useful operational check.
MCP stdio sessions react to `notifications/tools/list_changed`; remote
HTTP/SSE sessions and the Plugins detail view also provide an explicit
“Refresh discovered tools” path. Refresh replaces the runtime snapshot and
reconciles managed canonical registration without silently expanding an
explicit user allowlist.

Managed MCP connections expose the same Plugins tool checklist as native
connectors through `GET/POST /api/connections-v2/:id/tools`; manually configured
legacy servers remain visible and executable through their runtime list until
they are adopted into a canonical connection-v2 record.

### MCP presets

MCP presets are extension-registered runtime objects, not a hardcoded menu.
Each `mcp_preset` descriptor contributes a launchable `mcpPreset` block; the
preset service lists its name, transport, and requested credential fields and
can build a concrete server config by resolving empty environment slots and
`{{credential:<id>:<field>}}` placeholders.  The Settings MCP UI uses this
catalog to prefill its form.

Bundled preset descriptors currently include Brave, filesystem, GitHub, memory,
Postgres, SQLite, Windows, and Robinhood.  A preset creates or pre-fills a
server configuration; it does not certify that the external command, remote
service, credentials, or individual MCP tools will work until connection and
verification succeed.

### OAuth-enabled remote MCP

The connection runtime includes an MCP OAuth adapter for remote MCP configs. It
starts a PKCE-style OAuth flow without directly opening a browser, exposes the
authorization URL to the caller, polls its result, can clear OAuth state, and
reconnects to retrieve the tool list.  If the selected remote config has no
URL, the flow returns an explicit error.  A stale/nonexistent OAuth session
also reports that authorization must be restarted instead of presenting a
fictional success.

## 7. Important special cases

### X API/xurl is not xAI/Grok OAuth

The `x` connector uses official X API OAuth 2.0 user context for `x_api_*`
tools.  xAI/Grok OAuth/API-key configuration powers Grok models and xAI search,
TTS, and STT; it does not establish official X API access.  Saving X developer
app credentials only makes the connector have credentials.  The user-context
OAuth token is what makes it connected.

The Connections and Settings routes include an X-specific path.  The
recommended setup button can guide xurl CLI authentication, including installing
or repairing xurl; `src/auth/x-api-oauth.ts` can use the `prometheus` app entry
from `~/.xurl` when the Prometheus vault has no X user token.  The OAuth client
ID must be the X OAuth 2.0 Client ID, and its callback URL must exactly match
the X developer app's configured callback.  API 401/403/429 responses remain
visible; Prometheus does not quietly replace an official API request with
browser automation.

### Obsidian is a local vault bridge

Obsidian is configured by adding a local vault path and selecting an access
mode, not by OAuth.  The connector has status, vault-management, sync, and
writeback routes/tools.  Removing a vault warns that mirrored notes are removed
from Prometheus memory; it is a data-affecting operation rather than a harmless
logout.

## 8. Troubleshooting guide

| Symptom | What to check |
| --- | --- |
| A connector says it has credentials but tools are missing | Credentials are not proof of authentication. Check its auth flow, current connection state, registration/exposure, and reauth-required status. |
| OAuth keeps returning to a pending/error state | Restart the correct authorization flow, verify client credentials and callback/redirect settings, then poll again. For remote MCP OAuth, ensure the saved server has a URL. |
| Browser-session connector will not verify | Complete login in the Prometheus browser session, then use the connector's Verify action. The current URL must no longer match a known login route and should match a logged-in signal. |
| MCP server row exists but no MCP tools appear | Save is only configuration. Check enabled state, Connect result, server status/error, transport details, credentials/header `vault:` refs, and the tool count/name list. |
| A local stdio MCP fails immediately | Check the allowed executable/command format, no shell metacharacters, arguments, environment entries, and whether the command actually exists in the Prometheus runtime environment. |
| A user plugin appears not to change after reinstall/edit | Use the extension reload surface. It clears user-plugin module cache and re-discovers descriptors. Then check manifest validation, compatible Plugin API 1, non-colliding id, entrypoint/source presence, and runtime load logs. |
| A plugin cannot replace a bundled connector | That is deliberate. User descriptors whose kind/id collide with bundled extensions are skipped/refused, so official integration definitions cannot be shadowed. |
| A connector becomes unhealthy after initially working | Inspect the activity/attempt record and token errors. The runtime records expired/revoked/unauthorized authentication failures and should prompt reauthorization rather than retrying an unsafe external effect blindly. |
| Settings appear saved but behavior has not changed | Confirm which setting needs a restart: webhook UI explicitly calls this out. Also check that config-vault/environment references are resolvable by the running gateway. |

## 9. Implementation map

| Concern | Primary implementation |
| --- | --- |
| Config directory, config persistence, secret migration | `src/config/config.ts`, `src/config/config-schema.ts`, `src/security/vault.ts` |
| Settings API | `src/gateway/routes/settings.router.ts` |
| Desktop Settings behavior | `web-ui/src/pages/SettingsPage.js` |
| Connection-panel UI | `web-ui/src/pages/ConnectionsPage.js` |
| Legacy/direct Connections routes | `src/gateway/routes/connections.router.ts` |
| Connection lifecycle and verification | `src/connections/orchestrator.ts`, `src/connections/verification-service.ts`, `src/connections/runtime.ts`, `src/connections/discovery-service.ts` |
| Extension runtime contract and registry | `src/extensions/runtime-api.ts`, `src/extensions/runtime-registry.ts`, `src/extensions/runtime-loader.ts`, `src/extensions/activation-planner.ts` |
| User-plugin install/reload | `src/extensions/install-service.ts`, `src/extensions/reload.ts`, `src/extensions/registry.ts`, `src/gateway/routes/extensions.router.ts` |
| Extension status catalog and MCP presets | `src/extensions/catalog-service.ts`, `src/extensions/mcp-preset-service.ts` |
| MCP manager and OAuth | `src/gateway/mcp-manager.ts`, `src/gateway/mcp-oauth.ts` |
| X API/xurl credential bridge | `src/auth/x-api-oauth.ts`, `src/extensions/xai-extension-adapter.ts` |

Related reference: [MCP and connections](../10-mcp-and-connections.md),
[tool architecture](../05-tools.md),
[special Prometheus tools and flows](17-special-prometheus-tools-and-flows.md),
and [the runtime architecture](06-runtime-architecture.md).

## P9 OAuth-first connector migration update — 2026-08-09

The shared host-owned connection-v2 path now covers the native OAuth family:
GitHub, Gmail, Google Drive, GA4, Notion, Slack, HubSpot, Salesforce, and
Reddit. The source of truth is `src/connections/adapters/connector-oauth.ts`
plus `src/connections/connector-oauth-bridges.ts`; the Plugins page consumes the
same orchestrator state rather than implementing a second credential or OAuth
store. These connectors build additive, rollback-marked records with account
identity, resource/workspace/org/property scope, granted capabilities, exposed
tool counts, provider-app metadata, and verification health. Read-only scopes
and tools are the default; unknown tools and write/high-impact capabilities are
blocked or approval-gated.

The migration preserves legacy vault keys and existing connected sessions. No
user is forced to reauthorize only because the record gains `contractVersion: 2`.
Provider apps remain an explicit prerequisite in each manifest: the managed
flow is intentionally unavailable until the deployment supplies the provider's
client configuration and exact loopback callback. “Use your own app,” API key,
setup-token, browser-session, local, and custom MCP options remain under
Advanced setup.

Connector status at this slice:

| Status | Connectors |
| --- | --- |
| Migrated and locally contract-verified; provider app still external | GitHub, Gmail, Google Drive, GA4, Notion, Slack, HubSpot, Salesforce, Reddit |
| OAuth-supported but shared migration remains | X; keep X API user-context/xurl OAuth separate from xAI/Grok model OAuth |
| Browser-session or provider-review path | Instagram, TikTok, LinkedIn |
| API-key/manual or provider-specific platform semantics | Vercel, Stripe |
| Local by nature | Obsidian |
| Standards-based conditional OAuth | Remote MCP servers that advertise protected-resource/auth-server metadata; otherwise manual configuration |

Native callback and client env details, scope decisions, revocation behavior,
external prerequisites, risks, and exact verification results are maintained in
`docs/P9-OAUTH-FIRST-PLUGIN-PLATFORM-IMPLEMENTATION-2026-08-08.md` under the
2026-08-09 follow-up section. Keep model-provider and voice/realtime credentials
in Settings; do not add them to this connector surface.
