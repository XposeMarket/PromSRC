# Canonical voice completion

Status: **DONE_WITH_CONCERNS**

BASE: `cb2ca5dbd1abccc51dd93947174d39f69c86cb71`
Branch: `feat/canonical-voice-complete`
Implementation commit: `e11e6cafaced40fbd2e0201d6c69a26742206e13`

## Changed paths
- src/gateway/routes/voice.router.ts
- web-ui/src/pages/ChatPage.js
- web-ui/src/mobile/mobile-api.js
- web-ui/src/mobile/mobile-pages.js
- web-ui/src/mobile/mobile-voice-page.js
- web-ui/src/mobile/mobile-voice-runtime.js
- scripts/test-canonical-voice.mjs

## Findings / implementation (11)
1. Normal desktop Voice now defaults to canonical mode and submits STT through the existing `sendChat` composer adapter, not voice-agent input or realtime reasoning.
2. Mobile default uses the existing `streamChat` `/api/chat` admission and SSE path. Canonical mode bypasses legacy voice-worker handoff, interruption classifier and caller-context system instructions.
3. `/api/chat` remains untouched: its normal `runInteractiveTurn` / `handleChat` pipeline owns prompts, automatic/atomic memory, skills, tool dispatch, history and approval policy. No voice prompt copy was introduced.
4. Saved realtime defaults migrate to canonical. Explicit legacy realtime choices have Legacy labels and a durable opt-in flag; canonical provider-status refresh cannot auto-switch back.
5. Browser/device STT/TTS and selected OpenAI/xAI audio provider choices remain transport options. Browser unavailable falls back to server STT only, never realtime reasoning.
6. Restored dormant server TTS and mobile playback-stop functions; `/api/voice/status`, `/api/voice/tts` and `/api/tts/speak` return audio transport metadata/bytes.
7. OpenAI audio uses existing configured API credentials or Codex exchanged API key via the config directory; xAI uses existing account-pool credentials. No hardcoded paths. Codex access-only accounts without an exchanged API key cannot use public audio APIs; browser/device transport remains the no-paid-key route.
8. Browser final duplication and late backend/browser transcripts are guarded against duplicate submits or navigation to another desktop thread.
9. Barge-in stops audio and cancels the canonical chat; mobile uses stream abort plus `stopMobileMainChat`. Desktop invokes normal `stopGeneration`.
10. Mobile canonical Voice retains current chat rather than automatically starting an isolated voice draft; voice submissions include current attachments, request IDs and selected/excluded skills. Existing normal SSE events and shared approval handler remain authoritative.
11. No live provider generation/audio calls, push, merge or deployment performed. Generated sync output is intentionally unstaged and uncommitted.

## Verification
- `node scripts/test-canonical-voice.mjs`: **PASS**. Executes production functions extracted with AST, not text grep: desktop STT→normal submit, provider retention, stale-thread suppression, duplicate browser finals, two voice toggles, playback-stop/cancel; mobile native-STT fallback and barge-in; actual `/api/chat` request serialization and SSE tokens/tool/approval event/final/cancellation; mocked backend OpenAI/xAI speech synthesis and invalid provider rejection.
- `node --check` changed desktop/mobile JS: **PASS**.
- `npx tsc --noEmit -p tsconfig.json`: **PASS**, exit 0 in final combined run.
- `npm run sync:web-ui`: **PASS**, exit 0; includes `check:web-ui` module globals and generated sync check.
- Scoped `git diff --check`: **PASS**.

## Remaining verification limitations
No physical microphone/speaker or real phone was available in this lane. Audio capture permissions, browser SpeechRecognition availability, real Codex credential exchange/public audio entitlement, provider audio wire behavior and live approval-click completion require device/provider verification by main. Regression proves approval SSE preservation, not a live external approval action. No paid audio/generation was invoked. These limitations must not be described as physical-device end-to-end PASS.
