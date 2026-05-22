# Public Runtime Verification Checklist

Use this checklist before publishing a public Prometheus release.

## Prebuild

- `runtime-dependencies.public.json` reflects all required runtime packages, binaries, browser assets, and native/unpacked packages.
- `node_modules/playwright-core/.local-browsers` exists.
- `web-ui/vendor/fabric/fabric.min.js` exists.
- No required public UI feature points at a CDN.
- `electron-builder-public.yml` includes `runtime-dependencies.public.json`.
- `electron-builder-public.yml` excludes dev/private/source/workspace directories.
- `electron-builder-public.yml` unpacks native/executable dependencies.
- `electron-builder-public.yml` copies Playwright browsers to `extraResources/playwright-browsers`.

## Commands

Run:

```powershell
npm run prepare:public-web
npm run check:web-ui
npm run build:backend
npm run build:public
```

If `npm run build:public` times out while Electron Builder or 7za is active, wait for those processes and then run:

```powershell
npm run verify:public-release
```

## Expected Verifier Result

```text
[verify-public-release] OK: scanned <N> app.asar entries and <N> resource entries
```

## Runtime Smoke Checks

After building, check:

```powershell
node -e "const d=require('./dist/runtime/dependencies.js'); Promise.all([d.canRunRuntimeBinary('ffmpeg'), d.canRunRuntimeBinary('ffprobe')]).then(r=>console.log(r, d.resolveBundledPlaywrightChromium()))"
```

Expected:

- ffmpeg check is `true`
- ffprobe check is `true`
- Chromium path is non-empty

## Clean-Machine Smoke Test

On a Windows VM with no global Node/npm/Python/ffmpeg/Chrome assumptions:

- install Prometheus from `release-public/Prometheus-Setup-<version>.exe`
- launch app
- verify main UI loads without network
- render Mermaid block
- render Chart.js block
- open CodeMirror editor areas
- create/export a short HTML Motion clip
- import a video/audio file and probe metadata
- create a GIF/export path that uses `gif.worker.js`
- use Creative image layer extraction if model assets are present
- verify Runtime Health/doctor once implemented

## Follow-Up Improvement

Add an in-app Runtime Health page that runs the same checks as `verify-public-release` from inside the installed app:

- required package imports
- ffmpeg/ffprobe execution
- Playwright Chromium launch
- local vendor asset existence
- Mermaid tiny render
- Chart tiny render
- model asset availability
- HyperFrames package/API import

