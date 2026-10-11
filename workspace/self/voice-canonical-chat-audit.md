# Canonical voice chat

Desktop Voice and mobile Voice default to **canonical** mode. Speech is transport into the existing normal chat admission and `handleChat` runtime: same current session, model route, prompts, automatic/atomic memory, skill routing, native tools, approval policy and history. No copy of the normal assistant prompt/tool dispatcher is created.

## Transport
- Desktop finalized speech uses existing `sendChat`; mobile uses existing authenticated `/api/chat` SSE.
- Browser/device or configured OpenAI/xAI adapters transcribe audio and speak returned chat text only. Audio-provider selection is distinct from the normal chat reasoning model.
- Canonical mode does not add voice-agent caller instructions or launch the separate voice worker.
- Barge-in stops playback and normal chat generation; request/session guards discard late transcripts after navigation and duplicate browser finals.
- Existing attachments, selected/excluded skills, client request IDs and approval events remain owned by normal chat.

## Legacy and reverse states
Realtime native audio reasoning remains explicit **Legacy** opt-in. Old implicit saved defaults migrate to canonical; status refresh cannot silently switch back. Canonical voice can start/stop and cancel playback/generation. Legacy voice context cache keys include transcript SHA-256 to avoid reuse across different utterances.

## Credentials and platform limits
OpenAI public audio needs a configured API key or Codex exchanged API key. An access-only Codex account does not imply audio entitlement. xAI uses configured account credentials. Browser speech availability/permissions vary by OS/browser; absent browser STT uses available server STT, never silently substitutes legacy reasoning. No hardcoded account or machine paths.

## Verification
`node scripts/test-canonical-voice.mjs` exercises production routing/defaults/provider preservation, stale/duplicate transcripts, start/stop, cancellation, SSE attachments/request IDs/approval events and mocked transport TTS. `npx tsx src/gateway/voice/context-cache-key.regression.ts` covers legacy cache keys.
Physical microphone/speaker, phone permissions and live provider entitlement require real-device verification; mocks are not proof of audio-device success. Default canonical turn-taking is not promised to match native realtime latency.
