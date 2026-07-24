---
name: Video to Vertical Social Cut
description: Download or ingest videos from X/Twitter, YouTube, other yt-dlp-supported pages, direct media URLs, or local files and rapidly turn them into polished no-header vertical social clips using direct FFmpeg, centered preserved landscape footage, dark source blur, word-timed captions, bounded hook selection, and actual-export QA.
version: 2.0.0
triggers: download this video and make a clip, turn this youtube video into a captioned vertical clip, make a vertical captioned clip from this x video, turn this twitter video into a tiktok style video, make a no-header vertical clip from this video, create a 9:16 social cut with captions, clip this online video with captions
---

# Video to Vertical Social Cut

Use this when Raul supplies an X/Twitter status, YouTube link, another yt-dlp-supported video page, a direct media URL, or a local video and wants a fast captioned vertical clip. Platform-specific differences belong only to ingest. Selection, transcription, captioning, render, QA, and exact-file delivery use one shared workflow. Measure request-to-delivery time, not render time.

## Non-negotiable export defaults

- No added header, title, hook, tag, source credit, Prometheus label, or persistent top text unless explicitly requested. An original watermark embedded in the source is not an added label.
- Preserve the complete landscape source as a geometrically centered foreground over a dark source-derived blurred 9:16 background.
- Burn short speech-synced captions built from word timestamps.
- Default: 720x1280, 30fps, H.264/AAC, `+faststart`.
- Deliver only the exact stat-verified MP4 that passed decode and direct exported-frame QA.

## Hard speed contract

### Normal critical path

1. Download into a short Windows path, or verify and reuse exact cached source when permitted.
2. Probe once. If the platform produced separate video and audio streams, keep them separate when both are valid; a merged intermediate is not required.
3. Select a candidate range from an exact-media transcript cache when available; otherwise transcribe only a bounded opening/audio chunk with a cached lightweight local model. Never call broad/full-video `analyze_video` for hook selection.
4. Reuse word timestamps for the selected range when available. Otherwise extract and transcribe only the chosen 20-30 second window.
5. Build ASS captions.
6. Render once with FFmpeg.
7. Run one combined QA pass: probe, full decode, and representative frames from the actual export.
8. Stat and deliver the exact artifact.

### Time budget

- Cached source plus reusable transcript: target under 2 minutes.
- Fresh supported-platform download plus bounded transcription: target under 3 minutes when network/extraction behaves normally.
- Hard intervention point: if any fallback would push the run past 4 minutes, stop that branch and use a known recovery or report the exact blocker.
- Skill/docs updates happen after delivery unless Raul explicitly asks for them in the same run.

### Forbidden latency branches

- No full-video `analyze_video` for selection or routine QA.
- No repeated transcription providers or model downloads.
- No recursive workspace/drive search.
- No browser or `web_fetch` before direct media download unless the downloader cannot handle the page.
- No repeated FFmpeg probing. Use the verified project-local `@ffmpeg-installer` binary and CPU `libx264`.
- No Creative, HyperFrames, HTML Motion, or Remotion source-video rendering for this fast lane.
- Do not redownload solely because yt-dlp downloaded valid component streams but failed during merge/postprocessing.

## Exact execution

### 1. Ingest by source type

Use a short folder such as `tmp/media-cut/<platform-or-id>/`.

- X/Twitter or YouTube page: call `download_media` immediately.
- Other supported video page: try `download_media` before browser extraction.
- Direct media URL: use `download_url` or the downloader as appropriate.
- Local file: verify the given file directly; do not copy unless short-path processing requires it.
- Cache reuse: inspect only known identity-specific locations and verify path, bytes, duration, and codecs.

If `download_media` reports a merge/postprocessing failure, inspect the exact output directory before retrying. If it contains a valid video-only stream and valid audio-only stream with matching duration, use them as separate FFmpeg inputs. See `references/youtube-fast-path-2026-07-23.md`.

### 2. Probe once

Use `C:/Users/rafel/PromSRC/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe` as the verified runtime path. Probe source/component streams once for duration, dimensions, codecs, frame rate, and audio presence. Never search Windows drives.

### 3. Select without full-video AI analysis

Preferred order:

1. Exact-media word transcript cache.
2. Exact-media coarse transcript, followed by local word timing only for the selected window.
3. No transcript: bounded opening/audio-only chunk transcription sufficient to choose a coherent passage.

Record `START` and `DURATION`. Open on a complete thought and end naturally. If Raul explicitly requests exactly 20 seconds, render 20 seconds while choosing the cleanest possible boundary.

### 4. Bounded word transcription

Use a confirmed cached lightweight model such as `base.en` with `word_timestamps=True`. Load mono 16kHz PCM WAV directly with Python `wave`/NumPy so Whisper does not need PATH FFmpeg. If no approved model is cached, do not acquire one during the run; use exact-media timing artifacts or report the blocker.

### 5. Caption cards

- Usually 2-5 words per card, phrase/punctuation aware.
- Begin at first word onset with at most ~80ms early lead.
- End at final word plus roughly 60-120ms.
- In continuous speech, replace the prior card within ~120ms of the next word.
- Never retain stale text while a new phrase is spoken.
- Use only the ASS `Caption` style. Never create title/tag/header events.

### 6. Direct FFmpeg render

Use `references/proven-direct-ffmpeg-runbook.md`. For 720x1280 and 16:9 foreground scaled to 720x405, exact center is `x=0,y=438`, using `overlay=(W-w)/2:(H-h)/2`.

For separate streams:

- Seek and trim the video as input 0.
- Seek and trim the audio as input 1.
- Apply the normal blur/foreground/ASS filter to input 0 video.
- Map `[v]` and `1:a:0`, then use `-shortest`.

Encode `libx264 -preset veryfast -crf 20`, `yuv420p`, AAC 160-192k, 30fps, and `+faststart`.

### 7. One combined QA pass

Mandatory gates:

- Probe: requested duration/dimensions and H.264/AAC.
- Full decode to null exits 0.
- Inspect representative frames from the actual MP4 for no added header/title/source label, centered preserved landscape foreground, active dark blur, legible unclipped captions, and no blank/corrupt frames.
- Verify ASS events are caption-only and lie within duration.

A tiled contact sheet can create false impressions of clipping or off-center geometry. If ambiguous, extract one direct frame from the exact MP4 and trust that frame over the tile layout. Do not remove or misclassify watermarks embedded in the original footage.

### 8. Deliver

Stat immediately before delivery. Present/send that exact QA-passed MP4. Report total elapsed time and a compact phase breakdown: ingest, selection/transcription, render/decode, QA.

## Recovery table

- Deep-path downloader failure -> retry once in the short ingest folder.
- Merge/postprocessing failure -> inspect component streams; if valid, render video and audio as separate inputs without redownloading.
- Exact source cached and reuse allowed -> verify identity and skip download.
- No word timing -> bounded local transcription with cached lightweight model.
- No cached local model -> use timing cache or report blocker; never download a model mid-run.
- FFmpeg absent on PATH -> use the verified project-local `@ffmpeg-installer` binary.
- ASS path failure -> use forward slashes and escape the Windows drive colon.
- QA uncertainty -> inspect one direct exported frame or targeted interval, not the full video.

## Completion gate

Do not deliver unless probe, full decode, actual-export direct-frame review, caption-only ASS validation, and exact-file stat all pass. Keep source identity, transcript/word timing, ASS, build script/filter, final MP4, QA images, and compact telemetry together.
