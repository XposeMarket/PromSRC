# Public Runtime Release Hardening

Last verified: 2026-05-21
Project root: `D:\Prometheus`

This directory records the public-download runtime dependency work that makes Prometheus installable without asking users to manually install Node, npm, ffmpeg, ffprobe, Chromium, Mermaid/Chart/Fabric browser libraries, or other creative-mode dependencies.

## Core Rule

Public Prometheus builds must use bundled runtime dependencies first. Do not depend on the user's global `PATH`, global `node`, global `npm`, `npx`, system Chrome, system Python, CDN scripts, or manually installed ffmpeg for required product features.

Optional integrations can still depend on user setup:

- Ollama, LM Studio, llama.cpp
- Git and Vercel deploy flows
- Tailscale and remote tunnel setup
- User Chrome/browser profile automation
- Cloud API providers and OAuth services
- Python-only helper lanes until explicitly bundled or ported

## Files To Start With

- `runtime-dependencies.public.json`: manifest of required public runtime packages, binaries, browser assets, native/unpacked packages, optional externals, and managed creative model assets.
- `src/runtime/dependencies.ts`: central runtime resolver for bundled `ffmpeg`, `ffprobe`, Playwright Chromium, and package CLI entries.
- `electron-builder-public.yml`: public package include/exclude rules, `asarUnpack`, and `extraResources`.
- `scripts/prepare-public-build.js`: generates `generated/public-web-ui`, copies local browser vendor assets, and writes local font CSS.
- `scripts/check-public-web-ui-sync.js`: validates generated public UI is in sync and allows expected generated vendor/font files.
- `scripts/verify-public-release.js`: verifies no banned private/dev files leaked and required runtime assets exist in the built release.
- `web-ui/index.html`, `web-ui/src/utils.js`, `web-ui/src/components/creative/exportEngine.js`, `web-ui/src/styles/fonts.css`: public UI browser asset entry points.

## Current Public Artifact Proof

On 2026-05-21, a fresh public unpacked app and installer were built. `npm run verify:public-release` passed against:

- `release-public/win-unpacked/resources/app.asar`
- `release-public/win-unpacked/resources/playwright-browsers`
- `release-public/Prometheus-Setup-1.0.4.exe`

The installer was about 586 MB after bundling Chromium and public runtime assets. This size is expected unless Chromium packaging is split into a downloadable optional component.

## Maintenance Rule

When adding a new creative/video/image/frontend dependency, update all of these together:

1. Add or confirm the dependency in `package.json`.
2. Add it to `runtime-dependencies.public.json` if required for public installs.
3. If it is a browser asset, copy it in `scripts/prepare-public-build.js`.
4. If it is native or executable, add it to `asarUnpack` or `extraResources` in `electron-builder-public.yml`.
5. Add a release verifier assertion in `scripts/verify-public-release.js`.
6. Run `npm run prepare:public-web`, `npm run check:web-ui`, `npm run build:backend`, and `npm run verify:public-release` after building public artifacts.

