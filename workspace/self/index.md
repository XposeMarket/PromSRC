# self/: Prometheus Guidebook (start here)

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` (main) · Rebuilt from scratch on 2026-10-07; the old Aug-2026 docs are in `archive/self-2026-08/` (stale, use only as historical hints).
> **What this is:** the agent-facing map of how Prometheus works. Read the matching doc **before** changing or debugging a subsystem, and **update it** after you change one (see [Conventions](_tools/CONVENTIONS.md)).

## Ground truth in 10 lines

- **Live source:** `C:\Users\rafel\PromSRC` (package `prometheus` v1.0.17, Electron main `electron/main.js`). Don't do PR work here.
- **PR work:** git worktree per task at `C:\Users\rafel\promsrc-pr\<slug>`, then a PR via the `connector_github` tool. **`gh` CLI is not installed.** → [07](07-source-editing-and-pr-workflow.md)
- **Runtime workspace:** `C:\Users\rafel\AppData\Roaming\Prometheus\workspace` (skills, memory files, Brain, audit, projects). → [01](01-identity-and-paths.md)
- **Gateway:** default port `18789` (`src/config/gateway-port.ts`). → [02](02-startup-gateway-runtime.md)
- **System prompt** is built in `src/gateway/prompt-context.ts`. It hard-reads `self/index.md` (first 3000 chars) and `self/06-image-voice.md` (voice, 7000 chars), so **keep both filenames.**
- **Tools** are category-gated (`src/gateway/tool-builder.ts`), with ~640 definitions in source. → [05](05-tools-and-categories.md) · [inventory](generated/tools.md)
- **Primary model:** Claude Opus 5.5. OpenAI GPT-6.1 Sol / GPT-6 Luna are for spawned workers. → [04](04-chat-pipeline-and-providers.md), [08](08-agents-tasks-background.md)
- **Big subsystems added since August:** media engine/video ([15](15-media-engine-video.md)), games engine ([16](16-games-engine.md)), Teams v3 ([09](09-teams.md)), account-optional onboarding ([19](19-onboarding-accounts-auth.md)), connector `api_request` escape hatches ([12](12-connectors-mcp-integrations.md)).
- **Raul's rules** (USER.md) override convenience. Most relevant here: auto-PR on Prometheus faults, no self-merge, quote cost before paid media runs.
- **When something is weird,** check [25 Sharp edges](25-sharp-edges.md) first.

## Core docs

| # | Doc | Read when you're touching… |
|---|-----|---------------------------|
| 01 | [Identity & paths](01-identity-and-paths.md) | where anything lives, config files, soul files |
| 02 | [Startup, gateway, runtime](02-startup-gateway-runtime.md) | boot, port, process supervisor, restart, health, CLI |
| 03 | [Prompt assembly & context](03-prompt-assembly-and-context.md) | system prompt, injected blocks, compaction, budgets |
| 04 | [Chat pipeline & providers](04-chat-pipeline-and-providers.md) | tool loop, streaming, providers, model routing, threads |
| 05 | [Tools & categories](05-tools-and-categories.md) | adding/changing tools, categories, tool_search, result bounding |
| 06 | [Image & voice](06-image-voice.md) | voice agent, realtime, dictation, image generation |
| 07 | [Source editing & PR workflow](07-source-editing-and-pr-workflow.md) | changing Prometheus itself, worktrees, CI, merge → restart |
| 08 | [Agents, tasks, background](08-agents-tasks-background.md) | background_ops, subagents, task runner, spawn routing |
| 09 | [Teams](09-teams.md) | managed teams, manager/member turns, goals, dispatch |
| 10 | [Scheduling, automations, triggers](10-scheduling-automations-triggers.md) | schedules, heartbeat, timers, webhooks, goals |
| 11 | [Memory, notes, Brain](11-memory-notes-brain.md) | memory tool, write_note, Brain Thought/Dream, audit index |
| 12 | [Connectors, MCP, integrations](12-connectors-mcp-integrations.md) | connectors, OAuth, MCP servers, X/Vercel wrappers |
| 13 | [Browser & desktop](13-browser-desktop.md) | browser/desktop automation, vision, login handoff |
| 14 | [Creative, HyperFrames, Remotion](14-creative-hyperframes-remotion.md) | creative studio, motion templates, scene graph |
| 15 | [Media engine & video](15-media-engine-video.md) | video projects, shots/jobs, providers (fal/Kling/Wan/Grok), cost caps |
| 16 | [Games engine](16-games-engine.md) | games-engine subsystem, game builds |
| 17 | [Desktop web UI](17-desktop-web-ui.md) | web-ui pages, components, build/sync |
| 18 | [Mobile app](18-mobile-app.md) | mobile UI, pairing, Tailscale Funnel |
| 19 | [Onboarding, accounts, auth](19-onboarding-accounts-auth.md) | first-run flow, accounts, provider auth |
| 20 | [Skills runtime](20-skills-runtime.md) | skills, routing, SKILL.md format |
| 21 | [Security, approvals, permissions](21-security-approvals-permissions.md) | approval gates, Lite/Default, elevated, secrets |
| 22 | [Comms, Telegram, notifications](22-comms-telegram-notifications.md) | channels, delivery_send, push |
| 23 | [Rich output, cards, artifacts](23-rich-output-cards-artifacts.md) | show_ui_card, fenced cards, html visuals |
| 24 | [Release, packaging, update](24-release-packaging-update.md) | Electron build, public release, updater |
| 25 | [Sharp edges](25-sharp-edges.md) | known traps across the system |

## Generated inventories (never hand-edit; rerun `node self/_tools/generate-inventories.mjs`)

| File | Contents |
|------|----------|
| [generated/tools.md](generated/tools.md) | every tool definition found in source, grouped by prefix, with file |
| [generated/tool-categories.md](generated/tool-categories.md) | category IDs + policies |
| [generated/routes.md](generated/routes.md) | all HTTP routes by router file |
| [generated/connectors.md](generated/connectors.md) | connectors / MCP presets / provider extensions, with api_request gap flags |
| [generated/skills.md](generated/skills.md) | installed skills + descriptions |
| [generated/source-map.md](generated/source-map.md) | src/ dir sizes, largest files, web-ui layout |
| [generated/tests.md](generated/tests.md) | scripts/test-* and *.regression.ts, so you can find the tests for what you touched |
| [generated/changelog.md](generated/changelog.md) | merged PRs since 2026-08-01 |

## Maintenance

- [Conventions & doc template](_tools/CONVENTIONS.md): rules every self/ doc follows.
- [ISSUES.md](ISSUES.md): running log of Prometheus tool/runtime friction found during work (feeds auto-PRs).
- `investigations/`: dated, point-in-time reports and benchmarks (`YYYY-MM-DD-slug.md`). They are not core reference.
- Drift check: `node C:\Users\rafel\PromSRC\scripts\test-self-doc-drift.mjs` (verifies index links resolve; it reads `PromSRC/workspace/self`, see [25](25-sharp-edges.md)).
