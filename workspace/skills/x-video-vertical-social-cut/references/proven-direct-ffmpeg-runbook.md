# Proven direct-FFmpeg runbook

This is the actual production lane for X/local source-video social cuts. It is based on the verified Heavy Pulp Odyssey no-header export and the earlier Kimi/X runs. **Do not substitute HTML Motion, HyperFrames, Remotion, or Creative frame rendering for these commands.**

## Required inputs

- `SOURCE`: local MP4 resolved from the X URL or supplied local file
- `START`: selected source start time in seconds, for example `0`
- `DURATION`: selected coherent moment, normally `20` to `45` seconds
- `CAPTIONS`: ASS subtitle file written for the selected moment, with timestamps relative to the cut (`00:00` starts at the clip start)
- `OUTPUT`: final `1080x1920` `.mp4`

## 1. Resolve FFmpeg and probe the source on Windows

Run from the workspace root. Prefer the bundled runtime binary, then PATH.

```powershell
$ErrorActionPreference = 'Stop'
$root = Split-Path (Get-Location) -Parent
$bundled = Join-Path $root 'node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe'
$ff = if ($env:PROMETHEUS_FFMPEG_PATH -and (Test-Path $env:PROMETHEUS_FFMPEG_PATH)) {
  $env:PROMETHEUS_FFMPEG_PATH
} elseif (Test-Path $bundled) {
  $bundled
} else {
  (Get-Command ffmpeg -ErrorAction Stop).Source
}
$probe = $ff -replace 'ffmpeg\.exe$', 'ffprobe.exe'
if (!(Test-Path $probe)) { $probe = (Get-Command ffprobe -ErrorAction Stop).Source }
& $probe -v error -show_entries format=duration:stream=codec_name,codec_type,width,height,r_frame_rate -of json "$SOURCE"
```

If the probe fails, stop and fix media resolution. Do not begin an HTML/Creative fallback.

## 2. Inspect and select the edit

1. Generate or reuse the cached transcript.
2. Inspect a contact sheet or sampled frames around candidate beats.
3. Pick one coherent 20–45 second section with a clear opening line. Record `START` and `DURATION`.
4. Write captions as ASS. Keep timestamps relative to the selected clip, use one or two short lines, and do not create a title/header event.

## 3. Caption style: no-header default

Use this real working baseline from the Odyssey test. Adjust only after visual review.

```ass
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Caption,Arial,62,&H00FFFFFF,&H000000FF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,5,2,2,72,72,175,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 1,0:00:00.00,0:00:01.84,Caption,,0,0,0,,FIRST SHORT LINE.
Dialogue: 1,0:00:02.36,0:00:04.36,Caption,,0,0,0,,SECOND SHORT LINE\NOPTIONAL SECOND ROW.
```

Important:
- `Alignment=2` and `MarginV=175` keeps captions in the lower mobile-safe area.
- No `Title`, `Tag`, hook, source-credit, or persistent header style is allowed unless Raul explicitly asks.
- ASS paths in FFmpeg filter files must use forward slashes and escape the drive colon: `C\:/...`.

## 4. Canonical vertical composition filter

Write this to `FILTER.txt`, replacing `START`, `DURATION`, and `CAPTION_PATH` first. This is the exact visual construction proven in the Odyssey run: landscape foreground centered, source-derived blurred/dark background, ASS captions.

```text
[0:v]trim=start=START:duration=DURATION,setpts=PTS-STARTPTS,split=2[bgsrc][fgsrc];
[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:10,eq=brightness=-0.18:saturation=0.72[bg];
[fgsrc]scale=1080:-2:force_original_aspect_ratio=decrease[fg];
[bg][fg]overlay=(W-w)/2:(H-h)/2,ass='CAPTION_PATH'[v];
[0:a]atrim=start=START:duration=DURATION,asetpts=PTS-STARTPTS[a]
```

The first verified Odyssey filter was:

```text
[0:v]trim=duration=30,setpts=PTS-STARTPTS,split=2[bgsrc][fgsrc];
[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:10,eq=brightness=-0.18:saturation=0.72[bg];
[fgsrc]scale=1080:-2:force_original_aspect_ratio=decrease[fg];
[bg][fg]overlay=(W-w)/2:(H-h)/2,ass='C\:/Users/rafel/PromSRC/workspace/creative-projects/mobile_mrv13wv3_nh17ac/assets/heavypulp-opening-captions.ass'[v]
```

## 5. Export command

```powershell
& $ff -hide_banner -y -i "$SOURCE" `
  -filter_complex_script "$FILTER" `
  -map '[v]' -map '[a]' `
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p `
  -c:a aac -b:a 192k -movflags +faststart `
  "$OUTPUT"
```

Notes:
- `libx264`, `veryfast`, and `CRF 20` are the stable compatibility baseline. Only swap to a verified hardware encoder after testing the actual export.
- `+faststart` is required for mobile-ready delivery.
- Do not use `-shortest` as a substitute for correct audio trimming.

## 6. Mandatory QA commands

### Decode and stream contract

```powershell
& $ff -v error -i "$OUTPUT" -f null -
& $probe -v error -show_entries format=duration:stream=codec_name,codec_type,width,height -of json "$OUTPUT"
```

Accept only when full decode exits successfully and the output contains H.264 video, AAC audio, and `1080x1920` dimensions unless a user requested another format.

### Early/middle/end frame samples

```powershell
$qa = Join-Path (Split-Path "$OUTPUT") 'qa'
New-Item -ItemType Directory -Force -Path $qa | Out-Null
& $ff -y -ss 1 -i "$OUTPUT" -frames:v 1 (Join-Path $qa 'early.jpg')
& $ff -y -ss ($DURATION / 2) -i "$OUTPUT" -frames:v 1 (Join-Path $qa 'middle.jpg')
& $ff -y -ss ([Math]::Max(1, $DURATION - 1)) -i "$OUTPUT" -frames:v 1 (Join-Path $qa 'ending.jpg')
```

Visually check the actual exported frames for:
- no persistent header/title/source-credit added by us;
- whole landscape foreground is preserved, not aggressively cropped;
- background is dark/blurred rather than black;
- captions are large, legible, and never clipped;
- no black/corrupt frames;
- final shot/end card gets enough hold time.

## Failure handling

- X post extractor misses video: use the known media resolver/downloader fallback, then continue with the local MP4.
- Cloud STT fails: use cached transcript or local Whisper fallback. Do not switch rendering lanes.
- FFmpeg cannot resolve captions: verify ASS file path, use a filter script file, convert Windows separators to `/`, and escape the drive colon.
- A render is visually wrong: change the source `START`, `DURATION`, ASS timing/style, or FFmpeg filter. Never rebuild source footage in HTML as a workaround.
