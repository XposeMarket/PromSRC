---
name: X Video to Vertical Social Cut
description: Turn an X/Twitter video or local source clip into a fast, verified 9:16 social export through a direct FFmpeg path: uncropped landscape foreground, dark blurred source background, ASS captions, no persistent header, artifact provenance, and measured telemetry.
version: 1.2.0
triggers: make a vertical captioned clip from this x video, turn this twitter video into a tiktok style video, make a no-header vertical clip from this video, create a 9:16 social cut with captions
---

# X Video to Vertical Social Cut

Use this production runbook when Raul supplies an X/Twitter status URL or a local MP4 and asks for a short, captioned 9:16 social cut. Default outcome: an actual-export QA-passed **1080×1920, 30fps H.264/AAC MP4** plus a compact telemetry note.

## Non-negotiable render lane

Keep source footage in the **direct FFmpeg/run-command lane** from ingest through delivery. Never use HyperFrames, HTML Motion, Remotion, Creative compositions, or browser/frame rendering to crop, caption, carry, or export normal source footage. Those are optional only for graphics added *after* a direct FFmpeg export.

The finished frame is always: uncropped landscape foreground centered over a dark, blurred source-derived 9:16 background, burned-in captions, original trimmed audio, and no default header/title/tag/watermark.

## Preflight and speed contract

1. Activate `workspace_write` and `media_assets`. Create `creative-projects/<session>/<slug>-<duration>s-telemetry/` before downloading. All artifacts, QA frames, logs, and the final MP4 must remain under that directory.
2. Download the X URL with `download_media(url, output_dir)`. Record source path, byte size, and elapsed time. If X extraction fails, recover with the downloader/resolver fallback. Do not change render lanes.
3. Resolve FFmpeg and FFprobe before analysis. On this Windows workspace, use these proven bundled binaries when PATH does not expose them:
   - `C:\Users\rafel\PromSRC\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe`
   - `C:\Users\rafel\PromSRC\node_modules\@ffprobe-installer\win32-x64\ffprobe.exe`
   Invoke paths explicitly. Do not waste time recursively searching broad drive roots.
4. Probe source immediately with FFprobe. Record duration, dimensions, codecs, and frame rate.

**Latency goal:** target a 5–8 minute end-to-end run for typical 20-second source clips. For a long source, do not send the full video through a broad transcription/contact-sheet analysis by default. First use FFprobe plus a fast, sparse visual contact sheet or transcript cache to identify candidate hook windows. Then create a short 25–40s local candidate trim and analyze/transcribe only that trim. Escalate to full-source analysis only when the user explicitly needs a comprehensive search or the fast pass cannot choose a coherent hook.

Read `references/proven-direct-ffmpeg-runbook.md` for canonical commands and `references/performance-and-recovery.md` for confirmed recovery rules and telemetry targets.

## Executable workflow

1. **Ingest and provenance.** `download_media` → inspect exact returned `rel_path` and file size → write artifact root. Never deliver by filename assumption. Before `delivery_send`, use workspace existence/stat evidence to confirm that the exact final path exists.
2. **Fast hook selection.** FFprobe source → create sparse samples/contact sheet with direct FFmpeg or use a known transcript cache → select a coherent `START` and `DURATION` (normally 20s) with an immediately understandable opening line. For long sources, locally trim only the candidate window before STT/analysis. Record the selected time range and reason.
3. **Captions.** Write an `.ass` file whose events start at `00:00` for the selected cut. Use Arial 62, white, black outline, lower-safe `MarginV=175`, phrase-length events, no title/tag events. Do not invent words: caption either a verified transcript or clear audible source phrasing. Preserve any useful native captions inside source footage.
4. **Render.** Write `filter.txt`; use the canonical chain:
   ```text
   [0:v]trim=start=START:duration=DURATION,setpts=PTS-STARTPTS,split=2[bgsrc][fgsrc];
   [bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:10,eq=brightness=-0.18:saturation=0.72[bg];
   [fgsrc]scale=1080:-2:force_original_aspect_ratio=decrease[fg];
   [bg][fg]overlay=(W-w)/2:(H-h)/2,ass='CAPTION_PATH'[v]
   ```
   Use direct FFmpeg with `-map '[v]' -map '0:a:0?' -t DURATION -r 30 -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart`. Capture stderr to a log but determine success from `$LASTEXITCODE`, not from routine FFmpeg stderr.
5. **QA the actual MP4.** FFprobe must report 1080×1920, H.264 video, AAC audio, requested duration. Run a full decode to null. Extract early, middle, and ending frames and visually inspect them: full foreground intact, blurred background visible rather than blank/corrupt, captions readable and clear of mobile UI, no accidental header.
6. **Deliver and report.** Send only the exact proven MP4 path after QA. Report duration, dimensions, codecs, hook range, QA verdict, each core-stage timing, tool/API token cost when available, local compute caveat, and every error/recovery. Close browser sessions if any were opened.

## Recovery rules

- **Downloaded MP4 path is not found:** check `download_media`'s returned `rel_path`; operate only there. Never copy or send a presumed filename.
- **`ffmpeg` or `ffprobe` is not recognized:** use the bundled explicit paths above. This is a binary resolution issue, not a render failure.
- **PowerShell marks normal FFmpeg stderr as an error:** preserve the log, inspect `$LASTEXITCODE`, and only stop if non-zero or expected final artifact is missing.
- **Full analysis is slow:** do not retry full-source analysis. Use sparse samples and trim-first STT. This is the main latency lever for long X videos.
- **Background looks nearly black:** preserve source-derived blur but raise it slightly, e.g. `brightness=-0.10` to `-0.14`, instead of replacing it with a generic solid background.
- **QA detects caption timing, crop loss, black frames, or a wrong hook:** change only candidate range, ASS timings, or the FFmpeg filter; rerender and repeat all QA gates.

## Completion gates

Do not deliver unless full decode, stream/dimension probe, and early/middle/ending visual checks pass. Do not claim an audio/listening verdict without transcript or audible evidence. Record a `TELEMETRY.md` in the artifact root so later runs can compare latency and failures.
