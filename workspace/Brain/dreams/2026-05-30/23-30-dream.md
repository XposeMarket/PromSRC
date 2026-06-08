# Brain Dream — 2026-05-30
_Generated: 2026-05-30 23:30 local_

## Executive synthesis

2026-05-30 was dominated by Prometheus mobile voice and realtime-voice reliability. The strongest pattern is clear: the normal mobile voice path and the full realtime agent path have diverged. The normal path has deterministic transcript/wake gating and predictable submit behavior; the realtime path has its own response lane, quiet state, narration loop, provider-specific session update shapes, and different tool-call timing. That divergence explains the repeated quiet-mode failures, runaway speaking, and mid-thread context gaps Raul hit during live mobile testing.

The day also produced useful product momentum outside voice: repeated browser/desktop smoke tests proved the voice-triggered browser + desktop automation surface works end-to-end, the landing-page/file-edit workflow was exercised, and a Prometheus HyperFrames release-practice promo draft was created in the Ash & Archive direction. The mobile UI liquid-glass work was reportedly completed by Claude, but that remains medium-confidence until independently verified in source and visually on-device.

## Durable memory/entity updates written

Updated project entities from `Brain/business-candidates/2026-05-30/candidates.jsonl`:

- `project/prometheus-mobile-app`
  - Mobile realtime voice likely lacks full current chat history when enabled mid-thread.
  - Realtime voice steer/status behavior was updated live but still needs QA.
  - Realtime quiet/wake failure diagnosis: realtime bypasses normal always-listening wake gate and relies too heavily on provider response gating.
  - Raul reported quiet mode still failed and produced runaway/self-talking behavior after prior fixes.
  - Source investigation narrowed quiet/runaway causes to provider-specific response-lane handling, deferred quiet activation, xAI session update shape mismatch risk, and narration/context loops.
  - Claude-reported liquid-glass UI refinements were recorded as medium confidence pending independent verification.
- `project/prometheus`
  - Prometheus HyperFrames release-practice Ash & Archive promo draft was recorded, with lint passing but MP4 export blocked by missing FFmpeg and Creative/HyperFrames QA blocked by the known `__name` runtime issue.

## Source-grounded findings from this Dream run

### 1. Mobile voice wake phrase / quiet mode evidence from 2026-05-23 remains source-confirmed

Although the proposed review artifact `Brain/reviews/mobile-voice-verification-2026-05-23.md` could not be created in this scheduled run because the current mutation scope only allows `Brain/dreams/2026-05-30/23-30-dream.md`, `Brain/proposals.md`, `BUSINESS.md`, entities, and `Brain/business-reconciliation/2026-05-30`, the source inspection did confirm the earlier fixes are present.

Evidence inspected:

- `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:17-23`
  - Records Codex fixes for `xai_partial_idle`, `realtime_delta_idle`, `voice_set_wake_phrase`, wake-phrase directives, and duplicate transcript collapse.
- `src/gateway/routes/chat.router.ts:8934-8964`
  - `voice_write_note` explicitly says it must not handle runtime wake phrase/quiet/provider settings.
  - `voice_set_wake_phrase` is exposed as a direct mobile voice runtime tool.
- `src/gateway/routes/chat.router.ts:9149-9165`
  - `voice_write_note` rejects wake-phrase content with a runtime-action hint.
  - `voice_set_wake_phrase` returns `runtimeAction: 'set_wake_phrase'` and the cleaned wake phrase.
- `src/gateway/routes/chat.router.ts:9388-9406`
  - Deterministic fallback routes parse set/change wake phrase and quiet-until/quiet intent.
- `src/gateway/routes/chat.router.ts:9546-9554` and `11463-11468`
  - Voice-agent instructions include direct wake phrase/quiet tools and warn against substituting notes/memory.
- `web-ui/src/mobile/mobile-pages.js:4120-4134`
  - Mobile voice settings preserve `wakePhrase` and `wakeGateActive` only for always-listening mode.
- `web-ui/src/mobile/mobile-pages.js:4255-4307`
  - Runtime directives apply wake phrase, clear wake phrase, and quiet-until/enter-quiet state to mobile settings and realtime quiet state.
- `web-ui/src/mobile/mobile-pages.js:5360-5448`
  - `__pmRealtimeAgent.quiet` tracks active wake/quiet state; helper sends `session.update` with `turn_detection.create_response` toggles and handles xAI separately at the top-level session shape.
- `web-ui/src/mobile/mobile-pages.js:5743-5852` and `6019-6170`
  - OpenAI and xAI mobile realtime sessions pass `voiceRuntime` wake data to bootstrap and configure `turn_detection.create_response` based on quiet state.
- `web-ui/src/mobile/mobile-pages.js:8781-8895`
  - `_collapseDuplicatedFinalTranscript()` collapses repeated end-to-end final transcripts before `_submitAlwaysListeningSpeech()` applies wake gating, dedupe, and submission.
- `web-ui/src/mobile/mobile-pages.js:8897-8909`, `9113-9124`, `9211-9219`, `9401-9463`
  - xAI partials schedule `xai_partial_idle`; OpenAI realtime deltas schedule `realtime_delta_idle`; final events still submit through the same `_submitAlwaysListeningSpeech()` path.

Source-level conclusion: the 2026-05-23 fixes exist in current source. Live phone/browser verification is still needed for actual provider behavior, especially xAI realtime and quiet-mode response suppression.

### 2. Current mobile realtime quiet-mode remains the highest-leverage follow-up

The 2026-05-30 evidence points to a newer, more specific quiet-mode bug than the 2026-05-23 fixes:

- Normal/split mobile voice path gates transcripts deterministically before submitting.
- Full realtime agent path has provider-managed server VAD/response lanes and its own quiet state.
- Quiet entry historically acknowledged first, then tried to cancel/suppress later, which can fail during in-flight tool-call ordering.
- xAI must use top-level `turn_detection`; OpenAI uses nested `audio.input.turn_detection`. Current code appears to account for this in `_sendMobileRealtimeAgentCreateResponseFlag`, but prior notes and Raul’s live report show this area needs provider-specific live testing.
- Context/milestone narration loops can call `response.create` without a new user utterance when dictation mode allows narration, creating a plausible runaway speech source.

The latest Codex follow-up in skill-gardener logs says it suspected the quiet-mode tool-call path itself was ordered wrong: tool output should return first, follow-up model response should be suppressed, then quiet mode should activate with cancellation skipped for the in-flight tool call. This should be verified before more mobile voice work stacks on top.

### 3. Voice/browser/desktop smoke tests are broadly healthy

Multiple 2026-05-30 smoke tests opened X search, scrolled, focused Codex and Claude, delivered screenshots, and ran browser/desktop diagnostics. Browser automation passed Playwright/CDP/profile/screenshot checks. Desktop automation passed Windows/UIA/window targeting checks. Minor recurring warnings: OCR cache not populated and desktop capture falling back to `copy_from_screen` because WGC helper is not installed.

### 4. Creative/HyperFrames state

The release-practice promo draft exists as both Creative composition and standalone project files under `hyperframes-prometheus-release-practice/`. Lint passes except a timeline-density warning. Export/QA remains blocked by missing FFmpeg and the known native Creative/HyperFrames `ReferenceError: __name is not defined` issue.

## Follow-up proposals for `Brain/proposals.md`

1. **Fix mobile realtime quiet-mode response-lane ordering and provider-specific suppression**
   - Priority: critical.
   - Scope: source edit under `src/gateway/routes/chat.router.ts`, `web-ui/src/mobile/mobile-pages.js`, and possibly `web-ui/src/pages/ChatPage.js`.
   - Goal: make quiet mode actually silence realtime OpenAI/xAI after acknowledgement/tool output, avoid cancellation errors, suppress follow-up `response.create`, and verify wake phrase reactivation.

2. **Add compact current-thread context to mobile realtime voice bootstrap**
   - Priority: high.
   - Scope: source edit/review under mobile voice context packet/bootstrap paths.
   - Goal: when realtime voice is enabled mid-thread, it should know current chat context, not just global memory/persona and process summaries.

3. **Verify Claude-reported mobile liquid-glass UI refinements**
   - Priority: medium.
   - Scope: review-only unless verification finds a regression.
   - Goal: inspect source/generated sync and visually verify mobile footer/header/buttons on-device or via mobile viewport.

4. **Unblock HyperFrames release-practice promo export QA**
   - Priority: medium.
   - Scope: local creative/video/tooling review.
   - Goal: resolve missing FFmpeg path/runtime and the known `__name` frame-QA issue, then export or clearly mark the promo as source-only.

## Blockers / scope notes

- This scheduled run’s mutation scope blocked creating `Brain/reviews/mobile-voice-verification-2026-05-23.md`, even though the pending review proposal requested it. The source inspection was completed enough to preserve findings here, but the review artifact still needs an approved execution context or expanded mutation scope.
- No source files were edited in this Dream run.
- No live phone/browser provider tests were run for realtime quiet/wake behavior; conclusions above distinguish source-confirmed facts from live verification needs.
