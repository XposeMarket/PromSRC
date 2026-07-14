# SELF — Prometheus Self-Reference (Split Index)

Last verified against `src/`, `web-ui/`, route/tool definitions, batch read/patchset file tools, web search/fetch/batch-fetch tool definitions, dev-source verification profiles/auto-narrow `prom_apply_dev_changes verify_only`, config defaults, command policy/approval surfaces, current package metadata, provider-aware context budgeting, rolling/mid-workflow compaction, tool observation injection, Brain runner skill-curator behavior, Hub/chat context UI, voice-agent/mobile dictation routing/direct voice tool wrappers, OpenAI/xAI realtime voice integration, mobile Realtime camera snapshot/video-frame capture and visual input handling, mobile camera-roll video attachments, the desktop web UI source/generated route/component surface, the Prometheus Mobile PWA/gateway route surface, and channel completion notification bridge wiring on: 2026-06-05
Workspace: `D:\Prometheus\workspace`
Project root: `D:\Prometheus`

This directory is a split copy of root `SELF.md` — the same source-verified architecture reference, broken into per-area files so Prometheus can read and edit individual sections without churning the full document. In the current tool/runtime view the split directory is `self/` and the monolithic file is `SELF.md`; older wording that says `workspace/self/` or `workspace/SELF.md` refers to the same workspace-root material, not a separate second copy.

## How to read

- Start here, then jump to the file that matches the area you're working on.
- Anchors/section numbers from the original `SELF.md` are preserved at the top of every file.
- Creative-mode coverage is large enough to live in its own subfolder under `creative/`.

## Section → file map

| § | Area | File |
|---|------|------|
| 1 | Core Identity | [01-identity.md](01-identity.md) |
| 2, 3, 3A, 3B | Startup, Runtime Surfaces, Auth Gate, Mobile Pairing/HTTPS/Tailscale | [02-startup-runtime.md](02-startup-runtime.md) |
| 4, 5 | Execution Modes, Prompt Assembly | [03-execution-and-prompting.md](03-execution-and-prompting.md) |
| 6 | Creative Modes (overview) | [creative/00-overview.md](creative/00-overview.md) |
| 6A | Creative Runtime and Scene Graph | [creative/01-runtime-scene-graph.md](creative/01-runtime-scene-graph.md) |
| 6B | Creative Assets, Uploads, Media Intake | [creative/02-assets-uploads.md](creative/02-assets-uploads.md) |
| 6C | Creative Video and Editing | [creative/03-video-editing.md](creative/03-video-editing.md) |
| 6D | HTML Motion and HyperFrames | [creative/04-html-motion-hyperframes.md](creative/04-html-motion-hyperframes.md) |
| 6D-1 | Creative Generative Pipeline + 2026-05-20 self-edit notes | [creative/05-generative-pipeline.md](creative/05-generative-pipeline.md) |
| 6E | HTML Motion Templates | [creative/06-motion-templates.md](creative/06-motion-templates.md) |
| 6F | HTML Motion Blocks | [creative/07-motion-blocks.md](creative/07-motion-blocks.md) |
| 6G | Remotion Motion Templates | [creative/08-remotion-templates.md](creative/08-remotion-templates.md) |
| 6H | Premium Editable Creative Templates | [creative/09-premium-templates.md](creative/09-premium-templates.md) |
| 6I | Creative QA Rules | [creative/10-qa-rules.md](creative/10-qa-rules.md) |
| 7, 8, 9 | Browser Modes, Teach/Copilot UI, Observation/Vision | [04-browser.md](04-browser.md) |
| 10, 11 | Tool Architecture, Web/Media tools | [05-tools.md](05-tools.md) |
| 12, 12A | OpenAI Image Gen + Creative Media Config, Voice/Realtime | [06-image-voice.md](06-image-voice.md) |
| 13, 13A, 14, 15, 15A, 15B | Source Editing, Coding API, Proposals, Self-Edit Sandbox, Fast Dev Source Edit Approvals, Dev-Live Self-Edits | [07-source-editing.md](07-source-editing.md) |
| 16, 17, 18, 19 | Tasks/Background, Subagents/Teams/Coordinator, Spawn Strategy, Deploy Analysis | [08-tasks-and-agents.md](08-tasks-and-agents.md) |
| 20, 21 | Providers, Model Configuration | [09-providers-and-models.md](09-providers-and-models.md) |
| 22, 23 | MCP, Connections (incl. X/xAI shared OAuth) | [10-mcp-and-connections.md](10-mcp-and-connections.md) |
| 24, 24A | Terminal Command/Approval, Managed Process Supervisor | [11-run-and-supervisor.md](11-run-and-supervisor.md) |
| 25, 25A, 25B | Telegram/Channels, Brain Runner, Skill Gardener | [12-telegram-and-brain.md](12-telegram-and-brain.md) |
| 26, 27 | Memory Files/Search, Memory Index Layers | [13-memory.md](13-memory.md) |
| 28, 28A, 28B | Bundled Skills, Hub/Frontend Views, Onboarding/Migration | [14-skills-and-frontend.md](14-skills-and-frontend.md) |
| 29, 30, 31 | Data Paths, Sharp Edges, Maintenance Rule | [15-paths-and-sharp-edges.md](15-paths-and-sharp-edges.md) |
| 32 | Prometheus Mobile App Maintenance Reference | [16-mobile-app.md](16-mobile-app.md) |
| 32A | Mobile Liquid Glass UI Reference and Dev Slider Restore Notes | [24-mobile-liquid-glass.md](24-mobile-liquid-glass.md) |
| 33 | Desktop Web UI Maintenance Reference | [17-desktop-web-ui.md](17-desktop-web-ui.md) |
| — | Local UI URLs, `?desktop=1`, self-edit live verification | [17-local-ui-verification.md](17-local-ui-verification.md) |
| 34 | Public Release and Self-Update Operations | [18-public-release.md](18-public-release.md) |
| 35 | Onboarding System, Replay, Dev Test, Migration Boundary | [19-onboarding-system.md](19-onboarding-system.md) |
| 36 | Rich Chat Artifacts (cards), Data Tools, Voice Integration | [20-rich-artifacts.md](20-rich-artifacts.md) |
| 37 | Runtime Prompt Map (all agent surfaces, files, overlaps) | [21-runtime-prompt-map.md](21-runtime-prompt-map.md) |
| 38 | Runtime Prompt Verbatim Inventory (literal strings + injection map) | [22-runtime-prompt-verbatim.md](22-runtime-prompt-verbatim.md) |
| 39 | Runtime Context Build Pipeline (assembly order, block by block) | [23-runtime-context-flow.md](23-runtime-context-flow.md) |
| 40 | Runtime Instruction Census (verified injection ownership, costs, overlaps, role matrix) | [26-runtime-instruction-census.md](26-runtime-instruction-census.md) |
| 41 | Stage 4 Tool-Menu Trigger Benchmark (deterministic triggers, rollback, savings, test corpus) | [27-stage4-tool-menu-trigger-benchmark.md](27-stage4-tool-menu-trigger-benchmark.md) |
| 42 | Stage 5 Deterministic Skill Routing (inventory, relevance decisions, discovery, rollback, benchmark) | [28-deterministic-skill-routing.md](28-deterministic-skill-routing.md) |
| 43 | Canonical Agent Identity and Memory Runtime (main, manager, standalone/team agents, compatibility) | [29-agent-identity-and-memory-runtime.md](29-agent-identity-and-memory-runtime.md) |
| Feature Index | Product/feature catalog for copy, launch posts, onboarding, and capability lookup | [feature-index/README.md](feature-index/README.md) |

Voice-only memory lives at `workspace/VOICEAGENT.md`. It is injected into Realtime voice-agent context for routing and spoken behavior notes without loading those notes into the main worker prompt.

> CRITICAL realtime gotchas (OpenAI/xAI mobile voice + visual input sharp edges — see §12A-CRITICAL, §12A-2, and §12A-3 of [06-image-voice.md](06-image-voice.md)):
> 1. AUTH/500: OpenAI Realtime 500s ("Internal Server Error") on Codex OAuth because the realtime CALL endpoint needs a real platform api_key (raw OAuth bearer gets 403 on `/v1/models`). The api_key is minted by exchanging the OAuth **id_token**, which needs an `organization_id` claim — only on a FRESH LOGIN that does NOT send `codex_cli_simplified_flow=true` in `startOAuthFlow`. Working logs show `auth: 'openai_codex_oauth_api_key'`.
> 2. NO INPUT (after auth fixed): session connects + soundwaves animate but no transcription/audio because the OpenAI WebRTC path did its OWN `getUserMedia` — a SECOND iOS mic capture that comes back silent. Fix: reuse the shared warm mic (`_ensureMobileXaiRealtimeMic()`/`__pmVoice.warmMicStream`) like xAI does; never open a second concurrent `getUserMedia` on iOS.
> 3. VISUAL INPUTS (mobile Realtime): camera photos/videos are in-app captures, not native saved photos. OpenAI Realtime visual context must be sent as `conversation.item.create` user messages with `input_image` content parts (`image_url` data URLs plus `detail: "auto"`), aggressively downscaled to fit mobile Safari/WebRTC data-channel limits. Voice-camera captures are staged in the chat bubble and flushed to the next spoken PTT/always-listening turn, or to the typed chat send path when the user types after taking a photo.

## Operational Runbooks

- Public runtime and installer dependency hardening: [public-runtime-release/README.md](public-runtime-release/README.md)
- Owner-approved public release and self-update flow: [18-public-release.md](18-public-release.md)

## Maintenance

When editing, change only the file that owns the affected section. Keep root `SELF.md` in sync as the monolithic historical source-of-truth and sync target, unless this split copy is formally promoted to primary later. Follow §31 Maintenance Rule: verify against actual source files before updating.

## Workspace persona files (USER / SOUL / MEMORY)

- **SOUL.md** (2026-07-07 slim): persona, conversational turns, action-first, owner authority, memory routing, light pointers only. Operational runbooks → **MEMORY.md** `operational_rules`, **skills**, and section files above.
- **USER.md** (2026-07-07 slim): identity, communication_style, projects only — internals → MEMORY, skills, **self/13-memory.md**.
- **MEMORY.md**: durable history, decisions, migrated runbooks, operational rules.
