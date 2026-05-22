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

## 12B) Voice Agent, Mobile Dictation Handoff, and Live Worker Steering

2026-05-21 voice refactor principle:

- Voice mode now has its own Voice Agent layer in front of the Prometheus worker.
- This layer is only for Prometheus dictation/voice flows. Normal typed desktop/mobile chat and manual queued steering should keep using the ordinary app paths.
- The Voice Agent can answer immediate voice questions from a fresh worker context packet, steer an active worker, interrupt an active worker, or acknowledge before handing new work to the worker.
- The Prometheus worker remains the tool-running brain. The Voice Agent is the speech/router/narrator layer.

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

- `answer_now`: speak `voiceReply`; do not call or steer the worker.
- `no_reply`: no worker call and no spoken output.
- `steer_worker`: queue a same-turn steer on the active worker.
- `interrupt_worker`: abort the active worker if possible.
- `handoff_new_work`: speak the acknowledgement, then the mobile/desktop voice client may start the normal worker request.

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

Voice Agent role prompt:

- "You are Prometheus speaking through the user's voice interface."
- It has Prometheus identity, memory, preferences, user knowledge, and current task context.
- It does not execute tools directly.
- It answers directly only when context is enough.
- It dispatches/steers/interrupts the Prometheus worker when work requires tools/files/browser/desktop/coding/scheduling/memory mutation/long reasoning.
- It must return strict JSON: `action`, `spokenReply`, optional `workerInstruction`, optional `needsWorkerResponse`, optional `reason`.
- It should avoid generic acknowledgements and speak like Prometheus with specific context.

Worker handoff:

- When the Voice Agent chooses `handoff_new_work`, backend builds `[VOICE_AGENT_HANDOFF]`.
- The handoff block includes the spoken acknowledgement, original transcript, worker instruction, and context summary.
- Mobile passes this backend handoff block as `callerContext` into `/api/chat`.
- The worker is instructed not to repeat a generic startup acknowledgement because the Voice Agent already spoke to the user.

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
