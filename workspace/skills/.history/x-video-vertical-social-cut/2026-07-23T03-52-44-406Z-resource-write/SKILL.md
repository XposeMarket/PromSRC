---
name: X Video to Vertical Social Cut
description: Create Raul's no-header vertical social cuts from X/Twitter or cached local video using the measured direct-FFmpeg fast path: short-path download, bounded local word transcription, centered preserved landscape footage, dark source blur, fast captions, and one combined actual-export QA pass.
version: 1.5.0
triggers: make a vertical captioned clip from this x video, turn this twitter video into a tiktok style video, make a no-header vertical clip from this video, create a 9:16 social cut with captions
---

# X Video to Vertical Social Cut

Use this when Raul supplies an X/Twitter status URL or local video and wants a captioned vertical clip. The workflow is measured by request-to-delivery time, not render time.

## Non-negotiable export defaults

- No header, title, hook, tag, source credit, Prometheus label, or persistent top text unless explicitly requested.
- Preserve the complete landscape source as a geometrically centered foreground over a dark source-derived blurred 9:16 background.
- Burn short speech-synced captions built from word timestamps.
- Default: 720x1280, 30fps, H.264/AAC, `+faststart`.
- Deliver only the exact stat-verified MP4 that passed decode and sampled-frame QA.

## Hard speed contract

### Normal critical path

1. Download to a short Windows path, or verify and reuse exact cached source when the user permits cache reuse.
2. Probe once.
3. Select a candidate range from an exact-media transcript cache when available; otherwise use a bounded lightweight local transcription strategy. Never call broad/full-video `analyze_video` for hook selection.
4. Extract only the chosen 20-30 second window to 16kHz mono WAV.
5. Run an already-cached lightweight local Whisper model with word timestamps on only that window. Never download/acquire a model during the run.
6. Build ASS captions.
7. Render once with FFmpeg.
8. Run one combined QA pass: probe, full decode, and a contact sheet/sample set from the actual export.
9. Stat and deliver the exact artifact.

### Time budget

- Cached source plus reusable exact-media transcript: target under 2 minutes.
- Fresh direct X download plus bounded local transcription: target under 3 minutes when network/extraction behaves normally.
- Hard intervention point: if any fallback would push the run past 4 minutes, stop that branch immediately and use a known fallback or report the exact blocker. Do not silently continue expensive experiments.
- Skill/docs updates and retrospective analysis happen after delivery, never on the critical path, except when Raul explicitly asks to update the skill before rerunning.

### Forbidden latency branches

- No full-video `analyze_video` for selection or QA.
- No repeated transcription providers.
- No Whisper model download. Use a confirmed cached model only.
- No recursive workspace/drive search.
- No browser or `web_fetch` before direct X download.
- No repeated FFmpeg encoder probing; use CPU `libx264` because NVENC is known unavailable.
- No separate early/middle/late AI video analyses. Use one generated contact sheet and inspect it once.
- No Creative, HyperFrames, HTML Motion, or Remotion source-video rendering.

## Exact execution

### 1. Ingest

For a fresh X run, call `download_media` immediately into `tmp/xv/<short-status-id>/`. Deep artifact destinations are prohibited during yt-dlp ingest because fragment names can exceed Windows path limits. Record returned path and download elapsed time. Move/copy the completed MP4 to the artifact directory only after download.

When cache reuse is requested, inspect only known status-specific cache locations and verify the source with path, bytes, duration, and codec. Do not recursively search the workspace.

### 2. Probe once

Resolve FFmpeg from the known bundled runtime or PATH and run one FFprobe for duration, dimensions, codecs, and frame rate. Never search Windows drives.

### 3. Select without full-video AI analysis

Preferred order:

1. Exact-media word transcript cache: select a coherent range directly.
2. Exact-media coarse transcript cache: select range from it, then locally retranscribe only that range for word timing.
3. No transcript: use a bounded/local first-pass strategy, never `analyze_video`. For longer videos, use low-cost audio-only chunk transcription or silence/scene sampling sufficient to choose candidates, then word-transcribe only the selected window.

Record `START` and `DURATION`. Open on a complete thought and end naturally; do not pad a clean 18-20 second idea merely to hit an arbitrary length.

### 4. Bounded word transcription

Extract only the selected range to mono 16kHz PCM WAV. Use a confirmed cached lightweight model such as `base.en` with `word_timestamps=True`. Load WAV directly with Python `wave`/NumPy if Whisper would otherwise spawn a missing PATH FFmpeg. If no approved model is already cached, do not download one; use exact-media timing artifacts or report the blocker.

### 5. Caption cards

- Usually 2-5 words per card, phrase/punctuation aware.
- Cue begins at first word onset, with at most ~80ms early lead.
- Cue ends at final word plus roughly 60-120ms.
- In continuous speech, replace the prior card within ~120ms of the next word.
- Never retain a stale phrase while a new phrase is being spoken.
- Use only the ASS `Caption` style. Never create title/tag/header events.

### 6. Direct FFmpeg render

Use `references/proven-direct-ffmpeg-runbook.md`. For 720x1280 and a 16:9 foreground scaled to 720x405, exact center is `x=0,y=438` (`overlay=(W-w)/2:(H-h)/2`). Encode using `libx264 -preset veryfast -crf 20`, `yuv420p`, AAC 160-192k, 30fps, and `+faststart`.

### 7. One combined QA pass

Mandatory gates:

- FFprobe: requested duration/dimensions and H.264/AAC.
- Full decode to null exits 0.
- Generate one contact sheet or bounded representative sample set from the actual MP4 and inspect once for: no header/title/source label; centered preserved landscape foreground; active dark blur; legible unclipped captions; no blank/corrupt frames; natural ending.
- Verify ASS events are caption-only, lie within duration, and use short word-timed cards. If a visual sample exposes a timing/layout defect, correct and rerender once.

Do not call broad video analysis for final QA unless the lightweight combined QA reveals a specific ambiguity that cannot be resolved from the actual frames/probe.

### 8. Deliver

Stat immediately before delivery. Send that exact QA-passed MP4. Report total elapsed time and a compact phase breakdown: download/cache, selection/transcription, render/decode, QA.

## Recovery table

- Deep-path yt-dlp failure → retry once in `tmp/xv/<short-id>/`.
- Exact source already present and cache reuse allowed → verify identity and skip download.
- No word timing → bounded local transcription of selected range with a cached lightweight model.
- No cached local model → do not acquire one during the run; use exact-media timing cache or report blocker.
- FFmpeg absent on PATH → use known project-local `@ffmpeg-installer` binary.
- ASS path failure → use forward slashes and escape Windows drive colon.
- Full-video analysis temptation → reject it; use transcript/audio-only bounded selection.
- QA uncertainty → inspect one additional targeted frame/audio interval, not the entire video.

## Completion gate

Do not deliver unless probe, full decode, actual-export visual review, caption-only ASS validation, and exact-file stat all pass. Keep source identity, transcript/word timing, ASS, build script/filter, final MP4, QA contact sheet, and compact telemetry together.