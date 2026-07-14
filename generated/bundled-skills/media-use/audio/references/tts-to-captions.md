# TTS → Captions

When no recorded voiceover exists, generate one and obtain word-level caption
timing. The recommended route is the shared `audio.mjs` engine: it records native
HeyGen timings or automatically transcribes ElevenLabs/Kokoro output into the
same `audio_meta.json` contract.

## Path A — HeyGen (single call, no Whisper)

HeyGen returns word timestamps in the same response as the audio. Use the
bundled helper (the HyperFrames 0.6.x `tts` command is local-only):

```bash
node skills/media-use/audio/scripts/heygen-tts.mjs script.txt \
  --output narration.wav --words narration.words.json
```

`narration.words.json` is already in the `[{ id, text, start, end }]` shape the captions pipeline consumes — no separate transcribe pass.

## Path B — ElevenLabs / Kokoro (TTS → Whisper)

These providers don't return word data. Generate the audio, then transcribe:

```bash
node scripts/run-hyperframes.js tts script.txt --voice af_heart --output narration.wav
node skills/media-use/scripts/transcribe.mjs --input narration.wav \
  --engine whisper --whisper-model small.en --out narration.words.json
```

Whisper extracts word boundaries from the generated audio. Use an English model
for `a`/`b` Kokoro voices; use the pinned CLI's `large-v3 --language <code>`
route for non-English. Then consume the normalized word array via the caption
references in `captions/`.
