# Voice Agent, Realtime, and Worker Architecture

Last source verification: 2026-07-22. Primary implementation: `src/gateway/routes/chat.router.ts`; mobile client: `web-ui/src/mobile/mobile-pages.js` and `mobile-api.js`.

## The important distinction

Prometheus has two different AI execution lanes that can participate in a spoken interaction:

| Lane | Job | What it is optimized for |
|---|---|---|
| **Voice Agent / realtime worker** | Keep a live spoken interaction responsive; understand speech, speak back, manage the active voice session, accept camera context, and execute the deliberately constrained voice-tool surface | Immediate conversational control, short operational actions, live browser/desktop interactions that are safe for voice |
| **Prometheus Worker** | The normal tool-capable agent runtime behind main chat | Planning, multi-step work, files/coding, full Creative work, durable external actions, complex research, background delegation, and all work that needs normal task/approval semantics |

The Voice Agent is not a skin over the normal Worker. It has its own `voice_agent` prompt profile, own tool definitions, realtime bootstrap path, session context, activity state, and safety boundary. Conversely, a Worker turn is not automatically a realtime voice turn just because it was started from a phone.

## End-to-end interaction flow

1. A paired mobile user opens **Voice** or invokes voice controls from a mobile/chat surface. The browser obtains the required microphone permission and establishes the applicable voice/realtime transport.
2. Mobile maintains a voice target: normally the active main-chat session, but it can target a subagent or a voice workgroup when the UI/runtime supports that route.
3. The client sends speech/text/visual state to the gateway. The gateway can use STT/TTS endpoints, a Voice Agent context route, or an OpenAI/xAI realtime bootstrap/call path depending on the configured provider and interaction mode.
4. The Voice Agent either answers/acts using voice-safe tools or decides the request needs the full Prometheus Worker. Worker-handoff work is routed into the current foreground chat so it gets normal chat history, planning, approvals, tool categories, and durable delivery.
5. Live UI state is delivered through WebSocket/stream events. The mobile UI shows voice activity, staged inputs, interruption state, worker/workgroup state, and final responses in the relevant chat/voice surface.

## What stays in the Voice Agent

The voice tool surface is intentionally constrained. It can perform immediate, bounded work such as:

- spoken status/context checks (`voice_worker_status`, automation dashboard, memory search);
- one-shot timers and notes;
- voice-safe web search/fetch and image/video generation;
- browser observation, navigation, click, fill, typing, keypress, scroll, screenshot and wait actions;
- Windows desktop screenshots, app/window discovery, focus, launch, window-scoped input/control, and narrow live UI actions;
- wake/quiet controls and explicit screenshot delivery.

The exact 39 schemas are listed in [14-voice-tool-capability-index.md](14-voice-tool-capability-index.md). The descriptions there are operational: several browser/desktop voice tools explicitly redirect passwords, payment, uploads/downloads, destructive actions, account/security changes, files, installs, shell commands, and full Creative/timeline work to the Worker.

## When and how it hands off to the Worker

Use the Worker lane for work that needs persistent planning, broad tool access, a project/canvas, generated deliverables, task delegation, source edits, a proposal, or a normal approval card. The Voice Agent can submit a visible user-facing instruction into the foreground session; the Worker then proceeds as a regular foreground chat turn. It does not inherit a blanket authority merely because the user is speaking.

The Worker can in turn dispatch background workers or a voice workgroup. `/api/voice-agent/dispatch-workers` creates/coordinates voice-oriented worker work, and `/api/voice-agent/workgroups/...` exposes session/workgroup state. This is why a spoken request can show both a realtime conversation and ordinary Worker task progress without being the same execution process.

`voice_worker_status` is read-only: it reports the freshest Worker/run state and context packet, but it does not steer or interrupt the Worker. This matters for accurate spoken updates such as “what are you doing?” without changing the work.

## Browser and desktop relationship

Voice browser and desktop tools call the same underlying browser/desktop runtime families used by the Worker, but they expose a narrower voice-facing contract. A browser session still has to exist, and desktop control still depends on the local Windows/native path. Voice tools do not grant a phone independent ownership of the host desktop.

- Browser actions work against the Prometheus-controlled browser lane and return refreshed DOM/screenshot context for the voice model.
- Desktop actions use the canonical window model, screenshot anchors, app IDs, and window IDs. Window-scoped controls are preferred over raw global coordinates.
- The separate background-desktop Sandbox path is not the same as foreground host-desktop voice control.

## Realtime providers and auth

Prometheus exposes provider-specific realtime bootstrap paths for OpenAI and xAI. A live route is available only when the chosen provider, credentials, browser WebRTC support, and device permissions are valid. OpenAI realtime needs a real platform API key rather than a raw Codex OAuth bearer; the documented gateway flow obtains the needed key from a valid fresh OAuth login. xAI/OpenAI connection status and bootstrap failures must be represented as configuration/runtime state, not as a generic “voice is broken” condition.

## Microphone, wake, quiet, interruption, and delivery

- The mobile client manages warm/shared microphone handling so it does not open a competing second capture on iOS.
- **Wake phrase** and **quiet-until** are Voice Agent controls. Quiet mode means the voice lane waits for the configured wake condition; it does not cancel background or Worker activity.
- **Interruption** is a dedicated mobile/gateway event. It stops/adjusts the live voice interaction and preserves enough context to avoid a duplicate or misrouted follow-up.
- TTS/audio delivery, transcriptions, and voice logs are tied to the selected provider/browser and the active target session.
- Voice-originated screenshots are only delivered when the user asks to share/show/send them; normal origin-aware delivery chooses the originating channel unless explicitly overridden.

## Camera, images, and video inputs

Camera stills, camera-roll video, and sampled video frames are client-side inputs. Mobile stages them in chat/voice state, downscales image payloads for realtime transport limits, and flushes them into a subsequent typed or spoken request. They are not silent continuous surveillance and are not automatically uploaded just because a camera UI exists.

For OpenAI realtime, visual input is sent as user conversation items with image content/data URLs. The current implementation treats in-app camera captures differently from saved native photos and avoids sending oversized raw frames over the mobile WebRTC data channel.

## Failure/recovery model

| Symptom | System boundary to inspect |
|---|---|
| No microphone or no transcription | Browser/device permission, microphone ownership, shared warm-stream path, selected provider |
| Realtime auth failure | Provider status and provider-specific OAuth/API-key bootstrap requirements |
| Voice responds but cannot do complex work | Expected Voice Agent boundary; route the request to the Worker |
| Worker is running but voice has no update | Check voice target/session and `voice_worker_status`; Worker status is a separate runtime stream |
| Browser/desktop action unavailable | Browser lane/native host/desktop permission or a request outside voice-safe scope |
| Camera input seems ignored | Confirm it was staged and included in the next typed/spoken turn; check realtime payload limits |

## Source map

- Voice/realtime routes and tool definitions: `src/gateway/routes/chat.router.ts`
- TTS/STT service routes: `src/gateway/routes/voice.router.ts`
- Main-worker handoff/context and voice profile: `src/gateway/prompt-context.ts`, `src/gateway/session.ts`
- Mobile transport/state/UI: `web-ui/src/mobile/mobile-pages.js`, `mobile-api.js`, `mobile-router.js`
- Existing detailed operational notes: `../06-image-voice.md`, `../16-mobile-app.md`, `../22-runtime-prompt-verbatim.md`, `../23-runtime-context-flow.md`
