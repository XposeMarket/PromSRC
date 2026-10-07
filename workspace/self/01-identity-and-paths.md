# 01 — Identity and filesystem paths

> Last verified: 2026-10-07 against PromSRC a48712ccc · **Owner area:** `src/config/`, `src/runtime/storage-layout.ts`, runtime workspace layout
> **Read this when:** locating application code, user data, configuration, durable memory, or source-vs-runtime soul instructions.

## TL;DR
- Prometheus is the local, durable AI agent application; **Prom** is its conversational agent identity, not a synonym for a generic chatbot. The package is `prometheus` (version `1.0.17`); Electron entry is `electron/main.js`.
- Live source checkout: `C:\Users\rafel\PromSRC`. PR worktrees live below `C:\Users\rafel\promsrc-pr\<slug>`. Source is not the runtime user's data directory.
- The primary runtime workspace for this installation is `%APPDATA%\Prometheus\workspace`; use `getConfig()`/the resolved layout rather than assuming this path on other machines or staged layouts.
- Storage layout v2 deliberately separates machine/runtime state (`appDataRoot\runtime`) from user/agent workspace (`appDataRoot\workspace`). Migration is staged; `resolvePrometheusLayout()` defaults to legacy mode unless opted into canonical mode.
- In canonical layout, configuration is `<runtimeRoot>\\config\\config.json`; `getConfigDir()` returns the active config root (legacy: config directory; canonical: broader runtime root). The config filename is **not** always under the workspace.
- `PrometheusConfigSchema` is the Zod contract; `ConfigManager` loads, defaults, merges, validates, and persists configuration.
- The app has source-owned soul defaults in `src/config/{soul,subagent-soul,voice-soul,prometheus-runtime-contract}.md`; user-profile files in the runtime workspace are distinct and may be injected into prompts.
- For inventories of repository paths, tests, and merged changes, use [generated/source-map](generated/source-map.md), [generated/tests](generated/tests.md), and [generated/changelog](generated/changelog.md), not manually duplicated lists.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Main product identity / package | `package.json` → `name`, `version`, `main`; `electron/main.js` → `startGateway()` | Desktop main launches the gateway child; main is not the chat router. |
| Backend source | `src/` | Gateway, providers, tools, runtime/config, memory, agents, security and orchestration. |
| Web application | `web-ui/` | Web/mobile UI source consumed by the gateway and Electron surfaces. |
| Desktop shell | `electron/` → `main.js` | Main process, preload/security, gateway ownership and renderer lifecycle. |
| Project automation | `scripts/` | Build, sync, release and regression scripts; list in generated inventories. |
| Bundled/runtime workspace assets | `workspace/` | Bundled skills and app-managed seed assets, not the live user's runtime workspace. |
| Layout resolver | `src/runtime/storage-layout.ts` → `resolvePrometheusLayout()`, `getPrometheusLayout()` | Computes legacy and canonical roots from environment/platform; no disk mutation in resolver. |
| Config manager | `src/config/config.ts` → `getConfig()`, `getConfigDir()`, `ConfigManager` | Canonical config file is derived from `STORAGE_LAYOUT.runtime.config`. |
| Legacy config backend | `src/config/config-classic.ts` → `ConfigManager`, `DEFAULT_CONFIG` | Preserved as compatibility backend while v2 is staged. |
| Config contract | `src/config/config-schema.ts` → `PrometheusConfigSchema`, `getConfigErrors()` | Zod validation for provider, gateway, models, tools, memory, workspace, agents, channels and more. |
| Public workspace scaffold | `src/config/public-workspace.ts` → `ensurePublicWorkspaceScaffold()` | Seeds files such as SOUL.md/USER.md without overwriting existing user files. |
| Soul defaults | `src/config/soul.md`, `subagent-soul.md`, `voice-soul.md` | Main Prom persona, distinct subagent persona, voice surface persona. |
| Runtime contract | `src/config/prometheus-runtime-contract.md` | Behavioral and execution contract joined with system prompt; distinct from personality soul. |
| Runtime user data (legacy active root here) | `%APPDATA%\\Prometheus\\workspace` | Human/agent durable workspace. Typical key children below; active root may be overridden. |
| Runtime config (canonical v2) | `%APPDATA%\\Prometheus\\runtime\\config\\config.json` | Canonical default with `appDataRoot=%APPDATA%\\Prometheus`; config manager returns runtime root from `getConfigDir()`. |
| Runtime machine state (v2) | `%APPDATA%\\Prometheus\\runtime\\` | Sessions, agent chats, task/schedule/team state, vault, audit, diagnostics, cache, migrations, backups. |
| Runtime workspace (v2) | `%APPDATA%\\Prometheus\\workspace\\` | User-facing durable data; includes memory, projects, skills, Brain and internal agent roots. |
| Source-specific prompt index | `self/index.md`, `self/06-image-voice.md` | Prompt references name these; non-public builds preload selected bounded copies. |

## How it works

### Product and repository boundaries

The npm package is named `prometheus`; the application version in the brief's verified checkout is `1.0.17`. `electron/main.js` owns desktop startup and the managed gateway process. `src/gateway/server-v2.ts` and its extracted `src/gateway/core/`, `routes/`, `chat/`, `runtime/`, and other subsystems implement backend behavior. `web-ui/` is UI source; the bundled assets may be generated/copied into distribution output. `workspace/` at the checkout root holds repository-bundled resources, especially skills. None of those should be confused with `%APPDATA%\Prometheus\workspace`, where the current user's operational data lives.

The source checkout is currently at `C:\Users\rafel\PromSRC`; isolated PR worktrees use `C:\Users\rafel\promsrc-pr\<slug>`. Use the workspace guide's repo workflow for source edits; do not edit runtime user data when a source change is intended, or vice versa. `src/runtime/distribution.ts` resolves source/package roots for production and development surfaces.

### Storage layout and config location

`getPrometheusLayout()` calls `resolvePrometheusLayout()`. `appDataRoot` precedence is explicit `PROMETHEUS_APP_DATA_DIR`, legacy `PROMETHEUS_DATA_DIR`, then the platform default (`%APPDATA%\Prometheus` on Windows, Application Support on macOS, XDG config on Linux). Layout v2 has:

- **runtime root**: `PROMETHEUS_RUNTIME_DIR` or `<appDataRoot>\runtime`; its `config` child contains canonical `config.json`, with sibling machine-owned data directories.
- **workspace root**: `PROMETHEUS_WORKSPACE_DIR` or `<appDataRoot>\workspace`; contains user/agent durable work such as memory, skills, projects and `Brain`.
- **legacy roots**: `PROMETHEUS_DATA_DIR\.prometheus`, project-local `<cwd>\.prometheus`, or home `~\.prometheus` for config selection, plus an active workspace next to that legacy config (unless an explicit workspace override is set).

The resolver reports both root sets and `mode`. Canonical mode is opted into using `PROMETHEUS_STORAGE_LAYOUT=canonical`/`v2`/`2` or an explicit `PROMETHEUS_RUNTIME_DIR`; an explicit workspace override alone does not flip mode (Electron already sets it in legacy-compatible launches). The migration is staged, and Electron can set explicit workspace while still running legacy config. Ask `getConfig().getConfigDir()` / `getConfig().getWorkspacePath()` at runtime; do not infer active mode from a path that happens to exist. In canonical mode the config file is under `runtime/config/config.json`, not `workspace/.prometheus`; `getConfigDir()` intentionally returns the broader runtime root in that mode.

`src/config/config.ts` delegates to the classic backend in legacy mode, while canonical mode anchors config to `STORAGE_LAYOUT.runtime.config/config.json`; it canonicalizes workspace paths, defaults, and active route. `getConfigDir()` exposes the active config directory, which auth/provider code uses for its vault-backed credentials and tokens. Do not log or copy credentials from config/vault.

For the currently active desktop installation, the legacy workspace at `%APPDATA%\Prometheus\workspace` is the primary durable workspace. These locations are expected or user-created there, but not all directories are created on a fresh install:

| Path | Purpose |
|---|---|
| `skills/` | User-installed/custom skills and copies of shipped skills; runtime catalog, not code under `src/`. |
| `USER.md` | Durable user identity and working preferences. |
| `SOUL.md` | Workspace-local persona/context additions; distinct from source-owned default soul. |
| `MEMORY.md` | Durable, curated cross-session facts. |
| `BUSINESS.md` | Business-specific state, loaded only when business context is enabled. |
| `Brain/` | Durable agent-created thought, dream, carry-forward, context-capsule and research artifacts. |
| `audit/` | Audit trail, task/chat/system/restart and other evidence indexes. |
| `notes/` | Intraday notes and short-lived continuity. Not a replacement for durable MEMORY.md. |
| `teams-test/` | Team test artifacts/workspaces, if present. |
| `video-projects/` | Persistent video project data. |
| `creative-projects/` | Creative project records and assets. |

The filesystem is user data: do not assume every listed folder exists in every new/clean install or use broad cleanup. Public workspace setup is in `src/config/public-workspace.ts`; runtime managers also create subsystem-owned folders as needed.

The v2 workspace resolver names `memory/`, `projects/`, `proposals/`, `generated/`, `uploads/`, `downloads/`, `skills/`, `hooks/`, `Brain/`, `creative-projects/`, `creatives/`, `analysis/`, `entities/`, `events/`, `integrations/`, `internal/`, standalone-subagent roots under `.prometheus/subagents/`, and `teams/`. The exact active root remains configuration/mode dependent.

### Config schema overview

`PrometheusConfigSchema` is a top-level Zod object. It models gateway/listener/auth/remote access, local Ollama concurrency, primary and role models, LLM provider blocks and account settings, agent-model defaults/templates, tool permissions, skills, memory/embeddings, heartbeat, workspace roots, agents, session/compaction/main-chat-goal controls, channels (Telegram/Discord/WhatsApp), search, voice, hooks, generic providers, policies, agent builder and creative editor. Nested provider configuration is partially strict so known provider fields/types are validated; custom/generic provider records are extensible. Optional knobs may be absent and receive defaults/compatibility treatment from config loading; schema acceptance alone does not guarantee the runtime currently uses a field.

Prefer schema names and consumers over editing `config.json` by guess. `src/config/main-chat-route.ts` documents the live main chat route as `llm.provider` plus its provider model; `agent_model_defaults.main_chat` mirrors it for older callers/templates. Keep related model fields synchronized using its patch helper, not hand-edited partial state. Tool permission checks are enforced outside the schema too.

### Soul and runtime instruction files

| File | Role |
|---|---|
| `src/config/soul.md` | Product-default identity, personality, action posture and general communication expectations for Prom. |
| `src/config/subagent-soul.md` | Distinct worker identity for assigned subagent runs; a subagent is not the main-chat Prom voice. |
| `src/config/voice-soul.md` | Voice conversation style and delivery constraints. |
| `src/config/prometheus-runtime-contract.md` | Runtime-wide behavior/safety/tool-use contract. |
| Workspace `SOUL.md`, `USER.md`, `MEMORY.md` | Installation-specific persona and user continuity inputs; they are not these source defaults. |

`src/config/soul-loader.ts` resolves source/default instruction documents. `src/config/public-workspace.ts` seeds initial workspace profile templates only when absent; do not treat a blank template as live persona truth. Prompt assembly selects files by runtime execution mode/profile; see [03 Prompt assembly and context](03-prompt-assembly-and-context.md).

## Config & knobs

- `.prometheus/config.json` is a conventional shorthand in legacy deployments, not a universal absolute path. Use `getConfigDir()` from `src/config/config.ts`; canonical v2 is `<runtimeRoot>\config\config.json`.
- `PROMETHEUS_APP_DATA_DIR`: explicit application-data parent.
- `PROMETHEUS_DATA_DIR`: legacy application-data/config root override.
- `PROMETHEUS_RUNTIME_DIR`: explicit runtime root and canonical-layout opt-in.
- `PROMETHEUS_WORKSPACE_DIR`: explicit user workspace root.
- `PROMETHEUS_STORAGE_LAYOUT=canonical|v2|2`: select canonical layout; other values resolve as legacy.
- Electron sets runtime paths/environment for its managed gateway; inspect `electron/main.js` `startGateway()` before assuming shell environment is authoritative.
- Provider API keys/tokens are secrets and commonly vault-backed; config schema is not the secure storage mechanism.

## Gotchas / sharp edges

- **Source `workspace/` vs user workspace:** repository `workspace/skills` is bundled/default data; `%APPDATA%\Prometheus\workspace/skills` is live user/runtime data. Verify which one a task means.
- **Legacy vs canonical storage:** this is an active migration. A single machine can have both candidate roots on disk; trust `getPrometheusLayout().mode`, not a hand-guessed precedence.
- **Config is not always `<workspace>/.prometheus/config.json`:** current canonical path is `<runtime>/config/config.json`; legacy path may be project/home/data-root `.prometheus`. Find it via `getConfigDir()`.
- **Prompt defaults vs user content:** source soul files are defaults/contracts; workspace profile files are installation data. Do not overwrite user-customized profiles when seeding or changing persona.
- **Config schema vs effective behavior:** `config-schema.ts` validates shape, but route resolution and provider/runtime policy are implemented by consumers. Trace from schema key to reader before changing it.
- **Private runtime tree:** do not recursively clean, sync, commit or publish the runtime workspace; it holds user memory, credentials-adjacent state, audit and project artifacts.
- **Self documentation source copy:** prompt text references `self/index.md` and `self/06-image-voice.md`; when authoring local workspace docs, verify links/availability in the target guidebook rather than assuming the tracked PromSRC copy has received them.

## How to change it safely

1. Identify whether the target is source, bundled workspace data, or a live user workspace artifact.
2. For code/schema changes use the source-edit/PR workflow in [07 Source editing and PR workflow](07-source-editing-and-pr-workflow.md); do not modify the read-only source during documentation reconstruction.
3. Trace a config key through `PrometheusConfigSchema`, `ConfigManager`, and its runtime reader. Add/change regression coverage listed in [generated/tests](generated/tests.md).
4. When changing persistent layout, inspect `src/runtime/storage-layout.ts`, `src/config/config.ts`, `src/config/config-classic.ts`, `src/config/*layout*.regression.ts`, and relevant migration tests. Test legacy and canonical mode separately; never move/delete user data as an incidental verification step.
5. When changing soul or prompt defaults, trace consumers and execution modes through [03 Prompt assembly and context](03-prompt-assembly-and-context.md) and run prompt/config regressions.

## Related
- [00 Index](index.md)
- [02 Startup, gateway and runtime](02-startup-gateway-runtime.md)
- [03 Prompt assembly and context](03-prompt-assembly-and-context.md)
- [04 Chat pipeline and providers](04-chat-pipeline-and-providers.md)
- [07 Source editing and PR workflow](07-source-editing-and-pr-workflow.md)
- [11 Memory, notes and Brain](11-memory-notes-brain.md)
- [generated/source-map](generated/source-map.md) · [generated/tests](generated/tests.md) · [generated/changelog](generated/changelog.md)

## Root-selection examples

| Situation | Expected route to the data | Verify |
|---|---|---|
| Electron runtime using this installation's workspace override | `%APPDATA%\Prometheus\workspace` | Electron child environment + `getWorkspacePath()` |
| Canonical layout, no explicit roots | `%APPDATA%\Prometheus\runtime` plus `%APPDATA%\Prometheus\workspace` | `PROMETHEUS_STORAGE_LAYOUT` and `getPrometheusLayout().mode` |
| Explicit canonical runtime root | `<PROMETHEUS_RUNTIME_DIR>\config\config.json` | `getConfigDir()` and `STORAGE_LAYOUT.runtime.config` |
| Legacy project-local development config | `<cwd>\.prometheus` | Whether that directory exists at process start and `getPrometheusLayout().legacy.activeConfig` |
| Isolated team/agent workspace | Resolver output under canonical workspace roots | `teamRoot()`, `teamSharedWorkspace()`, `teamSubagentWorkspace()` in `storage-layout.ts` |

The table describes the source resolver, not a guarantee every launcher uses those defaults unchanged. For a path incident, record the environment overrides, process cwd, platform, selected layout mode, active config directory and active workspace root together. This usually explains apparent duplicate `config.json`, skills or MEMORY files without requiring destructive cleanup.

Recent layout work intentionally preserves a classic config backend while staging v2 data separation. Do not describe canonical migration as complete for every caller just because `resolvePrometheusLayout()` exposes both roots. Existing skills, vault records and workspace state can be on legacy roots until their caller opts into canonical layout/migration.

## Config-path lookup rule

The call chain is `getConfig()` → active `ConfigManager` → `getConfigDir()`. In legacy mode, the classic manager chooses an active `.prometheus/config.json` candidate based on explicit/legacy data root and project/home config rules; in canonical mode `CANONICAL_CONFIG_FILE` is fixed under `STORAGE_LAYOUT.runtime.config`. The public `getConfigDir()` is therefore the stable diagnostic API. Do not assume `PROMETHEUS_DATA_DIR` means “the config directory” in v2: it remains the legacy application-data parent, while `PROMETHEUS_RUNTIME_DIR` names canonical runtime state. `public-workspace.ts` creates user-facing files under the resolved workspace and never determines the configuration file location.

For legacy config, `config-classic.ts` defines `CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')` and returns `CONFIG_DIR` via its manager's getter. In canonical mode `config.ts` returns `STORAGE_LAYOUT.runtime.root` so data stores can derive their own subdirectories; the canonical config file itself lives under `STORAGE_LAYOUT.runtime.config`. This is why `getConfigDir()` correctly hides the implementation choice without implying there is a single permanent config root.

## Quick orientation for a new agent

- Start from `%APPDATA%\Prometheus\workspace` for persistent user-level memory, skills and project content, but confirm active workspace before reading private files.
- Start from `src/config/config.ts` plus `src/runtime/storage-layout.ts` to locate config and state. `getConfigDir()` is intentionally layout dependent; in canonical mode it returns the runtime root, while actual config file is at `runtime.config/config.json`.
- Use `src/config/config-schema.ts` to discover supported config shape, `src/config/main-chat-route.ts` for live model route invariant, and `src/config/soul-loader.ts` for source-default instructions.
- Follow [03](03-prompt-assembly-and-context.md) before touching instruction injection: schema presence, file existence and actual per-mode prompt selection are three separate questions.
- Follow [generated/source-map](generated/source-map.md) to find a package or owner without reprinting the repo tree into a subsystem document.

## Layout environment truth

`src/runtime/storage-layout.ts` derives `appDataRoot` from `PROMETHEUS_APP_DATA_DIR`, then legacy `PROMETHEUS_DATA_DIR`, then platform defaults. It always calculates canonical `runtime` and workspace paths for reference, plus legacy project/home/data-root config paths and their active legacy workspace. Mode selection is separate: explicit `PROMETHEUS_RUNTIME_DIR` wins, otherwise `normalizeMode(env)` uses the layout selector; an explicit `PROMETHEUS_WORKSPACE_DIR` alone intentionally does not change mode because Electron sets it for legacy launches. The returned `activeConfigRoot` and `activeWorkspaceRoot` are the resolved authority for that call.

Avoid calling `%APPDATA%\Prometheus\runtime\config\config.json` the current config path without checking mode; it is canonical. The compatibility `ConfigManager` delegates either to `config-classic.ts` (whose `getConfigDir()` returns legacy `CONFIG_DIR`) or canonical manager (whose `getConfigDir()` is `STORAGE_LAYOUT.runtime.root`). To locate the actual file in canonical mode, use `STORAGE_LAYOUT.runtime.config/config.json`; to locate legacy, join legacy manager directory with `config.json`.

## Where to go next

- Start/health/lifecycle and process handoff: [02 Startup](02-startup-gateway-runtime.md).
- Prompt and memory injection boundaries: [03 Prompt assembly](03-prompt-assembly-and-context.md).
- Provider route and model/account invariants: [04 Chat and providers](04-chat-pipeline-and-providers.md).
- A specific runtime tool's actual declaration: [generated/tools](generated/tools.md); category ownership and policy: [generated/tool-categories](generated/tool-categories.md).
- Locate every route or likely test for a code path through [generated/routes](generated/routes.md) and [generated/tests](generated/tests.md).
