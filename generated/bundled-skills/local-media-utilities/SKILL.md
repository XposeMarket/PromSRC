---
name: "local-media-utilities"
description: "Inspect and transform local audio, video, and image files with Prometheus-bundled FFmpeg and FFprobe. Use for metadata inspection, audio extraction, frame capture, trimming, transcoding, resizing, compression, thumbnails, contact sheets, or other safe local media operations."
---

# Local Media Utilities

Use Prometheus’s runtime dependency resolver or the installed npm binary packages; do not assume `ffmpeg` or `ffprobe` is globally available on `PATH`.

## Binary resolution

Within Prometheus source, use `resolveRuntimeBinary('ffmpeg', { allowPathFallback: true })` and the corresponding `ffprobe` call. In a standalone Node diagnostic, use:

```js
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const ffprobe = require('@ffprobe-installer/ffprobe').path;
```

Do not tell the user to install system binaries when the bundled executables resolve successfully.

## Workflow

1. Resolve and verify both binaries.
2. Validate the source path and keep the source read-only.
3. Probe with FFprobe JSON before transforming media.
4. Write to a distinct output path inside the requested workspace or artifact directory.
5. Run FFmpeg without shell-built interpolation when possible; pass an argument array through the process executor.
6. Verify exit code, output existence, nonzero size, and output metadata.
7. Report the actual output path and any codec/container limitations.

## Guardrails

- Never overwrite input media unless the user explicitly requests it.
- Resolve and verify recursive or cleanup targets before removing temporary files.
- Use progress-capable execution and cancellation for long jobs.
- Preserve metadata when requested; strip it only when requested.
- Treat transcription as a separate capability requiring its own model/binary check.
- Prefer native Creative Mode media tools when the operation is part of an active creative project.

The bundled Windows binaries have been verified for source generation, FFprobe JSON, audio extraction, frame capture, trimming, scaling, and H.264/AAC transcoding.
