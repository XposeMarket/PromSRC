---
name: X Video to Vertical Social Cut
description: Recreate Raul's approved X/Twitter captioned phone-view social cuts through the direct-FFmpeg fast path: preserved landscape footage, dark source blur, no header, speech-synced burned captions, exact-export QA, and an 8-10 minute ceiling.
version: 1.4.0
triggers: make a vertical captioned clip from this x video, turn this twitter video into a tiktok style video, make a no-header vertical clip from this video, create a 9:16 social cut with captions
---

# X Video to Vertical Social Cut

Use this when Raul supplies an X/Twitter status URL or local video and wants a captioned phone-view social clip. The visual authority is the preserved-landscape/direct-FFmpeg Kimi benchmark, with Raul's later corrections overriding its historical header and loose caption behavior.

## Non-negotiable current defaults

Every normal export must have:

- **No header, title, hook, tag, source credit, Prometheus label, or persistent top text.** Never add one unless Raul explicitly asks for a header in the current request.
- Full landscape source preserved and centered over a source-derived dark blurred 9:16 background.
- Bold burned captions timed to the spoken words, not merely to coarse transcript blocks.
- Original trimmed audio, H.264/AAC, 30fps, `+faststart`.
- Exact artifact identity plus actual-export technical, visual, and caption-sync QA.

A header appearing without an explicit request is a failed export. Captions remaining on screen roughly 1-2 seconds after the audio has moved on are a failed export.

## Output contract

Default to **720x1280, 30fps H.264/AAC MP4** for the approved fast layout unless the user requests another resolution. For a single requested clip, choose one coherent **20-30 second** section unless another duration is specified.

Composition:

- preserve the full landscape foreground, centered;
- fill the 9:16 canvas with a dark, blurred enlargement of the same source;
- use no persistent top or bottom title strips;
- place readable spoken captions in the lower mobile-safe area without covering critical source content.

## Proven authority

Read `references/approved-kimi-benchmark-fast-path.md` before execution for the exact direct-FFmpeg lineage, retained artifacts, speed evidence, and implementation. Treat its hook/tag as historical only. The current no-header and caption-sync rules in this file override older benchmark styling.

Use `references/proven-direct-ffmpeg-runbook.md` for the no-header filter, Windows command templates, and QA commands.

## Tool contract

Activate only:

1. `media_assets` for `download_media`, transcription/media analysis when needed, and one final actual-export QA pass.
2. `workspace_write` for workspace paths, transcript/ASS/filter artifacts, and bounded FFmpeg/FFprobe commands.

Do not use Creative, HyperFrames, HTML Motion, or Remotion to carry or export source footage in this workflow.

## Speed contract

- Target: **8-10 minutes maximum**.
- Preferred with cached source/transcript: **3-6 minutes**.
- Download the X media directly. Do not browse or `web_fetch` first.
- Reuse a transcript cache only when it belongs to the exact media and includes timing precise enough for captions.
- Do not run broad binary searches, duplicate transcription providers, or repeated full-video analyses.
- One render and one actual-export QA pass should be normal. Rerender only to correct a found defect.

## Executable fast path

### 1. Ingest

- Call `download_media(url, output_dir)` immediately.
- Record the exact returned MP4 path, bytes, and elapsed time.
- If the exact source is cached, stat/verify it and skip redownload.

### 2. Probe once

- Resolve FFmpeg/FFprobe from the known project-local binaries or PATH.
- Probe duration, dimensions, codecs, and frame rate.
- Never recursively search Windows drives.

### 3. Transcribe and select the clip

- Prefer transcript data with **word-level timestamps**.
- Reuse a cache only if it matches the exact media and contains word timing. If the cache contains only coarse segment timing, do not blindly burn those segment boundaries as captions; obtain word timing or run a bounded alignment/transcription pass for the selected range.
- Select one coherent 20-30 second source window with a clear opening and natural ending, unless Raul requests another duration.
- Record exact `START` and `DURATION`.

### 4. Build speech-synced captions

Create short caption cards from word timestamps:

- normally 2-6 words per card, one or two short lines;
- break on natural phrase/punctuation boundaries, not fixed transcript chunks;
- cue start should follow the first spoken word onset, allowing at most about 80ms of early lead;
- cue end should track the final spoken word and normally add only 60-120ms of visual tail;
- during continuous speech, the next cue should replace the previous cue within 120ms of the next word onset;
- never let a finished phrase linger while a different phrase is already being spoken;
- silence may contain no caption. Do not stretch a caption across a real pause just to fill time;
- enforce positive durations and avoid overlapping unrelated cards;
- correct obvious transcription errors before rendering.

Use only a `Caption` ASS style. Do **not** create `Title`, `Tag`, `Hook`, or source-credit styles/events.

### 5. Render directly with FFmpeg

Use the no-header filter in `references/proven-direct-ffmpeg-runbook.md`:

- source-derived scale/crop blur for the 9:16 background;
- darkened/saturated background;
- full landscape foreground centered without aggressive cropping;
- ASS spoken captions only.

Encode with `libx264 -preset veryfast` or `faster`, CRF 20, 30fps, `yuv420p`, AAC 160-192k, and `+faststart`. NVENC is unavailable on the verified machine (`Cannot load nvcuda.dll`); do not probe it every run.

### 6. QA the actual exported MP4

All gates are mandatory:

1. **Probe:** expected duration/dimensions, H.264 video, AAC audio.
2. **Decode:** full decode to null exits 0.
3. **Visual:** inspect a contact sheet or 8-12 sampled frames from the actual MP4. Confirm preserved landscape footage, active dark blur, legible unclipped captions, no blank/corrupt frames, and absolutely no header/title/tag/source-credit.
4. **Caption sync:** inspect at least three actual-export caption transitions near the early, middle, and late portions while referencing audio waveform/playback and cue times. Confirm each old card clears as its phrase ends and the next card appears with the next spoken phrase. Reject if captions visibly trail active speech by more than roughly 250ms, or if any stale card survives into a different spoken phrase.
5. **Ending:** the final caption clears naturally and is not stranded after speech ends.

If caption sync fails, fix the word-to-card timing and rerender. Do not merely shift the whole subtitle track unless the offset is proven uniform across the clip.

### 7. Deliver exact artifact

- Stat the final path immediately before delivery.
- Send only that exact QA-passed MP4.
- Report source URL/range, duration/format, elapsed time, and the technical/visual/caption-sync verdict.

## Recovery

- X extraction fails: use `download_media`; do not browse the post or switch render lanes.
- Transcript provider fails: reuse exact-media word timing or use local Whisper/alignment on the selected range.
- Only coarse timestamps exist: regenerate/alignment-pass the selected 20-30 seconds rather than shipping slow captions.
- FFmpeg absent from PATH: use the project-local `@ffmpeg-installer` binary documented in the benchmark reference.
- ASS path fails: use forward slashes and escape the Windows drive colon.
- Background too dark: raise brightness modestly while preserving the source-derived blur.
- Caption wording is wrong: correct transcript-derived ASS text before delivery.
- Captions drift progressively: inspect timestamp basis/sample-rate and regenerate cues; do not apply a single global offset to nonlinear drift.

## Completion gate

Do not deliver unless probe, full decode, actual-export visual QA, and actual-export caption-sync QA all pass. Keep the source, exact-media transcript/word timings, ASS, filter, final MP4, QA samples, and compact telemetry together under one artifact directory.
