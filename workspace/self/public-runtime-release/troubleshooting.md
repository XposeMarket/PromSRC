# Public Runtime Troubleshooting Notes

These are the exact problems encountered during the 2026-05-21 public runtime hardening pass and how to fix them if they recur.

## Problem: Fabric npm Package Pulls Native Canvas

Symptom during `electron-builder`:

```text
preparing moduleName=canvas arch=x64
fatal error C1083: Cannot open include file: 'cairo.h': No such file or directory
node-gyp failed to rebuild 'D:\Prometheus\node_modules\canvas'
```

Cause:

The npm `fabric` package pulls in native `canvas`. Prometheus only needs the browser-side Fabric bundle for the public UI, not Node canvas.

Fix:

1. Remove `fabric` from npm production dependencies.
2. Keep a browser-only vendor file at `web-ui/vendor/fabric/fabric.min.js`.
3. Copy it through `scripts/prepare-public-build.js` into `generated/public-web-ui/vendor/fabric/fabric.min.js`.
4. Do not list `fabric` in `runtime-dependencies.public.json`.

## Problem: Playwright Browser Packaging Looks Hung

Symptom:

`npm run build:public` times out, `electron-builder` remains running for a long time, and `app.asar` may be 0 bytes if the builder is still copying files.

Cause:

Bundled Chromium is very large. If it is pushed through ASAR or unpacked under `node_modules`, packaging can become extremely slow and the tool timeout can fire before Electron Builder finishes.

Fix:

1. Install browser locally:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='0'; npx playwright install chromium
```

2. Exclude local browser cache from ASAR packaging:

```yaml
- "!node_modules/playwright-core/.local-browsers/**/*"
- "!node_modules/playwright/.local-browsers/**/*"
```

3. Copy it as an explicit resource:

```yaml
extraResources:
  - from: "node_modules/playwright-core/.local-browsers"
    to: "playwright-browsers"
```

4. Resolver should check `process.resourcesPath/playwright-browsers`.

Operational note:

If `7za` is running and consuming CPU, the build is compressing the NSIS payload. Wait for it. The installer may be around 586 MB with bundled Chromium.

## Problem: Public Build Times Out But Actually Continues

Symptom:

Codex shell command exits with code `124` after a timeout, but `node electron-builder` or `7za` is still running.

Fix:

Check processes:

```powershell
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like '*electron-builder*' -or
  $_.CommandLine -like '*build:public*' -or
  $_.CommandLine -like '*7za*'
} | Select-Object ProcessId,Name,CommandLine
```

If active, wait:

```powershell
Wait-Process -Id <pid> -Timeout 900
```

After it finishes, manually run:

```powershell
npm run verify:public-release
```

## Problem: TypeScript Runtime Mismatch

Symptom:

Public packaging excludes TypeScript, but runtime code imports it:

```text
Cannot find module 'typescript'
```

or build/source-outline features fail.

Cause:

`src/gateway/agents-runtime/subagent-executor.ts` imports `typescript` at runtime.

Fix:

- Keep `typescript` in production dependencies.
- Do not exclude `node_modules/typescript/**/*` in `electron-builder-public.yml`.
- Keep `typescript` listed in `runtime-dependencies.public.json`.

If TypeScript version changes surface strict-mode errors, pin a known-good version and fix only the narrow type errors that block `npm run build:backend`.

## Problem: CDN Assets Break Offline

Symptom:

Public app works online but Mermaid, Chart.js, CodeMirror, Fabric, gif export, Lottie, icons, or fonts fail offline.

Cause:

The public UI was loading browser libraries from `cdnjs`, `jsdelivr`, `unpkg`, Google Fonts, or Iconify CDN.

Fix:

1. Replace CDN references in `web-ui/index.html`, `web-ui/src/utils.js`, and creative export code with local `/vendor/...` paths.
2. Copy sources in `scripts/prepare-public-build.js`.
3. Add generated vendor files to `scripts/check-public-web-ui-sync.js`.
4. Add required public assets to `runtime-dependencies.public.json`.
5. Run:

```powershell
npm run prepare:public-web
npm run check:web-ui
```

## Problem: Release Verifier Flags Legit Dependency Paths

Symptom:

`verify-public-release` reports paths such as:

```text
node_modules/chromium-bidi/.../context
node_modules/framer-motion/.../context
node_modules/electron-updater/node_modules/builder-util-runtime
```

Cause:

Banned regex rules were too broad and matched nested dependency folders or legitimate transitive runtime dependencies.

Fix:

Keep banned rules anchored to top-level leaks where appropriate. For example:

- Use `^node_modules/...` for top-level dev packages.
- Do not use broad `(?:^|/)context` style patterns that match dependency internals.
- Allow `electron-updater/node_modules/builder-util-runtime`; it is part of the runtime updater stack.

## Problem: gif.js Demo Media Leaks Into Public Build

Symptom:

Verifier reports:

```text
app.asar:node_modules/gif.js/site/contents/tests/clip.mp4
```

Cause:

The `gif.js` package includes demo/test site media.

Fix:

Exclude it:

```yaml
- "!node_modules/gif.js/site/**/*"
```

Then rebuild public artifacts and rerun verifier.

## Problem: ffmpeg/ffprobe Works In Dev But Not Installed App

Symptom:

Creative export, audio analysis, thumbnails, or media probing fail on clean machines.

Cause:

Code used plain `ffmpeg` or `ffprobe`, relying on user `PATH`.

Fix:

Use:

```ts
resolveRuntimeBinary('ffmpeg', { allowPathFallback: true })
resolveRuntimeBinary('ffprobe', { allowPathFallback: true })
```

Required files:

- `src/runtime/dependencies.ts`
- `@ffmpeg-installer/ffmpeg`
- `@ffprobe-installer/ffprobe`
- `asarUnpack` entries in `electron-builder-public.yml`
- verifier checks in `scripts/verify-public-release.js`

## Problem: ONNX Model Features Are Not Fully Offline

Symptom:

Layer extraction/background removal asks for model downloads or fails on a clean offline install.

Cause:

`src/gateway/creative/onnx/model-paths.ts` supports model paths and URL hints, but actual model files may not be bundled.

Fix if offline support is required:

1. Place model files under a source-controlled or release-prepared directory.
2. Add them to `extraResources` as `creative-models`.
3. Keep resolver checking `process.resourcesPath/creative-models`.
4. Add required model file checks to `scripts/verify-public-release.js`.

