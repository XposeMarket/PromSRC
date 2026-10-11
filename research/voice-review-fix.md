# Voice review fix — DONE

Baseline: integration HEAD `09d4f86bc`. Source/test ownership confined to `web-ui/src/pages/ChatPage.js` and `scripts/test-canonical-voice.mjs`; this requested report is the only additional file written.

## Fix

- `web-ui/src/pages/ChatPage.js:8966`: existing `_openSession` lifecycle increments `canonicalVoiceEpoch` before changing sessions and stops active backend recording. Permission requests and in-flight transcription are invalidated even for A → B → A navigation.
- `web-ui/src/pages/ChatPage.js:23255`: `transcribeBackendRecording(blob, recordingContext)` uses capture-time session/epoch, not current transcription-time state. Staleness is checked before encoding, again before upload, and after the response before composer mutation/submission.
- `web-ui/src/pages/ChatPage.js:23309`: freezes session/epoch before `getUserMedia`; stale permission results release their tracks without starting capture. Recorder, chunks and MIME are closure-local, so delayed stop callbacks cannot clear a newer recording. `onstop` forwards the immutable context.
- Provider selection remains unchanged: canonical configured STT (browser → auto), legacy batch auto; canonical submits via `sendChat`, legacy remains composer text only.

## Executable regression

`scripts/test-canonical-voice.mjs:49-135` executes extracted production capture/transcription functions with mocked MediaRecorder and microphone permission, covering:

1. Exact record A → navigate B → stop: no upload, text, or submission.
2. Actual synchronous `_openSession` lifecycle: epoch invalidation and capture stop.
3. Delayed `getUserMedia` resolving after A → B → A: tracks released, zero recorder starts.
4. Navigation during base64 conversion: zero uploads.
5. Epoch change during transcription response: zero text/submission.
6. Normal canonical and legacy record/start/stop, MIME and provider selection.

## Checks

- `node --check web-ui/src/pages/ChatPage.js` — PASS.
- `node --check scripts/test-canonical-voice.mjs` — PASS.
- `node scripts/test-canonical-voice.mjs` — PASS (desktop/mobile canonical transport and backend audio checks included).
- `git diff --check -- web-ui/src/pages/ChatPage.js scripts/test-canonical-voice.mjs` — PASS.

No commit, push, full build, generated-file write, spawn, or other-worker file edit performed. Synthetic checks do not prove physical-device microphone behavior; full integration/deployment remains main's responsibility.
