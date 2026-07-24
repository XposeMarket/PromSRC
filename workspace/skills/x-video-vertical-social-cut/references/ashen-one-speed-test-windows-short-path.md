# Ashen One speed test: Windows short-path ingest and exact centering

Verified on X status `2078161744388563053`.

## Fast-path correction

On Windows, do not pass a deeply nested artifact directory directly to `download_media` for long X/HLS media. yt-dlp appends the tweet title, media ID, format name, `.part`, and fragment suffix; this run spent 3m37 downloading before repeated `unable to open for writing` failures from the effective path length.

Use a short bounded ingest path first, for example `tmp/xv/<short-id>/`, then retain or move the completed MP4 into the artifact directory. The retry to `tmp/ashen2078/` completed normally. Treat this as the default Windows ingest path, not merely an error fallback.

## Cached artifact rejection

A same-status prior export may still violate the current skill. Inspect its ASS/filter before reuse. The stale export in this run had `Title` and `Tag` styles/events, coarse 3-9 second captions, black strips, and foreground overlay at `y=290`; it was rejected rather than delivered.

## Exact geometric centering

For a 720x1280 canvas and preserved 3840x2160 source scaled to 720x405, use:

`overlay=(W-w)/2:438`

The integer center is `(1280-405)/2 = 437.5`; 438 is the frame-aligned result. Do not infer centering from visual balance or reserve title space. Final sampled QA confirmed foreground bounds at approximately `x=0, y=438`.

## Local word-timestamp recovery

If `faster_whisper` is absent but Python `whisper` exists:

1. Use the known project-local FFmpeg binary to extract 16kHz mono PCM WAV.
2. Load the WAV directly with Python `wave`/NumPy so Whisper does not spawn a missing PATH `ffmpeg` executable.
3. Run a small cached model such as `base.en` with `word_timestamps=True` on only the selected clip.
4. Group 3-5 words per ASS card; trim each card end to just before the next word onset.

Avoid first attempting the uncached `turbo` model: this run began an unnecessary 1.51GB model download. `base.en` was 139MB and transcribed the 20-second candidate in about 15 seconds once audio loading was corrected.

## Verified final contract

- 20.000s, 720x1280, 30fps, H.264/AAC
- full 16:9 source centered at x=0/y=438
- dark source-derived blur
- no added header/title/tag/source label
- 23 short word-timed caption cards
- full decode exit 0
- actual-export 16-frame QA pass
