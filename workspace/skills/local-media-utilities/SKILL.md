# Local Media Utilities

Use this skill when Prometheus needs local audio/video/image utility work through tools like ffmpeg, ffprobe, transcription binaries, waveform extraction, frame capture, or compression.

## Prometheus Fit

Media utilities are CLI-heavy, so route them through `cli-adapter-framework`. The user should see installed/missing status, output artifact paths, and progress instead of raw command text.

## Tool Scope

Start with:

- `media_status`
- `media_probe`
- `media_extract_audio`
- `media_extract_frames`
- `media_transcode`
- `media_compress`
- `media_trim`
- `media_transcribe`
- `media_make_contact_sheet`

## Rules

- Never assume ffmpeg or transcription binaries are installed. Check first.
- Keep source media read-only; write outputs to an artifact directory.
- Validate input paths and output extensions before running a command.
- Use progress-capable execution for long media jobs.
- Prefer `ffprobe` JSON output for inspection.
- Do not overwrite outputs unless the user confirms.
- Preserve metadata where requested; strip metadata only when requested.

## Implementation Route

1. Build a typed CLI adapter with status/setup/run.
2. Add `ffprobe` support before transformation tools.
3. Add output naming that avoids collisions.
4. Add cancellation support through Prometheus jobs/process control.
5. Add smoke tests using a tiny fixture media file.

## Acceptance Check

Prometheus can inspect and transform local media while every generated output is visible as a workspace artifact.
