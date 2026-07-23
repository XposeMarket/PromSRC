# Prometheus: Complete Product Catalog

Last source verification: 2026-07-22.

## What Prometheus is

Prometheus is a persistent, local-first AI operator workspace. A single conversation can plan and execute work, use tools, create files and rich artifacts, operate web or desktop surfaces, delegate to agents, remember durable context, and continue through schedules, timers, background work, and approved automation. The desktop web UI, Electron desktop shell, mobile PWA, CLI, messaging channels, and gateway all use the same product runtime rather than being separate products.

The useful document-level framing is: **one durable operational workspace, many controlled ways to act.** It is not merely a chat UI, browser automator, or creative editor.

## Capability map

| Family | What a person can do | Primary surfaces | Availability |
|---|---|---|---|
| Conversational work | Start, search, fork, rename, edit/rerun, and stream persistent work threads; attach files; receive artifacts, progress, goals, approvals, and agent traces | Desktop Chat, Mobile Chat, channels, CLI | Built in |
| Plans and goals | Maintain a visible main goal, steps, status, and continuity across a working thread | Chat, background work, agents | Built in |
| Files and coding | Read, search, create, patch, validate, test, format, run, inspect Git, and present workspace files; use an approval-aware Prometheus-source edit lane | Chat tools, Projects, proposals | Built in; writes/publishing can be approval-gated |
| Web research and browser work | Search/fetch the web, operate a browser, inspect page text/DOM/screenshots, download, fill forms, run controlled JS, and teach reusable workflows | Chat browser canvas, tool menu | Browser host/session required; risky actions are conditional |
| Desktop computer use | Observe and control Windows apps/windows, accessibility, clipboard, macros, screenshots, and isolated background desktop work | Tool menu | Windows/native helper required; host interaction is conditional |
| Creative production | Build projects and scenes; ingest media; generate and edit image/video/audio; compose timelines; use templates, HTML motion, HyperFrames, and quality checks | Desktop Creative workspace and chat; focused mobile renderer is present but currently not routed as its own page | Providers/assets/local render dependencies vary |
| Agents and teams | Create persistent subagents, chat with them, assign model/skills/context/heartbeat, group them into managed teams, dispatch and review work | Subagents, Teams, Tasks, chat | Built in; model/provider configuration required to run |
| Background and automation | Spawn independent work, pause/resume/steer/recover it, create watches, timers, recurring or one-shot schedules, and heartbeat routines | Tasks, Schedule, chat | Built in; action policy/approval may apply |
| Memory and business context | Search a file-backed/indexed memory system, view graph/timeline/related records, review claims, manage entities and evidence | Memory, Hub, chat tools | Built in; embedding/provider capabilities vary |
| Integrations and channels | Use MCP servers and configured connectors; interact through Telegram and other configured channels; pair a mobile device; send notifications/webhooks | Connections, Settings, mobile, chat | Configured |
| Voice | Dictation, TTS/STT, mobile voice agent, realtime voice, camera/visual voice inputs, interruption and wake controls | Mobile Voice, Chat, APIs | Provider/browser/device dependent |
| Administration | Set provider/model defaults, credentials, security/approvals, paths, features, hooks, heartbeat, remote access, lifecycle, and installed-app aliases | Settings, Connections, CLI | Admin/operator access |
| Self-improvement | Run Brain Thought/Dream loops, inspect pulse cards, curate skills, make proposal-gated evolution suggestions | Hub, Brain routes, proposals | Internal/operator; model configured |

## Product surfaces

### Desktop web application

The primary workstation has nine routed page modes: Chat, Tasks, Schedule, Teams, Subagents, Proposals, Audit Log, Memory Graph, and Hub. A shared Settings modal and Connections page extend it. The Chat page can become a message stream, file/canvas workspace, in-app browser, approval queue, process monitor, voice surface, artifact renderer, or creative workspace based on the current work.

### Desktop application

Electron packages the same product web UI into a desktop shell and provides the desktop trust boundary/integration points. It is not a separate feature catalog: page behavior is owned by `web-ui/`, while native helpers enable host-specific desktop capability.

### Mobile PWA

The paired mobile client has dedicated Chat, Voice, Tasks, Hub, Schedule, Teams, Subagents, Proposals, More, and Settings flows. A focused Creative renderer exists in the bundle, but the current router aliases `creative` to Hub rather than exposing it as a standalone route; documents must not present it as a current navigation destination. It is a true paired gateway client with device-token authorization, chat-stream recovery and push support—not just a responsive desktop page. Details and current parity boundaries are in [04-mobile-app.md](04-mobile-app.md).

### Channels, CLI, and webhooks

The gateway supports cross-channel sessions and broadcaster events. The built-in channel architecture covers the desktop UI, mobile, CLI and configured Telegram/Discord/WhatsApp-style paths; current configured channels determine what is actually usable. The CLI provides onboarding, gateway lifecycle, jobs, models, diagnostics, and updates. Webhooks can wake or invoke the system where configured.

## Work modes

Prometheus has more than one way to execute a request:

- **Interactive main chat** is the foreground, user-steered work lane with streaming tools, progress, approval cards, and session history.
- **Side chats** branch an investigation or drafting tangent from a parent without implicitly continuing its plan, edits, approvals, or tools.
- **Browser agent / copilot / teach** add an in-chat browser canvas. Teach records a workflow, asks for verification boundaries, and can recommend—not silently create—a reusable skill or composite.
- **Background tasks** are independent long-running lanes with evidence, progress, messages, lifecycle controls, and a join path back to the parent thread.
- **Persistent subagents and managed teams** provide named workspaces, task runs, chat, memory, models, schedules, heartbeats, coordination, and manager review.
- **Schedule, timer, heartbeat, and internal watch** provide different kinds of deferred continuation. A timer is a later user-like event in a chat; a schedule is a one-shot/recurring job; heartbeat is an agent continuation policy; a watch wakes a normal turn when a bounded condition matches.
- **Voice and realtime** are dedicated routing paths designed for spoken interaction and, on mobile, visual context. They do not simply reuse every main-chat capability.

## Trust, safety, and truth in product copy

Prometheus exposes meaningful actions, so its boundaries are part of the product:

- Tool use can be scoped by category and dynamically requested rather than loaded indiscriminately.
- Commands, file/source writes, desktop/browser actions, external sends, deployments, and proposal execution can require approval or an explicit action policy.
- Source editing separates the user's workspace from Prometheus's own source and has a dedicated approval/verification path.
- Connected apps, MCP servers, credentials, provider models, mobile remote access, and desktop helpers are configured surfaces; list them as integrations, not automatic defaults.
- Background/agent work produces inspectable status, logs/evidence, recovery paths, and audit history; a completed run is treated as historical rather than silently reopened.
- Browser and external content are untrusted inputs. Generated product documents must not claim automatic authorization, unrestricted remote access, or universal provider support.

## Ready-to-use positioning lines

- “Prometheus turns a chat into a durable operating workspace: you can plan, execute, inspect, approve, delegate, and continue the work from one system.”
- “Use the same project from desktop, a paired mobile PWA, configured channels, or the CLI—while the gateway keeps the work, context, and controls connected.”
- “Automation is deliberate: timers, schedules, heartbeat, background agents, and internal watches each have a different continuation model and safety boundary.”
- “Creative work is first-class: media intake, generation, timelines, HTML motion, templates, rendering, and QA live alongside the operational tools.”

Avoid: “works with every app,” “fully autonomous,” “all tools are always enabled,” or “mobile has identical desktop controls.”

## Deep implementation references

- Identity/startup/execution: `../01-identity.md`, `../02-startup-runtime.md`, `../03-execution-and-prompting.md`
- Browser/tools/media: `../04-browser.md`, `../05-tools.md`, `../06-image-voice.md`
- Agents/source/memory: `../07-source-editing.md`, `../08-tasks-and-agents.md`, `../13-memory.md`
- Providers/connections/runtime: `../09-providers-and-models.md`, `../10-mcp-and-connections.md`, `../11-run-and-supervisor.md`
- Product clients: `../16-mobile-app.md`, `../17-desktop-web-ui.md`, `../20-rich-artifacts.md`
