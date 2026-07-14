# Text To Speech

Use the shared `audio/scripts/audio.mjs` engine when a workflow needs provider
selection, multiple lines, or word timing. Its chain is HeyGen → ElevenLabs →
local Kokoro, and `--provider` can pin one. The published HyperFrames 0.6.x
`tts` command itself is **Kokoro-only**; it has no `--provider` or `--words`
option.

> **Run the Preflight first when cloud voice quality or spend matters.** Check
> HeyGen auth, then let the user choose cloud voice or offline Kokoro. A request
> that explicitly asks for local/offline TTS can proceed directly to Kokoro.

## Provider chain

| Order | Provider          | Env trigger                                 | Voice IDs                                   | Word timestamps                           | Audio format         |
| ----- | ----------------- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------- | -------------------- |
| 1     | HeyGen (Starfish) | `$HEYGEN_API_KEY` / `~/.heygen/credentials` | UUIDs from `GET /v3/voices?engine=starfish` | **Yes** (`word_timestamps[]` in response) | mp3 → wav via ffmpeg |
| 2     | ElevenLabs        | `$ELEVENLABS_API_KEY`                       | UUIDs from elevenlabs.io dashboard          | No                                        | mp3 → wav via ffmpeg |
| 3     | Kokoro-82M        | always (local fallback)                     | `am_michael`, `af_heart`, … (54 voices)     | No                                        | wav direct           |

```bash
# Recommended workflow route: audio_request.json selects lines/provider.
node skills/media-use/audio/scripts/audio.mjs \
  --request ./audio_request.json --hyperframes . --out ./audio_meta.json --only tts

# Direct local Kokoro route (inside Prometheus use scripts/run-hyperframes.js).
node scripts/run-hyperframes.js tts "Welcome to HyperFrames" \
  --voice af_heart --output narration.wav
```

## Self-contained HeyGen (no CLI) — `scripts/heygen-tts.mjs`

The published `hyperframes tts` CLI synthesizes locally with Kokoro only. When you
want HeyGen specifically — best quality **plus** word timestamps in one call — use
the skill's bundled script, which calls the HeyGen v3 REST API directly and needs
no CLI provider plumbing:

The script resolves a HeyGen credential the same way the CLI does — first source
wins: `$HEYGEN_API_KEY` → `$HYPERFRAMES_API_KEY` → a project `.env` (auto-loaded,
walks up ≤5 dirs) → `~/.heygen/credentials` (shared with heygen-cli;
`$HEYGEN_CONFIG_DIR` overrides the dir). An OAuth login is sent as
`Authorization: Bearer`; an API key as `X-Api-Key`; both include
`X-HeyGen-Source: cli`. OAuth CLI users can consume the web-plan free allowance
(10 min/month) before paid usage; API keys follow normal API billing. If the
only credential is an expired OAuth token it stops with a hint to run
`npx hyperframes auth refresh`.

```bash
# Only needed if you haven't run `npx hyperframes auth login`:
export HEYGEN_API_KEY=...   # or put it in a project .env

# Synthesize + capture word timestamps in one call (skips a Whisper pass)
node skills/media-use/audio/scripts/heygen-tts.mjs \
  "Welcome to HyperFrames." -o narration.wav --words narration.words.json

node skills/media-use/audio/scripts/heygen-tts.mjs ./script.txt -o narration.wav
node skills/media-use/audio/scripts/heygen-tts.mjs --list   # public starfish voices
```

- **Voice:** `--voice <id>` must be a **starfish** voice_id (`--list`, or `GET /v3/voices?engine=starfish`). v2-catalog ids are rejected with HTTP 400. Omit `--voice` (English) and it defaults to **Marcia** (`05f19352e8f74b0392a8f411eba40de1`, a fixed default so the choice is deterministic). Non-English with no `--voice` falls back to the first matching catalog voice.
- **Output:** `.wav` → transcoded to 44.1k mono via ffmpeg; `.mp3` → raw bytes (no ffmpeg needed).
- **Words:** `--words <path>` writes the flat `[{id,text,start,end}]` shape below, drop-in for the captions pipeline. HeyGen's `<start>`/`<end>` boundary sentinels are filtered out and ids are re-contiguous.
- **Non-English:** `--lang <code>` (anything but `en`) is sent as the request `language`.

## When to use which provider

| Goal                                                      | Use                                                 |
| --------------------------------------------------------- | --------------------------------------------------- |
| Best voice quality + word timestamps in one call          | **HeyGen**                                          |
| Drop-in cloud TTS, big voice catalog                      | **ElevenLabs**                                      |
| Offline, no API key, fast iteration                       | **Kokoro**                                          |
| Non-English multilingual with deterministic phonemization | **Kokoro** (`ef_dora`, `jf_alpha`, `zf_xiaobei`, …) |

## ffmpeg requirement

HeyGen + ElevenLabs return mp3. The media engine transcodes to wav when the
workflow requests it. Inside Prometheus, both the engine and the committed
HyperFrames wrapper resolve bundled FFmpeg/ffprobe binaries; standalone installs
need those binaries on `PATH`.

## Voice selection (Kokoro)

Default `af_heart`. Curated picks:

| Content type      | Voice                  |
| ----------------- | ---------------------- |
| Product demo      | `af_heart`, `af_nova`  |
| Tutorial / how-to | `am_adam`, `bf_emma`   |
| Marketing / promo | `af_sky`, `am_michael` |
| Documentation     | `bf_emma`, `bm_george` |
| Casual / social   | `af_heart`, `af_sky`   |

Run `npx hyperframes tts --list` for the bundled set.

## Multilingual (Kokoro voice prefix → language)

The first letter of a Kokoro voice ID picks the phonemizer language; `--lang` overrides auto-detection.

| Prefix | Language             |
| ------ | -------------------- |
| `a`    | American English     |
| `b`    | British English      |
| `e`    | Spanish              |
| `f`    | French               |
| `h`    | Hindi                |
| `i`    | Italian              |
| `j`    | Japanese             |
| `p`    | Brazilian Portuguese |
| `z`    | Mandarin             |

```bash
node scripts/run-hyperframes.js tts "La reunión empieza a las nueve" --voice ef_dora
node scripts/run-hyperframes.js tts "Today is a nice day" --voice af_heart
```

Valid `--lang` codes (only needed to override the voice's auto-detected language): `en-us`, `en-gb`, `es`, `fr-fr`, `hi`, `it`, `pt-br`, `ja`, `zh`.

Non-English phonemization requires `espeak-ng` system-wide (`brew install espeak-ng` / `apt-get install espeak-ng`).

## Speed

- `0.7-0.8` — tutorial, complex content, accessibility
- `1.0` — natural pace (default)
- `1.1-1.2` — intros, transitions, upbeat content
- `1.5+` — rarely appropriate, test carefully

Honored by Kokoro + HeyGen; ElevenLabs ignores `--speed` (use voice settings on their dashboard).

## Long scripts

Past a few paragraphs, write the text to a `.txt` file and pass the path. Inputs over ~5 minutes of speech may benefit from splitting into segments.

## HeyGen word-timestamp shape

When `--words <path>` is passed to the bundled `heygen-tts.mjs` helper, the
file is written in the same flat shape `transcribe` produces — drop-in
compatible with the captions pipeline:

```json
[
  { "id": "w0", "text": "Hi", "start": 0.0, "end": 0.21 },
  { "id": "w1", "text": "there", "start": 0.22, "end": 0.55 }
]
```

For ElevenLabs/Kokoro, the shared audio engine automatically chains
transcription. On a one-off file, use `scripts/transcribe.mjs --engine whisper`
or the Prometheus HyperFrames wrapper.
