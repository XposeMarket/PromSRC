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
2. Spin up your gateway (`tsx src/gateway/server-v2.ts`) on port 18789
3. Open the Prometheus UI in a native window

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
- The BrowserWindow loads `http://127.0.0.1:18789` once the gateway is ready
- When you close the window, both Electron and the gateway shut down cleanly
- External links open in your default browser, not inside the app

---

## Notes

- The app ships **without** a bundled model — users connect their own Ollama/API keys as usual
- `asar: false` is set so `tsx` can resolve TypeScript files at runtime inside the packaged app
- The installer is per-user by default (no admin required) but can be changed to per-machine in `electron-builder.yml`
