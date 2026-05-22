## 2) Startup, Config Root, and Workspace Resolution

- Config/workspace resolution is centralized in `src/config/config.ts`
- Config dir precedence:
  - `PROMETHEUS_DATA_DIR/.prometheus`
  - project-local `.prometheus/`
  - `~/.prometheus/`
- Default workspace path is sibling to the config dir unless `PROMETHEUS_WORKSPACE_DIR` overrides it
- Legacy `.localclaw` data is migrated forward into `.prometheus`
- Default config version in source is `1.0.2`

## 3) Canonical Runtime Surfaces

- `src/gateway/core/startup.ts` owns startup boot orchestration
- `src/gateway/routes/chat.router.ts` owns `/api/chat`, tool loop execution, plan discipline, SSE streaming, browser/vision nudges, and mode-specific prompting
- `src/gateway/session.ts` owns session history, rolling compaction, rolling summaries, workspace binding, and persisted `creativeMode`
- `src/gateway/prompt-context.ts` builds the dynamic tool/memory/project prompt blocks
- `src/gateway/tool-builder.ts` assembles the tool surface from core tools, category tools, connector tools, composites, and MCP tools
- `src/gateway/browser-tools.ts` is the browser automation/runtime state system
- `src/gateway/routes/canvas.router.ts` owns canvas files, Creative mode state, Creative assets, HTML Motion, render jobs, scene save/export, and creative project publishing
- `src/gateway/tasks/background-task-runner.ts` is the autonomous task executor
- `src/gateway/mcp-manager.ts` is the MCP client/config manager
- `src/gateway/comms/telegram-channel.ts` is the canonical Telegram bridge and command handler
- `src/gateway/routes/account.router.ts` owns Supabase account login, encrypted persisted sessions, subscription checks, and account access gating
- `src/gateway/routes/hub.router.ts` powers the Hub usage page for skill usage, tool heatmaps, skill content previews, and achievement stubs
- `src/gateway/routes/obsidian.router.ts` owns the local Obsidian bridge API
- `src/gateway/routes/migration.router.ts` owns legacy workspace/data migration previews and execution
- `src/gateway/routes/processes.router.ts` exposes the managed process supervisor API
- `src/gateway/routes/coding.router.ts` exposes coding workspace/session, diff, branch, stage, and commit operations
- `src/gateway/routes/onboarding.router.ts` owns account-scoped onboarding/tutorial/model/memory-seed state

## 3A) Account/Auth Gate and Router Mounting

The gateway now mounts almost all application routes behind both gateway auth and account entitlement checks in `src/gateway/server-v2.ts`.

Account facts from `src/gateway/routes/account.router.ts`:

- Supabase sessions are kept in memory and persisted encrypted through the vault key `account.supabase.session`
- legacy `auth-session.json` is migrated into the vault and removed
- access requires either `subscriptionActive` or `isAdmin`
- subscription checks look for Supabase subscription statuses `active` or `trialing`
- cached subscription state has a five-minute refresh TTL
- `/api/account/status?strict=1` performs a blocking verification/refresh path
- expired sessions with refresh tokens are refreshed optimistically in normal status checks

Account routes currently include:

- `GET /api/account/config`
- `GET /api/account/status`
- `POST /api/account/login`
- `POST /api/account/login/password`
- `POST /api/account/logout`
- `POST /api/account/refresh`

WebSocket connections are also closed with policy code `1008` when the account is not logged in or lacks an active subscription/admin entitlement.

Account-entitled router mounts currently include:

- skills, tasks, channels, teams, settings, goals, proposals, audit log, connections, extensions
- canvas, projects, memory, Obsidian, Hub, migration, processes, coding, chat, onboarding

## 3B) Mobile Pairing, QR Codes, HTTPS, and Tailscale Remote Access

Mobile pairing is implemented as a desktop-approved device enrollment flow, not as a shared browser login.

Canonical source files:

- backend store: `src/gateway/pairing/pairing-store.ts`
- backend REST routes: `src/gateway/routes/pairing.router.ts`
- gateway auth gate: `src/gateway/gateway-auth.ts`
- router mount order and HTTP/HTTPS listener setup: `src/gateway/server-v2.ts`
- HTTP/HTTPS server behavior and redirect handling: `src/gateway/core/server.ts`
- desktop Pairing settings UI: `web-ui/src/pages/SettingsPage.js`
- mobile PWA pairing UI: `web-ui/src/mobile/mobile-pages.js`
- generated public UI mirrors: `generated/public-web-ui/static/pages/SettingsPage.js` and `generated/public-web-ui/static/mobile/mobile-pages.js`

Current pairing model:

- `POST /api/pairing/qr` creates a short-lived pairing challenge, returns an SVG QR, a `pairUrl`, and a human `pairCode`.
- The QR URL encodes the long random challenge code as `/?pair=<code>#mobile/pair`.
- The desktop UI also displays a human code such as `PAIR-Q4SD-4HZ2`.
- `getChallengeByCode(...)` accepts the long QR code, `PAIR-XXXX-XXXX`, `PAIRXXXXXXXX`, or just `XXXXXXXX`.
- Mobile claims the challenge through `POST /api/pairing/claim`.
- The claim creates a pending desktop approval request and broadcasts `pairing_pending`.
- Desktop approval calls `POST /api/pairing/approve`.
- Mobile polls `GET /api/pairing/poll/:requestId` until approval returns a one-time plaintext `deviceToken`.
- The phone stores the token in localStorage as `pm_device_token`; later mobile API calls send it as `X-Pairing-Token`.
- Paired devices are persisted in `.prometheus/paired-devices.json` with token hashes only, not plaintext tokens.
- Pairing challenges and pending requests are in-memory only; they intentionally expire and do not survive gateway restarts.
- Challenge TTL is five minutes; pending request TTL is ten minutes.
- Device revocation/removal happens through `PATCH/DELETE /api/pairing/devices/:id`.

Important auth/mounting behavior:

- `pairingRouter` must be mounted before any `app.use('/', requireGatewayAuth, ...)` router group in `src/gateway/server-v2.ts`.
- Express middleware attached as `app.use('/', requireGatewayAuth, accountRouter)` runs before route matching inside `accountRouter`; placing it before pairing will block `/api/pairing/claim` with `Unauthorized: configure gateway.auth.token to enable remote access`.
- `src/gateway/gateway-auth.ts` intentionally lets these account bootstrap routes through without a gateway token: `GET /api/account/config`, `GET /api/account/status`, `POST /api/account/login`, and `POST /api/account/login/password`.
- `gateway-auth.ts` verifies `X-Pairing-Token` and `?pt=` before checking the configured gateway token. This lets approved mobile devices work over LAN or Tailscale even when `gateway.auth.token` is absent.
- Non-loopback, unpaired API access is still blocked when no gateway auth token is configured.
- `POST /api/pairing/claim` also checks the server-side Prometheus account session via `getSessionStatus()` and requires `authenticated && (subscriptionActive || isAdmin)`. Pairing is therefore "phone logs into Prometheus account, then desktop approves the device."

iOS/Safari/PWA behavior that drove the dual route:

- iOS Safari and an Add-to-Home-Screen PWA do not reliably share the same browser storage container.
- A user can be logged in and paired in Safari, add the app to the Home Screen, and then find the Home Screen app starts with fresh storage.
- Scanning a QR with the iPhone Camera app opens Safari, not the already-installed Home Screen PWA.
- For that reason pairing must support both QR scanning and manual pair-code entry inside the Home Screen app.
- The mobile pair page with no `?pair=` code shows a pair-code input and internally redirects to `/?pair=<typedCode>#mobile/pair` so the normal claim/login/approval path is reused.
- If the phone already has a valid token, `/api/pairing/me` skips the pairing dance and navigates to mobile chat.
- On approval, mobile writes `pm_force_mobile=1` as a sticky mobile-mode hint so refresh/restart recovery does not dump the phone into the desktop UI.

LAN, HTTPS, and camera constraints:

- Plain LAN pairing requires `gateway.host` to be `0.0.0.0` or `::`; `127.0.0.1` only works from the desktop itself.
- Current local config has `gateway.host: "0.0.0.0"`.
- Safari browser camera/microphone APIs require a secure context. Plain `http://<LAN-IP>:18789` can load the app, but in-browser camera scanning and reliable mobile microphone capture need HTTPS.
- Gateway HTTPS is configured under `gateway.https` and served by a second listener from `server-v2.ts` when a PFX or key/cert exists.
- Current local config has HTTPS enabled on port `18790` with `certs/gateway-mobile.pfx` and passphrase `prometheus-local-dev`.
- `GET /api/pairing/certificate` serves the configured `.cer` file for installing/trusting the local gateway certificate on mobile devices.
- When HTTPS is enabled, `_resolvePairingOrigin(...)` prefers `https://<LAN-IP>:<httpsPort>` for generated QR URLs unless remote access overrides it.
- The plain HTTP listener redirects non-API/static GETs to HTTPS when an HTTPS listener exists.
- `core/server.ts` must not redirect requests that arrived through an HTTPS-terminating proxy. It checks `x-forwarded-proto: https` so Tailscale Funnel public HTTPS requests are not redirected to an unreachable local `:18790` URL.

Tailscale / remote access model:

- Remote access is an optional layer on top of local pairing, not a replacement for device approval.
- Config lives at `gateway.remoteAccess`.
- Defaults in `src/config/config.ts`: `{ enabled: false, mode: "tailscale-funnel", publicUrl: "" }`.
- Current local config has remote access enabled with mode `tailscale-funnel` and public URL `https://fonso-pc.tailca7310.ts.net`.
- When remote access is enabled with a valid `https://` origin, `/api/pairing/qr` encodes that public URL in the QR instead of the LAN IP.
- The response still includes `lanOrigins` for visibility and fallback.
- `GET /api/pairing/remote-access` reports current remote access config.
- `PUT /api/pairing/remote-access` saves `{ enabled, mode, publicUrl }` after validating that enabled remote access uses a full HTTPS origin.
- `GET /api/pairing/tailscale/status` shells out to the local `tailscale` CLI, checks `tailscale version`, parses `tailscale status --json`, suggests `https://<Self.DNSName>`, and inspects `tailscale funnel status` for active localhost ports.
- The Settings Pairing UI has a Detect Tailscale action, a "Use this URL" helper, and tells the user to run a command like `tailscale funnel <port>` when Funnel is not active.
- If remote access is on, the Pairing UI shows a "Remote access ON" badge and generates a new QR against the public URL.

Security sharp edge to preserve:

- `pairingRouter` is currently mounted before gateway auth so unpaired phones can claim challenges.
- That also means remote-access configuration/device-management endpoints in the pairing router are not individually protected by `requireGatewayAuth` at the router mount layer.
- Do not casually expose a Funnel/public URL without understanding this. A hardening pass should make desktop management endpoints loopback/account-gated while keeping only `qr`, `claim`, `poll`, certificate download, and `me` available as needed for pairing.
- A leaked QR/human code is not a credential by itself because desktop approval is still required, but it can create pending approval prompts.

Self-edit verification checklist for pairing/remote access:

- After changing `src/gateway/*` TypeScript, run `npm run build:backend` or `npm run build`; the live gateway often serves `dist/gateway/server-v2.js`, so source edits alone are not live.
- After changing `web-ui/src/*`, run `npm run sync:web-ui` and `npm run check:web-ui` or `npm run build`.
- If the running gateway is serving generated web files on Windows, stop it before `npm run sync:web-ui` if generation fails with `EBUSY`.
- Restart the gateway after backend changes.
- Smoke-test QR creation: `POST http://127.0.0.1:18789/api/pairing/qr` should return `pairUrl`, `pairCode`, `lanOrigins`, `remoteAccess`, and `qrSvg`.
- Smoke-test manual code claim from the phone/LAN origin by posting `{ code: pairCode, deviceName, deviceFingerprint }` to `/api/pairing/claim`; it should return `{ success: true, requestId, expiresAt }`.
- Clean up smoke-test pending requests with `/api/pairing/deny`.
- Verify protected LAN APIs still return 401 without `X-Pairing-Token`.
- Verify an approved mobile token reaches protected APIs through `X-Pairing-Token`.
- Verify old QR pages are not reused after challenge expiration or gateway restart.
