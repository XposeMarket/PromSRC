# Self-Reference Source Matrix

This matrix connects the complete split `workspace/self` reference to the document-ready feature catalog. It prevents the catalog from becoming a disconnected marketing summary: use the catalog pages for top-down explanation and the owning self-reference file for exact implementation, operational, and sharp-edge detail.

## Core product and runtime

| Self-reference source | Primary catalog use |
|---|---|
| `index.md` | Entry map for the split self-reference and its ownership boundaries |
| `01-identity.md` | Product identity and durable workspace framing |
| `02-startup-runtime.md` | Startup, route mounting, Electron trust boundary, account gate, mobile pairing/HTTPS/Tailscale |
| `03-execution-and-prompting.md` | Execution modes, main chat, browser/teach behavior, prompt assembly |
| `04-browser.md` | Browser modes, browser state, observation, vision, copilot and teach |
| `05-tools.md` | Tool architecture, web/media tools, tool routing and policy |
| `06-image-voice.md` | Image generation, media config, dictation, realtime voice and visual-input sharp edges |
| `07-source-editing.md` | Coding/source edits, proposals, self-edit sandbox, approval and verification rules |
| `08-tasks-and-agents.md` | Tasks, background work, subagents, teams, coordinator, deployment analysis |
| `09-providers-and-models.md` | Provider capabilities, model selection/defaults and routing |
| `10-mcp-and-connections.md` | MCP, connectors, OAuth, configured-app boundaries |
| `11-run-and-supervisor.md` | Command approval, managed process supervisor, gateway liveness/workers |
| `12-telegram-and-brain.md` | Telegram/channels, Brain runner, Thought/Dream, skill gardener/curator |
| `13-memory.md` | Workspace memory files, search/index layers, durable-memory boundaries |
| `14-skills-and-frontend.md` | Bundled skills, Hub/frontend views, onboarding/migration hooks |
| `15-paths-and-sharp-edges.md` | Data paths, sharp edges, cross-cutting maintenance rules |

## Product clients and operations

| Self-reference source | Primary catalog use |
|---|---|
| `16-mobile-app.md` | Mobile PWA source layout, routing, pairing, chat, voice, push, deep links and verification |
| `17-desktop-web-ui.md` | Desktop page/module ownership, UI globals, shortcuts, API/WebSocket usage and boundaries |
| `17-local-ui-verification.md` | Local URLs, desktop forcing and UI QA rules |
| `18-public-release.md` | Public releases, self-update, packaged runtime operations |
| `19-onboarding-system.md` | First run, migration, model picker, memory seed and replay/dev test flows |
| `20-rich-artifacts.md` | Rich chat cards, dashboards, visualizations and voice integration |
| `24-mobile-liquid-glass.md` | Mobile visual language and development slider restoration notes |
| `WEB_UI_THEMES.md` | Desktop/mobile visual theme system |

## Runtime/prompt/identity audit set

| Self-reference source | Primary catalog use |
|---|---|
| `21-runtime-prompt-map.md` | Agent-surface prompt map and execution-mode personality matrix |
| `22-runtime-prompt-verbatim.md` | Literal prompt inventory and injection ownership |
| `23-runtime-context-flow.md` | Context assembly pipeline, ordering and isolated paths |
| `26-runtime-instruction-census.md` | Verified injection ownership, cost/overlap/role matrix |
| `27-stage4-tool-menu-trigger-benchmark.md` | Dynamic tool-category/menu benchmark and rollback gates |
| `28-deterministic-skill-routing.md` | Skill discovery/routing decision model and validation |
| `29-agent-identity-and-memory-runtime.md` | Canonical identity/memory behavior across main, standalone and team agents |
| `30-runtime-process-isolation.md` | Workers, durable turn journal, retention, delivery and remaining boundaries |

## Creative reference set

| Self-reference source | Primary catalog use |
|---|---|
| `creative/00-overview.md` | Creative mode scope and routing |
| `creative/01-runtime-scene-graph.md` | Scene graph/runtime/editor state |
| `creative/02-assets-uploads.md` | Assets, uploads, source-video intake |
| `creative/03-video-editing.md` | Video editing, social/editorial source-video lane |
| `creative/04-html-motion-hyperframes.md` | HTML motion and HyperFrames capability boundary |
| `creative/05-generative-pipeline.md` | Generative image/video/media pipeline |
| `creative/06-motion-templates.md` | HTML motion templates |
| `creative/07-motion-blocks.md` | HTML motion blocks |
| `creative/08-remotion-templates.md` | Remotion template support |
| `creative/09-premium-templates.md` | Premium editable template boundary |
| `creative/10-qa-rules.md` | Creative QA and visual verification rules |

## Release, legacy, and research material

| Self-reference source | Primary catalog use |
|---|---|
| `public-runtime-release/README.md`, `dependency-map.md`, `packaging-and-generated-files.md`, `troubleshooting.md`, `verification-checklist.md` | Public runtime packaging, dependencies, generated files, troubleshooting and release QA |
| `Legacy self.md/SELF.md` | Historical monolith; consult when a split-file reference needs historical wording/context |
| `feature-index/findings.md` | 2026-06 research inventory retained for historical traceability |
| `feature-index/deep-cuts.md` | 2026-06 deep-feature research retained for historical traceability |

## How to use the matrix

1. Start a product document in [01-product-catalog.md](01-product-catalog.md).
2. Add exact UI/tool/creative/runtime detail from the corresponding catalog page.
3. Use this matrix to open the owning self-reference when exact behavior, source anchors, defaults, or operational caveats need to be represented.
4. Retain the availability labels—built in, configured, conditional, approval-gated, internal—when translating source detail into product copy.
