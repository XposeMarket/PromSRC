# Performance and Recovery Reference

This resource records field-proven behavior from the Frederick James and Starter Story direct-FFmpeg telemetry runs. Use it with `SKILL.md`, not as a separate workflow.

## Stable Windows media binaries

When `ffmpeg` / `ffprobe` are unavailable on PATH, use:

```powershell
$ffmpeg = 'C:\Users\rafel\PromSRC\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe'
$ffprobe = 'C:\Users\rafel\PromSRC\node_modules\@ffprobe-installer\win32-x64\ffprobe.exe'
```

Do this before any probing or rendering. Avoid a recursive drive-wide binary search: it cost two minutes and did not help the Starter Story run.

## Fast long-video hook procedure

For sources longer than roughly two minutes:

1. FFprobe first.
2. Use a sparse visual scan or existing transcript cache to identify 1–3 candidate ranges.
3. FFmpeg-trim each candidate to 25–40 seconds without re-encoding if possible.
4. Run STT/vision only on the best local candidate trim.
5. Select a 20-second coherent range; captions start at 00:00 for that range.

Do **not** use a broad full-video `analyze_video(... both, 16 quick + 30 detail samples, transcription)` as the default for a 13-minute source. On Starter Story it took **398.0 seconds (6m38s)** before editing, consuming the entire target budget. Treat that as a diagnostic escalation only.

## Render command template

Write `filter.txt` and use the direct command below. `START`, `DURATION`, source, caption, filter, and output paths must be replaced with actual values.

```powershell
& $ffmpeg -hide_banner -y -i "$src" `
  -filter_complex_script "$filter" -map '[v]' -map '0:a:0?' `
  -t $duration -r 30 -c:v libx264 -preset medium -crf 19 `
  -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "$out" 2>&1 |
  Tee-Object -FilePath "$renderLog"
$exit = $LASTEXITCODE
if ($exit -ne 0 -or -not (Test-Path -LiteralPath $out)) { throw "Render failed: exit=$exit" }
```

FFmpeg emits routine progress and codec detail on stderr. PowerShell may label that text as a native-command error even when the final exit is `0`. The exit code plus artifact existence, not the presence of stderr, determines success.

## Field telemetry

| Stage | Frederick 20s source | Starter Story 13m04s source | Meaning |
|---|---:|---:|---|
| X download | 5.76s | 40.45s, 228.5 MB | Expected to scale with source size/network |
| Broad analysis + STT | 73.69s | 398.02s | Main avoidable long-video cost. Use trim-first STT. |
| Direct 20s render | 50.48s | 55.57s | Stable local encode cost at 1080×1920 medium/CRF19 |
| Technical QA | 3.01s | 4.94s | Probe, full decode, three frames |

Target for a typical source is 5–8 minutes, including download and export. A 13-minute / 228MB source can meet this only if long-source selection avoids full-source STT/analysis.

## Visual QA checklist

Extract and inspect 1s, midpoint, and final-second frames from the final MP4. Accept only when:

- output is 1080×1920 H.264/AAC and requested duration;
- full landscape source stays centered, not aggressively cropped;
- blur fill is visible and intentional, not a black/corrupt frame;
- captions are readable, phrase-length, and not clipped;
- no added top header/title/source credit exists;
- exact export path exists before delivery.

## Proven issue log

- **Artifact root misalignment:** harden all work under `creative-projects/<session>/<slug>/` and use tool-returned relative paths.
- **PATH has no FFmpeg:** invoke bundled binaries explicitly.
- **Routine FFmpeg stderr misread:** gate success on `LASTEXITCODE` and final artifact.
- **Background too dark:** raise blur brightness from `-0.18` toward `-0.10` to `-0.14` if frames read as almost black.
- **Full-source transcription is too slow:** sparse candidate scan then local trim-first STT. Do not repeat full analysis.
