# P10-36 Mobile Gateway Connections

Status: first safe slice implemented 2026-08-09. This is a phone catalog and
read-only target/status/pairing foundation. It is not a computer federation,
shared database, central scheduler, or remote execution transport.

## Product boundary

The phone is the client. Each MacBook or desktop runs its own Prometheus
gateway and remains the owner of its chats, tasks, agents, schedules,
workspace, browser profiles, vault/connectors, memories, credentials, model
runtime, files, and audit records. The phone stores only target metadata,
target-scoped pairing grants, filter state, and immutable session-to-target
bindings.

The intended future experience is “MacBook Prometheus” and “Desktop
Prometheus” as separate targets in one phone UI. The first slice can discover,
pair, name, inspect, filter, and select those targets, and can show bounded
read-only catalog metadata. Sending a message or invoking a tool against a
non-current gateway remains deliberately disabled until a target-aware chat
transport is implemented.

## Implemented source contracts

- `src/gateway/gateway-identity.ts` persists one installation identity in the
  gateway config directory as `gateway-identity.json`. It exposes a stable
  `gw_...` identity, safe name/platform/architecture/version/origin/workspace
  label, protocol version, capabilities, and an explicit
  `execution.enabled=false` first-slice marker.
- `src/gateway/routes/pairing.router.ts` includes that descriptor in QR,
  claim, and poll responses. The QR contains a base64url JSON challenge
  payload with audience, gateway ID, origin, short expiry, and display hints;
  it contains no device token, private key, password, or reusable credential.
- `src/gateway/routes/pairing.router.ts` includes
  `GET /api/mobile/gateway/catalog`. It accepts only an
  `X-Pairing-Token` header, returns bounded session/agent/task metadata, and
  omits transcript previews/history, workspace paths, project roots, goals,
  credentials, and tool/runtime state. The existing local account session is
  not forwarded between origins.
- Pairing poll token delivery is bound to the device fingerprint supplied at
  claim. Legacy clients without a fingerprint must match the claim's
  user-agent and IP hint. `consumePendingRequestToken()` remains one-use.
- `POST /api/pairing/me/revoke` lets a paired phone revoke only its own
  target-local grant. Desktop pairing administration remains a separate
  authority.
- `src/gateway/gateway-auth.ts` permits the fingerprint header through CORS.
  `src/gateway/server-v2.ts` rejects `pt` query credentials on the new
  descriptor route. New catalog calls use headers, never query-string tokens.

Phone state is in `web-ui/src/mobile/mobile-gateway-catalog.js`:

- catalog: `pm_mobile_gateway_catalog_v1`;
- target credentials: `pm_mobile_gateway_token_v1:<gatewayId>`;
- device IDs: `pm_mobile_gateway_device_v1:<gatewayId>`;
- active target and all/selected filter state;
- immutable target bindings in `pm_mobile_session_targets_v1`;
- namespaced IDs use `<gatewayId>::<targetId>`.

`web-ui/src/mobile/mobile-api.js` keeps the legacy API helpers single-origin.
If a remote target is active, those helpers throw `REMOTE_EXECUTION_NOT_ENABLED`
instead of silently sending to the phone's current gateway. Target fetches
reject unknown/offline/revoked targets unless the call is explicitly a status
probe.

## Mobile UI

- `web-ui/src/mobile/mobile-shell.js` keeps the Prometheus logo and keeps the
  hamburger drawer focused on navigation and chats. Above its search bar it
  shows only compact, theme-aware All/target pills for the aggregate chat
  view; the pill row owns its horizontal overflow and has no outer panel.
- `web-ui/src/styles/mobile.css` widens the drawer to `min(76vw, 350px)` and
  adds compact horizontally scrolling All/gateway filter pills, gateway cards,
  target chip/popover, pairing action, safe area, and narrow 390px layout rules.
- `web-ui/src/mobile/mobile-gateways-page.js` shows stable identity, name,
  platform, version, status, last contact, capabilities, workspace label,
  pairing grant ID, reconnect, repair, forget, revoke, and target selection.
  The normal mobile shell/drawer remains the aggregate surface for bounded
  chats, pinned chats, agents, and tasks with visible gateway names and
  target-namespaced IDs; the Gateway Connections page itself stays focused on
  connection management. Filtering changes the aggregate view only; it does
  not disconnect a target.
- `web-ui/src/mobile/mobile-pages.js` keeps the chat body free of the gateway
  filter pills. The three-dot chat popover contains Notifications,
  Files, Resources, Permissions, Connections, and Settings; Connections opens
  the gateway-management page. The current gateway remains beside Attachments
  only while the composer is open. Its popover lists connected targets and
  target-local project / workspace metadata. Existing sessions show their
  original target and have disabled target choices. New drafts may select a
  target/path, but the first real user message binds the session permanently.
  Outside pointer-down and Escape reliably dismiss the target popover.
- The existing real camera is reused only when the browser exposes
  `BarcodeDetector` for QR. It validates the QR as a Prometheus pairing
  payload, checks its origin, discards arbitrary URLs, and navigates to a
  pairing confirmation page. Browsers without a safe QR decoder receive the
  explicit short-lived pair-code fallback; no fake camera behavior is used.
- `web-ui/index.html` labels the existing desktop Settings → Pairing panel as
  Gateway Connections · Pair a phone and explains the QR contents.

## Backward compatibility and fallback

The original `pm_device_token` and current-origin mobile API behavior remain
valid. A legacy current-origin catalog entry is synthesized when needed. The
phone first reads the new bounded catalog endpoint and falls back to the old
`/api/sessions`, `/api/agents`, and `/api/bg-tasks` reads for older gateways;
the fallback remains target-scoped and read-only but may require the old
gateway account session. Existing one-gateway chat stays on the old current
origin path.

The generated public UI must be produced from `web-ui/` with
`npm run sync:web-ui`; do not hand-edit generated copies.

## Security boundaries

- A gateway ID is installation-local, not a global account or peer identity.
- Pairing is explicit desktop consent plus a short-lived one-time challenge.
  The phone confirms the returned identity before saving a token.
- QR payload origin and gateway identity must match the approved response;
  mismatch is rejected without saving anything.
- Tokens are stored per gateway and sent in `X-Pairing-Token`; the new
  descriptor/catalog paths do not accept `pt` query credentials.
- Revocation is target-local. Forget removes only the phone's catalog/token;
  revoke disables the phone grant on that gateway. Losing a phone therefore
  requires revoking its grant on each affected gateway.
- Catalog metadata is bounded and omits message contents, secrets, paths, and
  runtime details. Gateway-owned data does not synchronize between computers.
- Current-surface execution is fail-closed. No remote chat/SSE/WS/tool/file,
  browser, desktop, terminal, schedule, or task execution was added here.

## Verification

- `npm run test:mobile-gateway` exercises two gateways, stable namespaced IDs,
  separate credentials, all/selected filtering, immutable bindings, draft
  behavior, QR expiry/malformed payloads, header-only requests, and offline /
  revoked fail-closed behavior. It also checks the source-level pairing,
  identity, camera, UI, safe-area, and generated-contract markers.
- `npx tsc --noEmit` passed after adding the catalog route and fingerprint
  binding.
- Run `npm run check:web-ui` after syncing generated output. A clean paired
  browser test is still required for physical camera permission, BarcodeDetector
  availability, desktop approval, LAN/Tailscale reachability, and 390×844
  visual focus/keyboard behavior.

## Next phases

1. Keep the first slice behind `MOBILE_GATEWAY_CATALOG_ENABLED`, the gateway
   environment kill switch `PROMETHEUS_MOBILE_GATEWAY_CATALOG=0`, and the
   phone emergency switch `pm_mobile_gateway_catalog_disabled=1` (or
   `window.__PROMETHEUS_DISABLE_MOBILE_GATEWAY_CATALOG=true`) before broad
   rollout.
2. Add target-aware chat session reads and streaming with `{gatewayId,
   targetSessionId, requestId}` envelopes, connection generations, replay,
   cancellation, outbox limits, and per-target WebSocket/SSE ownership.
3. Add target-aware attachments/resources and explicit capability scopes.
   Keep browser profiles, desktop control, terminal, files, vault, schedules,
   and task actions local until each has a separately reviewed route.
4. Add push/wake or an outbound relay only when sleeping computers and NAT
   requirements justify it. Same-LAN/private-network access is the smallest
   core; Tailscale/private networking is the preferred remote option; a cloud
   relay is optional and must not become a shared data store.
5. Add account/session continuity, rotation, audit redaction, connection
   generations, duplicate-side-effect protection, and migration tests before
   enabling remote execution.

## Rollback

Disable the catalog feature flag, stop exposing the Gateway Connections route,
and keep the existing `pm_device_token` current-origin path. Removing a phone
catalog entry is local and recoverable by pairing again; revocation is
target-local and can be repaired only through a fresh desktop-approved pair.
No gateway-owned chats, files, databases, schedules, or runtime state are
deleted by this slice.
