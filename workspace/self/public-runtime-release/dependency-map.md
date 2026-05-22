# Public Runtime Dependency Map

## Required Manifest

The canonical manifest is `runtime-dependencies.public.json`.

It includes:

- required npm packages
- required binaries
- required public browser assets
- native/unpacked packages
- optional external integrations
- managed creative model assets

The manifest is packaged into the public app through `electron-builder-public.yml` so future diagnostics can inspect the expected public runtime contract.

## Required Binaries

### ffmpeg

Source package: `@ffmpeg-installer/ffmpeg`

Resolver: `resolveRuntimeBinary('ffmpeg')` in `src/runtime/dependencies.ts`

Used by:

- creative video export/transcoding in `src/gateway/routes/canvas.router.ts`
- creative asset thumbnails in `src/gateway/creative/assets.ts`
- creative audio extraction in `src/gateway/agents-runtime/subagent-executor.ts`

Public packaging:

- `node_modules/@ffmpeg-installer/**/*` is in `asarUnpack`.
- Release verifier finds the executable in `resources/app.asar.unpacked/node_modules/@ffmpeg-installer` and runs `ffmpeg -version`.

### ffprobe

Source package: `@ffprobe-installer/ffprobe`

Resolver: `resolveRuntimeBinary('ffprobe')` in `src/runtime/dependencies.ts`

Used by:

- creative audio analysis in `src/gateway/creative/audio.ts`
- creative media asset probing in `src/gateway/creative/assets.ts`

Public packaging:

- `node_modules/@ffprobe-installer/**/*` is in `asarUnpack`.
- Release verifier finds the executable in `resources/app.asar.unpacked/node_modules/@ffprobe-installer` and runs `ffprobe -version`.

### Playwright Chromium

Install/update command:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='0'; npx playwright install chromium
```

Local source path:

`node_modules/playwright-core/.local-browsers`

Public package destination:

`resources/playwright-browsers`

Important: do not force Chromium through `app.asar` or `app.asar.unpacked/node_modules/playwright-core/.local-browsers`; packaging becomes extremely slow and may appear hung.

Resolver: `resolveBundledPlaywrightChromium()` in `src/runtime/dependencies.ts`

Used by:

- `src/gateway/creative/playwright-runtime.ts`
- `src/gateway/routes/canvas.router.ts`
- creative renderers and QA paths that launch Chromium

## Browser-Side Public UI Assets

Public UI must not require CDN scripts for required app surfaces.

Generated destination:

`generated/public-web-ui/vendor/`

Current local vendor assets:

- CodeMirror: `vendor/codemirror/...`
- marked: `vendor/marked/marked.min.js`
- Fabric browser build: `vendor/fabric/fabric.min.js`
- gif.js and worker: `vendor/gif/gif.js`, `vendor/gif/gif.worker.js`
- Iconify runtime: `vendor/iconify/iconify.min.js`
- Lottie player: `vendor/lottie-player/lottie-player.js`
- Chart.js: `vendor/chart/chart.umd.js`
- Mermaid: `vendor/mermaid/mermaid.min.js`

Fonts:

- `@fontsource/manrope`
- `@fontsource/ibm-plex-mono`
- generated into `generated/public-web-ui/static/fonts/`
- CSS generated into `generated/public-web-ui/static/styles/fonts.css`

## Fabric Special Case

Do not add `fabric` as a production npm dependency unless native `canvas` packaging is intentionally solved.

Fabric is currently vendored as a browser-only file:

`web-ui/vendor/fabric/fabric.min.js`

`scripts/prepare-public-build.js` copies that file into:

`generated/public-web-ui/vendor/fabric/fabric.min.js`

Why: the npm `fabric` package pulls in native `canvas`, and Electron rebuild fails on Windows without GTK/Cairo headers.

## Runtime TypeScript

`src/gateway/agents-runtime/subagent-executor.ts` imports `typescript` at runtime. Therefore public builds must include `node_modules/typescript`.

Do not exclude `node_modules/typescript/**/*` from `electron-builder-public.yml` unless those runtime imports are removed or replaced.

## Creative Model Assets

Model resolver:

`src/gateway/creative/onnx/model-paths.ts`

The resolver now checks packaged resources before config-dir models:

`resources/creative-models/<model>.onnx`

Current managed model names:

- `mobile_sam_encoder.onnx`
- `mobile_sam_decoder.onnx`
- `lama.onnx`
- `rmbg.onnx`

As of this pass, the model files are recognized as managed assets but are not all bundled by default. If layer extraction/background removal must work fully offline, add the model files to `extraResources` and update `scripts/verify-public-release.js` to require them.

