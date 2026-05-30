# Windows HyperFrames install/environment troubleshooting (2026-05-24)

Evidence from Raul's HyperFrames install/export attempt on 2026-05-24 showed two practical Windows blockers:

- `node -v && npm -v && where ffmpeg && ffmpeg -version` returned Node `v20.20.2` and npm `10.8.2`, but `where ffmpeg` failed (`INFO: Could not find files for the given pattern(s).`). The upstream CLI skill says HyperFrames requires Node >= 22 and FFmpeg.
- A quick check for `node_modules/@hyperframes` failed with `ERROR: "node_modules/@hyperframes" not found`, which is not by itself proof that HyperFrames cannot run if the workflow uses `npx hyperframes` or Prometheus-bundled Creative/HyperFrames tooling.

Next time HyperFrames install/render/export is requested on Windows:

1. Run environment checks explicitly: Node version, npm version, FFmpeg availability, and `npx hyperframes doctor`/`info` when the CLI is reachable.
2. Treat missing FFmpeg and Node < 22 as environment blockers for CLI render until fixed or a bundled runtime path is available.
3. Do not rely on `node_modules/@hyperframes` as the only install check; first determine whether this workspace expects `npx hyperframes`, a local package, or Prometheus-bundled Creative/HyperFrames tooling.
4. If installing dependencies is required, keep it approval-gated and report the exact package manager path (`winget`, `choco`, npm, or bundled runtime) plus any command failures.
5. If Creative/HyperFrames preview/export also errors with `ReferenceError: __name is not defined` or editor timeouts, preserve the authored source and escalate as a Creative runtime/export bug rather than claiming export success.
