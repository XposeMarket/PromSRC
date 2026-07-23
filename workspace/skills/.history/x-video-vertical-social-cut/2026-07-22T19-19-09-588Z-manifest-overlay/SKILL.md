---
name: X Video to Vertical Social Cut
description: Recreate the Raul-approved X-video social-cut style through a direct FFmpeg fast path: 720x1280 phone layout, preserved landscape foreground, dark source blur, persistent hook/tag by default, burned captions, exact artifact QA, and an 8-10 minute ceiling.
version: 1.3.0
triggers: make a vertical captioned clip from this x video, turn this twitter video into a tiktok style video, make a social media phone-view clip with captions, recreate the approved kimi style x video clip
---

# X Video to Vertical Social Cut

Use this when Raul supplies an X/Twitter status URL or local video and wants a captioned phone-view social clip. The default authority is the first Kimi benchmark Raul actually praised, not later generic 20-second attempts.

## Outcome

Deliver one or more actual-export QA-passed **720x1280, 30fps H.264/AAC MP4s** with:

- full landscape source preserved in a centered 720x405 foreground;
- source-derived dark blurred 9:16 background;
- persistent uppercase top hook plus small source/Prometheus tag by default;
- bold, readable burned spoken captions;
- original trimmed audio and mobile `+faststart`;
- exact source range and compact latency telemetry.

If Raul explicitly requests **no header**, remove the hook/tag and top strip only. Do not silently make no-header the default: the praised benchmark included hooks and tags.

## Proven authority

Read `references/approved-kimi-benchmark-fast-path.md` before execution. It identifies:

- the exact transcript and Raul's approval;
- the retained artifacts and telemetry;
- `tools/render_social_clips.py`, the exact approved implementation;
- later HyperFrames/generic attempts that must not be treated as approved evidence;
- the verified speed reproduction.

## Tool contract

Activate only:

1. `media_assets` for `download_media` and one final `analyze_video` QA pass.
2. `workspace_write` for workspace paths, ASS/script artifacts, and bounded `workspace_run` FFmpeg/FFprobe commands.

Do not activate Creative/HyperFrames/browser categories for this normal source-video lane. Do not use HTML Motion, Remotion, HyperFrames, or Creative compositions to carry or export the source footage.

## Speed contract

- Target: **8-10 minutes maximum**.
- Preferred with cached transcript/source: **3-6 minutes**.
- No `web_fetch` before `download_media` for an X status.
- No full-source `analyze_video` before hook selection.
- No cloud-STT call followed by local-STT retry when a valid transcript cache already exists.
- No drive-wide binary search; use known FFmpeg/FFprobe paths.
- No repeated per-clip visual-analysis loops. One contact sheet/quick QA per final clip is sufficient unless it finds a defect.

## Executable fast path

1. **Ingest**
   - Call `download_media(url, output_dir)` immediately.
   - Record the exact returned MP4 path, bytes, and elapsed time.
   - If the exact source is already cached, verify it exists and skip redownload.

2. **Probe once**
   - Resolve FFmpeg/FFprobe from the known project-local binaries or PATH.
   - Probe duration, dimensions, codecs, and frame rate.
   - Never recursively search Windows drives.

3. **Transcript and hook selection**
   - Reuse the exact media's transcript cache when present.
   - If absent, transcribe once. Do not deep-analyze the full source first.
   - Select a coherent 30-45s source range from timestamped transcript text, unless Raul specifies another duration.
   - For several clips, select all independent ranges in the same pass.

4. **Generate ASS captions**
   - Use the Title/Tag/Caption styles and event construction from `tools/render_social_clips.py:32-52`.
   - Caption only transcript segments intersecting the selected source range; shift timestamps relative to clip start.
   - Clean whitespace and escape braces.
   - Keep Title and Tag by default. Remove them only on an explicit no-header request.

5. **Render the approved composition**
   - Use the exact filter baseline from `tools/render_social_clips.py:58-69`:
     - background: scale/crop to 720x1280, `gblur=sigma=30:steps=2`, `brightness=-0.22`, `saturation=0.72`;
     - foreground: scale to 720x405 and overlay at y=290;
     - dark top and bottom strips;
     - ASS subtitles.
   - Encode with `libx264 -preset faster -crf 20 -r 30 -pix_fmt yuv420p`, AAC 160k, and `+faststart`.
   - NVENC is currently unavailable on the verified Windows machine (`Cannot load nvcuda.dll`); do not probe it every run.
   - If producing multiple clips, run independent renders in parallel when resource-safe.

6. **QA the actual MP4**
   - FFprobe: require 720x1280, H.264, AAC, expected duration.
   - Full decode to null: require exit code 0.
   - Run one quick `analyze_video` contact-sheet pass or inspect 8-12 sampled frames.
   - Confirm full landscape source, active dark blur, readable hook/tag and captions, no clipping, corruption, or accidental blank frames.
   - If QA fails, change only the selected range, ASS, or filter, then rerender once and repeat the failed gate.

7. **Deliver exact artifact**
   - Stat the final path; never infer it from a filename.
   - Send only the exact QA-passed MP4.
   - Report source URL/range, output duration/format, total elapsed time, stage timings, QA verdict, and any recovery.

## Recovery

- X extraction fails: use `download_media`; do not browse the post or switch render lanes.
- Transcript provider fails: reuse cache or local Whisper. Do not spend minutes retrying the same cloud provider.
- FFmpeg absent from PATH: use the project-local `@ffmpeg-installer` binary documented in the approved benchmark reference.
- Caption path fails: use forward slashes and escape the drive colon in the ASS filter path.
- Background too dark: raise brightness modestly while preserving source-derived blur.
- Wrong words: correct transcript-derived ASS text, especially model names, before delivery.

## Completion gates

Do not deliver unless probe, full decode, and actual-export visual QA pass. Keep all source, transcript, ASS, final MP4, contact sheet, and compact telemetry together under one artifact directory.
