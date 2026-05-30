# 16) Prometheus Mobile App Maintenance Reference

Last verified against `web-ui/`, `generated/public-web-ui/`, `src/gateway/routes/`, gateway auth/session/delivery helpers, and package scripts on: 2026-05-28

Prometheus Mobile is a hash-routed PWA shell inside the existing web UI. It is not a separate native iOS/Android/Capacitor app in this repo. Treat `web-ui/src/mobile/*` as the canonical mobile app source and treat `generated/public-web-ui/static/mobile/*` as generated public-build output.

## Source Layout

Canonical mobile source files:

- `web-ui/src/mobile/mobile-router.js` - activates mobile mode, owns hash routing, sticky mobile-mode behavior, pairing gate, and page dispatch.
- `web-ui/src/mobile/mobile-shell.js` - mobile chrome, tab/drawer shell, session picker wiring.
- `web-ui/src/mobile/mobile-pages.js` - most mobile screens and behavior: chat, voice, tasks, creative, schedules, teams, subagents, proposals, pairing, delivery notifications, live run UI, and mobile audio.
- `web-ui/src/mobile/mobile-api.js` - thin API shim. Mobile fetches go through `mfetch`, which attaches `X-Pairing-Token`; media/WS URLs use query `pt`.
- `web-ui/src/mobile/mobile-settings.js` - mobile settings surfaces, including model/voice settings.
- `web-ui/src/mobile/mobile-data.js` - static first-pass/mock mobile nav/schedule/team data still used by parts of the shell.
- `web-ui/src/styles/mobile.css` - isolated mobile styling. It only takes over when `body.pm-mobile-active` is present.

Root PWA/static entry files:

- `web-ui/index.html` - includes mobile CSS, PWA metadata, `#mobile-root`, boot screen, and `src/mobile/mobile-router.js`.
- `web-ui/manifest.webmanifest` - PWA identity, start URL `/?source=pwa#mobile/chat`, shortcuts, icons, portrait display.
- `web-ui/service-worker.js` - PWA cache strategy and cache version.
- `web-ui/src/ws.js` - shared WebSocket event bus; mobile device token is added to `/ws` as `?pt=...`.
- `web-ui/src/api.js` - shared API helper; it also attaches the paired-device token when present.

Generated public copies:

- `generated/public-web-ui/index.html`
- `generated/public-web-ui/manifest.webmanifest`
- `generated/public-web-ui/service-worker.js`
- `generated/public-web-ui/static/mobile/*`
- `generated/public-web-ui/static/styles/mobile.css`
- `generated/public-web-ui/static/ws.js`

Never hand-edit generated mobile files except for emergency diagnosis. Make source changes under `web-ui/`, then sync generated output.

## Generated Files and Sync

The canonical sync path is:

- `npm run sync:web-ui`
- expands to `node scripts/prepare-public-build.js --web-only && npm run check:web-ui`
- `npm run check:web-ui` runs `node scripts/check-public-web-ui-sync.js`

`scripts/prepare-public-build.js` copies `web-ui/src` to `generated/public-web-ui/static`, transforms `web-ui/index.html` references from `src/` to `static/`, copies root-level PWA files, and vendors browser assets/fonts.

`scripts/check-public-web-ui-sync.js` compares source files against generated public copies, including root-level `manifest.webmanifest` and `service-worker.js`. A stale generated mobile file means the source may be right but public runtime output is not.

Service worker gotcha: `web-ui/service-worker.js` has a `VERSION` constant. Bump it on meaningful frontend/mobile changes or installed PWAs may keep old assets even after build/restart. The service worker intentionally never caches `/api/*`, `/ws`, or `/events`, so stale chat/auth/streaming data usually means app state or generated static files, not cached API responses.

## Activation and Routing

Mobile activates when `web-ui/src/mobile/mobile-router.js` sees one of:

- hash route beginning `#mobile`
- pathname `/mobile` or `/mobile/...`
- query `?pair=...`
- query `?source=pwa`
- sticky localStorage flag `pm_force_mobile`
- paired token in localStorage key `pm_device_token`

Once mobile mode is entered, the router writes `pm_force_mobile=1` so iOS/Android/PWA launches do not fall back to desktop UI if the hash/query is lost. If a paired token is missing and the current page is not `pair`, the router forces the pair page. `clearForceMobile()` removes only the sticky mobile flag, not the device token.

Primary routes currently dispatch from `mobile-router.js`:

- `#mobile/pair`
- `#mobile/chat` and `#mobile/chat/:sessionId`
- `#mobile/voice`
- `#mobile/tasks`
- `#mobile/creative`
- `#mobile/schedule`
- `#mobile/teams` and team detail routes
- `#mobile/subagents` and subagent detail routes
- `#mobile/proposals`
- `#mobile/settings`
- `#mobile/more`

## Pairing, Auth, and Remote Access

Pairing source:

- `src/gateway/routes/pairing.router.ts`
- `src/gateway/pairing/pairing-store.ts`
- `src/gateway/gateway-auth.ts`
- `src/gateway/server-v2.ts`
- `web-ui/src/mobile/mobile-api.js`
- `web-ui/src/mobile/mobile-pages.js`

`src/gateway/server-v2.ts` mounts `pairingRouter` before `requireGatewayAuth` and `requireAccountAccess`, so an unpaired phone can complete QR pairing. All normal API surfaces after that still go through gateway auth and account access.

Pairing endpoint flow:

- Desktop creates QR: `POST /api/pairing/qr`
- Phone claims QR: `POST /api/pairing/claim`
- Phone polls approval: `GET /api/pairing/poll/:id`
- Desktop lists/approves/denies pending requests: `GET /api/pairing/pending`, `POST /api/pairing/approve`, `POST /api/pairing/deny`
- Desktop manages devices: `GET /api/pairing/devices`, `PATCH /api/pairing/devices/:id`, `DELETE /api/pairing/devices/:id`
- Phone validates current token: `GET /api/pairing/me`
- Local HTTPS certificate download: `GET /api/pairing/certificate`

Remote/mobile reachability support in `pairing.router.ts`:

- QR origin resolution uses LAN IPv4 when the gateway is bound to `0.0.0.0`.
- `gateway.remoteAccess.publicUrl` is used when remote access is enabled.
- Tailscale/Funnel helpers: `GET /api/pairing/remote-access`, `PUT /api/pairing/remote-access`, `GET /api/pairing/tailscale/status`, `POST /api/pairing/tailscale/funnel/enable`, `POST /api/pairing/tailscale/funnel/disable`, `GET /api/pairing/tailscale/funnel/status`.
- `ensureTailscaleFunnel` and `startFunnelWatchdog` keep the configured Funnel alive from startup/runtime code.

Mobile auth mechanics:

- `mobile-api.js` stores the opaque token in `localStorage.pm_device_token`.
- HTTP requests add `X-Pairing-Token`.
- WebSocket/media URLs use `pt=<token>` because browsers cannot attach headers to those requests.
- `gateway-auth.ts` verifies paired-device tokens before checking the configured gateway token, so paired phones can work over LAN/remote access even when gateway token auth is enabled.
- If a token returns 401, `mobile-api.js` clears it and dispatches `pm-device-revoked`, causing the router to return to pairing.

## Chat, Sessions, and Channels

Mobile chat source:

- `web-ui/src/mobile/mobile-api.js`
- `web-ui/src/mobile/mobile-pages.js`
- `src/gateway/routes/chat.router.ts`
- `src/gateway/session.ts`
- `src/gateway/live-runtime-registry.ts`
- `src/gateway/comms/broadcaster.ts`
- `web-ui/src/ws.js`

Mobile default session:

- `MOBILE_CHAT_SESSION_ID` is `mobile_default`.
- New explicit mobile chat IDs are generated as `mobile_<timestamp>_<rand>`.
- `createMobileChatSession()` posts `POST /api/sessions` with `{ id, channel: 'mobile', title }`.

Mobile sends normal worker turns through `POST /api/chat` with SSE. `mobile-api.js::streamChat` includes:

- `sessionId`
- optional `clientRequestId`
- `origin: { channel: 'mobile', surface: 'mobile_app', device: 'phone', label: 'Mobile app', source: 'mobile_web_ui' }`
- attachments and caller context when present

`chat.router.ts` normalizes turn origin. A session ID beginning `mobile_` or an explicit `origin.channel='mobile'` becomes channel `mobile`, surface `mobile_app`, device `phone`. The injected origin context tells the model that mobile is only the contact channel; local desktop/browser/files/tools can still be available.

Mobile chat APIs:

- `GET /api/sessions?channel=mobile&limit=...&offset=...`
- `GET /api/sessions/search?q=...`
- `GET /api/sessions/:id`
- `POST /api/sessions`
- `POST /api/sessions/:id/history`
- `POST /api/sessions/:id/edit-rerun-reset`
- `DELETE /api/sessions/:id`
- `POST /api/sessions/:id/mobile-read`
- `GET /api/mobile/chat/runs`
- `GET /api/mobile/chat/runs/:sessionId`
- `GET /api/mobile/chat/stream/:sessionId?after=...`

Session behavior in `src/gateway/session.ts`:

- session/message channel type includes `mobile`
- `inferChannelFromSessionId` maps `mobile_*` to `mobile`
- mobile sessions are kept in the session index even when message count is zero
- `mobileLastReadAt` and `mobileUnread` are part of session summaries
- `markSessionReadForMobile()` updates `mobileLastReadAt`

Live stream behavior:

- `chat.router.ts` tracks `mainChatStreams` per session and appends frames through `appendMainChatStreamEvent`.
- `appendMainChatStreamEvent` broadcasts `main_chat_stream_event` over WebSocket to all clients.
- Mobile can replay missed events through `GET /api/mobile/chat/stream/:sessionId`.
- `web-ui/src/ws.js` auto-reconnects and routes WebSocket events through `wsEventBus`.

Mobile command endpoints:

- `GET /api/mobile/commands/models`
- `GET /api/mobile/commands/stop-targets`
- `POST /api/mobile/commands/stop-now`
- `POST /api/mobile/commands/stop`
- `POST /api/mobile/commands/screenshot`
- `POST /api/lifecycle/restart` via `restartMobileGateway()` in `mobile-api.js`

## Voice, Wake, Interruption, and Audio

Voice/mobile source:

- `web-ui/src/mobile/mobile-pages.js`
- `web-ui/src/mobile/mobile-api.js`
- `src/gateway/routes/chat.router.ts`
- `src/gateway/routes/voice.router.ts`
- `src/gateway/routes/realtime.router.ts`
- `src/gateway/live-runtime-registry.ts`
- `web-ui/service-worker.js`

Mobile supports regular browser/server voice and Realtime/WebRTC paths. Relevant endpoints:

- `GET /api/voice/status`
- `GET /api/voice/voices?provider=...`
- `POST /api/voice/stt`
- `POST /api/voice/tts`
- `GET /api/voice/audio/:id`
- `GET /api/realtime/status`
- `GET /api/realtime/context-pack`
- `POST /api/realtime/client-secret`
- `POST /api/realtime/call`
- `POST /api/mobile/voice-debug`

Realtime/mobile audio details:

- `mobile-pages.js` chooses supported `MediaRecorder` MIME types, preferring iOS-friendly formats where needed.
- Realtime SDP exchange can go through the gateway `POST /api/realtime/call` or direct client-secret flow through `POST /api/realtime/client-secret`.
- Server TTS playback uses Web Audio when possible and falls back to an HTML audio element.
- `service-worker.js` never caches voice/realtime API calls.

Voice Agent and interruptions:

- `POST /api/voice-agent/context`
- `GET /api/voice-agent/context/:sessionId`
- `POST /api/voice-agent/input`
- `POST /api/voice-agent/narrate`
- legacy/mobile-specific `POST /api/mobile/voice/interruption`

`chat.router.ts` builds a Voice Worker context packet from active main-chat runtime state, recent stream events, tool/process activity, browser/desktop advisor packets, and recent messages. Mobile prewarms this packet before voice turns and sends voice runtime context such as wake phrase and quiet-mode state.

Current behavior to preserve:

- Ordinary spoken mobile turns are not always interruptions.
- If no active worker/stream exists, `/api/voice-agent/input` broadcasts `voice_agent_turn`.
- If a worker is active, or the Voice Agent chooses `steer_worker` or `interrupt_worker`, it broadcasts `voice_interruption`.
- `steer_worker` queues a pending runtime steer through `live-runtime-registry`.
- `interrupt_worker` aborts an abortable active runtime.
- `handoff_new_work` stores a handoff marker so the client can speak the Voice Agent acknowledgement first, then start the normal `/api/chat` worker turn.

Wake phrase behavior is split:

- Mobile applies wake phrase changes locally first for responsiveness.
- Mobile still sends the utterance to `/api/voice-agent/input` so Prometheus can acknowledge it.
- Backend receives `voiceRuntime` context and injects runtime note text for the Voice Agent.

Debugging voice:

- `server-v2.ts` logs selected pre-auth voice/mobile endpoints to `D:\Prometheus\voice-xai-debug.log`.
- `mobile-pages.js` posts client-side voice debug events to `POST /api/mobile/voice-debug`.
- For mobile microphone capture on real phones, HTTPS is usually required. Pairing certificate and remote-access/Tailscale paths are part of this story.

## Delivery, Push, Telegram, and Origin

There is no native push-notification service in this PWA path. Mobile delivery is currently WebSocket/in-app delivery plus session unread state.

Source files:

- `src/gateway/delivery-router.ts`
- `src/gateway/comms/broadcaster.ts`
- `src/gateway/tool-builder.ts`
- `web-ui/src/mobile/mobile-pages.js`
- `web-ui/src/ws.js`
- `src/gateway/comms/telegram-channel.ts`
- `src/gateway/comms/telegram-persona-bots.ts`
- `src/gateway/comms/telegram-team-room-bridge.ts`

Origin-aware delivery:

- `delivery-router.ts` target values include `origin`, `telegram`, `mobile`, `web`, `discord`, `whatsapp`, `terminal`, and `all`.
- `inferOriginChannel()` prefers session channel hints, then latest user origin, then session channel, then session ID prefix.
- `mobile_*` sessions infer origin `mobile`.
- Delivery to `mobile` sends a `delivery_notification` WebSocket event, optionally with image data or attachment path.
- `mobile-pages.js` listens for `delivery_notification` targeted to `mobile` or `all`, appends it into the mobile chat thread, and converts delivered media into mobile media previews.

Telegram remains a separate channel. Cross-channel behavior matters because a mobile-origin worker can still deliver to Telegram if the user or tool explicitly targets Telegram. Conversely, Telegram-origin sessions have their own session IDs and live stream events but are visible to desktop/mobile session lists through the shared session/channel model.

## Commands and Workflow

Common development commands:

- `npm run sync:web-ui` - sync `web-ui` source into generated public web UI and verify.
- `npm run check:web-ui` - verify generated public web UI is current.
- `npm run build:web` - currently aliases to `npm run check:web-ui`.
- `npm run build:backend` - TypeScript build plus creative renderer copy.
- `npm run build` - backend build plus web sync check.
- `npm run gateway` - start gateway from TypeScript.
- `npm run electron` - start desktop Electron shell.
- `npm run build:public` - full public runtime build path including generated web UI, public release packaging, and verification.

Live dev-edit workflow for mobile:

- Edit `web-ui/src/mobile/*`, `web-ui/src/styles/mobile.css`, `web-ui/service-worker.js`, `web-ui/manifest.webmanifest`, or shared files such as `web-ui/src/ws.js`.
- Run `npm run sync:web-ui`.
- If backend route/session/auth changes were also made, run `npm run build:backend` or `npm run build`.
- Restart gateway/electron if backend changed.
- Reload mobile clients. A `dev_reload_requested` WebSocket event can target `mobile`; `web-ui/src/ws.js` clears Prometheus service-worker caches before reloading mobile routes.

Prometheus' internal dev helper rule is recorded in `src/gateway/prompt-context.ts`: mobile app source is under `web-ui/src/mobile/*`; do not hand-edit generated public copies; after live mobile edits, apply/sync through the mobile/web-ui change path.

## Gotchas

- Sticky mobile mode is intentional. A phone may keep showing mobile UI because `pm_force_mobile=1` or `pm_device_token` exists.
- Generated output can be stale even when `web-ui` source is correct. Run `npm run sync:web-ui`.
- Service worker cache version must be bumped for meaningful PWA/static changes.
- API/SSE/WS requests are not service-worker cached; stale API-looking behavior is usually stale JS, token state, session state, or gateway state.
- Phone microphone capture usually needs HTTPS, not plain LAN HTTP.
- Pairing endpoints are intentionally mounted before auth. Normal API access still requires a valid paired token/gateway auth and account access.
- Mobile media elements need `?pt=` URLs for auth; headers do not work for `<img>`, `<video>`, or WebSocket construction.
- `mobile_default` is both the default new mobile draft/session target and a real mobile channel session in several code paths. Avoid accidentally hijacking a fresh new-chat state with old restart/session notifications.
- `clientRequestId` is used with the mobile dedupe map in `chat.router.ts`; keep it stable for retried mobile sends, unique for new sends.
- Do not assume mobile means Prometheus lacks local computer capabilities. The gateway injects origin context saying the contact channel is mobile while local tools may still be available.
- Mobile and desktop share WebSocket broadcasts. Handlers must filter by target/channel when a message should affect only mobile or only desktop.
- Tailscale Funnel remote access must use an HTTPS public URL. The pairing QR origin uses configured remote access when enabled.

## Verification Checklist

For source-only mobile UI changes:

- Confirm changed source lives under `web-ui/`, not only `generated/public-web-ui/`.
- Run `npm run sync:web-ui`.
- Check that `generated/public-web-ui/static/mobile/*`, `static/styles/mobile.css`, root `service-worker.js`, or root `manifest.webmanifest` updated when expected.
- If service-worker-controlled assets changed, confirm `web-ui/service-worker.js` `VERSION` changed.
- Open `/?source=pwa#mobile/chat` and verify the app stays in mobile mode after refresh.
- Verify an unpaired browser goes to `#mobile/pair`.
- Verify a paired token adds `X-Pairing-Token` on API calls and `pt` on WS/media URLs.

For mobile chat/session changes:

- Send a mobile chat turn and verify `POST /api/chat` SSE returns `token`/`final`/`done`.
- Verify session summary is channel `mobile`.
- Verify `GET /api/mobile/chat/runs` and `GET /api/mobile/chat/stream/:sessionId` reflect active/recent stream state.
- Verify `POST /api/sessions/:id/mobile-read` clears mobile unread state.
- Verify desktop still receives `main_chat_stream_event` for the mobile-origin session.

For pairing/remote access:

- Generate a QR from desktop with `POST /api/pairing/qr`.
- Claim from mobile via `POST /api/pairing/claim`.
- Approve from desktop and verify mobile receives/stores `deviceToken` from `GET /api/pairing/poll/:id`.
- Revoke the device and verify mobile gets 401, clears token, and returns to pairing.
- If using LAN, confirm gateway host is reachable from phone. If using Tailscale/Funnel, confirm remote access public URL is HTTPS and Funnel status is active.

For mobile voice:

- Verify `GET /api/voice/status` and `GET /api/realtime/status` from paired mobile.
- Test browser/server STT and TTS paths.
- Test Realtime SDP path if enabled.
- Test a normal no-active-worker voice turn: expect `voice_agent_turn`.
- Test speaking while an active worker is running: expect `voice_interruption` and either steer or abort behavior.
- Inspect `D:\Prometheus\voice-xai-debug.log` only for voice endpoint diagnostics; do not treat it as durable app state.

