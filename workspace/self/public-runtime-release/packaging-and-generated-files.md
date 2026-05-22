# Public Packaging And Generated Files

## Public Build Command

```powershell
npm run build:public
```

This runs:

1. `npm run build:backend`
2. `node scripts/copy-extension-descriptors.js`
3. `npm run prepare:public-web`
4. `npm run check:web-ui`
5. `npm run patch:electron-native`
6. `electron-builder --win --config electron-builder-public.yml`
7. `npm run verify:public-release`

In Codex tool runs, the full command may exceed tool timeout because NSIS/7zip compression is slow after bundling Chromium. If the shell times out but `electron-builder` or `7za` is still running, wait for those processes instead of immediately assuming failure.

## Public Build Outputs

Main outputs:

- `release-public/win-unpacked/`
- `release-public/win-unpacked/resources/app.asar`
- `release-public/win-unpacked/resources/app.asar.unpacked/`
- `release-public/win-unpacked/resources/playwright-browsers/`
- `release-public/Prometheus-Setup-<version>.exe`
- `release-public/Prometheus-Setup-<version>.exe.blockmap`
- `release-public/latest.yml`

Large expected payload:

- `resources/playwright-browsers/` contains Chromium/headless shell and related Playwright browser assets.

## Included In Public App

Configured in `electron-builder-public.yml`:

- `electron/**/*`
- `dist/**/*`
- `generated/public-web-ui/**/*`
- `assets/**/*`
- `node_modules/**/*`
- `runtime-dependencies.public.json`
- `package.json`
- `generated/bundled-skills` as `extraResources/bundled-skills`
- `node_modules/playwright-core/.local-browsers` as `extraResources/playwright-browsers`

## Excluded From Public App

Important exclusions in `electron-builder-public.yml`:

- source: `src/**/*`, `web-ui/**/*`, `scripts/**/*`, `bin/**/*`
- private workspace/user data: `workspace/**/*`, `.prometheus/**/*`, `teams/**/*`
- local/dev dirs: `.claude/**/*`, `.cursor/**/*`, `.vscode/**/*`, `.pip-cache/**/*`, `.pip-tmp/**/*`, `.tmp-py/**/*`
- release/temp/output: `release/**/*`, `release-public/**/*`, `output/**/*`, `tmp/**/*`
- logs, docs, videos, zips, local images
- dev/build packages: Electron builder internals, ESLint, TSX, type packages
- `node_modules/.bin/**/*`
- Playwright local browsers under node_modules, because they are copied to `extraResources/playwright-browsers`
- `node_modules/gif.js/site/**/*` to avoid packaging demo/test media

Important: `node_modules/typescript/**/*` must not be excluded while runtime code imports `typescript`.

## Native And Unpacked Packages

Configured in `asarUnpack`:

- `node_modules/better-sqlite3/**/*`
- `node_modules/node-pty/**/*`
- `node_modules/onnxruntime-node/**/*`
- `node_modules/@ffmpeg-installer/**/*`
- `node_modules/@ffprobe-installer/**/*`

Reason: native `.node` modules and executable binaries must live on the real filesystem, not inside `app.asar`.

## Generated Public UI

Generated from:

`web-ui/`

Generated to:

`generated/public-web-ui/`

Command:

```powershell
npm run prepare:public-web
```

Check:

```powershell
npm run check:web-ui
```

Generated vendor files are expected and whitelisted in:

`scripts/check-public-web-ui-sync.js`

If new vendor assets are added, update both:

- `scripts/prepare-public-build.js`
- `scripts/check-public-web-ui-sync.js`

## Release Verifier

Command:

```powershell
npm run verify:public-release
```

Checks:

- banned private/source/dev files did not leak
- required npm package `package.json` files exist in `app.asar`
- required public browser assets exist in `generated/public-web-ui`
- `runtime-dependencies.public.json` is packaged
- ffmpeg/ffprobe unpacked executables exist and pass `-version`
- Playwright Chromium exists in `resources/playwright-browsers`
- native/unpacked packages exist

