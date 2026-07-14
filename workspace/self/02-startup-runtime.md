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
- `src/gateway/session.ts` owns session history, rolling summaries, workspace binding, persisted `creativeMode`, and recent tool-context fallback helpers
- `src/gateway/context/model-context.ts` owns provider-aware context profiles, token estimates, and compaction/input budget math
- `src/gateway/tool-observations.ts` owns persisted compact tool observations for future-turn context and compaction
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

Main-chat turn safety:

- `src/gateway/chat/turn-coordinator.ts` is the canonical in-process per-session turn lock. `runInteractiveTurn(...)` callers queue FIFO for the same session, while different sessions remain parallel.
- `/api/chat` does not queue a different browser/mobile request behind an active turn: it returns `409 SESSION_TURN_ACTIVE`, preserving explicit interrupt/steer semantics and preventing overlapping history/tool mutation.
- `clientRequestId` / `X-Client-Request-Id` is an idempotency key scoped to the session. An exact duplicate attaches to or acknowledges the original stream; using the same key with a changed message, attachments, reasoning, caller context, pins, or skill selection returns `409 IDEMPOTENCY_KEY_REUSED`.
- Completed request fingerprints remain for a two-minute replay window. Do not shorten this to a few seconds or delete the entry immediately after completion; delayed mobile/PWA retries must not duplicate tool or external side effects.
- Run `npm run test:turn-safety` after changing chat admission, stream retention, the turn coordinator, process termination, or captured command results.

## 3A) Electron desktop trust boundary

- `electron/security.js` is the pure URL/port parsing boundary used by the desktop main process. Renderer trust is an exact parsed-origin comparison against `http://127.0.0.1:18789`; credentials, malformed URLs, alternate ports/hosts/schemes, child frames, and non-main-window senders are rejected.
- Every privileged `ipcMain.handle(...)` registration goes through `handleTrustedMain(...)`. Teach events are separate: they must come from the main frame of the currently presented native-browser `webContents`, whose partition must map to the active session.
- Main-window navigation and redirects stay on the exact gateway origin. Only credential-free `https:` links may be handed to the operating system; unsafe/custom schemes are blocked.
- The embedded browser accepts only credential-free HTTP(S) pages plus the internal `about:blank` sentinel. `file:`, `data:`, `javascript:`, and custom-protocol loads are rejected.
- Electron startup never kills an arbitrary process that happens to own port 18789. On Windows it reports the listening PID and refuses startup; watchdog/quit cleanup may terminate only the child process Electron itself spawned.
- Teach capture ignores synthetic DOM events, never derives element descriptions from input values, and drops fills for password, payment, OTP, token, recovery, seed/private-key, and client-secret fields. Delivery errors propagate instead of returning a false `{ ok: true }`.
- Run `npm run test:electron-security-boundary` after changing `electron/main.js`, either preload, or `electron/security.js`.

## 3B) Account/Auth Gate and Router Mounting

The gateway now mounts almost all application routes behind both gateway auth and account-login checks in `src/gateway/server-v2.ts`.

Account facts from `src/gateway/routes/account.router.ts`:

- Supabase sessions are kept in memory and persisted encrypted through the vault key `account.supabase.session`
- legacy `auth-session.json` is migrated into the vault and removed
- Prometheus is free to use; access requires a valid Supabase-authenticated account session, not Stripe or a subscription row
- `subscriptionActive`, `purchaseActive`, and `accessActive` remain as backward-compatible response fields and are true for any verified account session
- `/api/account/status?strict=1` performs a blocking account verification/refresh path
- expired sessions with refresh tokens are refreshed optimistically in normal status checks

Account routes currently include:

- `GET /api/account/config`
- `GET /api/account/status`
- `POST /api/account/login`
- `POST /api/account/login/password`
- `POST /api/account/logout`
- `POST /api/account/refresh`

WebSocket connections are closed with policy code `1008` when the account is not logged in. They no longer require subscription/admin entitlement.

Account-gated router mounts currently include:

- skills, tasks, channels, teams, settings, goals, proposals, audit log, connections, extensions
- canvas, projects, memory, Obsidian, Hub, migration, processes, coding, chat, onboarding
## 3B) Mobile Pairing, QR Codes, HTTPS, and Tailscale Remote Access

Mobile pairing is implemented as a desktop-approved device enrollment flow, not as a shared browser login.

Canonical source files:

- backend store: `src/gateway/pairing/pairing-store.ts`
- desktop-admin authorization: `src/gateway/pairing/pairing-admin-auth.ts`
- backend REST routes: `src/gateway/routes/pairing.router.ts`
- gateway auth gate: `src/gateway/gateway-auth.ts`
- router mount order and HTTP/HTTPS listener setup: `src/gateway/server-v2.ts`
- HTTP/HTTPS server behavior and redirect handling: `src/gateway/core/server.ts`
- desktop Pairing settings UI: `web-ui/src/pages/SettingsPage.js`
- Electron authority bridge: `electron/main.js` and `electron/preload.js`
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
- `POST /api/pairing/claim` also checks the server-side Prometheus account session via `getSessionStatus()` and requires `authenticated`. Pairing is therefore "phone logs into a free Prometheus account, then desktop approves the device."
- QR creation, pending-list, approval/denial, device management, remote-access settings, and Tailscale operations use `requirePairingAdmin`. A paired-device credential cannot satisfy this middleware.
- Electron generates `PROMETHEUS_PAIRING_ADMIN_TOKEN` per process, keeps it out of renderer JavaScript, and proxies only allowlisted pairing-admin requests through `window.prometheusPairingAdmin`.
- A manually started standalone gateway permits pairing administration without a token only when it is loopback-bound and the request is an exact same-origin browser request or a non-browser loopback client. LAN/wildcard binds require an explicit gateway credential.

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

Security boundary to preserve:

- `pairingRouter` is currently mounted before gateway auth so unpaired phones can claim challenges.
- Only certificate download, claim, poll, and `me` remain mobile/public-facing. QR creation is desktop-admin-only because challenge creation is part of the approval authority surface.
- Do not replace `requirePairingAdmin` with ordinary `requireGatewayAuth`: gateway auth accepts paired-device tokens by design, which would restore the self-approval/device-administration vulnerability.
- A leaked QR/human code is not a credential by itself because desktop approval is still required, but it can create pending approval prompts.

Tailscale First-Time Setup Runbook (Windows):

1. **Verify Tailscale is logged in** — open PowerShell and run `tailscale status`. You should see your machine's MagicDNS hostname (e.g. `fonso-pc.tailca7310.ts.net`). If not connected, run `tailscale up`.
2. **Enable Funnel in the admin console** — Funnel is off by default for every tailnet. Go to [login.tailscale.com/admin](https://login.tailscale.com/admin) → your machine → enable Funnel. Without this step the CLI command will error.
3. **Expose the gateway port** — run `tailscale funnel 18789` in PowerShell (use the actual port from `gateway.port` if changed). This creates a public `https://` route to `localhost:18789`. Run `tailscale funnel status` to confirm the port is listed.
4. **Configure remote access in the UI** — in the desktop app go to Settings → Pairing → Remote Access section:
   - Click **Detect Tailscale** — the UI calls `GET /api/pairing/tailscale/status`, checks the CLI, and shows your hostname plus a **"Use this URL"** button.
   - Click **"Use this URL"** — fills in `https://<your-machine>.tail…ts.net`.
   - Set mode to **Tailscale Funnel**, check **Enable**.
   - Click **Save** (calls `PUT /api/pairing/remote-access`).
5. **Regenerate the QR** — click **Regenerate QR** (or the refresh button). The response from `POST /api/pairing/qr` will now use the public Tailscale URL; a blue **"Remote access ON"** badge appears.
6. **Pair the phone** — scan the QR from iPhone Safari (or enter the human pair code in the Home Screen PWA), then approve the request on the desktop.

Windows-specific notes:
- The `tailscale` binary added by the Windows installer may not be in `%PATH%` for all shells. If `_runTailscaleCli` fails (installed=false in `/api/pairing/tailscale/status`), add the Tailscale install dir (typically `C:\Program Files\Tailscale`) to `PATH` and restart the gateway.
- The binary-search helpers in `workspace/oss agents/openclaw/src/infra/tailscale.ts` only probe macOS paths; they are not used by the desktop gateway, which calls `tailscale` directly via `spawn('tailscale', ...)` in `src/gateway/routes/pairing.router.ts:_runTailscaleCli`.
- Tailscale Funnel on Windows keeps running as a system service even after the terminal closes; it persists until you run `tailscale funnel reset`.
- The `x-forwarded-proto: https` check in `core/server.ts` ensures that Tailscale's HTTPS termination does not trigger the HTTP→HTTPS redirect loop (the gateway stays on plain HTTP internally; Tailscale handles TLS).

Self-edit verification checklist for pairing/remote access:

- After changing `src/gateway/*` TypeScript, run `npm run build:backend` or `npm run build`; the live gateway often serves `dist/gateway/server-v2.js`, so source edits alone are not live.
- After changing `web-ui/src/*`, run `npm run sync:web-ui` and `npm run check:web-ui` or `npm run build`.
- If the running gateway is serving generated web files on Windows, stop it before `npm run sync:web-ui` if generation fails with `EBUSY`.
- Restart the gateway after backend changes.
- Run `npm run test:pairing-admin-boundary`; it verifies remote/paired-token rejection, Electron authority, standalone loopback rules, and middleware coverage for every admin route.
- Smoke-test QR creation through the desktop Pairing UI/IPC bridge. Direct HTTP requires either the per-process desktop header or the configured gateway credential and should otherwise return 403.
- Smoke-test manual code claim from the phone/LAN origin by posting `{ code: pairCode, deviceName, deviceFingerprint }` to `/api/pairing/claim`; it should return `{ success: true, requestId, expiresAt }`.
- Clean up smoke-test pending requests through the desktop Pairing UI/IPC bridge.
- Verify protected LAN APIs still return 401 without `X-Pairing-Token`.
- Verify an approved mobile token reaches protected APIs through `X-Pairing-Token`.
- Verify old QR pages are not reused after challenge expiration or gateway restart.
