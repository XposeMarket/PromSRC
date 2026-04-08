# Runtime Context Architecture Index

## Overview
This document maps the complete layered instruction + memory system that builds context for each message. The system prioritizes: **System Prompt > Developer Instructions > User Memory > Conversation History > Current Message**.

---

## LAYER 1: Core System Instructions

### Main System Prompt
**File:** `chat.router.ts`
- **Line 1086** — Primary role: 'system' message ("You are Prom...") sent each turn

---

## LAYER 2: Developer/Runtime Instructions

### Execution Mode & Personality Context
**File:** `chat.router.ts`
- **Line 1056** — `buildExecutionModeSystemBlock()` — Builds background/cron/heartbeat runtime behavior rules
- **Line 1079** — Builds response-style runtime rule text
- **Line 1031** — `buildPersonalityContext()` call — Constructs injected runtime instruction context

**File:** `prompt-context.ts`
- **Line 286** — `buildPersonalityContext()` function — Assembles runtime instruction blocks
- **Line 217** — `TOOL_BLOCKS` text — Tool usage instructions for runtime injection
- **Line 385** — Injects `[TOOLS]` block into context payload

### Tool Definitions & Schemas
**File:** `tool-builder.ts`
- Imports and assembles all tool definitions (agent-team, file-web-memory, cis-system, browser, desktop, MCP)

**Files:**
- `tools/defs/agent-team-schedule.ts` — `start_task`, `task_control`, `declare_plan`, `team_manage`, `schedule_job`, `spawn_subagent`
- `tools/defs/file-web-memory.ts` — `list_files`, `read_file`, `web_search`, `memory_write`, `write_note`
- `tools/defs/cis-system.ts` — `deploy_analysis_team`, `social_intel`, `gateway_restart`, `write_proposal`

---

## LAYER 3: Session History & Conversation Context

### Loading Previous Messages
**File:** `chat.router.ts`
- **Line 456** — `getHistoryForApiCall(sessionId, 5)` — Loads prior session history for this turn
- **Line 1098** — Loop over history; push each prior user/assistant turn into messages payload
- **Line 1101** — Appends current user message last

### History Retrieval & Trimming
**File:** `session.ts`
- **Line 336** — `getHistory()` — Returns last N turns (maxTurns × 2 messages)
- **Line 343** — `getHistoryForApiCall()` — Prunes long assistant messages before sending to model
- **Line 41** — Prune constants definition

### Storing Messages (for next turn)
**File:** `chat.router.ts`
- **Line 3915** — Adds incoming user message to history
- **Line 3985** — Adds assistant reply to history

---

## LAYER 4: Memory, Compaction, & Context Management

### Core Compaction Engine
**File:** `session.ts`
- **Line 25** — `pendingMemoryFlush`, `pendingCompaction` — Session state flags
- **Line 31** — `PRE_COMPACTION_MEMORY_FLUSH_PROMPT` — Memory flush prompt template
- **Line 40** — `PRE_COMPACTION_SUMMARY_PROMPT` — Compaction summary prompt template

### Token Estimation & Thresholds (Ollama-aware)
**File:** `session.ts`
- **Line 66** — `resolveNumCtx()` — Resolves LLM context window size from llm.num_ctx / environment
- **Line 85** — `estimateMessageTokens()` — Estimates token count per message
- **Line 97** — `resolveSessionPolicy()` — Determines maxMessages, compactionThreshold, memoryFlushThreshold

### Compaction Algorithm
**File:** `session.ts`
- **Line 133** — `compactHistoryWithSummary()` — Core compaction algorithm
- **Line 156** — Persists compaction summary to daily memory note

### Compaction/Memory Flush Injection Logic
**File:** `session.ts`
- **Line 238** — `addMessage()` entry point
- **Line 254** — Compaction trigger path
- **Line 276** — Memory flush trigger path
- **Line 305** — Applies compaction when assistant summary arrives
- **Line 321** — Returns compaction/memory flush result metadata

### Session Persistence & Lifecycle
**File:** `session.ts`
- **Line 193** — `getSession()` — Loads persisted session + flags
- **Line 357** — `clearHistory()` — Resets compaction flags
- **Line 367** — `cleanupSessions()` — Stale session cleanup
- **Line 417** — Debounced `saveSession()` — Persists session state

### Runtime Wiring (Chat Flow Integration)
**File:** `chat.router.ts`
- **Line 3915** — `addMessage(..., { deferOnMemoryFlush: true, deferOnCompaction: true })` — Entry point
- **Line 3916** — Compaction branch execution
- **Line 3919** — Internal compaction context message preparation
- **Line 3920** — `handleChat(compactionPrompt, ...)` — Runs compaction turn
- **Line 3929** — Stores compaction result as assistant message
- **Line 3940** — Memory flush branch execution
- **Line 3943** — Internal memory-flush context message preparation
- **Line 3944** — `handleChat(memoryFlushPrompt, ...)` — Runs memory flush turn
- **Line 3953** — Stores flush result as assistant message
- **Line 3939** — Re-adds original user message (after compaction)
- **Line 3963** — Re-adds original user message (after memory flush)

### Configuration Tuning
**File:** `config.ts`
- **Line 176** — Session block
- **Line 177** — `maxMessages` — Max messages kept in context
- **Line 178** — `compactionThreshold` — Token threshold for triggering compaction
- **Line 179** — `memoryFlushThreshold` — Token threshold for triggering memory flush

---

## LAYER 5: User Memory, Preferences & Identity

**Files (Injected per-user):**
- `USER.md` — About you, preferences, identity
- `SOUL.md` — Operating principles/persona
- `BUSINESS.md` — Business context

**Note:** These are typically injected as context text (sometimes truncated in display, but still part of runtime context).

---

## LAYER 6: Background Task System

### Task Store & State Management
**File:** `task-store.ts`
- **Line 46** — `TaskStatus` enum — Includes: queued, running, paused, stalled, needs_assistance, awaiting_user_input, complete, failed, waiting_subagent
- **Line 94** — `TaskRuntimeProgressState` — Runtime progress tracking
- **Line 124** — `TaskRecord` — Full task: plan, currentStepIndex, runtimeProgress, finalSummary
- **Line 277** — `createTask()` — Creates new background task
- **Line 436** — `updateTaskRuntimeProgress()` — Updates progress state
- **Line 478** — `mutatePlan()` — Modifies task plan mid-execution
- **Line 661** — `loadEvidenceBus()` — Loads evidence/artifacts trail
- **Line 688** — `writeToEvidenceBus()` — Appends evidence entry
- **Line 735** — `formatEvidenceBusForPrompt()` — Formats evidence for AI context

### Background Task Runner
**File:** `background-task-runner.ts`
- **Line 133** — `BackgroundTaskRunner` class — Main orchestrator
- **Line 261** — `start()` — Begins task execution loop
- **Line 527** — `_runRoundWithRetry()` — Executes one task step with retry logic
- **Line 731** — Maps progress_state into task runtime progress
- **Line 845** — End-of-plan completion path
- **Line 869** — `callCompletionVerifier()` — Final summary logic
- **Line 1304** — `_attemptSelfHeal()` — Self-repair on failure
- **Line 1661** — `_pauseForClarification()` — awaiting_user_input flow
- **Line 1691** — `_pauseForAssistance()` — failure/needs-help flow
- **Line 1426** — Manager/worker orchestration events

### Task Control & Blocked Task Handling
**File:** `task-router.ts`
- **Line 37** — `initTaskRouter()` — Router initialization
- **Line 193** — `launchBackgroundTaskRunner()` — Spawns runner
- **Line 199** — `handleTaskControlAction()` — Pause/resume/control
- **Line 470** — `tryHandleBlockedTaskFollowup()` — Handles blocked task follow-ups

### Task API Routes
**File:** `tasks.router.ts`
- **Line 320** — `GET /api/bg-tasks` — List all tasks
- **Line 325** — `GET /api/bg-tasks/:id` — Get task details
- **Line 334** — `GET /api/bg-tasks/:id/evidence` — Get evidence bus
- **Line 359** — `POST /api/bg-tasks/:id/pause`
- **Line 376** — `POST /api/bg-tasks/:id/resume`
- **Line 403** — `POST /api/bg-tasks/:id/error-response`
- **Line 526** — `POST /api/bg-tasks/:id/message` — Send message to task
- **Line 549** — `GET /api/bg-tasks/:id/stream` — WebSocket stream
- **Line 587** — `scheduleTaskFollowup()` — Schedule follow-up

### Chat Integration Hooks
**File:** `chat.router.ts`
- **Line 1212** — Preflight branch into background-task path
- **Line 1320** — `createTask()` call
- **Line 1333** — `updateTaskRuntimeProgress()` call
- **Line 1344** — Emits progress_state
- **Line 1362** — Emits task_queued
- **Line 3406** — `declare_plan` handling

---

## LAYER 7: Secondary AI Advisors & System Prompts

### Self-Improvement & Analysis Prompts
**File:** `self-improvement-engine.ts`
- **Line 354** — Weekly insight-generation prompt builder
- **Line 530** — JSON-only performance analyst system callerContext

**File:** `prompt-mutation.ts`
- **Line 96** — Mutation-analysis prompt builder
- **Line 184** — JSON-only analysis system callerContext

**File:** `error-watchdog.ts`
- **Line 294** — Self-repair trigger prompt builder

**File:** `boot.ts`
- **Line 54** — Boot runtime prompt builder
- **Line 121** — Boot prompt execution

### Proposal Execution Prompts
**File:** `proposals.router.ts`
- **Line 93** — Builds rich proposal execution prompt
- **Line 101** — `[PROPOSAL EXECUTION]` prompt header

**File:** `tasks.router.ts`
- **Line 685** — Proposal auto-dispatch prompt builder
- **Line 693** — `[PROPOSAL EXECUTION]` prompt header

### Secondary Advisor System Prompts (Centralized)
**File:** `secondary-calls.ts`
- **Line 102** — `RESCUE_ADVISOR_SYSTEM` — Emergency recovery advisor
- **Line 130** — `PLANNER_ADVISOR_SYSTEM` — Task planning advisor
- **Line 161** — `BROWSER_ADVISOR_SYSTEM` — Web navigation advisor
- **Line 278** — `DESKTOP_ADVISOR_SYSTEM` — Desktop tool advisor
- **Line 317** — `FILE_ANALYZER_SYSTEM` — File analysis advisor
- **Line 334** — `FILE_VERIFIER_SYSTEM` — File verification advisor
- **Line 363** — `FILE_PATCH_PLANNER_SYSTEM` — Patch planning advisor
- **Line 394** — `FILE_OP_CLASSIFIER_SYSTEM` — File operation classifier
- **Line 1780** — `TASK_STEP_AUDITOR_SYSTEM` — Task step auditor

---

## LAYER 8: Communication & Channels (Telegram)

### Telegram Channel Integration
**File:** `src/gateway/comms/telegram-channel.ts`
- **Lines:** 2, 4, 8, 11, 12, 16, 27, 59, 108, 127, 149, 179, 181–183, 200, 208, 218, 226, 241, 243, 257, 260, 287, 291, 313, 316, 323, 342, 392, 419, 431, 435, 439, 445, 581, 623, 673, 711, 991, 993, 1853, 1854, 1966, 1974, 1978, 1979, 2112, 2117, 2284, 2293, 2305, 2416, 2515, 2524, 2525, 2645, 2673, 2678, 2680, 2698, 2702, 2704, 2711, 2713, 2722, 2728, 2841, 2846, 2869

### Channel Management & Broadcasting
**File:** `src/gateway/comms/broadcaster.ts`
- **Lines:** 6, 41, 68, 78, 113, 115, 177–179, 184, 189, 193, 282, 287

**File:** `src/gateway/routes/channels.router.ts`
- **Lines:** 2, 5, 20, 27, 31, 37–38, 40, 84, 89–93, 121, 127, 132, 135, 138, 143, 154–156, 182, 184, 321

**File:** `src/gateway/comms/webhook-handler.ts`
- **Lines:** 46, 356, 358–361

### Startup & Server Integration
**File:** `src/gateway/core/startup.ts`
- **Lines:** 64, 75, 188, 190, 241, 255, 260, 268, 282, 284, 287, 291, 293–294, 297–298, 301–302, 306, 368, 379–380, 385–386, 392

**File:** `src/gateway/core/server.ts`
- **Line:** 50

**File:** `src/gateway/server-v2.ts`
- **Lines:** 65, 121, 123–124, 218, 325, 344, 355, 359, 377, 379–380, 389, 450, 476–477, 479, 485, 521, 535

---

## LAYER 9: Task UI & Progress Rendering

### Backend Progress Tracking
**File:** `chat.router.ts`
- **Line 1302–1408** — Progress state emission and tracking

### Frontend Task Page
**File:** `web-ui/src/pages/TasksPage.js`
- **Line 73** — Status columns (queue, failure, etc.)
- **Line 106** — `refreshBgTasks()` — Fetch latest tasks
- **Line 224** — `openBgtPanel()` — Open task detail panel
- **Line 332** — Final summary render
- **Line 354** — Progress/checklist render
- **Line 376** — Evidence bus render
- **Line 427** — Pause/resume actions
- **Line 442** — Reply/assistance submit
- **Line 529** — Load evidence entries
- **Line 618** — Error-response panel
- **Line 910** — WebSocket event subscriptions
- **Line 956** — `task_panel_update` live refresh
- **Line 974** — `task_evidence_update` handler

### Main Chat Progress Panel
**File:** `web-ui/src/pages/ChatPage.js`
- **Line 820** — `renderProgressPanel()` — Embedded progress display
- **Line 790** — `getTaskProgressItems()` — Format progress for inline display
- **Line 1259** — Handles progress_state stream updates

### API Constants
**File:** `web-ui/src/api.js`
- **Line 39** — Task-related API endpoint definitions

---

## LAYER 10: Additional Integrations

### Sub-Agent Execution & Management
**File:** `src/gateway/agents-runtime/subagent-executor.ts`
- **Lines:** 59, 79, 455–459, 469, 475, 479, 482–483, 486, 848, 1393–1396, 1831–1834

**File:** `src/gateway/agents-runtime/subagent-manager.ts`
- **Lines:** 88, 94, 99, 185

### Scheduling & Cron
**File:** `src/gateway/scheduling/cron-scheduler.ts`
- **Lines:** 10, 50, 152–160, 162, 182, 745–749

### Desktop & Browser Tools
**File:** `src/gateway/desktop-tools.ts`
- **Lines:** 741, 745, 747, 750, 753–754, 768, 773, 775, 1433, 1437–1438

**File:** `src/gateway/browser-tools.ts`
- **Lines:** 1963, 1978

### Team Management
**File:** `src/gateway/teams/managed-teams.ts`
- **Lines:** 157, 865, 889–890

### Goals & Decomposition
**File:** `src/gateway/goal-decomposer.ts`
- **Line:** 12

**File:** `src/gateway/routes/goals.router.ts`
- **Lines:** 25, 31, 36, 70, 90–91, 96, 100, 102, 140, 264

### Configuration & Types
**File:** `src/config/config.ts`
- **Lines:** 182, 296, 380–383, 392

**File:** `src/config/config-schema.ts`
- **Lines:** 101, 168, 267–271

**File:** `src/types.ts`
- **Lines:** 204–205, 208, 305, 312

---

## Context Priority Matrix

When conflicts occur, context is resolved in this order:

1. **System Prompt** (highest) — Platform core safety rules + role definition
2. **Developer Instructions** — Runtime rules, tool definitions, execution mode
3. **User Memory** — USER.md, SOUL.md, BUSINESS.md (per-user context)
4. **Session History** — Previous conversation turns (with compaction)
5. **Current Message** — Newest user prompt (lowest, appended last)

---

## Token Management Summary

- **Estimation:** `estimateMessageTokens()` at `session.ts:85`
- **Thresholds:** `resolveSessionPolicy()` at `session.ts:97`
- **Compaction Trigger:** When tokens exceed `compactionThreshold`
- **Memory Flush Trigger:** When tokens exceed `memoryFlushThreshold`
- **Pruning:** `getHistoryForApiCall()` trims long assistant messages at `session.ts:343`

---

## Quick Reference: Find Files By Feature

| Feature | Primary File | Key Lines |
|---------|--------------|-----------|
| System Prompt | chat.router.ts | 1086 |
| Tool Definitions | tool-builder.ts | All |
| History Management | session.ts | 193–417 |
| Compaction | session.ts | 133–321 |
| Background Tasks | task-store.ts, background-task-runner.ts | 46–1691 |
| Task UI | TasksPage.js, ChatPage.js | 73–1259 |
| Secondary Advisors | secondary-calls.ts | 102–1780 |
| Telegram | telegram-channel.ts | 2–2869 |
| Configuration | config.ts | 176–179 |

