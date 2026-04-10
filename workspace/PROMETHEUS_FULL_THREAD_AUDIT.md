# Prometheus Full Thread Audit (Top-to-Bottom)

Date: 2026-04-02  
Workspace: `D:\Prometheus`

This document consolidates everything analyzed and reported in this thread, from initial Prometheus deep-dive requests through the business/CIS and main chat visuals system assessment.

---

## 1) Scope Requested

You asked for a full deep dive into Prometheus, including:

- core architecture and main agent behavior
- model switching/model selection
- background agents/tasks, plans, scheduled plans
- teams/manager/coordinator/subagents
- channels, projects, skills, memory/notes, self-improvement
- connectors/OAuth/providers/API key flows
- canvas, audit, CLI terminal, web UI, keyboard shortcuts
- CIS/business side properly analyzed
- main chat visuals system (Claude-code-like), with workspace skill references

---

## 2) What Was Inspected

### Workspace / docs / operating memory

- `workspace/SELF.md`
- `workspace/TOOLS.md`
- `workspace/AGENTS.md`
- `workspace/BUSINESS.md`
- `workspace/entities/**`
- `workspace/integrations/**`
- `workspace/events/pending.json`
- `workspace/skills/**` (including visual-related skills)

### Gateway/runtime code paths

- `src/gateway/routes/chat.router.ts`
- `src/gateway/chat/chat-helpers.ts`
- `src/gateway/agents-runtime/subagent-executor.ts`
- `src/gateway/tool-builder.ts`
- `src/gateway/tools/defs/cis-system.ts`
- `src/gateway/core/startup.ts`
- `src/gateway/prompt-context.ts`

### CIS/business-related subsystems

- `src/gateway/conversation-learning.ts`
- `src/gateway/projects/project-learning.ts`
- `src/gateway/policy.ts`
- `src/gateway/audit-log.ts`
- `src/gateway/routes/audit-log.router.ts`
- `src/gateway/routes/connections.router.ts`
- `src/integrations/oauth-base.ts`
- `src/integrations/connector-registry.ts`
- connector implementations (`gmail`, `slack`, `github`, `notion`, `reddit`, `google-drive`)
- `src/gateway/scheduling/self-improvement-engine.ts`
- `src/gateway/proposals/self-improvement-api.ts`

### UI (main chat visuals + operations pages)

- `web-ui/index.html`
- `web-ui/src/pages/ChatPage.js`
- `web-ui/src/pages/ConnectionsPage.js`
- other page modules referenced by index (`AuditPage`, `ProposalsPage`, `TeamsPage`, `TasksPage`, `SchedulePage`, `SettingsPage`, `ProjectsPage`)

---

## 3) High-Level Outcome

Prometheus has a strong architecture and broad surface area, but the runtime currently shows **partial wiring** in key CIS/tooling areas.

Most important finding:

- Several CIS/team tools are **declared in tool schemas** and context docs but **not actually handled** by the active tool executor used by main chat (`subagent-executor.ts`).
- That creates runtime mismatch risk: the model can be offered tools that will return `Unknown tool`.

---

## 4) Business/CIS Deep-Dive Findings

## 4.1 Workspace business state (actual data readiness)

Current business memory appears mostly scaffold/template-level:

- `workspace/BUSINESS.md` exists but fields are mostly unfilled template placeholders.
- `workspace/entities/` has template files by type (`clients`, `projects`, `vendors`, `contacts`, `social`), but no meaningful populated entity records were found.
- `workspace/events/pending.json` exists and is effectively empty at rest.

Implication:

- Business intelligence can be structurally supported, but real business context persistence is currently thin unless manually populated or auto-learning paths are fully wired and exercised.

## 4.2 CIS tool definitions vs executable reality

`src/gateway/tools/defs/cis-system.ts` defines rich CIS/system tools, including:

- `ask_team_coordinator`
- `deploy_analysis_team`
- `social_intel`
- `webhook_manage`
- `mcp_server_manage`
- `integration_quick_setup`
- `switch_model`
- `write_proposal`
- `self_improve`
- `gateway_restart`
- `request_tool_category`
- skill tools (`skill_list`, `skill_read`, `skill_create`)

However, in `src/gateway/agents-runtime/subagent-executor.ts` (the active executor path for chat), verified handlers exist for:

- `ask_team_coordinator`
- `switch_model`
- `self_improve`
- `write_proposal`
- `mcp_server_manage`
- `gateway_restart`
- `request_tool_category`
- many other core and team/agent tools

But no executable handlers were found for several tools declared in schema, notably:

- `deploy_analysis_team`
- `social_intel`
- `webhook_manage`
- `integration_quick_setup`
- also team-bridge tools declared in CIS definitions (`dispatch_team_agent`, `get_agent_result`, `post_to_team_chat`, `message_main_agent`, `reply_to_team`, `manage_team_goal`) were not found as direct handlers in the active executor path

Implication:

- The model/tool menu advertises more than runtime can execute in main chat today.
- This is the highest-impact consistency gap uncovered.

## 4.3 Analysis/social tools existence (non-executor path)

Concrete implementations exist in `src/tools`:

- `src/tools/deploy-analysis-team.ts` (`deploy_analysis_team` logic)
- `src/tools/social-scraper.ts` (`social_intel` logic, with API/scraping fallback tiers)

Startup wiring confirms dependency injection attempts:

- `src/gateway/core/startup.ts` injects deps for analysis team and social scraper.

But because main chat uses `subagent-executor.ts`, these `src/tools` implementations are not automatically available unless explicitly routed/integrated into that executor path.

## 4.4 Conversation/project learning reality

`src/gateway/conversation-learning.ts` exists with heuristics to write:

- `BUSINESS.md` sections
- entity files under `workspace/entities/*`

`src/gateway/projects/project-learning.ts` exists for project-context extraction to `workspace/projects/<id>/CONTEXT.md`.

Observed issue:

- In current runtime scans, explicit live invocation wiring for these learning routines was not found in active chat flow.

Implication:

- The learning engines are present, but evidence suggests they may not be fully active in current execution path.

## 4.5 Governance, policy, and audit

This stack is real and active:

- `src/gateway/policy.ts`: read/propose/commit style policy evaluation and risk scoring
- `src/gateway/audit-log.ts`: JSONL audit with secret scrubbing
- `src/gateway/routes/audit-log.router.ts`: query/filter endpoint for audit page

This is one of the most mature and operationally valuable CIS layers in current code.

## 4.6 Connectors/OAuth/CIS integrations

Connections infrastructure is substantial and wired:

- `src/gateway/routes/connections.router.ts` supports list/save/disconnect, OAuth start/poll, browser-open/browser-verify, and connector activity reads
- `src/integrations/oauth-base.ts` provides token lifecycle and vault-backed storage pattern
- `src/integrations/connector-registry.ts` initializes and routes connector OAuth flows
- Implemented connectors include Gmail, Slack, GitHub, Notion, Reddit, Google Drive

This area appears functionally robust relative to other CIS surfaces.

## 4.7 Self-improvement and performance intelligence

`self_improve` tooling is live and dispatches into:

- `src/gateway/proposals/self-improvement-api.ts`
- `src/gateway/scheduling/self-improvement-engine.ts`

Capabilities include performance summaries, schedule health, error summaries, changelog insights, pending proposal/skill-evolution visibility, and pattern retrieval.

---

## 5) Main Chat Visuals System (Claude-code-like) Findings

UI is advanced and intentionally built for agentic coding workflows.

## 5.1 Core chat execution UX

From `web-ui/src/pages/ChatPage.js`:

- SSE streaming of tokens
- process log entries for tool calls/results/status
- runtime progress checklist panel (`progress_state`)
- “thinking” rendering and incremental updates
- queued prompt system for chained user intents during active runs
- context pinning system (message-level pin to injected context)

## 5.2 Canvas system

Canvas supports:

- multi-tab editing
- code vs preview modes
- file presentation from workspace
- save/download flows
- session-persisted canvas file references
- context injection of canvas content
- drag/drop and upload integrations

This is strongly aligned with Claude-code-like “workbench” interaction.

## 5.3 Operations views available in UI

From `web-ui/index.html` and modular pages:

- Chat
- Tasks
- Schedule
- Teams
- Proposals
- Audit
- Connections panel
- Projects sidebar/page
- Skills manager
- Settings tabs (including models, heartbeat, integrations, shortcuts)

## 5.4 Keyboard shortcuts and interaction affordances

Verified patterns include:

- Chat input: `Enter` send, `Shift+Enter` newline
- Canvas editor save: `Ctrl+S` / `Cmd+S`
- settings panel includes shortcut management section

## 5.5 Visual skills ecosystem

Workspace has rich visualization skill routing and specializations:

- `interactive-visuals` router skill
- `chart-visualizer`
- `mermaid-diagrams`
- `html-interactive`
- `svg-diagrams`

This is well-designed for structured visual output selection based on request type.

---

## 6) Teams / Coordinator / Manager Findings

- `ask_team_coordinator` is implemented in executor and can launch coordinator sessions with team_ops pre-activation.
- Team manager facade and coordinator runtime are present with broad capability scaffolding.
- However, several direct team-bridge tool names exposed in CIS definitions were not found as direct handlers in main executor path, contributing to schema/runtime mismatch risk.

---

## 7) Model Picking / Switching Findings

- `switch_model` is implemented in executor and validates low/medium tier mapping from `agent_model_defaults`.
- Settings and config schema support robust model/provider management:
  - provider/model defaults
  - per-agent defaults
  - switch-model low/medium slots
  - coordinator model slot

---

## 8) Channels, CLI, and Runtime Operations

- CLI entry and gateway startup systems exist and are well-structured (`src/cli/index.ts`, `core/startup.ts`).
- Web UI and routes cover broad operational lifecycle needs.
- Telegram/channel integrations are extensive in codebase and docs, including proposal and repair workflows.

---

## 9) Docs vs Runtime Drift (Important)

Workspace docs are rich but partly stale against current runtime behavior.

Observed drift categories:

- tools described as available vs missing executor handlers
- learning/autowrite behaviors described as wired vs unclear live invocation in current path
- legacy references still present in places despite partial cleanup

Files reviewed for drift signals:

- `workspace/SELF.md`
- `workspace/TOOLS.md`
- `workspace/AGENTS.md`

---

## 10) Risk Summary

Highest risk:

1. **Tool schema/runtime mismatch** leading to `Unknown tool` failures in real sessions.
2. **Business memory underpopulation** (templates not populated) reducing true CIS value.
3. **Learning-path uncertainty** (conversation/project learning engines present but not clearly active in runtime path).

Lower risk (strong areas):

- policy/audit governance
- connectors/OAuth plumbing
- UI execution ergonomics (chat/process/progress/canvas)

---

## 11) Recommended Remediation Sequence

1. **Make tool contracts honest**
   - Either implement missing executor handlers for all declared CIS/team tools, or remove/hide undeployed tools from schema/tool-menu exposure.

2. **Wire existing CIS implementations into active executor path**
   - Route `deploy_analysis_team`, `social_intel`, `webhook_manage`, `integration_quick_setup` through `subagent-executor.ts` or equivalent active dispatch.

3. **Activate and verify business learning loop**
   - Ensure `conversation-learning.ts` and `project-learning.ts` are called in live chat flow.
   - Add explicit observability logs/events for learning writes.

4. **Populate BUSINESS/entities baseline**
   - Seed meaningful business profile data so CIS features have context to act on.

5. **Refresh docs to match runtime truth**
   - Update `SELF.md`, `TOOLS.md`, `AGENTS.md` so behavior guarantees are accurate.

---

## 12) Final Bottom Line

Prometheus is architecturally ambitious and already strong in governance, integration plumbing, and UI execution ergonomics.  
The main blocker to a truly reliable “everything AI/CIS” platform right now is consistency: the runtime executor does not yet fully match the capability surface advertised by docs/tool schemas.

Once schema/runtime parity and learning-path wiring are fixed, the business/CIS layer can move from “promising scaffold” to genuinely operational intelligence system.
