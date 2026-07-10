# 16) Prometheus Mobile App Maintenance Reference

Last verified against `web-ui/`, `generated/public-web-ui/`, `src/gateway/routes/`, gateway auth/session/delivery helpers, mobile main-chat WebSocket stream handling, mobile camera-roll video attachments, mobile subagent Home chat/Runs recovery surfaces, iOS Home Screen Web Push for chat/task/subagent/team/scheduled-job events, and package scripts on: 2026-06-30

Prometheus Mobile is a hash-routed PWA shell inside the existing web UI. It is not a separate native iOS/Android/Capacitor app in this repo. Treat `web-ui/src/mobile/*` as the canonical mobile app source and treat `generated/public-web-ui/static/mobile/*` as generated public-build output.

## Source Layout

Canonical mobile source files:

- `web-ui/src/mobile/mobile-router.js` - activates mobile mode, owns hash routing, sticky mobile-mode behavior, pairing gate, and page dispatch.
- `web-ui/src/mobile/mobile-shell.js` - mobile chrome, tab/drawer shell, session picker wiring.
- `web-ui/src/mobile/mobile-pages.js` - most mobile screens and behavior: chat, voice, tasks, creative, schedules, teams, subagents, proposals, pairing, delivery notifications, live run UI, and mobile audio.
- `web-ui/src/mobile/mobile-api.js` - thin API shim. Mobile fetches go through `mfetch`, which attaches `X-Pairing-Token`; media/WS URLs use query `pt`.
- `web-ui/src/mobile/mobile-settings.js` - mobile settings surfaces, including model/voice settings.
- `web-ui/src/mobile/mobile-data.js` - static first-pass/mock mobile nav/schedule/team data still used by parts of the shell.
- `web-ui/src/styles/mobile.css` - isolated mobile styling. It only takes over when `body.pm-mobile-active` is present; mobile themes use `--pm-*` surface tokens and semantic `--pm-accent*` tokens, while legacy `--pm-orange*` variables are compatibility aliases.


Mobile canvas/file viewer fullscreen mode: `initMobileCanvasSheet()` in `web-ui/src/mobile/mobile-shell.js` owns the canvas sheet chrome and fullscreen state. The toolbar includes `#pm-canvas-fullscreen`; when active, `.pm-canvas-sheet.is-fullscreen` hides the handle, file tabs/header, filename, Interact/Inspect, Preview, and Save chrome, leaving only `#pm-canvas-fullscreen-exit` as a top-right safe-area-aware X overlay. Styles live in `web-ui/src/styles/mobile.css`; keep source changes synced with `npm run sync:web-ui`. [2026-06-30]

Mobile reasoning/model control (2026-07-09): `web-ui/src/mobile/mobile-model-badge.js` renders the header-badge tap surface as a compact model-and-effort summary (`Model · Effort ›`) above a segmented range slider. Opening it uses a voice-mode-style bottom takeover that obscures roughly the lower third of the chat and centers the controls; reasoning-specific positioning bypasses the normal header-badge popover coordinates. Tapping the centered summary opens the existing credentialed provider → model picker; changing the range persists `reasoning_effort` through `/api/settings/provider` with haptic step feedback. The takeover variant is styled by `.pm-msheet-scrim.is-reasoning`, `.pm-msheet.is-reasoning`, and `.pm-reasoning-*` in `web-ui/src/styles/mobile.css`. Keep model/provider selection grouped in the dedicated picker rather than reintroducing inline settings selects or permanent Fast/Deep labels.

Mobile canvas live HTML asset linking: workspace HTML files opened in the mobile canvas must iframe through the path-shaped route `/api/canvas/workspace/<workspace-relative-path>` instead of query-style `/api/canvas/inline?path=...`. This preserves the browser URL directory so relative assets like `assets/zombie.png`, local CSS, JS, audio, and images resolve from the HTML file's own subdirectory on mobile. Keep `/api/canvas/inline` for direct media/file previews and downloads. [2026-07-01]
Mobile background visual rule: `body.pm-mobile-active` and `.pm-app` must use flat theme background colors only. Do not add page-level radial/conic/linear background-image glow layers or pseudo-element glow overlays for any theme/skin; component-local shadows are okay, but the app backdrop itself should have no glow. [2026-06-29]

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

Service worker gotcha: `web-ui/service-worker.js` has a `VERSION` constant. Bump it on meaningful frontend/mobile changes or installed PWAs may keep old assets even after build/restart. The service worker intentionally never caches `/api/*`, `/ws`, or `/events`, so stale chat/auth/streaming data usually means app state or generated static files, not cached API responses. Current version: `pm-v69-2026-06-19-mobile-deep-links`. [2026-06-19]

Session cache: `web-ui/src/mobile/mobile-api.js` caches `loadMobileChatSession` results in-memory for 30s (max 20 entries). Use `invalidateMobileChatSessionCache(sessionId?)` to bust. Cache is automatically busted on `updateMobileChatSessionHistory` writes. This makes revisiting the same chat instant within the TTL window. [2026-06-17]

Recovery parallelism: `refreshMobileRunRecovery` in `mobile-pages.js` now fires `loadMobileChatRunStatus` + `loadMobileChatSession` in parallel (batch 1), then `loadMobileApprovals` + `loadMobileQuestions` in parallel (batch 2). Previously all were serial awaits — a 5-call waterfall on every reconnect. [2026-06-17]

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

Mobile thinking / live tool-stream policy (desktop parity, 2026-07-08):

- Desktop `ChatPage.js` buffers raw `thinking_delta` (`source: thinking`) and only live-appends when `source === 'reasoning_summary'`; full `thinking` / `agent_thought` become clean think rows; burst flushes into process log on non-thinking events.
- Mobile now matches that policy in `mobile-pages.js`: helpers `_flushMobilePendingThinkingBurst`, `_handleMobileThinkingDelta`, `_handleMobileCleanThought`, `_maybeFlushMobileThinkingBeforeEvent`.
- Live paths: `applyMobileChatStreamEvent`, `applyMobileSideStreamEvent`, voice `onThinking`/`onThought`, and `_applyMobileAgentStreamEvent`.
- `mobile-api.js` passes `onThinking(text, { source })` and emits `onThought` for complete thought blocks.
- Do not dump every raw thinking token into `liveTraceEntries`; keep tools + clean thoughts only.

Mobile chat attachment path:

- `web-ui/src/mobile/mobile-pages.js` owns the mobile chat attachment picker, attachment normalization, staged attachment chips, upload result mapping, and the shared team/subagent mobile composer.
- Main mobile chat file input is `#pm-file-input`; shared team/subagent composer inputs are generated as `${id}-file-input`.
- Camera-roll/file-picker video support was added on 2026-06-05 by allowing `video/*` plus common video extensions (`.mp4`, `.mov`, `.m4v`, `.webm`, `.avi`, `.mkv`) in both mobile chat inputs.
- `_normalizeMobileFile(file)` now treats `mimeType.startsWith('video/')` as `kind: 'video'`. Videos intentionally are not converted into in-memory data URLs during staging; they upload as binary files through the existing canvas upload path.
- `_uploadMobileChatAttachments(files)` preserves `isVideo` alongside `isImage`, and mobile send mappings convert uploaded videos back to `kind: 'video'` so chat previews and runtime attachment metadata do not collapse them into generic files.
- `_renderChatAttachmentPreviews(...)` can render uploaded video chips with `<video muted playsinline preload="metadata">`; `web-ui/src/styles/mobile.css` styles `.pm-attach-chip.video video`.
- Uploaded mobile videos are saved through `uploadMobileBinaryFile(...)` -> `POST /api/canvas/upload-binary`, which stores them under `workspace/uploads/` and returns a workspace path. The runtime prompt receives that exact path via `[UPLOADED FILES]`, so agents should use the media/video tools or workspace path directly to inspect/process the clip.
- Keep generated mirrors in sync: `generated/public-web-ui/static/mobile/mobile-pages.js` and `generated/public-web-ui/static/styles/mobile.css`.
- Because this is PWA-facing static JS/CSS, bump `web-ui/service-worker.js` `VERSION` on meaningful attachment/picker changes; the 2026-06-05 video attachment change uses `pm-v29-2026-06-05-mobile-video-attachments`.
- Verification used for this change: `npm run sync:web-ui`, which regenerated public assets and passed `check:web-ui`.


Mobile subagent chat layout:

- `mobile-pages.js::_renderSubagentChatTab` wraps the subagent message list and queue in `.pm-sa-chat-scrollport`, then renders the shared `_renderMobileAgentComposerHtml('pm-sa-chat', ...)` composer outside that scrollport.
- `mobile.css` scopes `.pm-sa-chat-shell` as a flex column with a scrollable `.pm-sa-chat-scrollport` and a sticky `.pm-agent-chat-composer.pm-composer` offset above `--pm-tabbar-h` plus safe-area inset. This prevents the subagent composer from sitting under the bottom tab bar while preserving normal main-chat composer geometry.
- Subagent Home chat must stay a normal conversational thread. Do not route a Home chat send into a paused/stalled run just because the subagent owns one.
- `mobile-api.js::streamSubagentChat` sends Home chat through `/api/agents/:id/chat/stream`; it should forward `attachmentPreviews` so images/video/files selected in the shared composer reach the subagent runtime.
- For non-OK subagent stream responses, read the response body and surface `Chat HTTP <status>: <detail>` when possible. A generic "HTTP failed" hides provider/model/backend errors and makes mobile debugging much harder.

Mobile subagent Runs/recovery layout:

- `mobile-pages.js::_renderSubagentRunsTab` uses `loadSubagentRuns(agentId)` and `loadSubagentRun(agentId, taskId)` from `mobile-api.js` to render task cards for the selected subagent.
- The Runs tab is the canonical mobile surface for subagent task status, prompt/output/progress/process detail, and paused/stalled/needs-assistance recovery.
- Recovery chat inside a run card uses the normal mobile agent chat bubble renderer (`_renderMobileAgentChatBubble`) and shared composer (`_renderMobileAgentComposerHtml`) so it visually matches regular chats instead of the old beige task-panel UI.
- Recovery sends through `sendSubagentRunRecovery(agentId, taskId, message, attachmentPreviews)`, which posts to `POST /api/agents/:id/runs/:taskId/recovery`.
- The run recovery composer supports the same staged attachment flow as Home subagent chat through `_installMobileAgentComposer` and `_uploadMobileChatAttachments`. On phones, `accept="image/*,video/*,..."` lets the platform offer photo library/camera options without forcing camera-only capture.
- Recovery replies should reload the specific run detail after send, not append fake local-only state that can diverge from the task store.

Mobile composer expansion behavior:

- The main mobile chat composer and shared agent/task composer stay compact as a single-line pill while idle.
- `mobile-pages.js` toggles `.is-focused`, `.has-text`, and `.has-attachments` on `.pm-composer`; `mobile.css` uses those classes to expand the panel upward.
- In expanded mode, `.pm-composer-row` becomes a two-row grid: the textarea/input wrap spans the top row, and attach/mic/send controls sit in the bottom toolbar row.
- Focused-empty composer state should stay short; the textarea grows with actual line count and caps around half the visible UI before using its own internal scroll.
- The mic button belongs on the right beside the send/abort button, not beside the attachment button.
- Browser speech dictation into the composer must call the same post-input sync path as typing: resize the textarea, refresh slash/skill rich preview state, update composer expansion classes, scroll the caret into view, and recalculate composer space.
- This keeps typed text above the buttons like modern chat apps while preserving the old compact composer when the field is not active and empty.
- Service worker version for this change: `pm-v117-2026-06-30-mobile-dictation-composer-wrap`.

Mobile drawer behavior:

- The left hamburger drawer is intentionally full-screen on mobile: `.pm-drawer` in `web-ui/src/styles/mobile.css` uses full shell width rather than the old `min(78vw, 320px)` side-panel width. Keep this as a full-screen overlay unless the mobile UX requirement explicitly changes.
- Drawer chat rows mark the currently open chat with `is-active-session` and `aria-current="page"`. `web-ui/src/mobile/mobile-shell.js` resolves the active row from `window.__pmChat.activeSessionId`, `#mobile/chat/:sessionId`, then `pm_mobile_last_chat_session`, excluding the `mobile_default` draft session.
- The active chat highlight is styled in `mobile.css` as an orange/gold ring/glow on `.pm-session-row.is-active-session`, and it applies to normal drawer rows and search-result rows while preserving working/unread state labels.

Mobile chat markdown tables and timestamp reveal:

- Assistant bubbles use `renderMd` → `.markdown-body` inside `.pm-bubble` (`web-ui/src/styles/mobile.css`). Wide tables use `width: max-content` with horizontal scroll on `.markdown-body:has(table)` (`overflow-x: scroll`, thin always-visible scrollbar, `touch-action: pan-x pan-y`).
- iMessage-style swipe-left on the thread to reveal `.pm-reveal-time` is installed in `mobile-pages.js::_installMobileTimestampReveal` on `.pm-chat-thread` (CSS `--pm-time-reveal-x` / `.pm-time-revealing`). Horizontal swipes on markdown that contains a table must not start time reveal: `isInteractiveTarget` treats `.pm-bubble .markdown-body` with a `table` as interactive so table scrolling wins over thread translate.

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
- `web-ui/src/ws.js` auto-reconnects with **exponential backoff** (1s→2s→4s→8s→16s→30s cap) and routes WebSocket events through `wsEventBus`. When `navigator.onLine` is false it stops retrying and waits for the browser `online` event instead of hammering the server. Dispatches `ws:reconnecting` (with `delayMs`/`attempt`), `ws:open`, `ws:close`, `ws:error`, and `ws:waiting_for_network` events. A `_wsConnecting` flag prevents double-connect races. [2026-06-17]
- Active mobile run recovery is now **incremental-first** on reconnect/focus/WebSocket-open recovery: `refreshMobileRunRecovery` preserves an existing live assistant bubble when it already has text, `processEntries`, or `liveTraceEntries`, fetches `/api/mobile/chat/stream/:sessionId?after=<lastSeq>`, and appends only missed/new frames. It only resets the live bubble and replays from `after=0` for cold recovery or when replay metadata shows the retained server buffer starts after the phone's last seen sequence (`firstSeq > lastSeq + 1`). This prevents the Process/tool stream from disappearing and reloading from the beginning while Prometheus is still working. `MAIN_CHAT_STREAM_MAX_EVENTS` is 1600 to keep long tool-heavy turns recoverable. Service worker version for this fix: `pm-v58-2026-06-17-incremental-stream-recovery`. [2026-06-17]

- 2026-06-05 desktop-to-mobile live sync fix: the server was already broadcasting every main-chat frame, including `event: 'user_message'`, through `main_chat_stream_event`. The mobile bug was client-side: `web-ui/src/mobile/mobile-pages.js::onMainChatStreamEvent` created/reused an assistant placeholder for every frame before special-casing user frames, so a user message sent from desktop did not appear in the open mobile chat until history reload. Fix: handle `eventType === 'user_message'` first, insert a mobile-format user turn from `msg.data.message`, dedupe the phone's own send via `clientRequestId`, then return before assistant placeholder logic. Keep the generated public copy (`generated/public-web-ui/static/mobile/mobile-pages.js`) in sync or run `npm run sync:web-ui`.
- Verification for that fix: `node --check web-ui/src/mobile/mobile-pages.js` and `node --check generated/public-web-ui/static/mobile/mobile-pages.js` passed. Manual expected behavior: with the same chat open on desktop and mobile, a desktop user message should appear immediately on mobile, followed by the normal Prometheus streaming/tool/process updates.

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
- REALTIME AUTH GOTCHA (bug 1): OpenAI Realtime 500s ("Internal Server Error", no transcription/audio) when minting works but the call fails. Cause: the realtime CALL endpoint rejects the raw Codex OAuth bearer; it needs a real platform api_key minted by exchanging the OAuth id_token, which needs an `organization_id` claim (fresh login only, and `startOAuthFlow` must NOT send `codex_cli_simplified_flow=true`). Working logs show `auth: 'openai_codex_oauth_api_key'`. Full runbook: §12A-CRITICAL of `workspace/self/06-image-voice.md`. xAI realtime is independent and unaffected.
- REALTIME MIC GOTCHA (bug 2, iOS): after auth is fixed, if the session connects and soundwaves animate but there is still no transcription/audio, the OpenAI WebRTC path is doing its OWN `getUserMedia` — a SECOND concurrent iOS mic capture that comes back live-but-silent, so OpenAI's VAD hears nothing. Fix/rule: mobile realtime mic MUST reuse the shared warm mic (`_ensureMobileXaiRealtimeMic()` / `__pmVoice.warmMicStream`), exactly like xAI; tag the conn `sharedMic: true` and do NOT `.stop()` the shared stream on teardown (only re-enable its track). Never open a second concurrent `getUserMedia` on iOS. Details: §12A-2 of `workspace/self/06-image-voice.md`.

Mobile Realtime camera/video additions from 2026-06-05:

- The PWA can open an in-app camera preview from the mobile chat attachment sheet and from the inline chat voice section. This uses browser `getUserMedia` camera permission; it does not need to save a native photo to the user's phone.
- Tap on the capture button takes a still frame from the live preview and converts it to a JPEG/data URL via canvas.
- Hold on the capture button records a short clip in the same preview. The hold interaction must suppress Safari text selection/context menu behavior, like the PTT fix. The clip is sampled into sequential JPEG frames rather than streamed as live video.
- The voice camera/file button belongs at the top-left of the chat voice section, opposite the close/X button. Keep it above the bottom tab footer; camera controls must not sit behind the mobile nav.
- Captured voice images are staged in `__pmRealtimeAgent.pendingImages` and rendered into the current mobile chat thread as a visible image bubble via `__pmRealtimeAgent.stagedImageTurn`.
- Staged OpenAI Realtime images flush into the live Realtime data channel on the next spoken PTT/always-listening turn, and also on typed chat send if the user types after taking the photo.
- Typed sends after a staged voice photo also include the staged image as regular mobile chat attachments, so the Prometheus worker receives the pixels through `/api/chat` even if the user typed instead of speaking.
- The OpenAI Realtime image event shape is `conversation.item.create` with a user `message` containing `input_text` and `input_image`. The `input_image` uses a data URL in `image_url` and includes `detail: "auto"`.
- Realtime images must be downscaled/recompressed before data-channel send. Mobile Safari can silently drop large SCTP messages; `_downscaleDataUrlForRealtime(...)` targets small JPEG data URLs instead of passing full-res captures through.
- xAI/Grok Realtime is not sent OpenAI-style `input_image` events in this implementation. xAI visual context goes through `/api/voice-agent/xai-vision-summary` and is injected into the xAI Realtime conversation as text. The sidecar tries Grok first and falls back by default to OpenAI `gpt-5.4-mini` vision when Grok is quota-limited/unavailable.
- If a user says the bubble shows but the voice agent says it cannot see anything, inspect `_flushMobileRealtimeAgentPendingImages(...)`, the provider guard (`openai_realtime` vs `xai`), and the downscaled data URL size. The local bubble alone does not prove the Realtime model received the image event.

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

Prometheus has iOS Home Screen Web Push for completed chat responses and terminal/attention events from tasks, subagents, teams, and scheduled jobs. Mobile delivery still uses WebSocket/in-app delivery plus session unread state while the app is open; Web Push is the opt-in background notification path for installed iOS/iPadOS PWAs.

### iOS Home Screen Web Push

iOS/iPadOS 16.4+ can receive Web Push for websites installed to the Home Screen when the app manifest is installable and the page is served over HTTPS. Prometheus uses standard Web Push with VAPID through the `web-push` package; it does not talk directly to APNs and does not require an Apple Developer account for this PWA path.

Current behavior:

- Mobile chat has an opt-in bell button. It requests notification permission and subscribes the active service worker. The permission is global to the installed PWA, not only the visible chat screen.
- Notifications are sent for completed chat responses.
- Chat response Web Push is sent for every completed `/api/chat` turn, not just mobile-origin turns. Mobile-origin turns are labeled `mobile`; every other chat origin is treated as `desktop` for channel-filter compatibility, but Web Push fanout is unconditional once the turn completes.
- Notifications are also sent for background task completion/failure/pause, tasks needing assistance or clarification, standalone subagent completion/failure/attention states, team executor completion/failure/attention states, and scheduled-job completion/failure/pause states.
- Starts and ordinary progress updates intentionally stay in-app to avoid notification spam.
- Each background push increments the Home Screen app badge count where the Badging API is available. Opening the mobile app or tapping a notification clears the badge. This is currently an attention-since-last-open count, not a server-derived unread total.
- Notifications include basic `Open`/`Clear` actions where the platform exposes web notification actions. iOS may ignore action buttons, so normal notification tap routing remains the durable path.
- First enable sends `/api/push/test` so the device can prove delivery immediately.
- Completion notifications are emitted after the final assistant response is produced, not during token streaming.
- Notification clicks focus/open the best mobile surface when possible: chat, tasks, teams, subagents, or schedule.
- iOS may render a system app attribution line such as `from Prometheus`; this comes from the installed Home Screen app identity, so payload titles should avoid repeating the app name.

Source files:

- `web-ui/service-worker.js` handles `push` and `notificationclick`.
- `web-ui/service-worker.js` also owns badge updates, notification actions, and the cached offline shell fallback.
- `web-ui/src/mobile/mobile-router.js` clears the app badge whenever the installed mobile app opens or navigates.
- `web-ui/src/mobile/mobile-api.js` manages service worker update nudges, permission requests, subscription/unsubscription, and `/api/push/*` calls.
- `web-ui/src/mobile/mobile-pages.js` renders and wires the mobile chat push bell.
- `src/gateway/notifications/web-push.ts` owns VAPID key generation, subscription persistence, and fanout sending.
- `src/gateway/notifications/completion-bridge.ts` builds the chat-response Web Push payload and fans it out alongside channel notifications.
- `src/gateway/notifications/task-events.ts` builds task/subagent/team/scheduled-job Web Push payloads.
- `src/gateway/tasks/background-task-runner.ts` calls the task event bridge from terminal and attention state transitions.
- `src/gateway/routes/chat.router.ts` exposes `GET /api/push/public-key`, `GET /api/push/status`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, and `POST /api/push/test`.

Persistence and public URL:

- VAPID keys and subscriptions live in `.prometheus/notifications/web-push.json`; do not commit this file.
- Deleting or regenerating VAPID keys invalidates existing browser subscriptions.
- The VAPID subject and chat notification links must resolve to the public HTTPS origin. For Funnel, use `gateway.remoteAccess.publicUrl`.
- A bad VAPID subject can make Apple Push reject sends with a generic response such as `Received unexpected response code`; `/api/push/status` records `lastError`, `lastSuccessAt`, endpoint metadata, and subscription count.

iOS-specific gotchas:

- `Notification.requestPermission()` must be called from the direct user tap path. Do not put an awaited network request before the permission prompt.
- Installed PWAs may keep an old service worker. Bump `web-ui/service-worker.js` `VERSION` for meaningful push/frontend changes, run `npm run sync:web-ui`, and reopen the Home Screen app if needed.
- If permission is accepted but no banner appears, check iOS Settings > Notifications > Prometheus, Focus modes, `/api/push/status`, and then send `/api/push/test`.
- Offline/bad-network mode is intentionally conservative: the service worker caches the mobile shell/static assets and the mobile chat page shows its local thread cache while the gateway reconnects. API/SSE/WS traffic is not blindly cached, so live task/session state does not go stale under the user's feet.

### Mobile Deep Links

Mobile supports both hash-style installed-PWA links and readable path links:

- Chat: `/?source=pwa#mobile/chat/<sessionId>` or `/mobile/chat/<sessionId>`
- Voice: `/?source=pwa#mobile/voice` or `/mobile/voice`
- Tasks: `/?source=pwa#mobile/tasks/<taskId>` or `/mobile/tasks/<taskId>`
- Teams: `/?source=pwa#mobile/teams/<teamId>/<tab?>` or `/mobile/teams/<teamId>/<tab?>`
- Subagents: `/?source=pwa#mobile/subagents/<agentId>/<tab?>` or `/mobile/subagents/<agentId>/<tab?>`
- Schedule: `/?source=pwa#mobile/schedule/<scheduleId?>` or `/mobile/schedule/<scheduleId?>`
- Proposals: `/?source=pwa#mobile/proposals/<proposalId>` or `/mobile/proposals/<proposalId>`
- Settings sections: `/?source=pwa#mobile/settings/<section>` or `/mobile/settings/<section>`

The gateway serves `index.html` for `/mobile` and `/mobile/*`, so QR codes and shared links can use readable path URLs. The router normalizes aliases such as `task -> tasks`, `team -> teams`, `subagent -> subagents`, and `proposal -> proposals`. Notification payloads should still prefer `/?source=pwa#mobile/...` because that preserves installed-PWA launch behavior on iOS more reliably.

`web-ui/manifest.webmanifest` exposes Home Screen long-press shortcuts for Chat, Voice, Tasks, Schedule, Teams, and Proposals.

Prometheus now has an opt-in channel notification fallback for completed chat responses:

- Settings > Channels can enable `completionNotifications` separately for Telegram, Discord, and WhatsApp.
- Source filters let the user notify on `mobile`, `desktop`, or both. In backend terms, `mobile` means `/api/chat` turns normalized to origin channel `mobile`; `desktop` means web chat turns normalized to origin channel `web`.
- Completion alerts are sent after the final assistant response is produced, not during token streaming.
- Mobile alerts are labeled `Mobile chat response complete:`; desktop web alerts are labeled `Desktop response complete:`.
- Alerts can include a cleaned/truncated summary and an optional best-effort chat link to `/#mobile/chat/<sessionId>`.
- This is deliberately separate from in-app WebSocket delivery/unread state and from Telegram's existing task/proposal/command delivery.
- PWA deep links remain browser/OS dependent. Telegram on iOS may open Safari rather than the installed PWA, so the notification itself and summary preview are the durable behavior.

Source files:

- `src/gateway/delivery-router.ts`
- `src/gateway/comms/broadcaster.ts`
- `src/gateway/notifications/completion-bridge.ts`
- `src/gateway/tool-builder.ts`
- `src/gateway/routes/chat.router.ts`
- `src/gateway/routes/channels.router.ts`
- `web-ui/src/mobile/mobile-pages.js`
- `web-ui/src/pages/SettingsPage.js`
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

Mobile context-window chip/popover spacing note [2026-06-28]: `renderMobileContextChip()` is inserted between the header and `.pm-body.pm-chat-body`. Keep chat-body top padding large enough that the first message starts below the floating context ring, and keep `.pm-ctx-popover` top offset lower than the header action row so the panel does not visually touch header buttons.

Mobile header Permissions shortcut note [2026-06-28]: the top-right chat-header ⋮ button is `renderMobileHeader()` from `web-ui/src/mobile/mobile-shell.js`, and the chat popover/menu itself is built inside `renderChatPage()` in `web-ui/src/mobile/mobile-pages.js` (`#pm-chat-settings-popover`). The `Permissions` menu item opens `#mobile/settings/security`, which `web-ui/src/mobile/mobile-router.js` maps to `openMobileSettings('security')`; that reuses the desktop Settings Security tab. The Default Permissions / Light Permissions terminal-command toggle is owned by `web-ui/src/pages/SettingsPage.js` (`loadSecuritySettings()`, `saveSecuritySettings()`, `getTerminalPermissionModeFromUI()`) and persists through `src/gateway/routes/settings.router.ts` as `tools.permissions.shell.approval_mode` in the settings config store.



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

