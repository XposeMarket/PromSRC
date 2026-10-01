# CyrilXBT 24-minute fresh-source fast-path benchmark (2026-07-23)

Status: delivered and actual-export verified.

## Input and output

- X status: `2080142167956128057` (linked post resolved to media id `2080141885876625408`).
- Source: 24:52.60, 1920x1080, H.264, 59.94fps, 198,661,051 bytes.
- Output: exactly 20.0s, 720x1280, centered full 16:9 foreground, dark source blur, caption-only ASS, no header.
- Selected range: 27.80-47.80s, a complete explanation of prompt engineering.
- Output artifact: `creative-projects/mobile_mrwh5rf1_jjg0nw/x-social-cut/cyrilxbt-2080142167956128057/cyrilxbt-prompt-engineering-centered-captioned-20s.mp4`.

## Measured critical path

- Fresh X download to the short status-specific path: 94s.
- Extract first 120s as mono 16kHz WAV: 4s.
- Cached `base.en` Whisper word transcription of only that opening: 45s.
- ASS generation + one render + full decode + contact-sheet generation: 22s.
- Critical media path total: about 165s (2m45s), excluding delivery and retrospective skill maintenance.

This proves a 24-minute source does not require full-source transcription or full-video analysis. Source duration mainly affects download time if selection begins from a bounded opening window.

## Exact fast-path decisions

1. Resolve the stable FFmpeg executable immediately: `C:\Users\rafel\PromSRC\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe`. Do not probe nonexistent paths or search recursively.
2. Download directly to `tmp/xv/<status-id>/`.
3. For a lecture/tutorial whose opening establishes the subject, extract and word-transcribe only the first 120 seconds.
4. Choose a complete 20-second thought from that bounded transcript.
5. Reuse the same word timestamps to build captions. Do not retranscribe the selected window when the bounded transcript already has word timing.
6. Run caption generation, render, full decode, and contact-sheet generation in one script/process.
7. Inspect the actual export. If a contact sheet creates composition ambiguity, inspect one exact full-resolution output frame before rerendering; do not assume a montage-layout artifact means the export is broken.

## Geometry and QA evidence

The output uses `overlay=(W-w)/2:(H-h)/2`. At 720x1280, the complete 16:9 foreground resolves to 720x405 and occupies approximately y=437..842, leaving about 437px above and 438px below. A direct 10s output-frame check confirmed this exact centering, readable unclipped captions, active source-derived blur, and no unintended black region.

The first contact-sheet vision pass incorrectly suspected off-centering because the tiled montage made foreground boundaries ambiguous. The direct output frame disproved that suspicion. Recovery rule: when geometry is deterministic and a contact sheet is ambiguous, extract one exact frame and verify boundaries before changing the render.

## Next optimization

The 94-second full-video download is now the largest stage. The next safe experiment is concurrent ingest:

- launch full video download;
- launch a lightweight audio-only download or bounded remote audio acquisition in parallel;
- transcribe the first 60-120 seconds while the full video continues downloading;
- render immediately when both selected timestamps and source video are ready.

Do not make partial-HLS segment download mandatory until X URL/format behavior is proven reliable with fallback to the direct full download.
