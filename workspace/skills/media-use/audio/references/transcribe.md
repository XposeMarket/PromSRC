# Transcription

Create normalized word-level timestamps. In Prometheus, prefer
`scripts/transcribe.mjs`: it tries Parakeet when installed and otherwise runs
whisper.cpp through the committed HyperFrames wrapper. **Always make the
Whisper model explicit** when using the CLI directly.

```bash
# Shared media-use route; use tiny.en for a smoke test, small.en for quality.
node skills/media-use/scripts/transcribe.mjs --input audio.mp3 \
  --engine whisper --whisper-model small.en --out transcript.json

# Direct pinned HyperFrames 0.6.x route inside Prometheus.
node scripts/run-hyperframes.js transcribe audio.mp3 --model small.en
node scripts/run-hyperframes.js transcribe video.mp4 --model large-v3 --language es
node scripts/run-hyperframes.js transcribe subtitles.srt
```

## Language Rule (Non-Negotiable)

`.en` models (`tiny.en` / `base.en` / `small.en` / `medium.en`) **translate** non-English audio into English. This silently destroys the original language.

1. **Known English** → `--model small.en` (or `medium.en` for music / noisy audio)
2. **Known non-English** → `--model large-v3 --language <iso-code>`
3. **Unknown language** → `--model large-v3` (Whisper auto-detects)

**CLI default is `small.en`** — do not rely on it; always pass `--model` to make the choice explicit. `--language` also filters out non-target-language segments from mixed-language audio.

## Model Sizes

| Current CLI model | Size   | Speed    | When                                  |
| ----------------- | ------ | -------- | ------------------------------------- |
| `tiny.en`         | 75 MB  | Fastest  | English smoke tests                   |
| `base.en`         | 142 MB | Fast     | Short, clear English                  |
| `small.en`        | 466 MB | Moderate | Default English quality               |
| `medium.en`       | 1.5 GB | Slow     | Noisy English / music                 |
| `large-v3`        | 3.1 GB | Slowest  | Multilingual or production quality    |

### Picking a model by content type

1. Speech over silence / light background → `small.en`
2. Speech over music, or music with vocals → start with `medium.en`
3. Produced music track (vocals + full instrumentation) → start with `medium.en`; expect to need manual lyrics or an external API ([`captions/transcript-handling.md`](captions/transcript-handling.md) → "Using External Transcription APIs")
4. Multilingual → `large-v3`, paired with `--language` when known

## Output Shape

Compositions consume a flat array of word objects. The `id` (`w0`, `w1`, …) is added during normalization for stable references in caption overrides; optional for backwards compatibility.

```json
[
  { "id": "w0", "text": "Hello", "start": 0.0, "end": 0.5 },
  { "id": "w1", "text": "world.", "start": 0.6, "end": 1.2 }
]
```

For mandatory caption-quality checks, retry rules, and the OpenAI/Groq Whisper API import path, see `captions/transcript-handling.md`.
