# 24 — Release, packaging, and update

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `package.json`, `electron/`, `electron-builder*.yml`, `scripts/`, `release/`, `release-public/`
> **Read this when:** Building a developer or public desktop distribution, changing Electron packaging, bumping version, or modifying updater/release verification.

## TL;DR
- Package name/version/main entry on main: `prometheus` / `1.0.17` / `electron/main.js`.
- `release/` and `release-public/` are separate build outputs/configurations; do not treat a dev/test build as the public distributable.
- `npm run build:win`/`build:mac` use the internal Electron Builder config. `build:public` prepares public assets, helper, builder output, then verifies it.
- `release` runs the public Windows build then Electron Builder's publish operation; publishing is externally visible and requires the release owner/process.
- Public desktop prep includes backend compilation, extension descriptors, public web UI preparation/sync, Electron native patching and helper build.
- `npm run sync:web-ui` syncs/checks UI sources but does not itself package a desktop application.
- **The auto-update path is live:** `src/update/canonical-updater.ts` (compiled to `dist/update/canonical-updater.js`) holds a file-based update request/status/lock protocol that `electron/main.js` loads and drives with `electron-updater`'s `autoUpdater`. Requests come from the `self_update` tool (`src/tools/self-update.ts`), the Telegram channel, and the CLI. `server-v2.ts` runs `evaluateUpdatePreflight()`.
- The read-only source checkout had unrelated dirty generated public-web files. Never clean/build over those without an explicitly owned clean tree.
- Use `verify:public-release` and platform-specific verifiers after packaging; check metadata/artifacts rather than only trusting builder exit code.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Version and app main | `package.json` → `version`, `main` | At verified revision: 1.0.17 and `electron/main.js`. |
| Electron main process | `electron/main.js` | Window/runtime boot and main lifecycle. |
| Desktop runtime/security | `electron/preload.js`, `electron/security.js`, `electron/gateway-process.js` | Preload, bridge, gateway child and security boundary. |
| Internal build scripts | `package.json` → `build:win`, `build:mac` | `electron-builder.yml`; backend/native/helper steps. |
| Public preparation | `package.json` → `prepare:public:desktop` | Public web/runtime and native/helper setup. |
| Public build | `package.json` → `build:public`, platform variants | `electron-builder-public.yml`, verifier. |
| Publish | `package.json` → `release` | `--publish=always`; public side effect. |
| Public web production | `scripts/prepare-public-build.js`, `scripts/build-web-ui-production.mjs` | Generated output under public-web tree. |
| UI sync/check | `npm run sync:web-ui`, `check:web-ui` | See [17 Desktop web UI](17-desktop-web-ui.md). |
| Build configurations | `electron-builder.yml`, `electron-builder-public.yml` | Packaging policy/artifacts differ. |
| Release folders | `release/`, `release-public/` | Local builder vs public distributable output. |
| Windows verification | `scripts/verify-public-release.js` | Run through `npm run verify:public-release`. |
| macOS verification | `scripts/verify-macos-release.js` | Run platform-specific public verifier. |
| Update dependency | `electron-updater` in `package.json` | Dependency alone is not proof of initialized runtime updater. |
| Updater runtime | `src/update/canonical-updater.ts` → `requestCanonicalUpdate()`, `consumeCanonicalUpdateRequest()`, `acquireUpdateLock()`, `evaluateUpdatePreflight()`, `validateReleaseInfo()`, `verifyFileSha512()`, `isPackagedPublicUpdaterEnvironment()` | Consumed by `electron/main.js` (loads `dist/update/canonical-updater.js`, wraps `autoUpdater`). Producers: `src/tools/self-update.ts` (`self_update` tool), `src/gateway/comms/telegram-channel.ts`, `src/cli/index.ts`, and the settings router. |
| CI/release docs | `.github/workflows/`, platform README/docs | Check current workflow before running expensive platform packaging. |

## How it works

### Developer/internal package
The internal Windows path is declared by `build:win`: backend build, Electron native patch, Windows desktop helper, then `electron-builder --win --config electron-builder.yml`. The Mac path performs equivalent backend/native/helper prep and uses the internal macOS config. These operations are builds, not “publish to customers.” The output in `release/` includes packaged/unpacked Electron assets and local installer artifacts; filenames and versions in a checked-in/output folder may be from older builds.

`npm run build` compiles backend and checks web UI; it does not mean “produce a Windows installer.” `build:web-production` generates hashed production web chunks, while `sync:web-ui` prepares the public UI mirror and verifies source parity. Select the explicit package script for the desired artifact.

### Public distribution build
The public path starts with `prepare:public:desktop`: backend compile, extension descriptors, public web preparation, web sync validation and Electron native patching. `build:public` then builds the Windows helper, runs Electron Builder with `electron-builder-public.yml`, and verifies the resulting release. Mac variants perform the corresponding platform helper/build/verifier path. Public outputs are in `release-public/`, whose `latest.yml` and setup installers are part of the public update/feed metadata.

There is an important distinction between preparing a public distribution locally and publishing it. `build:public` ends at local verification; `release` additionally invokes `electron-builder ... --publish=always`. That last step can upload/publish an externally visible release. Do not run publish just to see whether the packaging works.

### Version and artifact consistency
`package.json` is the version source observed here; builder metadata/artifact names, installer filenames, update YAML and packaged app must agree for an actual release. A folder may contain multiple historical installers, so presence of `Prometheus-Setup-1.0.17.exe` does not establish that a current source change is included. Record the exact commit, version and output produced by a build; verify using `verify-public-release` before handing it off.

### Auto-update status
Updates are a **file-based handshake between the gateway and Electron main**. A producer (the `self_update` tool, a Telegram command, the CLI, or settings) calls `requestCanonicalUpdate(configDir, …)`, which writes a request file under `getUpdatePaths(configDir)`. Electron main polls it with `consumeCanonicalUpdateRequest()`, takes a single-owner lock via `acquireUpdateLock()` (owner names like `electron-main-check`), and drives `electron-updater`'s `autoUpdater` against the public feed (`latest.yml`). It then validates the version with `validateReleaseInfo()`, checks the download with `verifyFileSha512()`, and writes progress through `writeCanonicalUpdateStatus()`. Callers wait on that status with `waitForCanonicalUpdateStatus()`. `isPackagedPublicUpdaterEnvironment()` gates the whole flow, so dev/unpackaged runs don't self-update. Read `electron/main.js` around its `canonicalUpdaterApi` usages before changing the flow. Symbols verified at `a48712ccc`; a real end-to-end install wasn't exercised while writing this doc.

## Config & knobs
- `package.json` `version` is `1.0.17` at `a48712ccc`; bumping it is a release operation that affects installers/update metadata.
- Internal/public build configuration: `electron-builder.yml` vs `electron-builder-public.yml`.
- Important scripts: `build:win`, `build:mac`, `build:web-production`, `sync:web-ui`, `prepare:public:desktop`, `build:public`, `build:public:mac*`, `release`, `verify:public-release`, `verify:public-release:mac`.
- Public platform/feed secrets and signing config are intentionally not reproduced here. Inspect builder config and CI environment; never put credentials in committed configs or terminal transcripts.

## Gotchas / sharp edges
- **Wrong build target:** `build:web` is a UI consistency check, not a standalone frontend production package; `build:public` is an Electron distribution build.
- **Wrong configuration:** internal and public builder YAML differ. A successful internal installer is not proof public policy, paths or signing are correct.
- **Release is a write:** `npm run release` publishes (`--publish=always`); do not use it for local verification.
- **Stale artifacts:** release folders retain versioned outputs from older builds. Check modification time, exact version, builder metadata and verifier output.
- **Dirty generated UI:** syncing may replace/delete generated files. Check source status and use a clean owned workspace; preserve unrelated operator changes.
- **Native helper mismatch:** public prep includes helper/native patch steps; skipping them can produce a broken packaged desktop even if TypeScript compiles.
- **Dependency vs behavior:** `electron-updater` dependency and `latest.yml` do not prove an updater is wired to the running app. Current runtime is **UNVERIFIED**.
- **Platform cross-build:** native modules/helpers/signing may depend on the host. Use the documented native builder/CI path rather than improvising cross-OS output.
- **No blind publish:** require explicit release-owner authorization for external publish/upload and inspect artifacts before that final step.

## How to change it safely
1. Inspect git status, current version, builder configs, public prep and platform verifier. Do not reset or overwrite a dirty release tree.
2. Make source/UI/runtime changes in canonical source; if UI changed, run `npm run sync:web-ui` in a clean owned worktree first.
3. Run backend and web checks before packaging; use the explicit target script and note platform/arch.
4. Verify public output with the matching verification script; check generated manifest/files and expected installer/update YAML/version consistency.
5. Inspect packaged resources and launch a local installer/unpacked app for startup, gateway, assets and update UX if those changed.
6. Treat `release` as a separate gated publish operation. Do not invoke it during exploratory testing.
7. For updater behavior, first locate an actual main-branch update runtime before changing any assumed `src/update` code; report missing integration as UNVERIFIED.

## Related
- [02 Startup, gateway, runtime](02-startup-gateway-runtime.md) · [07 Source editing and PR workflow](07-source-editing-and-pr-workflow.md)
- [17 Desktop web UI](17-desktop-web-ui.md) · [18 Mobile app](18-mobile-app.md) · [21 Security](21-security-approvals-permissions.md)
- [generated changelog](generated/changelog.md) · [generated tests](generated/tests.md)


## Preflight checklist by artifact

### Internal/dev Electron build
- Confirm the goal requires an Electron package; for UI-only work use source sync/check rather than a full installer.
- Check installed Node version against `package.json` engine range.
- Confirm native modules/helper prerequisites for the host OS and architecture.
- Confirm the requested `electron-builder.yml` config and output directory.
- Run backend build and platform helper step before builder packaging.
- Check the generated UI output is sourced from the intended commit.
- Keep the output local and record version + exact build command.

### Public Windows distribution
- Confirm the worktree is clean or every existing generated change is known/owned.
- Confirm public configuration and environment are appropriate for distribution.
- Run `prepare:public:desktop` and inspect its source-sync results.
- Build helper and Electron package with the public config.
- Run `verify:public-release` and inspect any manifest/findings.
- Confirm installer, blockmap/update metadata and version point to the just-built artifacts.
- Test an install/launch without relying on dev-tree files.
- Do not invoke `release` unless explicitly authorized to publish externally.

### Public macOS distribution
- Choose native arch or explicit `--x64`/`--arm64` script as intended.
- Check signing/notarization environment according to release docs/CI.
- Run the Mac release verifier for the expected architecture.
- Test app launch and bundled resources on macOS; a Windows build does not cover this.

## Versioning and rollback notes
- Keep source version, builder version metadata and public latest metadata aligned.
- Avoid reusing a version for materially different public bits; updater/cache consumers may treat version as immutable.
- If a build is invalid before publish, delete/rebuild only in an owned output directory.
- If already published, use the documented release rollback/superseding version path rather than silently replacing remote files.
- Keep generated update descriptors and checksums paired with exact installer bytes.
- Do not copy installer binaries or blockmaps into docs; link to managed release output only.
- Record verification evidence (platform/arch, installer name, checksum, version, launch result) in release tracking.
- Keep user data migration and application update separate: reinstall/rollback should not overwrite workspace/config data.

## Updates: what is and is not verified

At this source revision, package metadata shows `electron-updater` and public output includes `latest.yml`, but there is no `src/update/` folder in the inspected source tree and no `autoUpdater`/poll/apply call in the searched runtime paths. Treat the following as **UNVERIFIED** until located in a later/other path:
- Whether the desktop client checks update metadata automatically.
- Whether the user is prompted or updates are downloaded silently.
- What action applies the update or restarts the application.
- How staged rollout, downgrade and rollback behave.
- Which URL/feed and signature policy the running app uses.

The public build may still produce metadata consumed by another updater implementation or by a future version; do not infer the runtime state machine from artifact presence alone. A source search should locate the app startup initializer, updater listeners, feed/configuration source, UI status events and the eventual install/restart action before an update change is considered complete.


## Packaging responsibility boundaries

- Backend compilation/type checking belongs to the package build script; a frontend-only change does not prove backend runtime compatibility.
- Public web preparation copies/generated assets into the distributable tree; source web changes are not automatically in an already-built installer.
- Electron native patching is part of build prep and should not be skipped because an earlier local install happened to work.
- Desktop helper binaries are platform-specific and built separately; inspect helper version/architecture in the packaged app.
- Electron Builder configuration owns included files, excluded development artifacts, signing, NSIS metadata and output paths.
- `verify-public-release` validates the result but does not replace a launch smoke test.
- Release notes/changelog and user-facing version text may be handled by separate release automation; inspect its source before assuming `package.json` alone updates everything.
- Runtime data/workspace roots are user-owned data and should remain outside installer replacement or updater cleanup.
- Do not commit generated installer output as source unless the repository's release process explicitly tracks that exact artifact.
- When changing the public file allowlist, compare a packaged file inventory with runtime requirements, especially browser assets, extension descriptors, fonts, helper executable and update metadata.

## Release evidence to record

A useful handoff includes:
- Source commit SHA and clean/dirty status.
- `package.json` version and requested release channel.
- Build command and builder config used.
- Operating system and target architecture.
- Installer/unpacked artifact path and file size.
- Public-release verifier exit/result.
- Whether install and first launch succeeded.
- Gateway startup, asset loading and critical tool smoke-test result.
- Update metadata version/hash if an update feed is included.
- Signing/notarization evidence when relevant.
- Any known unverified updater behavior or platform limitation.

Do not claim “release ready” from a successful compile alone; packaging, verification, install and a fresh launch are separate checks.


## Release troubleshooting sequence

1. **Build exits before packaging:** inspect Node version, native dependency install, backend typecheck and helper build output.
2. **Installer opens but app is blank:** inspect packaged web asset paths, manifest/hashed chunks, public mirror prep and browser console.
3. **App starts but gateway fails:** inspect packaged backend/runtime files, native dependencies, data-root permissions and startup logs.
4. **Helper integration missing:** confirm the target helper was built and included for the correct OS/architecture.
5. **Installer reports wrong version:** compare `package.json`, builder debug metadata and packaged executable metadata.
6. **Verifier reports missing public file:** inspect the public allowlist/preparation stage and add only the required runtime asset.
7. **Latest metadata looks current but updater did not move:** check the update status file (`readCanonicalUpdateStatus`), confirm `isPackagedPublicUpdaterEnvironment()` is true for that install, and look for a stale lock from `acquireUpdateLock()` before changing artifact names.
8. **Build modified unexpected source/generated files:** stop; inspect diff and status. Keep unrelated edits, do not reset or clean.
9. **Installer works only on dev machine:** test a clean-profile install with no source checkout or development environment variables.
10. **Release upload failed after some artifacts:** inspect remote release state before retrying; partial publish can leave stale metadata or duplicate assets.


## Artifact directory hygiene

The `release/` and `release-public/` trees can contain large installers and unpacked Electron runtimes. Check available disk and current contents before building; do not erase an existing release someone is verifying. Prefer a unique temporary output path or a clean worktree for a parallel build. Avoid committing generated `win-unpacked/`, `.blockmap`, `latest.yml`, or installer binaries unless the release workflow explicitly stages them. A large-file scan is appropriate before staging release-related paths.


The exact GitHub release publishing policy, signing credentials and updater feed configuration are not reconstructed in this guide; use the repository release workflow and owner instructions. The local release directories are evidence of past outputs, not authorization to publish, upload, or overwrite them. The updater integration is documented above; an end-to-end install test (feed selection → sha512 → install → restart recovery) is still worth adding.

During a release regression, compare a known-good artifact built from the prior commit with the new installer; this separates a packaging regression from a source/runtime regression. Preserve both outputs and their version/hash metadata until the cause is understood. Never use an old `release-public/latest.yml` as current feed truth unless it matches the build's installer hash and release channel.