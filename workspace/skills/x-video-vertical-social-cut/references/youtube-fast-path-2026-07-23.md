# YouTube fast-path proof — 2026-07-23

## Request
Create a 20-second no-header vertical social clip from `https://youtu.be/zkGk_A4noxI`, with preserved centered landscape footage, dark source-derived blur, and word-timed captions.

## Result
- Source: 16:03 YouTube video, separate 1920x1080 AV1 video and Opus audio streams.
- `download_media` acquired both streams in about 13 seconds but its merge postprocess failed (`Stream #1:0 -> #0:1 (copy)`). The downloaded component streams were valid and were reused directly instead of redownloading.
- Bounded first-120-second mono WAV plus cached `base.en` word transcription completed in about 33 seconds.
- Selected a coherent 20-second passage at 26.02s.
- One Python/FFmpeg script created 15 short caption cards, rendered the separate video/audio inputs, fully decoded the export, and generated a contact sheet in about 25 seconds.
- Final: H.264/AAC, 720x1280, 30fps, 20.03s container duration, 2,441,506 bytes.
- Direct exported-frame QA confirmed centered landscape foreground, active dark blur, readable unclipped added captions, and no added header/title/source label. `MORE PERFECT UNION` is embedded in the original source video, not added by Prometheus.

## Cross-site execution rule
The social-cut workflow is source-platform agnostic. Accept X/Twitter, YouTube, other yt-dlp-supported video pages, direct media URLs, or local files. Platform differences belong only in ingest; selection, transcription, captioning, render, QA, and exact-file delivery stay identical.

## YouTube ingest recovery
1. Call `download_media` into a short path.
2. If merge/postprocessing fails, inspect the exact short-path directory before retrying. yt-dlp may have already completed separate video and audio streams.
3. Probe each component once. If one valid video-only stream and one valid audio-only stream have matching duration, use them as separate FFmpeg inputs and map the audio from input 1.
4. Do not redownload merely because container merge failed.
5. AV1 video input is acceptable; final output remains CPU `libx264` H.264/AAC.

## Proven separate-stream render pattern
- `-ss START -t DUR -i VIDEO`
- `-ss START -t DUR -i AUDIO`
- Apply the standard background/foreground/ASS filter to input 0 video.
- `-map [v] -map 1:a:0 -shortest`
- Encode H.264/AAC with the normal 720x1280/30fps defaults.

## QA caution
A tiled contact sheet can make the centered foreground look offset or captions clipped because each tile is cropped by the sheet layout. If the sheet is ambiguous, extract one direct frame from the actual MP4 and inspect that. Treat source-embedded watermarks separately from added headers/source labels.
