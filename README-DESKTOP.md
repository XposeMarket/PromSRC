# Prometheus Desktop App

Prometheus is packaged as a Windows and macOS desktop application using Electron.

For signed Apple Silicon and Intel release builds, Apple prerequisites, CI publishing, and first-release QA, see [`docs/MACOS-RELEASE.md`](docs/MACOS-RELEASE.md).

---

## Setup (one time)

```bash
cd D:\Prometheus
npm install
```

This installs `electron` and `electron-builder` alongside the existing dependencies.

---

## Run in Dev Mode (no installer)

```bash
npm run electron
```

This will:
1. Launch a loading screen
2. Spin up your gateway (`tsx src/gateway/server-v2.ts`) on the selected local port
3. Open the Prometheus UI in a native window

For the same source-based desktop launch through the installed `prom` command,
use:

```powershell
prom
# or explicitly:
prom electron
prom desktop
```

These commands run the local Electron runtime directly. They do not build an
installer or run the packaged updater. Use `prom gateway start` when you want
the regular terminal/web gateway without Electron.

Use this to test before building the installer.

---

## Build the Windows Installer

```bash
npm run build:win
```

Output goes to `D:\Prometheus\release\`:
- `Prometheus Setup 1.0.1.exe` — full NSIS installer
- Places Prometheus in Program Files
- Creates Desktop + Start Menu shortcuts
- Adds an uninstaller via Control Panel

## Build an unsigned macOS tester build

Run this on a Mac, not Windows:

```bash
npm ci
npm run build:mac:tester
```

The command builds the native Swift desktop helper, creates the macOS icon,
and produces unsigned DMG/ZIP artifacts in `release/`. Build on the matching
Mac architecture and distribute the resulting artifact only to testers. macOS
will show a Gatekeeper warning; testers must use **Privacy & Security → Open
Anyway** after the first launch. Prometheus will also request the normal
Microphone, Camera, Screen Recording, and Accessibility permissions when those
features are used.

For Apple Silicon and Intel testers, build separately on each architecture.
The signed/notarized production path is documented in
[`docs/MACOS-RELEASE.md`](docs/MACOS-RELEASE.md).

---

## File Structure

```
D:\Prometheus\
  electron/
    main.js              ← Electron entry point (spawns gateway, opens window)
  assets/
    Prometheus.png       ← App icon (auto-converted to .ico by electron-builder)
  electron-builder.yml   ← Build configuration
  package.json           ← Updated with electron scripts
  release/               ← Build output (gitignored)
```

---

## How It Works

- **Electron** wraps your existing web UI — zero changes to frontend or backend
- `electron/main.js` spawns `tsx src/gateway/server-v2.ts` as a child process
- The BrowserWindow loads the selected local gateway URL once the gateway is ready
- When you close the window, both Electron and the gateway shut down cleanly
- External links open in your default browser, not inside the app

## Run multiple local instances

The normal gateway port remains `18789`. Electron uses it when available and
fails clearly if another gateway already owns it, so a desktop test launch
cannot silently connect to the wrong instance. Close the existing Prometheus
gateway first, or pass a dedicated port to `prom electron --port <port>`.

The regular terminal/web gateway remains available through `prom gateway start`.
For an isolated terminal gateway, use the explicit `--new-instance` or
`--auto-instance` flags below.

For additional terminal gateways, give each instance both a unique port and a
unique data directory:

```powershell
npm run gateway -- --port 18889 --data-dir .prometheus-instances\dev-1
npm run gateway -- --port 18890 --data-dir .prometheus-instances\dev-2
npm run gateway -- --port 18891 --data-dir .prometheus-instances\dev-3
```

Open each instance at `http://127.0.0.1:<port>`. Separate data directories are
important: they keep sessions, jobs, runtime state, and restart supervision from
being shared across instances. `PROMETHEUS_GATEWAY_PORT` and
`PROMETHEUS_DATA_DIR` may be used instead of the CLI options.

If you want to force a completely isolated automatically assigned instance,
start it with this command in its own terminal:

```powershell
npm run gateway -- --new-instance
```

Each invocation claims the next available port and stores its isolated state
under `.prometheus-instances\port-<port>`.

### Pair a manual instance

Manual `prom` gateways are LAN-bound by default. On first start, each instance
creates a local browser-pairing credential at
`.prometheus\pairing-admin-token` and prints it once in the terminal. Paste
that credential into Settings → Pairing → Browser pairing authority, then
click **Use for this tab** before generating a QR code. Electron injects its
credential automatically.

### Keep live and dev PWAs online through Tailscale

The live Electron route can keep using the default Funnel HTTPS port 443:

```text
https://<machine>.ts.net       → local gateway 18789
```

Expose the dev gateway on a separate Tailscale HTTPS port so it gets a
different PWA origin and does not replace the live route:

```powershell
tailscale funnel --bg --https=8443 18790
```

Then open the dev instance's Pairing page, enter the browser credential, click
**Detect Tailscale**, apply the suggested `https://<machine>.ts.net:8443` URL,
save it, and generate a fresh QR. The phone can then keep both origins as
separate gateway entries/PWAs: the live app on 443 and the dev app on 8443.
Tailscale Funnel supports HTTPS listeners on 443, 8443, and 10000; the Pairing
page now chooses an unused one and disabling Funnel only removes that instance's
listener.

## Updates

Installed public builds use `electron-updater` with the GitHub feed configured in
`electron-builder-public.yml`. The updater checks after startup, shows its state
in the top bar, and exposes the same controls under Settings → General → Updates.
Automatic checks are enabled by default, but downloads and installation always
require explicit confirmation. Before installation Prometheus drains durable
writes, creates an OS-protected versioned backup of user state, closes gracefully,
installs, reopens, and validates the retained backup. Vault/credentials, settings,
workspace, memory, sessions, projects, and configured external workspaces remain
outside the installed app directory. Windows public builds must provide a signing
certificate; unsigned releases are refused by the updater.

The canonical updater owns only the update protocol under
`<user-data>\.prometheus\updates\` (`request.json`, `status.json`, the
single-flight `operation.lock`, retained `backups\<backup-id>\`, and the
restart-validation marker). It never replaces the user-data root. The backup
snapshot includes the standard roots `.prometheus\vault`, `.prometheus`
(settings and metadata, including `.prometheus\memory`, `sessions`, and
`projects`, and `.prometheus\skills` (packaged/imported skills), `workspace`
(including workspace memory and manually imported workspace skills),
`.prometheus\browser-sessions.json`, `.prometheus\browser-activity`, and
`Partitions` (persistent Electron browser profiles), plus configured
workspace, skills, and external paths. The encrypted
manifest contains paths and counts only; updater status and logs contain no
secret values.

`electron-builder-public.yml` deliberately requires a real signing provider
(`forceCodeSigning: true`) and enables signature verification. Supply signing
configuration such as `CSC_LINK`/`CSC_KEY_PASSWORD` only in the release
environment. If signing is unavailable, the build or
`npm run verify:public-release` must fail rather than producing an artifact the
runtime could install.

Updates are intentionally unavailable in development and non-public packaged
builds. Before publishing a release, build with the public config and run
`npm run verify:public-release`; the generated `latest.yml` must match the
installer version, filename, checksum, and size.

---

## Notes

- The app ships **without** a bundled model — users connect their own Ollama/API keys as usual
- `asar: false` is set so `tsx` can resolve TypeScript files at runtime inside the packaged app
- The installer is per-user by default (no admin required) but can be changed to per-machine in `electron-builder.yml`
