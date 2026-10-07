# 06 — Image & voice

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/routes/realtime.router.ts`, `src/gateway/voice/`, `src/gateway/realtime/`, `src/image-generation/`, `src/media-generation/`, `web-ui/src/voice/`, `web-ui/src/mobile/`
> **Read this when:** changing the live Voice Agent, realtime audio or dictation, mobile voice, voice instructions, or image-generation providers/tools.

## TL;DR
- **Voice Agent and Prometheus worker are different actors.** The live Realtime voice Agent speaks, listens and handles voice-channel controls; it does not own general tools, files, browser/computer control, approvals or memory writes. The Prometheus worker receives executable tasks and performs them.
- **Do not report voice narration as work evidence.** The Realtime context explicitly says to route file edits, commands, browser/actions and other tool work to the worker; report only what worker/process status confirms.
- Realtime state and HTTP bridge logic are in `src/gateway/routes/realtime.router.ts`; provider-side streaming adapters are in `src/gateway/voice/` and `src/gateway/realtime/`; desktop voice client helpers live in `web-ui/src/voice/`, mobile runtime in `web-ui/src/mobile/`.
- `src/config/soul-loader.ts` resolves `voice-soul.md` from configured Prometheus data directory first, then source fallback; missing voice soul falls back to `soul.md`.
- **Prompt budget gotcha:** `src/gateway/prompt-context.ts` injects the first 7000 characters of workspace `self/06-image-voice.md` into voice-agent context (private builds only). It is assembled after voice soul, USER/SOUL, project/startup context and self index. Keep the most operationally useful voice rules at the top; verify the actual excerpt boundary, not just this file length.
- OpenAI Realtime uses `/api/realtime/*` routes and can use an OAuth/Codex app-server bridge as well as realtime client-secret/call paths. The realtime transcription mode defaults to `gpt-4o-transcribe`.
- xAI voice streaming adapters are wired in `src/gateway/voice/xai-streaming.ts`; mobile UI/runtime supports OpenAI Realtime and xAI mode. Keep provider-specific session setup separate; don't assume the OpenAI realtime schema fits xAI.
- Dictation is distinct from a conversational Realtime voice session. Use the transcription/dictation mode and preserve settings such as quiet transcript display and wake-gate behavior; don't trigger a spoken reply for silent dictation.
- Mobile voice uses `web-ui/src/mobile/mobile-voice-runtime.js` plus `mobile-voice-realtime-runtime.js`; consult [18 Mobile app](18-mobile-app.md) before any mobile edit.
- Image generation uses `src/image-generation/` provider registry, including OpenAI image, OpenAI Codex and xAI providers; provider is inferred from model and configuration (OpenAI default alias currently `gpt-image-2.5-flare-medium`). OpenAI may route through Codex OAuth first when configured, with API-key fallback.
- Runtime media alias `media_generate` normalizes image/video actions to `generate_image`/`generate_video`; it belongs to `media_generation`. Concrete `generate_image`/`generate_video` are current core overrides in the canonical classifier.
- For actual work, voice actor hands to the Prometheus worker; worker owns tools, approvals, files and side effects. Confirm worker evidence before reporting completion.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Voice prompt profile | `src/config/soul-loader.ts` → `loadVoiceSoul()` | Checks configured `voice-soul.md`, then `src/config/voice-soul.md`, then main soul fallback. |
| Voice system context | `src/gateway/prompt-context.ts` → `buildSystemPrompt()` voice-agent branch | Injects voice soul, USER/SOUL, project/BOOT and capped `self/06-image-voice.md` context. |
| Realtime authority boundary | `src/gateway/routes/realtime.router.ts` → context-pack builder | Explicitly separates voice conversation/control from worker authority and execution. |
| OpenAI realtime API | `src/gateway/routes/realtime.router.ts` → `/api/realtime/*` handlers | Status, context pack, Codex bridge, client secret and call paths. |
| Realtime Codex bridge | `src/gateway/realtime/codex-app-server-bridge.ts` and realtime router | Routes an actual tool task to the worker path and streams its result/status. |
| xAI/OpenAI websocket adapters | `src/gateway/voice/xai-streaming.ts` | Attaches xAI STT-stream and OpenAI Realtime proxy endpoints. |
| Desktop voice UI | `web-ui/src/voice/` | Realtime voice refresh and client affordances; search route names before changing contracts. |
| Mobile voice UI/runtime | `web-ui/src/mobile/mobile-voice-runtime.js`, `mobile-voice-realtime-runtime.js`, `mobile-voice-page.js` | Provider/mode settings, real-time transport, camera and mobile interaction. |
| Image providers | `src/image-generation/registry.ts`, `providers/openai.ts`, `providers/openai-codex.ts`, `providers/xai.ts` | Provider implementation, model IDs and account handling. |
| Image tool definition/dispatch | `src/tools/generate-image.ts`; executor `generate_image` case | Schema and execution glue; delegates into provider/image utilities. |
| Video generation | `src/tools/generate-video.ts`; `src/media-generation/` | Distinct video/media job path; follow [15 Media engine & video](15-media-engine-video.md) for the broader media system. |
| Generated source/test index | [source map](generated/source-map.md), [tests](generated/tests.md) | Generated lookup; never hand-edit these files. |

## How it works

### Voice Agent and worker boundary
Realtime context is built in `realtime.router.ts`. Its bridge contract establishes that the Realtime actor is Prometheus “in live Realtime voice form” but is **not the executor**. It may know project/runtime context to converse naturally, but must not claim edits, commands, browser actions, memory writes or completion unless the worker reports them.

The practical routing rule is:
1. Voice Agent owns speaking/listening behavior, wake/silent state, status, stop-speech, interrupts and translating the spoken request into a worker task.
2. For real work—file/code edits, shell commands, browser/desktop interaction, skills, memory writes, app actions—the voice actor packages the intent to the Prometheus worker. It does not independently use general tools.
3. Worker owns skill selection, category activation, tools and approvals. It returns progress/completion evidence to the voice path; voice selectively speaks milestones, blockers, approval questions and the result.
4. A cancellation request must be distinguished from “stop talking”: stop the worker only when the user intends to cancel the work; otherwise stop speech.

This is an authority and UX boundary, not simply a two-voice provider choice. Preserve it in prompt text, UI event ownership and bridge code. Realtime context is cached; if changing its contents or source, verify invalidation/rebuild behavior in the router.

### Realtime routes and transport
- The router exports OpenAI realtime status/context-pack/client-secret/call routes and a Codex bridge surface for calls, tool output, speech, text appends, owner rebinding, stop and event polling. Search `router.get/post('/api/realtime/...')` in `realtime.router.ts` for the authoritative route set.
- The OpenAI client-secret builder has a separate `mode: "transcription"` branch. It sends `type: "transcription"` and an input-audio transcription model; the default is `gpt-4o-transcribe`. Other Realtime sessions use the sanitized realtime model/voice path.
- OAuth-backed OpenAI Codex app-server realtime can use the Codex bridge; it should retain the actual worker tool surface, not substitute a speech-only model call for execution.
- `src/gateway/voice/xai-streaming.ts` attaches `/api/voice/xai/stt-stream` and an OpenAI realtime websocket proxy endpoint. Its filename includes both adapter roles; inspect endpoint predicates before assuming every handler is xAI-specific.
- Status/config routes report whether each provider is configured. A visible provider choice does not mean that credentials, transport or upstream session setup succeeded; surface status errors honestly.

### Voice soul and prompt injection budget
`loadVoiceSoul()` checks `VOICE_SOUL_PATHS`: configured data-dir `voice-soul.md`, then `src/config/voice-soul.md`; if neither voice file exists, regular `soul.md` paths are used. The regular and voice contracts have different purposes: keep voice instructions speakable, short and conversational, while retaining detailed execution rules in worker/runtime documentation.

For the `voice_agent` prompt profile, `prompt-context.ts` reads the workspace self index up to 3000 chars and `self/06-image-voice.md` up to 7000 chars (the latter is excluded in public-distribution builds). It also adds the voice contract and USER/SOUL/project/BOOT context. This file is therefore partially executable prompt context, not only reference documentation:
- Keep the first two sections and opening bullets operationally dense.
- Never bury “voice is not the executor; worker does tool use and approvals” after the truncation boundary.
- Avoid a giant inventory, source dump, or low-priority implementation details in the first 7000 chars. Put cross-reference-heavy troubleshooting lower.
- If you materially change this doc, measure its encoded/character position so the key boundary fits before prompt truncation.

### Dictation versus conversation
Dictation is an input/transcription task; conversational Realtime has ongoing listening, turn-taking, speaking, barge-in and wake/silent semantics. They can use the same audio capture UI but must not share the wrong output policy.

- For quiet dictation, preserve the transcript/input path without synthesized voice replies or visible interim transcript if the session is intentionally silent.
- The current mobile voice settings initialize `dictation` to `quiet`; provider/mode settings also distinguish `openai_realtime` from `xai`, and default listening is push-to-speak. Verify the actual mobile settings and session status instead of inferring configured capability.
- Silent wake gate rules in the Realtime prompt: keep listening internally, suppress transcript display, suppress `sendChat` and suppress voice replies until wake phrase. User-specified “wait until X” should change the current session’s wake phrase.
- Stop/cancel has two meanings: interrupt active worker only on cancellation intent; otherwise stop current speech.
- Transcription model language/name validation is handled by sanitizers in `realtime.router.ts`; avoid sending unvalidated provider/model strings downstream.

### Mobile voice specifics
`web-ui/src/mobile/mobile-voice-runtime.js` is a small entry/runtime controller and creates the deferred `createMobileVoiceRealtimeRuntime()` from `mobile-voice-realtime-runtime.js`. It keeps provider-specific mode, settings, status, camera/voice session and UI bridges. Mobile API status code reads both `/api/realtime/status` and xAI realtime status; the UI should distinguish configured providers.

When changing mobile voice, keep the PWA/static sync and verification procedure in [18 Mobile app](18-mobile-app.md). The active mobile app guide is the authority for source/generated/static mirror rules and device smoke tests. Don't patch generated output alone. Mobile updates may alter realtime event ordering or camera permissions; verify on the actual mobile surface after build/sync.

### Image generation provider path
`src/image-generation/registry.ts` selects provider implementations from the current image-generation configuration and registered provider set. The current source includes:
- OpenAI image generation (`providers/openai.ts`): OpenAI API-model IDs include `gpt-image-2`; application aliases include Flare/Sunburst variants. The configured default alias is presently `gpt-image-2.5-flare-medium`; provider-specific API model and quality mapping happen in provider code. When provider is `openai`, the registry prefers a connected Codex OAuth route and falls back to API-key OpenAI when OAuth is not connected.
- OpenAI Codex image provider (`providers/openai-codex.ts`): separate auth/account route; do not assume API-key OpenAI auth and Codex account auth are interchangeable.
- xAI (`providers/xai.ts`): separate provider class/configuration. If xAI is unavailable, inspect provider registry/config/account access rather than blindly switching to a model that the provider does not support.

`generate_image` in `src/tools/generate-image.ts` validates the request and invokes the provider layer; image utilities normalize dimensions/quality/format, prepare files and return result metadata. The generation registry is not a gateway-tool category or a voice realtime provider registry. Keep user-facing model/provider selections, config schema, provider validation and UI choices aligned. Generated images may have attached output data/path; report actual artifacts, not only a successful provider response.

### Media action alias and video generation
Executor normalization maps `media_generate` with `action: image|images` to `generate_image`, and `video|videos` to `generate_video`; unsupported actions return an error. This is an alias/input adapter, not a provider implementation. The canonical manifest tags the alias under `media_generation`, while concrete `generate_image`/`generate_video` are explicit core overrides; verify actual list construction before concluding whether a particular alias is model-visible. Video generation uses a separate tool/job path and provider system; read [15 Media engine & video](15-media-engine-video.md) before editing provider lifecycle or cost controls.
### Voice bridge invariants to test
- A spoken request is an input event to the worker, not a direct executor call from the Realtime actor. Include a test where the worker refuses/blocks and the voice response reports the blocker rather than pretending success.
- Keep the originating chat/session identity stable across handoff, reconnect and mobile owner rebinding; do not attach a worker's result to a different active voice session.
- Treat event IDs as cursors, not message counts. Resume polling from the last consumed ID after reconnect and avoid replaying the same spoken response on duplicated events.
- Stop requests should cancel actual worker work only on cancellation intent; “stop speaking” should cancel playback without discarding an active task. Validate both phrases in UI and route tests.
- The voice context pack is separately cached from the system prompt. When changing identity rules or user-facing context, verify cache key/invalidation and that a restarted worker receives fresh facts.
- Keep noisy diagnostics and raw event streams out of spoken output. Speak concise state transitions; put full details in chat where IDs, paths and error evidence remain inspectable.
- A provider status endpoint should distinguish not configured, connected and upstream error. UI should not show a healthy active session simply because local microphone permission succeeded.
- For xAI speech streaming and OpenAI Realtime, test proxy teardown, upstream close/error, browser/mobile disconnect and worker cancellation independently; a failure in one channel must not strand the others.

### Image request/response lifecycle
1. `generate_image` validates prompt/options and resolves the requested/default provider/model; configuration and account availability are checked by the image-generation registry.
2. Provider code maps app aliases to the actual upstream model/API arguments. OpenAI image API and OpenAI Codex auth paths are separate; xAI uses its own provider implementation.
3. The selected provider returns media bytes/URL and provider metadata; the tool normalizes output dimensions/format and produces stable path/result data for downstream delivery or Creative use.
4. On provider failure, surface the specific unavailable/auth/validation/timeout reason without printing credentials or silently selecting a different provider. If a real fallback is supported by config, report the resolved provider/model.
5. Test both model alias and explicit upstream model behavior, a missing credential, unsupported dimensions, timeout/failure, output path and metadata. Keep paid generation tests mocked unless specifically authorized.

For `generate_video`, follow the job-oriented media engine guide rather than copying image request assumptions: jobs can outlive one tool call, have status/progress/cost/cancel semantics, and may return a temporary artifact before a persistent deliverable is created.

### Prompt budget details to preserve
- `prompt-context.ts` reads `self/index.md` to at most 3000 characters and this doc to at most 7000 characters; both are omitted for a public build.
- The prompt assembly inserts `SELF_INDEX` before `SELF_VOICE_SECTION`. Most of this document after the early voice bridge and routing sections is reference-only at runtime.
- Keep any new must-follow voice routing rule in the TL;DR or first few sections and verify the assembled snippet itself, not only the source doc's character count.
- Current prompt pack adds separate memory/skill context after these sections; the voice doc must not try to duplicate full worker skill instructions.
- The 7000-character cap applies to this file excerpt, not the whole assembled prompt. Under current text lengths, the complete doc appears to fit; keep margin for future growth.
- If it exceeds the cap, the remainder of prompt-budget safeguards, configuration, later gotchas, test checklist and Related links are truncated. Keep role boundary, worker handoff, dictation/wake distinctions, mobile pointer and common provider-routing context early.

## Config & knobs
| Setting | Where | Effect |
|---|---|---|
| Voice soul | configured data directory `voice-soul.md`; fallback `src/config/voice-soul.md` then regular soul | Live voice identity/style contract. |
| Realtime model/voice | `src/gateway/routes/realtime.router.ts` sanitizers; OpenAI realtime env/config | Realtime session model and output voice; validate before passing upstream. |
| Transcription model | `OPENAI_REALTIME_TRANSCRIPTION_MODEL`; default `gpt-4o-transcribe` | OpenAI realtime transcription session configuration. |
| Mobile provider/listen/dictation | `web-ui/src/mobile/mobile-voice-runtime.js` saved settings | Provider (`openai_realtime`/`xai`), quiet dictation and listen/wake state. |
| Image-generation provider/model | config schema `image_generation`; `src/image-generation/utils.ts` and registry | Provider account/config plus model, output dimensions, quality, format. |
| Public distribution | `isPublicDistributionBuild()` in `src/runtime/distribution.ts` | Suppresses private prompt self-section; see [21](21-security-approvals-permissions.md). |

## Gotchas / sharp edges
- **Voice narration is not execution evidence.** Check the worker event/result, approval and actual process state before announcing success.
- **Do not turn read-only voice context into direct authority.** The Realtime context is orientation; worker owns tool calls and approval decisions.
- **Keep voice rules before char 7000.** Later doc sections can be absent from the live Voice Agent prompt.
- **`voice-soul.md` absence is not a fatal no-prompt condition.** Loader falls back to main soul; verify which candidate path won before blaming the voice UI.
- **Do not conflate transcription with voice response.** A quiet dictation session should not synthesize a conversational response.
- **Provider available ≠ provider configured.** Read status endpoints and provider registration; verify authentication/transport separately.
- **xAI stream adapter naming is mixed.** Inspect the request path predicate; the module also attaches the OpenAI realtime proxy.
- **Image model alias may map to another upstream API model.** Provider mapping is implemented in `providers/openai.ts`; use current config/result metadata, not marketing-name assumptions.
- **OpenAI API and Codex providers have different auth.** Do not copy credentials or migrate auth paths as if they were the same provider.
- **`media_generate` is a normalization alias.** New tool docs should distinguish alias from canonical `generate_image` / `generate_video` definition and ensure classifier/category behavior is intentional.
- **Mobile source is not always the shipped source.** Follow [18](18-mobile-app.md) and run sync plus real-device smoke verification.

## How to change it safely
1. Identify which actor owns the change: speaking/listening prompt and bridge (voice), execution/policy (worker), browser/mobile UI, or image/video provider. Trace the exact path before editing.
2. For voice agent boundary/prompt changes, inspect `buildRealtimeContextPack()` and `buildSystemPrompt()` voice branch together; test status, normal speech, worker handoff, approval/blocker, user cancellation and silent wake cases.
3. For realtime or dictation changes, inspect both provider handler and desktop/mobile clients. Verify start/stop, transcript/display behavior, configured/unconfigured provider, authentication errors, interruption, status and event reconnects.
4. For mobile voice, obey [18 Mobile app](18-mobile-app.md): read its prerequisite, follow generated/static mirror notes, sync/check and exercise on a paired device. Relevant regression names live in [generated tests](generated/tests.md).
5. For image generation, test registry provider resolution, unavailable provider, default and explicit model mapping, invalid dimensions/options, output artifact path/metadata and authentication failure. Avoid live paid generation unless the task authorizes it.
6. For video/media job changes, use [15 Media engine & video](15-media-engine-video.md) and its cost, job-status and cancellation contracts.
7. Run targeted regressions, `npx tsc --noEmit` and the relevant `npm run sync:web-ui` / build/check steps. Use the source workflow in [07](07-source-editing-and-pr-workflow.md); after live apply, smoke-test on the actual desktop/mobile voice path.

## Related
- [03 Prompt assembly & context](03-prompt-assembly-and-context.md) · [04 Chat pipeline & providers](04-chat-pipeline-and-providers.md)
- [05 Tools & categories](05-tools-and-categories.md) · [07 Source editing & PR workflow](07-source-editing-and-pr-workflow.md)
- [15 Media engine & video](15-media-engine-video.md) · [18 Mobile app](18-mobile-app.md) · [21 Security/approvals](21-security-approvals-permissions.md)
- [Source map](generated/source-map.md) · [Tests inventory](generated/tests.md)
