# Field recovery: Frederick James 20-second X cut (2026-07-22)

This was a direct production test of the workflow on:

`https://x.com/_frederickjames/status/2079879732473028775?s=46`

The status points to a 103.85-second, 960x720 (4:3), H.264/AAC source. The selected edit was the opening 20 seconds: a coherent discipline hook beginning, “I’m honestly not feeling it today.”

## Proven ingestion recovery

The default multi-fragment HLS route can fail on Windows with `unable to open for writing` part-fragment errors for long auto-generated source names. Do not abandon the source or alter the render lane.

Use the direct progressive fallback, selecting a capped 720p representation and no partial fragment files:

```powershell
$yd = (Get-Command yt-dlp -ErrorAction SilentlyContinue).Source
if (!$yd) { $yd = 'C:\Users\rafel\AppData\Roaming\Python\Python314\Scripts\yt-dlp.exe' }
& $yd --no-playlist --no-part --retries 5 --fragment-retries 5 --concurrent-fragments 1 `
  --hls-prefer-native --merge-output-format mp4 -S 'res:720' `
  -o 'workspace/creative-projects/<session>/x-video-test/source.%(ext)s' 'X_STATUS_URL'
```

On this source, it selected direct `http-2176` and downloaded an 8.22 MiB MP4 in 5.76 seconds after media resolution.

## Artifact-root guardrail

Media QA tools resolve workspace-relative artifacts under `workspace/creative-projects/`, not repository-root `creative-projects/`. Create and use an explicit workspace artifact directory from the start:

```powershell
$dir = 'C:\Users\rafel\PromSRC\workspace\creative-projects\<session>\x-video-test'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
```

Do not put outputs under `C:\Users\rafel\PromSRC\creative-projects\...` unless you deliberately copy them to the workspace path before `analyze_image`, `analyze_video`, or delivery.

## Windows FFprobe correction

`@ffmpeg-installer/win32-x64` provides `ffmpeg.exe`; its corresponding probe binary is normally installed separately:

```powershell
$ff = 'C:\Users\rafel\PromSRC\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe'
$probe = 'C:\Users\rafel\PromSRC\node_modules\@ffprobe-installer\win32-x64\ffprobe.exe'
```

Do not derive `ffprobe.exe` from the FFmpeg installer directory unless the file actually exists.

## Dark or rainy 4:3 source recovery

The canonical Odyssey background setting (`brightness=-0.18`) was too dark for this already dim outdoor source. The first render was technically valid but frame QA showed the source-derived blur reading almost black.

For a visually dark source only, raise the blurred background after reviewing actual output frames:

```text
[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:10,eq=brightness=0.04:saturation=0.85[bg];
```

Keep the sharp foreground unchanged:

```text
[fgsrc]scale=1080:-2:force_original_aspect_ratio=decrease[fg];
```

This preserves a 4:3 source intact in the central frame and restores visible green/gray detail in the upper/lower blurred fill. It is a source-specific visual recovery, **not a new default replacing the darker Odyssey baseline**.

## Caption and STT guardrail

For this source, local Whisper Tiny produced the usable opening transcript but confused “discipline and consistency beat skill and talent...” in its raw output. Verify any uncertain phrase directly before burning it into captions. The intended opening caption is:

```text
BECAUSE DISCIPLINE AND CONSISTENCY
BEAT SKILL AND TALENT
EVERY SINGLE DAY OF THE WEEK.
```

For speed, make a local 20–25 second proxy before analysis/transcription when only a short opening cut is needed. Some analysis tools sample an entire long source even when an opening-only inspection is requested.

## FFmpeg + PowerShell stderr guardrail

FFmpeg routinely writes normal progress/metadata to stderr. In PowerShell, do **not** combine `$ErrorActionPreference='Stop'` with a pipeline that turns native stderr into a terminating `NativeCommandError`. Capture it safely, then check `$LASTEXITCODE`:

```powershell
$ErrorActionPreference = 'Continue'
& $ff -hide_banner -y -i "$source" `
  -filter_complex_script "$filter" `
  -map '[v]' -map '[a]' `
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 30 `
  -c:a aac -b:a 192k -movflags +faststart "$output" 2>&1 |
  Out-File -FilePath "$dir\render.log" -Encoding utf8
$exit = $LASTEXITCODE
if ($exit -ne 0) { throw "FFmpeg render failed with exit code $exit" }
```

## Required visual decision

A successful FFmpeg exit, H.264/AAC probe, and full decode are insufficient. For dark, rainy, night, or already-letterboxed source footage, inspect early/middle/late frames before delivery. If the background reads mostly solid black, adjust only the direct FFmpeg background `eq` values, rerender, decode-check, and inspect again.

## Output proven in this test

- `1080x1920`, 30 fps H.264/AAC MP4
- actual duration: `20.033333` seconds
- no added header/title strip
- large outlined captions in lower mobile-safe area
- full 4:3 foreground preserved
- source-derived blurred background visibly retained after brightness recovery
- direct FFmpeg from source to export, with no HTML/HyperFrames/Creative render path
- full decode and three actual-export visual-QA frames passed
