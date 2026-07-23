# Field recovery: Frederick James 20-second X cut (2026-07-22)

This was a direct production test of the workflow on:

`https://x.com/_frederickjames/status/2079879732473028775?s=46`

The status is an 18-second X post pointing to a 103.85-second, 960x720 (4:3), H.264/AAC source. The selected edit was the opening 20 seconds: a coherent discipline hook beginning, “I’m honestly not feeling it today.”

## Proven ingestion recovery

The default multi-fragment HLS route can fail on Windows with `unable to open for writing` part-fragment errors for long auto-generated source names. Do not abandon the source or alter the render lane.

Use the direct progressive fallback, selecting a capped 720p representation and no partial fragment files:

```powershell
$yd = (Get-Command yt-dlp -ErrorAction SilentlyContinue).Source
if (!$yd) { $yd = 'C:\Users\rafel\AppData\Roaming\Python\Python314\Scripts\yt-dlp.exe' }
& $yd --no-playlist --no-part --retries 5 --fragment-retries 5 --concurrent-fragments 1 `
  --hls-prefer-native --merge-output-format mp4 -S 'res:720' `
  -o 'tmp/xclip/source.mp4' 'X_STATUS_URL'
```

On this source, it selected direct `http-2176` and downloaded an 8.22 MiB MP4 in roughly a second after media resolution.

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

## Required visual decision

A successful FFmpeg exit, H.264/AAC probe, and full decode are insufficient. For dark, rainy, night, or already-letterboxed source footage, inspect early/middle/late frames before delivery. If the background reads mostly solid black, adjust only the direct FFmpeg background `eq` values, rerender, decode-check, and inspect again.

## Output proven in this test

- `1080x1920`, 30 fps H.264/AAC MP4
- actual duration: `20.033333` seconds
- no added header/title strip
- large outlined captions in lower mobile-safe area
- full 4:3 foreground preserved
- direct FFmpeg from source to export, with no HTML/HyperFrames/Creative render path
