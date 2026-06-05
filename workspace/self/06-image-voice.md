## 12) OpenAI Image Generation and Creative Media Config

Image generation is now a first-class config area in `config.ts`.
Default source values:

- provider: `auto`
- model: `gpt-image-2-medium`
- save to workspace: `true`
- default output dir: `generated/images`

Configured image provider slots currently exist for:

- `openai`
- `openai_codex`
- `xai`

The bundled provider/config system now carries image/video media defaults for OpenAI-family and xAI providers.

Media-provider routing rule from 2026-05-20:

- `src/image-generation/registry.ts` is the canonical image-provider selection point.
- Auto image selection should prioritize an explicit/configured image provider, configured image model inference, active LLM model inference, then usable fallback providers.
- OpenAI-family image generation must treat `openai` and `openai_codex` as compatible credential slots. A saved OpenAI Codex OAuth token in the vault should allow OpenAI image generation even when the active chat model is xAI/Grok, Claude, or another provider.
- `gpt-image-*` model inference should prefer OpenAI-family providers, not the active chat provider.
- Tool descriptions in `src/tools/generate-image.ts` and `src/gateway/tools/defs/file-web-memory.ts` should make it clear that provider override supports `auto | openai | openai_codex | xai`.

Video generation is now also a first-class config area in `config.ts`.
Default source values:

- provider: `auto`
- model: `grok-imagine-video`
- save to workspace: `true`
- default output dir: `generated/videos`

Configured video provider slots currently exist for:

- `xai`

Current xAI media defaults:

- LLM model: `grok-4.20-reasoning`
- image model: `grok-imagine-image-quality`
- video model: `grok-imagine-video`

xAI/Grok Imagine OAuth rule from 2026-05-20:

- `src/auth/xai-oauth.ts` owns runtime xAI credentials for media providers. It should expose a credential resolver that can refresh OAuth, derive usable bearer/API-key credentials, resolve the xAI base URL, and fall back safely when token expiry metadata is missing.
- `src/image-generation/providers/xai.ts` and `src/video-generation/providers/xai.ts` must use the shared xAI runtime credential resolver instead of assuming only static API keys.
- `src/video-generation/registry.ts` should surface xAI OAuth as a valid credential path when explaining missing video credentials.
- xAI/Grok OAuth should cover Grok Imagine image and video generation the same way API-key config does. The media provider should not require the user to make xAI the main chat provider before calling image/video generation.

Creative/video-adjacent facts:

- `video` is a first-class creative mode
- creative contracts explicitly enforce video-only flows for work that requires video mode
- generated media jobs and creative scenes are tracked through the canvas/creative runtime, not just chat text

## 12A) Voice Dictation and OpenAI Realtime Voice

Prometheus now has two separate chat voice paths in the web UI. They are intentionally not the same feature.

Canonical frontend files:

- `web-ui/index.html`
- `web-ui/src/pages/ChatPage.js`
- `web-ui/src/styles/pages.css`
- generated/public copies under `generated/public-web-ui/` must be kept in sync with `node scripts/prepare-public-build.js --web-only`

Canonical gateway files:

- `src/gateway/routes/voice.router.ts`
- `src/gateway/routes/realtime.router.ts`
- `src/gateway/server-v2.ts`
- `src/auth/openai-oauth.ts`
- `src/security/vault.ts`

Left mic button behavior:

- Element id: `chat-voice-btn`
- Handler: `toggleVoiceDictation()`
- Purpose: regular dictation into the chat text box
- STT providers are loaded from `/api/voice/status`
- Browser SpeechRecognition is the default free/local dictation path when available
- backend STT provider paths use `/api/voice/stt`
- normal spoken replies use `speakAssistantReply(...)` with browser speech synthesis or `/api/voice/tts`
- the Mic/Speak provider controls under the chat input are hidden by default and should appear only after the left mic is clicked
- left-mic mode enables `voiceRepliesEnabled = true` and disables OpenAI Realtime mode
- voice command submit phrases are recognized at the end of dictated text, including variants of `send it`, `send message`, and `submit`

Right soundwave button behavior:

- Element id: `chat-realtime-voice-btn`
- Handler: `toggleRealtimeVoiceReplies()`
- Purpose: full OpenAI Realtime voice loop
- This path should not show the regular Mic/Speak provider controls
- Realtime mode disables regular TTS and hides the regular voice provider controls
- It uses OpenAI Realtime transcription to write the user's speech into `#chat-input`
- After transcript completion, or after speech-stop/delta fallback timers, the UI calls `sendChat()`
- Prometheus remains the worker/runtime that receives the submitted text, runs tools, controls the computer, and produces the normal chat response
- OpenAI Realtime is used for speech I/O around that worker loop, not as the main tool-running brain

Realtime submission details in `ChatPage.js`:

- transcript text is tracked through `realtimeDictationBaseText`, `realtimeDictationFinalText`, and `realtimeDictationDeltas`
- duplicate sends are guarded by `realtimeDictationLastSubmittedText`
- `scheduleRealtimeDictationSubmit(...)` exists because realtime text may appear in the box even when final transcription event timing is delayed or inconsistent
- submit triggers currently include:
  - `conversation.item.input_audio_transcription.completed` immediately
  - `input_audio_buffer.speech_stopped` after a short delay
  - transcription delta fallback after a short delay

Realtime audio-output details:

- `ensureRealtimeVoiceConnection()` creates a WebRTC receive-only audio connection plus data channel
- `speakWithRealtimeVoice(text)` sends a `conversation.item.create` with the Prometheus final response text, then sends `response.create`
- current response creation uses `output_modalities: ['audio']`
- realtime voice errors from the data channel should surface as UI toasts instead of failing silently
- the hidden audio element is `#realtime-voice-audio`

Gateway Realtime behavior:

- `/api/realtime/status` reports whether Realtime is configured and whether auth is API-key or OpenAI Codex OAuth backed
- `/api/realtime/client-secret` mints ephemeral Realtime client secrets for both normal realtime sessions and transcription sessions
- default realtime model: `gpt-realtime`
- default realtime voice: `marin`
- default realtime transcription model: `gpt-realtime-whisper`
- Realtime auth candidates are tried in this order:
  - `OPENAI_REALTIME_API_KEY`, `OPENAI_API_KEY`, or `VOICE_TOOLS_OPENAI_KEY`
  - connected OpenAI Codex OAuth token from `openai.oauth_tokens`
- OAuth-backed Realtime has been verified to mint client secrets for both `transcription` and `realtime` session modes when OpenAI Codex OAuth is connected

Important router/auth note:

- `realtimeRouter` and `voiceRouter` must be mounted before the stricter `requireAccountAccess` catch-all route group in `src/gateway/server-v2.ts`
- they still use gateway auth, but must remain reachable for status/client-secret checks during account/model UI flows

Important vault note:

- OpenAI Codex OAuth tokens live under vault key `openai.oauth_tokens`
- The vault was hardened so writes merge current encrypted disk entries and vault instances are keyed by config dir
- This prevents stale singleton/config startup writes from wiping unrelated OAuth secrets
- If `/api/realtime/status` says `configured:false`, first check whether OpenAI Codex OAuth is still connected or whether a Realtime/API key env var is present

Operational debugging facts:

- If realtime transcription writes into the text box, the browser microphone/WebRTC transcription session is alive
- If it does not auto-send, inspect realtime transcription event handling and `scheduleRealtimeDictationSubmit(...)`
- If it sends but no response arrives, verify `/api/health` and `/api/chat` first; Prometheus/gateway response is still required before realtime audio can speak anything
- If Prometheus responds but no realtime audio is heard, inspect `speakWithRealtimeVoice(...)`, `response.create`, `output_modalities`, data-channel errors, and browser autoplay/audio device behavior
- `/api/realtime/status` and `/api/realtime/client-secret` can validate OAuth/API-key configuration without exposing client secrets

## 12A-CRITICAL) OpenAI Realtime "Internal Server Error" / no voice on Codex OAuth — root cause + fix (2026-06-03)

THE SHARP EDGE THAT COST DAYS. Symptom: OpenAI Realtime voice (the true voice-agent WebRTC path) gives no transcription, no audio, and a red "Internal Server Error" toast on mobile/desktop. Logs show `[voice-agent-realtime] client_secret ready`, then `call exchange failed ... status 500` for every attempt (`ephemeral`, `ephemeral_model`, `source_openai_codex_oauth`). xAI realtime works fine the whole time.

What it is NOT: NOT the camera change, NOT the SDP (mDNS `.local` candidates / ICE timing), NOT tool count / instruction size, NOT missing headers, NOT browser-vs-server, NOT the WebRTC transceiver setup. Old and new client code make the identical call to `https://api.openai.com/v1/realtime/calls`. Verified by reproducing with real browser SDPs.

What it IS: OpenAI's realtime CALL endpoint requires a real platform credential. The raw Codex OAuth bearer has NO platform API access (`GET /v1/models` with it → 403; `/v1/realtime/calls` → 500). The `client_secrets` MINT endpoint is lenient and returns a secret anyway, so it LOOKS configured — that is the trap.

The working "loophole" = `tryExchangeForApiKey()` in `src/auth/openai-oauth.ts`: it exchanges the OAuth **id_token** for a real platform **api_key** (stored as `tokens.api_key`, used via realtime auth candidate `openai_codex_oauth_api_key`). OpenAI DOES accept that key for realtime. When realtime works, logs show `auth: 'openai_codex_oauth_api_key'` (NOT `openai_codex_oauth`).

Why it broke: the exchange needs a singular `organization_id` claim in the id_token. Two failure layers were found and fixed:
1. A REFRESH-derived id_token never carries `organization_id` (only the `organizations` array). So once the cached api_key was lost, every refresh failed the exchange → fell back to raw bearer → 500.
2. A FRESH-LOGIN id_token also lacked `organization_id` for a MULTI-ORG account, because the OAuth authorize sent `codex_cli_simplified_flow=true`, which skips org binding. FIX: removed `codex_cli_simplified_flow` from both authorize param blocks in `startOAuthFlow` so login binds an `organization_id`. After that, a fresh Disconnect→Connect mints the api_key (verify: `GET /v1/models` → 200), and it persists across refreshes (`refreshTokens` keeps `existing.api_key` when the refresh-exchange fails).

Recovery runbook when realtime 500s on OAuth:
- Confirm: `auth` in the `client_secret ready` log. If `openai_codex_oauth` (not `..._api_key`), there is no usable api_key.
- Check token: decode `tokens.id_token` auth namespace (`https://api.openai.com/auth`). If `organization_id` is missing, the exchange will fail.
- Fix: ensure `codex_cli_simplified_flow` is NOT in the authorize params, restart gateway, Disconnect→Connect (fresh login), then the callback auto-mints `tokens.api_key`. `scripts/mint-realtime-key.ts` exchanges the current LOGIN id_token and saves the key (must NOT refresh first — refresh strips `organization_id`).
- If a fresh login STILL lacks `organization_id` (multi-org edge): pick/confirm one org in the consent screen, or set a real `OPENAI_API_KEY`, or use xAI realtime.

## 12A-2) SECOND BUG: mic connects but no transcription/audio — iOS dual-getUserMedia (2026-06-03)

After the auth fix (`auth: openai_codex_oauth_api_key`, call returns 201), a SEPARATE bug remained: the session fully connects (`session.created`/`session.updated`, mic track live, remote track received, soundwave visualizer animates to the user's voice) but speaking produces NO `input_audio_buffer.speech_started` → no transcription, no response. The user sees the mic "working" (soundwaves move) but Prometheus is deaf.

Ruled OUT as causes (all verified working via live browser tests with the real key): `gpt-realtime-2` model, voice `cedar`, `output_modalities:['audio']`, `server_vad`, `gpt-4o-transcribe`, and audio OUTPUT (text item + `response.create` → `response.output_audio.done` plays). The WebRTC mic m-line is answered `sendrecv` even with the extra recvonly transceiver. So model/voice/config/output/SDP are NOT the cause.

ROOT CAUSE (confirmed): iOS Safari does not tolerate TWO concurrent `getUserMedia` mic captures. The soundwave visualizer + xAI realtime share ONE warm mic (`__pmVoice.warmMicStream` via `_ensureMobileXaiRealtimeMic()`), but `_startMobileRealtimeAgentSession` (OpenAI WebRTC path) did its OWN `navigator.mediaDevices.getUserMedia(...)` — a SECOND capture. On iOS the second capture comes back live-but-SILENT, so the visualizer (warm mic) animates while OpenAI's PeerConnection receives silence → VAD never fires. xAI was immune precisely because it reuses the warm mic. This is why "soundwaves react but nothing happens" and why xAI worked while OpenAI did not.

FIX (applied in `web-ui/src/mobile/mobile-pages.js`):
- `_startMobileRealtimeAgentSession` now gets its mic from `await _ensureMobileXaiRealtimeMic()` (the shared warm mic) instead of its own `getUserMedia`.
- The conn is tagged `sharedMic: true`.
- `_stopMobileRealtimeAgentSession` must NOT `.stop()` a shared mic (it would kill the visualizer / other providers) — it only re-enables `micTrack.enabled = true`; it stops the stream only when the mic is exclusively owned (`!sharedMic`).
- Rule: any mobile realtime/voice provider that needs the mic MUST reuse `_ensureMobileXaiRealtimeMic()` / `__pmVoice.warmMicStream`. Never call a fresh `getUserMedia` for a second concurrent capture on iOS.

PTT caveat: gating the shared mic via `micTrack.enabled` also pauses the visualizer on release. Acceptable with one active provider; if PTT misbehaves, gate via a sending-flag (like xAI's `xaiCapture.sending`) instead of toggling `enabled`. Always-listening was the verified-good path to test first.

Also still true (session config): the backend `/api/voice-agent/realtime-bootstrap` bakes `server_vad` for ALL modes (it never receives `listenMode`); clients MUST re-assert per-mode `session.update` after the data channel opens (always_listening → server_vad with `create_response`; push_to_talk → `turn_detection: null` + manual commit/response on release). Do NOT bake session-level `output_modalities` into the mint.

## 12A-3) Mobile Realtime camera/video visual inputs (2026-06-05)

Mobile camera capture is an in-app visual-input feature for the PWA, not a native "save a photo to the phone" workflow. The PWA opens a camera preview with `getUserMedia`, captures the current video frame to a canvas, and turns that frame into a JPEG/data URL attachment. Tap captures a still image. Hold records a short clip in the same preview; the clip is sampled into sequential JPEG frames so the voice agent can treat it as a short visual sequence without live video streaming.

Canonical mobile source:

- `web-ui/src/mobile/mobile-pages.js`
- generated/public copy: `generated/public-web-ui/static/mobile/mobile-pages.js`
- styling lives in `web-ui/src/styles/mobile.css` and generated `generated/public-web-ui/static/styles/mobile.css`

Realtime camera UI behavior:

- Chat page voice strip has a camera/file button near the top-left of the inline voice section, opposite the close/X control.
- The existing mobile attach button can open camera capture for normal chat attachments.
- Voice camera capture is staged: the image/frame preview appears in the mobile chat bubble immediately, then is flushed into Realtime when the next user turn happens.
- For OpenAI Realtime, staged images flush on:
  - `input_audio_buffer.speech_started` for always-listening
  - PTT release before `input_audio_buffer.commit` and `response.create`
  - typed mobile chat send, so a user can take a photo and then type the question instead of speaking
- For typed sends after a staged voice photo, the image is also converted into normal mobile chat attachments so the Prometheus worker receives the visual context through the regular `/api/chat` attachment path.

OpenAI Realtime visual input contract:

- Send visual context over the Realtime data channel as `conversation.item.create`.
- Item type is a user `message`.
- Content contains `input_text` plus one `input_image` part.
- `input_image` must use a data URL in `image_url` and should include `detail: "auto"`.
- After a typed/send-now visual turn, create a Realtime response with `response.create` when the live voice agent should answer.
- Do not claim no image was sent if the chat bubble has a staged preview; debug whether `_flushMobileRealtimeAgentPendingImages(...)` ran and whether the data-channel image event fit the message-size limit.

Mobile Safari/WebRTC data-channel gotcha:

- Full-res camera PNG/JPEG data URLs can silently fail over the Realtime WebRTC data channel. The local UI may show the image bubble while the model receives only text or nothing useful.
- `_downscaleDataUrlForRealtime(...)` now recompresses to JPEG, defaults around longest side 960, quality 0.74, and iteratively shrinks toward about 180k data-URL chars.
- Keep image events small. If increasing camera/video quality, retest on iOS Safari/PWA because desktop Chrome can tolerate larger messages than mobile Safari.

Video capture rule:

- Do not stream live video to OpenAI/xAI Realtime for this feature.
- Mobile video is short hold-to-record capture, capped/sampled client-side, then sent as individual image-frame conversation items.
- Frames should be sent as separate `conversation.item.create` messages with `input_image`, not one giant event with many frames, to avoid SCTP/data-channel size limits.

xAI/Grok Realtime visual note:

- xAI Realtime does not share the same native `input_image` path in this implementation.
- xAI image/video visual context is handled by a side vision-summary workflow (`/api/voice-agent/xai-vision-summary`) and injected into the xAI Realtime conversation as text.
- Do not send OpenAI-style `input_image` events to xAI unless the xAI Realtime API path has been reverified; prior attempts produced invalid-event/404-style failures.

## 12B) Voice Agent, Mobile Dictation Handoff, and Live Worker Steering

2026-05-22 voice refactor correction:

- Voice mode now has its own Voice Agent layer in front of the Prometheus worker.
- This layer is only for Prometheus dictation/voice flows. Normal typed desktop/mobile chat and manual queued steering should keep using the ordinary app paths.
- The Voice Agent can answer immediate voice questions from a fresh worker context packet, steer an active worker, interrupt an active worker, or acknowledge before handing new work to the worker.
- The Prometheus worker remains the heavy tool-running brain for browser/desktop/files/coding/media/account actions and long reasoning.
- Correction: the Voice Agent is not tool-less. It may call a small allowlisted `voice_*` tool set directly for fast, low-risk voice support; anything outside that set must be handed to or steered into the normal worker.

Canonical source files for this refactor:

- `src/gateway/routes/chat.router.ts`
- `src/gateway/live-runtime-registry.ts`
- `web-ui/src/pages/ChatPage.js`
- `web-ui/src/mobile/mobile-api.js`
- `web-ui/src/mobile/mobile-pages.js`
- `web-ui/service-worker.js`
- generated/public copies under `generated/public-web-ui/` must stay in sync

Voice Agent backend endpoints:

- `POST /api/voice-agent/context`
- `GET /api/voice-agent/context/:sessionId`
- `POST /api/voice-agent/input`
- `POST /api/voice-agent/narrate`

Voice worker context packet:

- Built by `buildVoiceWorkerContextPacket(...)` in `chat.router.ts`.
- Pulls from active `main_chat` runtime, runtime checkpoint, recent process entries, recent main-chat stream events, latest user/assistant messages, browser advisor packet, and desktop advisor packet.
- Includes active run metadata, current goal, current phase, active tool name/label, pending steer count, last steer, last voice interruption, recent process entries, recent stream events, and browser/desktop observation summaries.
- This packet is what lets the Voice Agent answer questions like "what are you doing?" or "what do you see?" without invoking the worker again.

Voice Agent action contract:

- `answer_now`: speak `voiceReply`; do not call or steer the worker. The reply may come from injected context or a confirmed `voice_*` tool result.
- `no_reply`: no worker call and no spoken output.
- `steer_worker`: queue a same-turn steer on the active worker.
- `interrupt_worker`: abort the active worker if possible.
- `handoff_new_work`: speak the acknowledgement, then the mobile/desktop voice client may start the normal worker request.

2026-05-27 voice routing / wake gate current state:

- The Voice Agent path is now intentionally layered. Deterministic routing handles exact stop/pause/status commands, obvious wake phrase changes, small-talk/check-in turns, and safety boundaries before using the model router.
- Simple mobile always-listening turns like "how's it going", "can you hear me", "testing", "thanks", and "everything good" should bypass the model decision pass and log a `deterministic small-talk route` latency entry.
- For `handoff_new_work`, do not add fake/template acknowledgement text in the client. The Voice Agent model must provide the spoken acknowledgement. If the model chooses `handoff_new_work` but leaves `spokenReply` empty, `/api/voice-agent/input` asks the model for a brief repair acknowledgement rather than inventing a hardcoded one.
- `voice_set_wake_phrase` is a runtime configuration tool, not memory and not a worker task. It returns a runtime directive and an actual Voice Agent acknowledgement; it must not dispatch normal worker work.
- Mobile wake phrase setting also applies locally first for reliability, shows the green toast, then allows the utterance to continue to `/api/voice-agent/input` so Prometheus can acknowledge it naturally.
- Mobile sends `voiceRuntime` context when a wake phrase exists. The backend injects a short runtime note so the Voice Agent knows the current wake phrase and whether quiet mode is active.
- Normal voice turns are not automatically interruptions. `/api/voice-agent/input` broadcasts `voice_interruption` only when there is an active runtime/stream or the action is `steer_worker`/`interrupt_worker`; otherwise it broadcasts `voice_agent_turn`.
- Cutting off playback after the worker's final response has already been emitted must only stop the audio and let the next transcript become a normal new voice turn. It should not create `pendingInterruptContext` or the Interruption UI.
- Speaking while the worker is still streaming/working is the true interruption path. That should route through the Voice Agent to decide `answer_now`, `steer_worker`, or `interrupt_worker`, and this is what should render the Interruption / Interruption Response UI.

2026-05-21 full-context Voice Agent upgrade:

- `/api/voice-agent/input` now asks the configured model for a strict JSON decision instead of relying only on deterministic regex/hardcoded reply composition.
- The deterministic classifier remains as fallback and as an abort/pause safety hint.
- `buildPersonalityContext(..., { profile: 'voice_agent' })` builds the Voice Agent's Prometheus context.
- The `voice_agent` profile intentionally mirrors main-chat identity/memory context while excluding tool-schema instruction blocks.

Voice Agent injected identity/context now includes:

- `[PROMETHEUS_SOUL]` from `src/config/soul.md`
- `[USER]` from `workspace/USER.md`
- `[SOUL]` from `workspace/SOUL.md`
- `[BUSINESS]` when business context is enabled
- CIS/business context when relevant
- `[MEMORY]` from `workspace/MEMORY.md`, capped
- retrieved long-term memory context when routing says memory search is relevant
- `[PROJECT_CONTEXT]` when the session belongs to a project
- `[TODAY_NOTES]` from `workspace/memory/YYYY-MM-DD-intraday-notes.md`
- `[BOOT_MD]` from `workspace/BOOT.md`, capped
- `[SELF_INDEX]` from `workspace/self/index.md`
- `[SELF_VOICE_SECTION]` from `workspace/self/06-image-voice.md`
- skill turn context and already-active skill context
- current worker context packet
- classifier hint for cancel/pause/question/correction/etc.

Voice Agent role prompt and direct tool boundary:

- "You are Prometheus speaking through the user's voice interface."
- It has Prometheus identity, memory, preferences, user knowledge, current task context, and current time/date context.
- It may call only the provided `voice_*` tools from `buildVoiceToolDefinitions()` in `src/gateway/routes/chat.router.ts`.
- Current direct Voice Agent tools:
  - `voice_web_search`: fast wrapper around Prometheus web search; use for quick factual/current lookup, with multi mode for latest/current/news/compare/sensitive/current-event questions.
  - `voice_web_fetch`: fast wrapper around `web_fetch` for one clean text/article/docs URL; social/video/media/auth/browser-heavy URLs must escalate to the worker.
  - `voice_write_note`: fast wrapper around `write_note`; use only for explicit remember/jot/log/save-note requests.
  - `voice_set_wake_phrase`: runtime wake phrase setter. Use only for wake phrase/word changes; never save wake phrases as notes or memory.
  - `voice_skill_lookup`: summarized `skill_list`/skill metadata lookup for available workflows; returns summaries, not full skill instructions.
  - `voice_memory_search`: read-only memory recall wrapper around memory search and optional record read; do not mutate memory through it.
  - `voice_timer`: one-shot timer create/list/update/reschedule/cancel wrapper; the future timer execution is handled later by the worker.
- It can run at most a tiny direct-tool loop: the decision model receives `buildVoiceToolDefinitions()`, may call up to two tool calls per pass for the first two passes, and then must return strict JSON.
- It answers directly when context or a `voice_*` result is enough.
- It dispatches/steers/interrupts the Prometheus worker when work requires tools outside `voice_*`, files, browser, desktop, coding, media/account actions, approvals, broad scheduling/automation, long reasoning, or more than the small voice-tool loop should handle.
- It must return strict JSON: `action`, `spokenReply`, optional `workerInstruction`, optional `needsWorkerResponse`, optional `reason`.
- It should avoid generic acknowledgements and speak like Prometheus with specific context.
- Guardrail: do not claim the Voice Agent used full worker tools or changed files/accounts from the voice layer. It may truthfully say it searched, fetched, saved a note, checked memory, looked up skills, or set a timer only when the corresponding `voice_*` result confirms it.

Worker handoff:

- When the Voice Agent chooses `handoff_new_work`, backend builds `[VOICE_AGENT_HANDOFF]`.
- The handoff block includes the spoken acknowledgement, original transcript, worker instruction, and context summary.
- Mobile passes this backend handoff block as `callerContext` into `/api/chat`.
- The worker is instructed not to repeat a generic startup acknowledgement because the Voice Agent already spoke to the user.
- If handoff acknowledgement audio is silent, debug the model decision response first: `voiceReply` must be present for `handoff_new_work`, or the model repair pass should have produced one. Do not fix this by adding generic client-side acknowledgement templates.

Voice Agent tool execution path:

- Tool schemas are defined by `buildVoiceToolDefinitions()` in `src/gateway/routes/chat.router.ts`.
- Tool calls execute through `executeVoiceAgentToolWithTrace(...)`, which broadcasts `voice_agent_tool_event` websocket events and appends Voice Agent process entries.
- The concrete executor is `executeVoiceAgentTool(...)`; it calls the existing Prometheus helper functions for search, fetch, notes, skills, memory search/record read, and timers.
- `maybeApplyVoiceToolFallback(...)` can rescue old-style "I cannot use tools" voice decisions by detecting matching voice requests and running the relevant `voice_*` wrapper.
- `findVoiceToolFallbackRequest(...)` provides deterministic fallback routing for obvious voice requests: URL fetch/read, search/latest/current/news, note/remember, skill/workflow/playbook, memory/recall, and simple relative timers.
- `voice_agent_tool_event` is consumed by `web-ui/src/pages/ChatPage.js` and `web-ui/src/mobile/mobile-pages.js` so desktop/mobile chat process logs show Voice Agent tool calls/results.

Important behavior guarantee:

- If the Voice Agent chooses `answer_now`, the audio response is the main response and the Prometheus worker is not called.
- If the Voice Agent chooses `handoff_new_work`, the acknowledgement should be spoken before the worker begins.
- If the Voice Agent chooses `steer_worker`, the acknowledgement should be spoken immediately and the steer should be queued for the active worker.

Runtime steer schema:

- `RuntimeSteerEvent` in `src/gateway/live-runtime-registry.ts` now carries voice metadata:
  - `kind`
  - `requiresWorkerResponse`
  - `voiceContextPacketId`
  - `spokenAck`
  - `responseMode`
  - `contextSummary`
- `buildChatSteerContextBlock(...)` includes these fields when present so the worker can see what the Voice Agent already told the user and what context packet was used.
- `addPendingRuntimeSteer(...)` still only accepts active `main_chat` runtimes; this preserves the existing steer boundary.

Desktop Realtime voice behavior:

- Realtime interruption/follow-up calls in `ChatPage.js` route to `/api/voice-agent/input`.
- This allows desktop voice to answer status/context questions directly or steer the worker only when needed.
- Regular typed `/api/chat/steer` behavior is unchanged.
- Desktop voice parity rule from 2026-05-21:
  - Regular desktop dictation submit phrases call `sendChat(..., { voiceAgentHandoff: true, voiceSource: 'desktop_regular_voice' })`.
  - Desktop Realtime voice pending turns call `sendChat(..., { voiceAgentHandoff: true, voiceSource: turn.source })`.
  - `sendChat(...)` only performs the Voice Agent pre-worker handoff when `options.voiceAgentHandoff === true`; normal typed desktop sends do not use this path.
  - `prepareDesktopVoiceAgentHandoff(...)` calls `/api/voice-agent/input`, speaks the Voice Agent acknowledgement through the selected desktop voice provider, and passes the backend `[VOICE_AGENT_HANDOFF]` block into `/api/chat` as caller context when the action is `handoff_new_work`.
  - If the Voice Agent returns `answer_now`, `steer_worker`, or `interrupt_worker`, desktop voice handles that result and does not start a duplicate worker turn.

Mobile voice behavior:

- `createVoiceInterruptionEvent(...)` in `mobile-api.js` routes to `/api/voice-agent/input`.
- `_trySubmitVoiceAsLiveSteer(...)` in `mobile-pages.js` routes active-run mobile voice corrections to `/api/voice-agent/input`, not raw `/api/chat/steer`.
- `_prepareVoiceAgentHandoff(...)` runs before normal mobile voice prompts start `/api/chat`.
- For new mobile voice prompts:
  - mobile voice first asks `/api/voice-agent/input`
  - if action is `handoff_new_work`, it speaks the acknowledgement, then starts the normal worker stream
  - if action is `answer_now`, `no_reply`, `steer_worker`, or `interrupt_worker`, it handles that result and does not start a duplicate worker stream
- Voice acknowledgements use direct `_ttsSpeak(...)`, not milestone-gated `_speakVoiceMilestone(...)`, so acknowledgements should be audible even before worker streaming begins.

Mobile listen modes, wake phrase, and quiet mode:

- Mobile Listen Mode lives in `web-ui/src/mobile/mobile-pages.js` as `push_to_speak` or `always_listening`; Push to Speak is the default and must remain intact.
- Switching mobile back to Push to Speak clears `wakePhrase` and `wakeGateActive`, returning Prometheus to normal non-gated behavior.
- `wakePhrase` and `wakeGateActive` are separate states. A saved phrase is only configuration; it does not filter speech unless `wakeGateActive === true`.
- Saying "Prometheus quiet", "quiet Prometheus", or similar quiet phrases activates quiet mode only if a wake phrase is set. If no wake phrase exists, Prometheus should tell the user to set one first so they cannot get stuck.
- Saying the wake phrase while quiet mode is active clears `wakeGateActive` and returns Always Listening to normal. Saying "unlock Prometheus" / "turn off wake phrase" clears both the wake phrase and the quiet gate.
- While quiet mode is active, the mobile Voice page status should stay visibly on `Quiet mode` rather than being overwritten by generic `Listening` or `Ready`; the hint should continue to show `Say "<phrase>" to wake Prometheus`.
- Current implementation is still page-owned, not a full app-wide voice service. Leaving the Voice page stops the page-owned listener cleanly but preserves Always Listening settings and the warm mic grant; returning to the Voice page should auto-resume Always Listening without toggling back to Push to Speak.
- True cross-page always-listening would require moving STT/audio runtime handles out of `renderVoicePage(...)` into a global mobile voice service.

Mobile xAI / Grok STT and TTS facts:

- xAI mobile Push to Speak and Always Listening use the xAI streaming STT path where possible (`/api/voice/xai/stt-stream`), with batch STT fallback only where streaming is unavailable.
- On xAI Push to Speak release, do not close the websocket after a fixed short delay. Send `audio.done`, wait for `transcript.done`, and submit the final transcript. If final never arrives, submit the latest partial after the longer timeout. Empty text should show "I did not catch any speech" instead of silently returning to Ready.
- xAI partial transcripts in Always Listening may not always emit final events on phone; mobile schedules an idle submit from partials so recognized text does not sit forever on screen.
- OpenAI Realtime uses a different WebRTC audio path and can work even when xAI TTS/STT is broken. Do not infer xAI audio health from OpenAI Realtime success.
- xAI TTS on iOS/Safari should not always force URL delivery. The safer path is the server's base64/WAV fallback; URL delivery is fine off iOS/Safari. The hidden audio element should not treat an early pre-play `pause` as successful playback.

Narration loop:

- `/api/voice-agent/narrate` returns either `reply` or `no_reply` from the current context packet.
- Mobile starts `_startVoiceAgentNarrationLoop(...)` while a voice-started worker stream is active.
- The loop polls about every 5.6 seconds, has backend dedupe/min-gap protection, and only speaks in milestone dictation mode.
- This is intended to replace generic "reading what just happened" milestones with contextual narration like "I am working in X; the latest update is Y."

Mobile service-worker cache rule:

- Mobile/PWA assets can remain stale unless `web-ui/service-worker.js` and `generated/public-web-ui/service-worker.js` bump `VERSION`.
- The 2026-05-21 voice-agent update bumped the cache version to `pm-v1-2026-05-21-voice-agent-handoff`.
- If mobile behavior appears unchanged after frontend edits, close/reopen the PWA or refresh after a gateway restart, then confirm the service-worker version changed.

Debugging checklist for "mobile voice still sounds hardcoded":

- Confirm the phone loaded the new service-worker version.
- Confirm `web-ui/src/mobile/mobile-pages.js` contains `_prepareVoiceAgentHandoff(...)`.
- Confirm a normal mobile voice prompt hits `/api/voice-agent/input` before `/api/chat`.
- Confirm `result.action` from `/api/voice-agent/input` is `handoff_new_work` for new work or `answer_now` for status questions.
- Confirm the spoken acknowledgement path uses `_ttsSpeak(reply)`.
- If active-run narration is silent, confirm `/api/voice-agent/narrate` returns `reply`, dictation mode is `milestone`, and `_startVoiceAgentNarrationLoop(...)` is running for the active request id.
