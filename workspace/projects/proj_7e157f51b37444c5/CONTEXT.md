# Prometheus Self Improving

> Last updated: 2026-03-27 04:00 UTC

> This file is automatically maintained by Prometheus as the living context for this project.
> It is injected into every chat session within this project.

## Overview

Prometheus Self Improving is now planning a new **Background Agents** capability: one-time, fire-and-forget agent executions (no persistent profile files) that run in parallel with the main chat flow. The core requirement is additive behavior that preserves current UX while enabling concurrent side work (for example, memory updates while coding continues).

## Goals
- Keep this project as the single planning hub for all new features, decisions, and priorities.
- Add Background Agents as a new optional primitive without breaking current direct-execution behavior.
- Support “spawn + continue + rejoin” flow where main chat can continue primary work and later merge background results into one final response.
- Ensure Background Agents are the same core model/runtime identity as main chat, but invoked as a separate LLM/API call with a task-scoped prompt.
- Enable scalable fan-out patterns (e.g., multiple one-off background tasks for parallel research/scraping) while maintaining deterministic status tracking.

## Key People & Entities
- Raul — project owner/planner and feature direction authority.
- Prometheus main chat agent — orchestrator that may spawn and reconcile background jobs.
- Background Agent execution unit (new concept) — ephemeral, no dedicated profile files, one-time execution.

## Tech Stack & Tools
- going to need proposals for this. this is going to be a dec  <!-- 2026-03-27 -->
- Anthropic  <!-- 2026-03-27 -->
- only adding this as a feature and not modifying the original  <!-- 2026-03-26 -->
- Additive-only rollout: keep current direct execution path as default; Background Agents are opt-in and invoked only when explicitly spawned. <!-- updated 2026-03-26 -->
- Clarify boundary vs start_task: start_task = long-running task workflow; Background Agent = one-shot ephemeral parallel LLM call with no profi

- Web UI frontend source path confirmed by Raul: `D:\Prometheus\web-ui` (for planned backend-parity access tooling and proposal-gated edits). <!-- 2026-03-27 -->
- Mermaid installed in project root (`D:\Prometheus`) via npm (`mermaid@11.13.0`) for diagram rendering and prompt/runtime visualizations. <!-- 2026-03-27 -->
## Issues & Bugs Fixed (2026-03-27)
- **Task UI/Backend desync on build failure (Anthropic-specific):** When proposal tasks ran `npm run build` and it failed, the UI marked the task as paused but the agent (Claude) continued executing actions self-healing the error and rerunning build. Root cause: `tool_result` SSE callback called `_pauseForAssistance()` but did not abort the LLM round, so agent kept executing in same request. **Fix:** Set `abortSignal.aborted = true` in the build failure guard to properly abort the round. This ensures UI and backend stay in sync. Proposal submitted: prop_1774582101345_19320b. <!-- 2026-03-27T03:27 UTC -->le files.
- Merge safety requirement: final response waits on explicit join policy (wait_all | wait_until_timeout | best_effort_merge) to prevent race conditions.
- Decision refinement: default join behavior should be wait_until_timeout (bounded wait) for better UX; include explicit notice for unfinished background jobs when timeout hits.
- Safety rule: background result ingestion must be idempotent (each background result merges once only).
- Product request added: proposal system should support editing/modifying pending (unapproved) proposals instead of requiring replacement proposals.
- Existing Prometheus task orchestration and agent runtime.
- New UX goal: main-agent replies must visually separate background outcomes into a dedicated panel/section instead of plain merged text.
- New observability goal: process log entries must carry explicit actor labels (Prom, Background Task, Background Agent).
- Existing memory file update mechanisms (USER.md / SOUL.md + memory_write flow).
- Existing code edit and proposal flow for source changes.
- New requirement: background-agent spawn/progress/result interface compatible with current task lifecycle UX.

## Timeline & Milestones
- New milestone: add proposal-edit capability for pending proposals (pre-approval only), with audit trail and immutable snapshot at approval time.
- Current milestone (in planning): define and propose architecture for Background Agents.
- New planning scope added: expose web-ui frontend code surface with backend-parity governance (read/search/list tools + proposal-gated edit tools).
- Priority order confirmed by Raul: implement/propose pending-proposal editing first, then revise/replace the Background Agents proposal with the agreed risk controls.
- Next milestone: implement source changes behind additive flow (no major behavior regression).
- Proposal refinement completed: Background Agents proposal was rewritten to restore fuller original product intent/detail (spawn + continue + rejoin, additive-only scope, canonical mixed-request workflow) while retaining strict risk controls (start_task boundary, join policies, idempotent merge-once, finalization gate).
- Validation milestone: confirm mixed prompts (memory update + code edits) complete with both outcomes in one final response.

## Notes
- Raul explicitly wants this to mirror Claude Code-style background agent behavior.
- Raul emphasized this must be mostly additive and must not disrupt the current flow that already works well.
- Canonical example: spawn background memory update task, continue code edits immediately, then collect background completion before final reply.
- Clarification (2026-03-26): Background Agents proposal must preserve the original detailed plan narrative and examples; risk controls should be additive inserts, not a rewrite of core product intent.