## 2) Startup, Config Root, and Workspace Resolution

Last source verification: 2026-09-05.

- Config/workspace resolution is centralized in `src/config/config.ts`.
- Config dir precedence remains:
  - `PROMETHEUS_DATA_DIR/.prometheus`
  - project-local `.prometheus/`
  - `~/.prometheus/`
- Default workspace resolution is runtime/config driven. Self-documentation must use repository-relative source paths and symbolic runtime roots such as `<configDir>` / `<workspaceRoot>` rather than a workstation-specific checkout path.
- Retired pre-`.prometheus` startup migration is not a current runtime boundary; storage-v2 owns supported `.prometheus` state.

## 3) Canonical Runtime Surfaces

Current source owners:

- `src/gateway/core/startup.ts` — startup boot orchestration.
- `src/gateway/core/app.ts` — Express app creation and the current `/api/health` response.
- `src/gateway/core/server.ts` and `src/gateway/server-v2.ts` — HTTP/HTTPS server wiring, `/api/status`, route mounting, gateway queues, worker warmup/shutdown, and runtime lifecycle.
- `src/gateway/routes/chat.router.ts` — main chat route/tool-loop orchestration and streaming.
- `src/gateway/session.ts` — session/history persistence and workspace binding.
- `src/gateway/live-runtime-registry.ts` and `src/gateway/runtime-recovery.ts` — live runtime ownership and recovery.
- `src/gateway/context/model-context.ts` — provider-aware context profiles, token estimates, and compaction/input budget math.
- `src/gateway/prompt-context.ts` — dynamic tool/memory/project prompt blocks.
- `src/gateway/tool-builder.ts` — core/category/connector/composite/MCP tool assembly.
- `src/gateway/tool-observations.ts` — compact tool-observation persistence used by future-turn context.
- `src/gateway/file-change-summary.ts` — file-change summaries, including recovery from persisted process entries.
- `src/gateway/browser-tools.ts` — browser automation/runtime state.
- `src/gateway/tasks/background-task-runner.ts` — autonomous task execution.
- `src/gateway/mcp-manager.ts` — MCP client/config manager.
- `src/gateway/comms/telegram-channel.ts` — Telegram bridge/commands.
- `src/gateway/routes/account.router.ts` — account login/session state.
- `src/gateway/routes/processes.router.ts` — managed process supervisor API.
- `src/gateway/routes/coding.router.ts` — coding workspace/session, diff, branch, stage, and commit operations.
- `src/gateway/routes/onboarding.router.ts` — onboarding/tutorial/model/memory-seed state.

### Current internal worker map

Internal worker code is no longer organized under the old `src/gateway/turn-workers/` tree.

- `src/gateway/process/runtime-worker-protocol.ts`, `runtime-worker-broker.ts`, and `runtime-worker-resources.ts` provide the generic bounded child-process lifecycle/telemetry layer.
- Memory-index refresh: `src/gateway/process/memory-index-worker.ts` + `src/gateway/memory-index/refresh-worker-client.ts`.
- Memory search: `src/gateway/process/memory-search-worker.ts` + `src/gateway/memory-index/search-worker-client.ts`.
- Context build: `src/gateway/process/context-build-worker.ts` + `src/gateway/chat/context-build-worker-client.ts`.
- Model calls: `src/gateway/process/model-call-worker-protocol.ts`, `model-call-worker-pool.ts`, and `model-call-worker.ts`; `src/agents/ollama-client.ts` dispatches through this pool when enabled.
- Brain activity packaging: `src/gateway/brain/activity-package-worker-client.ts`.
- Thread/session search has current child-process coverage under `src/gateway/threads/session-search-worker.regression.ts`.

See [30-runtime-process-isolation.md](30-runtime-process-isolation.md) for the verified worker map and retired-name list.

### Main-chat turn safety and recovery

- Complete chat/tool orchestration is still gateway-owned; targeted hot paths are isolated rather than putting each complete turn in its own OS process.
- `src/gateway/chat/turn-coordinator.ts` remains the immediate same-session turn coordination boundary where used by current chat execution.
- Current durable chat/session authority is session/history state plus live-runtime/recovery state, not the deleted `src/gateway/turn-jobs/` SQLite journal architecture.
- `src/gateway/runtime-recovery.ts` reconstructs recoverable runtime/assistant state from current live/session/process-entry data and uses `collectTurnFileChangesFromProcessEntries(...)` from `file-change-summary.ts` when recovering file-change metadata.
- `/api/chat`/mobile retry and idempotency behavior must be verified against the current chat/router source before changing replay windows or conflict semantics; do not infer those rules from the retired turn-journal design.

### Runtime observability and lifecycle

- `GET /api/health` currently reports gateway basics, active runtimes, and `memoryMaintenance`. It does **not** expose `/api/health.turnRuntime`.
- `GET /api/status` exposes current internal queue/worker state under `gatewayQueues`, including `contextBuild`, `contextBuildWorkers`, `modelCallWorkers`, `brainActivityWorker`, and current post-turn/session status producers wired by `server-v2.ts`.
- Shutdown/restart wiring in `server-v2.ts` awaits the current internal worker pools and current persistence queues. Do not document shutdown dependencies for worker/journal subsystems that no longer exist.
- The retired `src/gateway/turn-jobs/`, `src/gateway/turn-delivery/`, `<configDir>/runtime/turn-jobs.sqlite`, `<configDir>/runtime/turn-blobs/`, `/api/turn-blobs/:hash`, file-change worker pool, context-footprint worker, and tool-observation-persistence worker pool are not current runtime architecture.

## 3A) Electron desktop trust boundary

- `electron/security.js` is the pure URL/port parsing boundary used by the desktop main process. Renderer trust is an exact parsed-origin comparison against `http://127.0.0.1:18789`; credentials, malformed URLs, alternate ports/hosts/schemes, child frames, and non-main-window senders are rejected.
- Privileged `ipcMain.handle(...)` registrations must stay behind the trusted-main boundary. Teach events are separate and must come from the active native-browser main frame/partition.
- Main-window navigation and redirects stay on the gateway origin. Only credential-free `https:` links may be handed to the operating system; unsafe/custom schemes are blocked.
- The embedded browser accepts credential-free HTTP(S) pages plus the internal `about:blank` sentinel; `file:`, `data:`, `javascript:`, and custom-protocol loads are rejected.
- Electron startup must not kill an arbitrary process merely because it owns port 18789; watchdog/quit cleanup may terminate only a process tree Electron owns.
- Teach capture must not derive descriptions from secret input values and must drop fills for password/payment/OTP/token/recovery/seed/private-key/client-secret fields.
- Run `npm run test:electron-security-boundary` after changing the Electron trust boundary.

## 3B) Account/Auth Gate and Router Mounting

The gateway mounts application routes behind gateway/account checks in `src/gateway/server-v2.ts`, with pairing/bootstrap exceptions that must remain deliberately ordered.

Account source: `src/gateway/routes/account.router.ts`.

Current account routes include:

- `GET /api/account/config`
- `GET /api/account/status`
- `POST /api/account/login`
- `POST /api/account/login/password`
- `POST /api/account/logout`
- `POST /api/account/refresh`

`src/gateway/gateway-auth.ts` owns the gateway credential/paired-device authorization boundary. Do not move unpaired pairing claim/bootstrap routes behind a middleware that requires an already-paired credential.

## 3B) Mobile Pairing, QR Codes, HTTPS, and Tailscale Remote Access

Mobile pairing is a desktop-approved device enrollment flow, not a shared browser login.

Canonical source files:

- `src/gateway/pairing/pairing-store.ts`
- `src/gateway/pairing/pairing-admin-auth.ts`
- `src/gateway/routes/pairing.router.ts`
- `src/gateway/gateway-auth.ts`
- `src/gateway/server-v2.ts`
- `src/gateway/core/server.ts`
- `web-ui/src/pages/SettingsPage.js`
- `electron/main.js` and `electron/preload.js`
- `web-ui/src/mobile/mobile-pages.js`
- generated public UI mirrors under `generated/public-web-ui/static/`

### Pairing model

- Desktop creates a short-lived pairing challenge through `POST /api/pairing/qr`.
- Mobile claims through `POST /api/pairing/claim` and polls `GET /api/pairing/poll/:requestId`.
- Desktop approval uses `POST /api/pairing/approve`; denial/device management stay desktop-admin operations.
- The resulting opaque device token is stored on mobile as `pm_device_token` and sent as `X-Pairing-Token`; WebSocket/media URLs use the supported paired-token query path because browsers cannot attach arbitrary WS headers.
- Persisted paired-device records store token hashes rather than plaintext device tokens.
- Challenges/pending requests are intentionally short-lived and are not durable credentials.
- Device removal/revocation uses the pairing device routes.

### Mount and authority rules

- Pairing claim/poll/bootstrap routes that must work before a device is paired must remain reachable before the ordinary paired/gateway auth gate.
- Administrative pairing routes use `requirePairingAdmin`; a paired-device token must not become sufficient authority to create/approve challenges or manage other devices.
- Electron keeps the pairing-admin authority outside renderer JavaScript and proxies an allowlisted administration surface.
- A manually started gateway may use its explicitly supported loopback administration boundary; LAN/wildcard administration requires real authority rather than trusting network locality.

### iOS/PWA behavior

- iOS Safari and an Add-to-Home-Screen PWA can have different storage containers.
- Camera QR scanning opens Safari rather than guaranteeing entry into the installed PWA.
- Preserve manual pair-code entry inside the Home Screen app and the sticky mobile-mode recovery path.

### LAN, HTTPS, and remote access

- LAN use requires a non-loopback bind when another device must reach the gateway.
- Browser camera/microphone features require a secure context; HTTPS/Tailscale termination matters independently of whether plain HTTP can render the page.
- `gateway.remoteAccess` and pairing router helpers own the supported remote-access/Tailscale behavior.
- `core/server.ts` must preserve the `x-forwarded-proto: https` handling needed when TLS terminates in front of the gateway.
- Remote access does not replace pairing approval; it changes reachability, not device authority.

### Pairing/remote-access verification

After changing this boundary:

- build/restart backend code as appropriate;
- sync/check generated web UI after `web-ui/` changes;
- run `npm run test:pairing-admin-boundary`;
- smoke-test desktop QR creation/approval and mobile claim/poll;
- verify unauthenticated protected LAN APIs still fail;
- verify an approved mobile token reaches protected APIs;
- verify paired-device credentials cannot administer pairing authority.

## Self-documentation maintenance rule for this file

This file describes runtime ownership, so stale implementation names are especially dangerous. Before adding an implementation path/API/status field here, verify it exists on current source. If a subsystem moves or is removed, update this file, [11-run-and-supervisor.md](11-run-and-supervisor.md), [30-runtime-process-isolation.md](30-runtime-process-isolation.md), and any affected mobile/desktop cross-reference together.
