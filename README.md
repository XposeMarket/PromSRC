# Prometheus

**A local AI automation layer.** Prometheus runs on your own machine and gives you a single agent ("Prom") that can work across your browser, desktop, files, terminal, connected apps, and long-running background agents. It also keeps memory between sessions.

- Desktop app for **Windows** and **macOS** (Electron)
- A **web UI** and a **mobile PWA** served by the local gateway
- Works with cloud models (Anthropic, OpenAI / ChatGPT, xAI) and local models (Ollama, LM Studio, llama.cpp)

---

## Install (recommended): desktop app

Installers are published to the public releases repo:

**➡ [github.com/XposeMarket/prometheus-releases/releases](https://github.com/XposeMarket/prometheus-releases/releases)**

| Platform | Download |
| --- | --- |
| Windows 10/11 (x64) | `Prometheus Setup <version>.exe` (NSIS installer) |
| macOS (Apple Silicon / Intel) | `.dmg` for your architecture |

1. Download the latest installer and run it.
2. Launch **Prometheus**. On first start, onboarding walks you through choosing a model provider and signing in.
3. The app updates itself from the same releases feed. You don't need a GitHub account or token.

---

## Install from source (developers)

### Requirements

- **Node.js `>=20.20.0 <23`** (Node 20 LTS recommended)
- **Git**
- Windows 10/11 or macOS. Linux works for the gateway and web UI, but desktop automation is Windows/macOS only.
- Optional: [Ollama](https://ollama.com) or LM Studio if you want local models

### Clone and install

```bash
git clone https://github.com/XposeMarket/PromSRC.git prometheus
cd prometheus
npm install
```

### Run it

Pick one:

```bash
# Desktop app from source (Electron window, no installer)
npm run electron

# Gateway + web UI only (open the URL it prints in your browser)
npm run gateway

# CLI entry point
npm run dev -- --help
```

To use the `prom` command globally from your checkout:

```bash
npm link
prom              # launch the desktop app from source
prom gateway start
prom doctor       # check the environment
```

### First-time setup

```bash
prom onboard
```

This creates the config and workspace directories and initializes the job database. After that, open **Settings → Models** in the UI to connect a provider.

### Where data lives

Prometheus resolves its config/data directory in this order:

1. `$PROMETHEUS_DATA_DIR/.prometheus` if `PROMETHEUS_DATA_DIR` is set
2. `.prometheus/` next to the project root, if it exists
3. `~/.prometheus` in your home directory

The gateway port can be overridden per process with `PROMETHEUS_GATEWAY_PORT` (default `18789`). The desktop app picks a free port on its own.

---

## Docker (gateway + web UI)

```bash
cp .env.example .env     # set PROMETHEUS_PROVIDER and keys
docker compose up -d
docker compose logs -f
```

Supported `PROMETHEUS_PROVIDER` values: `ollama` (bundled container), `lm_studio`, `llama_cpp`, `openai`, `openai_codex`, `xai`. See comments in `.env.example` and `docker-compose.yml`.

---

## Building installers

```bash
npm run build            # backend (tsc) + web UI checks
npm run build:win        # Windows NSIS installer -> release/
npm run build:mac        # macOS build (run on a Mac)
npm run build:public     # public Windows build + verify:public-release
```

Platform details, signing, and release QA:

- [README-DESKTOP.md](README-DESKTOP.md): desktop dev mode, Windows installer, Claude diagnostics
- [docs/MACOS-RELEASE.md](docs/MACOS-RELEASE.md): signed Apple Silicon/Intel builds and CI publishing

---

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run electron` | Run the desktop app from source |
| `npm run gateway` | Start the gateway + web UI |
| `npm run build:backend` | Compile TypeScript and copy runtime assets into `dist/` |
| `npm run start:compiled` | Run the compiled CLI from `dist/` |
| `npm run sync:web-ui` | Rebuild and check the web UI bundle |
| `npm run lint` | ESLint over `src/` |
| `npx tsc --noEmit` | Type-check |

---

## Repository layout

```
src/          gateway, agent runtime, tools, CLI (TypeScript)
web-ui/       desktop + mobile web UI
electron/     Electron main process and preload
native/       native desktop helpers (Windows / macOS)
extensions/   bundled connector and extension descriptors
scripts/      build, packaging, benchmark, and regression scripts
docs/         design notes, benchmarks, release docs
```

---

## License

MIT. See the `license` field in `package.json`.
