# Prometheus: Complete System Map

This is the reading map for the full Prometheus system. It answers two questions that a raw tool list cannot: **which subsystem owns a behavior**, and **which document explains it completely**. It was checked against the current gateway, runtime, extension, connection, client, mobile, and self-reference sources on 2026-07-22.

For exact individual tool inputs and outputs, use the generated indexes; this page deliberately describes the systems that make those tools work together.

## The system in one view

```text
User / Desktop / Mobile / Telegram / Voice
                 |
           Chat session + turn
                 |
    prompts, model routing, skills, memory, policy
                 |
          tools, agents, teams, processes
                 |
workspace | browser/desktop | web | providers | connections
                 |
 evidence, artifacts, approvals, delivery, durable history
```

Nothing in that diagram means every feature is always active. A model, provider, connected app, paired device, operating system, installed local dependency, or explicit approval may be required. That distinction is part of the design, not a footnote.

## Start with the interface you use

| If you want to understand… | Read |
|---|---|
| Every desktop page, its controls, its data, and what its logs mean | [desktop page guide](pages/README.md) |
| Every paired-mobile screen, including voice and what stays desktop-only | [mobile page guide](mobile-pages/README.md) |
| The Chat surface, workspace/session behavior, and attached artifacts | [Chat](pages/01-chat.md) |
| Tasks, process logs, evidence, pause/resume/restart, and recovery | [Tasks](pages/02-tasks.md) |
| Schedule, teams, subagents, proposals, audit/memory, Hub, or configuration pages | [desktop page guide](pages/README.md) |
| Creative projects, assets, generation, editing, and quality checks | [Creative Studio](05-creative-studio.md) |
| Voice Agent, realtime conversation, mic/camera handling, and normal Worker handoff | [Voice Agent and Worker](16-voice-agent-and-worker.md) |

## The user-work system

### 1. Sessions, turns, and models

A user starts a message in a channel. Prometheus resolves the session, selected model/provider, applicable project/workspace context, and the correct execution mode. It builds a context for that **turn**, runs the model/tool loop, persists the outcome, then sends the result back to the originating channel or an explicitly named destination.

This is not a stateless chatbot request: sessions carry bounded message history, artifacts, tool observations, current task/goal relationships, and continuity state. Context has a finite budget. Model selection and provider credentials determine whether a model is merely listed, actually usable, or usable only for a specific mode. See [runtime architecture](06-runtime-architecture.md), [API surface](07-api-surface.md), and [providers/models in the source reference](../09-providers-and-models.md).

### 2. Context, memory, summaries, and durable continuity

There are several deliberately different records:

- **Live chat history** supplies immediate conversational context.
- **Compactions/summaries** preserve useful context once history becomes too large; they are not a verbatim transcript and do not change the underlying user intent.
- **Memory** holds durable, scoped facts/notes and uses its own retrieval/consolidation rules.
- **Audit, task, and request records** preserve operational evidence, recoverable work, approvals, and governed edits.
- **Goals** are a scoped completion contract, with plan/evidence/checkpoints rather than an informal “keep going” instruction.

Use [Goals, context, and continuity](19-goals-context-continuity.md) for the full lifecycle and recovery boundaries, and [Audit and memory page](pages/07-audit-and-memory.md) for the UI view.

### 3. Ordinary work and tool use

The agent receives a categorized tool menu, not an unbounded promise that every integration works. Built-in workspace, shell/process, files, web, browser, desktop, media, creative, schedule, task, memory, skill, and delivery tools are assembled at the gateway. Their results are treated as evidence for the next model step and final response.

The complete static schema list is [08](08-static-tool-schema-inventory.md); its plain-language per-tool index is [11](11-static-tool-capability-index.md). Browser/Windows tools have their own [13](13-browser-and-desktop-tool-index.md), Voice has [14](14-voice-tool-capability-index.md), and gateway wrappers/optional Agent Builder flows have [15](15-gateway-core-and-agent-builder-tools.md).

### 4. Parallel and managed execution

Prometheus can run managed processes, task workflows, background agents, subagents, and teams. They have different owners and recovery semantics:

- A **managed process** is an operating-system command with stdout/stderr/lifecycle state.
- A **task** is the user-visible work record and control surface.
- A **background agent** is an ephemeral parallel worker invoked through `background_ops`.
- A **subagent/team** is a coordinated agent structure with dispatch and reporting behavior.
- An **internal watch** is a bounded condition observer; it does not secretly mutate unrelated work.

See [Tasks](pages/02-tasks.md), [Teams](pages/04-teams.md), [Subagents](pages/05-subagents.md), and [Goals, context, and continuity](19-goals-context-continuity.md).

### 5. Research, web, browser, and X

`web_search` discovers sources and can fetch top results; `web_fetch` reads known URLs or small batches without a browser. Browser tools are reserved for interaction, login/JS-heavy content, visual inspection, or automated page work. A public X status URL has special fetch/media extraction behavior, while authenticated X actions go through an X connection and require X Developer/OAuth credentials. xAI/Grok model OAuth is separate from X API authorization.

This distinction, including `include_media`, downloads, shopping cards, and browser escalation, is documented in [Special tools and flows](17-special-prometheus-tools-and-flows.md) and [browser/desktop index](13-browser-and-desktop-tool-index.md).

### 6. Media, Creative, and artifacts

Prometheus can download direct media or media pages, inspect images/videos, create provider-backed image/video output, and place files/cards/visualizations into a chat. A rich artifact is a presentation layer over structured data; it is not a new authoritative data source. Creative has a separate project/assets/edit/render/QA pipeline.

Read [Creative Studio](05-creative-studio.md), [special media and delivery flows](17-special-prometheus-tools-and-flows.md), and [Rich artifacts source reference](../20-rich-artifacts.md).

### 7. External apps, connectors, MCP, plugins, and setup help

Prometheus does not invent integration credentials. It can discover a service/connection strategy, plan a read-only or requested-capability setup, request approval before proceeding, launch supported authentication, verify health, expose only the connected tool surface, and offer supported repair/disconnect paths. Connections can originate from a bundled connector, an installed plugin, an MCP server/preset, or a supported custom strategy. Dynamic MCP tools have runtime names such as `mcp__<server>__<tool>` and therefore cannot be exhaustively listed before that server connects.

The authoritative guided-setup explanation is [Settings, plugins, and connectors](18-settings-plugins-connectors.md). The source-derived set of bundled dynamic connector tools is [12](12-bundled-connector-tool-index.md). Do not conflate **skills** (instruction/resource packages) with **plugins/connectors** (integration/runtime extensions).

### 8. Automation and time-based behavior

Prometheus has three separate timing mechanisms:

- **Timer**: a single future, user-like main-chat message.
- **Schedule**: one-time or recurring automation, with run history and operator controls.
- **Heartbeat**: an agent continuation policy.

In addition, an internal watch monitors an explicit bounded condition. `automation_dashboard` reports a read-only cross-system operational snapshot. See [Schedule](pages/03-schedule.md), [special tools and flows](17-special-prometheus-tools-and-flows.md), and [Goals, context, and continuity](19-goals-context-continuity.md).

### 9. Safety, governed source editing, and recovery

Workspace work, external side effects, and Prometheus source edits have different boundaries. Source changes require inspected scope/evidence, a proposal, explicit approval where needed, and verification. Diagnostics, audit reconstruction, and durable request records help recover from an interruption without pretending that an unverified tool/process completed. Approval cards are part of the normal feature, not merely an error response.

Read [Operational systems](20-operational-systems.md), [Proposals](pages/06-proposals.md), [Tasks](pages/02-tasks.md), and [Audit and memory](pages/07-audit-and-memory.md).

### 10. Learning, skills, Brain, and Browser Teach

Skills are versioned instruction/resource packages with routing, lifecycle, provenance, snapshots, and a change ledger. They are not executable plugins. Browser Teach records a demonstrated browser workflow and requires explicit verification before it can recommend reusable assets. Brain/Skill Curator turns evidence into typed review candidates; higher-risk or behavioral changes are proposal/review-gated rather than silently applied.

See [Settings, plugins, and connectors](18-settings-plugins-connectors.md), [Operational systems](20-operational-systems.md), [Hub](pages/08-hub.md), and [skills source reference](../14-skills-and-frontend.md).

### 11. Repo, deployment, release, and maintenance

`prom_repo_ops` handles repository synchronization; deployment and Vercel actions remain configured/external-app capabilities. `self_update` and `self_repair` are maintenance/release capabilities, not normal arbitrary workspace tooling. They retain their own operational and approval boundaries. See [Operational systems](20-operational-systems.md) and the [public release reference](../18-public-release.md).

## Settings and first-run system

Settings is not a single preference form. It is the user’s control plane for model/provider credentials, project/workspace selection, connection and plugin management, browser/desktop/voice behavior, automation/system controls, onboarding/migration, and operational status. A setting can be saved yet still be unusable until a provider validates, an OAuth callback completes, a local binary is installed, a device is paired, or a permission is granted.

First-run onboarding is a staged, account-scoped system: tutorial, optional migration, model health/setup, meet-and-greet, then previewed/approved memory seed. Replaying a tutorial, running a dev test, and redoing onboarding have intentionally different effects; redo is gated because it deletes onboarding-owned state. Read [Settings, plugins, and connectors](18-settings-plugins-connectors.md), [Configuration and projects](pages/09-configuration-and-projects.md), and [onboarding source reference](../19-onboarding-system.md).

## How to use this manual without guessing

1. Start with the page reference for the screen you are looking at.
2. Follow its linked system reference when a control starts work elsewhere (for example a task opening a managed process, a Connector button opening OAuth, or a Goal becoming a continuation).
3. Use [11](11-static-tool-capability-index.md) for the exact on-demand tool, [12](12-bundled-connector-tool-index.md) for connected-app tools, or [13](13-browser-and-desktop-tool-index.md) for browser/desktop actions.
4. Treat anything marked configured, conditional, approval-gated, or internal as a real availability constraint.

## Source map

`src/gateway/`, `src/runtime/`, `src/tools/`, `src/connections/`, `src/extensions/`, `src/config/`, `src/auth/`, `web-ui/src/pages/`, `web-ui/src/onboarding/`, `native/`, and the linked `workspace/self/` references.
