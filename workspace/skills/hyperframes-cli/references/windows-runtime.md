# HyperFrames on the Prometheus Windows runtime

## Prometheus source tree

Run `node <PROMETHEUS_ROOT>/scripts/run-hyperframes.js <command> [...args]`. The wrapper exposes the repository's bundled FFmpeg and FFprobe through `PATH`, `FFMPEG_PATH`, and `FFPROBE_PATH`. Diagnose render health through this wrapper before treating ambient command discovery as a blocker.

Useful checks:

- wrapper `doctor --json` for Chrome, FFmpeg, and FFprobe details;
- wrapper `info` for CLI/runtime versions;
- a disposable one-second render plus final-file probe for actual proof.

An overall doctor failure may reflect an available upgrade or an optional component such as Docker even when local MP4 rendering works. Evaluate the individual checks and the render.

## Standalone projects

Outside Prometheus, use `npx hyperframes`. A standalone project must provide its own discoverable FFmpeg/FFprobe or supported CLI installation. Missing `node_modules/@hyperframes` alone is not proof the CLI is unavailable; first determine whether the project uses `npx`, a local dependency, or a bundled runtime.

## Windows caveats

- HyperFrames versions may require or recommend a newer Node release. Treat an engine warning as a warning until a real command fails; report the installed and required versions when it does.
- Use PowerShell-native command/result handling rather than assuming POSIX chaining.
- Inspect duplicate-media warnings: intentional reuse of a static mark can be acceptable after visual QA, while stacked duplicate video/media nodes must be fixed.
- Preserve authored source if a first-class Creative route errors or exports blank video; retry through the verified wrapper and never claim success from the failed path.
- Keep installs and system changes approval-bound. Prefer the existing Prometheus wrapper over a system-wide FFmpeg installation.
