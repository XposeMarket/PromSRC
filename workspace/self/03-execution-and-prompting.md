## 4) Execution Modes

`chat.router.ts` currently recognizes these execution modes:

- `interactive`
- `background_task`
- `proposal_execution`
- `background_agent`
- `heartbeat`
- `cron`
- `team_manager`
- `team_subagent`

Important behavior:

- `interactive` is the only mode that reads the persisted session `creativeMode`
- Non-interactive modes use the scoped session workspace when present
- `background_agent` uses `bg_plan_declare` / `bg_plan_advance`
- `proposal_execution` gets stricter edit instructions and mutation scoping
- `team_manager` and `team_subagent` are separate runtime identities, not just labels
- `heartbeat` is intentionally terse and continuation-oriented

Subagent prompt isolation (2026-07-10): standalone/direct/background subagents and `team_subagent` runs share the normal runtime policy, tool-category, wrapper, and skill layers, but their file-backed identity is limited to `loadSubagentSoul()` plus the agent's canonical `AGENT.md`. They do not inherit main `USER.md`, `SOUL.md`, `MEMORY.md`, `BUSINESS.md`, intraday notes, project context, CIS context, or retrieved long-term memory. Caller/task/team context is still appended because it is the assignment, not main-chat memory. Provider/model switching must preserve this same isolated branch.

## 5) Prompt Assembly and Runtime Overlays

Prometheus currently builds the live prompt from these layers:

- execution-mode system block
- core system policy block
- recent tool observation block, except in creative mode
- caller context
- active browser/session context when relevant
- personality context from `buildPersonalityContext(...)`
- project context when the session is project-bound
- skills runtime directives

Recent tool context is no longer a raw "last 5 tool logs" dump in the main chat path. `chat.router.ts`, `boot.ts`, `main-chat-goals.ts`, and the Brain runner now prefer structured `[RECENT_TOOL_OBSERVATIONS]` generated from `src/gateway/tool-observations.ts`. The legacy `getRecentToolLog(...)` still exists in `session.ts` as a fallback when no observation records exist, but new tool results are persisted as observations and then budget-formatted for future turns.

Main-chat `/goal` mode is a persistent thread-scoped completion contract owned by Prometheus. `src/gateway/main-chat-goals.ts` persists the objective, lifecycle, continuation accounting, plans, evidence, restart checkpoints, and budgets; `startMainChatGoalRunner(...)` in `src/gateway/routes/chat.router.ts` schedules continuation only at safe turn boundaries. Goal turns still run through `runInteractiveTurn(...)`, so the same Prometheus runtime owns planning, execution, revision, testing, self-editing, restart recovery, and the final closeout. Normal code—not another LLM—decides whether to continue: the Goal must still be active, the thread must be idle, no newer user input may be queued, the budget must remain available, and the preceding turn must contain successful measurable tool progress. A turn with no measurable tool progress is paused instead of being allowed to spin.

Goal continuations receive a firm execution contract: do not ask the user for confirmation or next steps when existing context is sufficient; make reasonable in-scope assumptions; do not stop at a plan, partial implementation, build, or restart acknowledgement; and never expand permissions. Prometheus must use the dynamically injected `complete_goal` tool to attempt completion with acceptance criteria, evidence, tests, artifacts, and known limitations. Only that explicit completion attempt invokes the isolated completion verifier. Rejected evidence becomes focused continuation feedback; accepted evidence marks the Goal done. `block_goal` is reserved for genuine missing authority, credentials, essential user choices, unavailable external state, or hard policy boundaries after safe alternatives are exhausted. Pause, resume, clear, restart recovery, and budget-limited transitions remain deterministic system/user lifecycle controls.


Important current-turn boundary:

- current-turn tool results are still delivered through the normal active tool-execution flow so browser DOM refs, screenshots, approval waits, and other in-flight tool mechanics keep working as before
- the compact observation formatter affects what later turns receive as past context, plus what compaction receives as tool history
- future active-turn compression in `llm-primary.ts` would be a separate, more invasive change and is not part of the current implementation

Rolling and token-aware compaction are owned by `chat.router.ts`:

- `resolveRollingCompactionPolicy()` still reads the rolling compaction settings, but compaction is now also provider/context-budget aware
- `maybeRunRollingCompaction(...)` handles normal checkpoint compaction after the configured message count
- mid-workflow token-budget compaction uses the same compactor prompt path with strategy `mid_workflow_token_budget`
- compaction emits synthetic `context_compaction` tool-call/tool-result events so the web UI shows the pause/compaction/continue workflow like other tool/approval pauses
- the compactor prompt is isolated as `ContextCompactor` with no tools/persona chatter and produces a structured resume packet
- fallback summaries use the same section shape when the LLM compactor fails
- summaries are bounded by word count after generation through `boundCompactionSummaryWords(...)`

The current context compaction packet should preserve:

- primary request and intent
- key technical concepts
- files/code sections
- errors, fixes, and tests
- decisions and problem solving
- recent user messages
- pending tasks
- current work
- recovery artifacts
- exact "continue from here" instructions

Token estimation is approximate but model-aware. `src/gateway/context/model-context.ts` estimates message and text tokens by tokenizer family and reserves output/reasoning/headroom before deciding the usable input budget and compaction trigger. This replaces the old mental model of "20 messages plus a raw log tail" with "recent messages plus observation context under an active-model budget."

Context profiles currently include:

- `default`
- `switch_model`
- `local_llm`
- `creative_design`
- `creative_image`
- `creative_canvas`
- `creative_video`
- `teach_mode`

Teach mode is not a separate execution mode. It is activated when caller context contains `[TEACH_SESSION]`, which switches prompt profile behavior to `teach_mode`.
