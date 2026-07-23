# macOS desktop release

Prometheus ships separate, native macOS builds for Apple Silicon (`arm64`) and Intel (`x64`). Separate builds are intentional: the app bundles architecture-specific Electron, Swift, SQLite, PTY, ONNX Runtime, FFmpeg, ffprobe, and Chromium binaries. This is safer and easier to validate than combining all of those components into one universal bundle.

## One-time Apple setup

1. Enroll the release owner in the Apple Developer Program.
2. Create a **Developer ID Application** certificate and export it with its private key as a password-protected `.p12` file.
3. Create an app-specific password for the Apple ID used for notarization.
4. Add these Actions secrets to the private source repository:

   - `MAC_CSC_LINK`: the `.p12` as base64 or another `electron-builder`-supported certificate reference.
   - `MAC_CSC_KEY_PASSWORD`: password used when exporting the `.p12`.
   - `APPLE_ID`: notarization Apple ID email.
   - `APPLE_APP_SPECIFIC_PASSWORD`: Apple app-specific password.
   - `APPLE_TEAM_ID`: 10-character Apple Developer team ID.
   - `RELEASES_GH_TOKEN`: fine-grained GitHub token with permission to create and update releases in `XposeMarket/prometheus-releases`.

Do not commit certificates, API keys, or passwords to this repository.

## Building and publishing

Run the **Release macOS** workflow manually from GitHub Actions. The release tag must match `package.json`, for example `v1.0.9`.

- Leave `publish` off for a signed/notarized validation build. The workflow retains both architecture artifacts for 14 days.
- Turn `publish` on to upload both DMGs, both updater ZIPs, blockmaps, and a merged `latest-mac.yml` to the public release repository.
- If the Windows release already created that tag, the workflow adds or replaces only the Mac assets. If it does not exist, the workflow creates it.

Local production builds must run on the matching Mac architecture with signing and notarization variables present:

```bash
PLAYWRIGHT_BROWSERS_PATH=0 npm ci
npx playwright install chromium
npm run build:public:mac:arm64   # M-series Mac
npm run build:public:mac:x64     # Intel Mac
```

The public config deliberately fails instead of producing an unsigned Mac release.

## Required release QA

The automated verifier checks Mach-O architecture, the Swift helper handshake, native Node modules, ONNX libraries, FFmpeg/ffprobe, bundled Chromium, Developer ID signing, Gatekeeper assessment, and stapled notarization tickets.

Before announcing the first Mac release, also test the downloaded DMG on one clean Apple Silicon Mac and one clean Intel Mac:

1. Download through the public GitHub release, not an Actions artifact, so Gatekeeper sees a normal quarantined download.
2. Drag Prometheus to Applications and launch it without right-click overrides.
3. Complete the initial macOS prompts for Microphone, Screen Recording, and Accessibility. Restart after granting Screen Recording or Accessibility when macOS requests it.
4. Verify chat startup, voice input, a terminal command, browser automation, desktop screenshot/input, a SQLite-backed feature, ONNX/image tooling, and one FFmpeg video operation.
5. Publish a higher patch version and confirm the in-app updater selects the matching architecture and installs the update.

## Outputs

For each version the public release contains:

- `Prometheus-<version>-mac-arm64.dmg`
- `Prometheus-<version>-mac-arm64.zip`
- `Prometheus-<version>-mac-x64.dmg`
- `Prometheus-<version>-mac-x64.zip`
- `latest-mac.yml`, containing both architecture-specific ZIPs for `electron-updater`

Direct DMG distribution is the current path. A Mac App Store build is a separate project because it requires App Sandbox, different certificates/entitlements, a provisioning profile, and review; it is not needed to remove the website's “coming soon” status.

## Runtime maintenance before broad general availability

The repository currently pins Electron 33. That line reached end of life in April 2025, so it no longer receives Chromium or Electron security fixes. This does not prevent producing the first signed Mac build, but a supported-Electron upgrade should be treated as the next release gate before broad promotion—especially because Prometheus includes browser automation and renders network content.

Do that upgrade as its own tested change rather than mixing it into the platform packaging work. It needs Windows, Apple Silicon, and Intel regression passes plus rebuild checks for `better-sqlite3`, `node-pty`, and `onnxruntime-node`.
