# Windows HyperFrames install/environment troubleshooting (2026-05-24)

Evidence from Raul's HyperFrames install/export attempts on 2026-05-24 showed practical Windows/runtime blockers:

- `node -v`, `npm -v`, FFmpeg discovery, and `npx hyperframes doctor/info` are the meaningful environment checks.
- Raul's machine was observed on Node `v20.20.2` and npm `10.8.2`. HyperFrames prefers Node >=22, so warnings are expected, but render may still complete.
- `where ffmpeg` failed (`INFO: Could not find files for the given pattern(s).`), and HyperFrames render reported FFmpeg missing. Installing/copying a discoverable `ffmpeg.exe` via bundled/installed FFmpeg or `ffmpeg-static` let render complete.
- A quick check for `node_modules/@hyperframes` failed with `ERROR: "node_modules/@hyperframes" not found`, which is not by itself proof that HyperFrames cannot run if the workflow uses `npx hyperframes` or Prometheus-bundled Creative/HyperFrames tooling.
- PowerShell command chaining with `&&` failed in the current Prometheus shell mode; use separate commands or PowerShell-native `$LASTEXITCODE` chaining.

Next time HyperFrames install/render/export is requested on Windows:

1. Run environment checks explicitly: Node version, npm version, FFmpeg availability, and `npx hyperframes doctor`/`info` when the CLI is reachable.
2. Treat missing FFmpeg as a render blocker until fixed or a bundled runtime path is available. Use bundled/installed FFmpeg or `ffmpeg-static`; ensure `ffmpeg.exe` is discoverable from the project or PATH before rerendering.
3. Treat Node < 22 as a warning first if render can still proceed; upgrade or switch runtime only if the CLI actually fails in a way tied to Node version.
4. Do not rely on `node_modules/@hyperframes` as the only install check; first determine whether this workspace expects `npx hyperframes`, a local package, or Prometheus-bundled Creative/HyperFrames tooling.
5. If installing dependencies is required, keep it approval-gated and report the exact package manager path (`winget`, `choco`, npm, bundled runtime, or `ffmpeg-static`) plus any command failures.
6. If Creative/HyperFrames preview/export also errors with `ReferenceError: __name is not defined`, editor timeouts, or black/empty exported MP4s, preserve the authored source and continue through the real CLI project path rather than claiming export success.
7. If `duplicate_media_discovery_risk` appears, inspect why. Accept it only when repeated media is intentional static logo/image reuse and render plus inspect pass; fix stacked duplicate media/video nodes.
