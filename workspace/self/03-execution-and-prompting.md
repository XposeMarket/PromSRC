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

Main-chat `/goal` mode is a nonstop interactive loop owned by `src/gateway/main-chat-goals.ts` and started from `startMainChatGoalRunner(...)` in `src/gateway/routes/chat.router.ts`. Worker turns still run through `runInteractiveTurn(...)` so they get normal tools/context, but the `GoalJudge` call is deliberately prompt-isolated: it uses the main model path without the normal soul/memory/persona prompt, then evaluates the goal against bounded original/recent session messages, recent tool observations, the progress ledger, denied actions, and the latest assistant response. The judge returns strict JSON with `status`, `reason`, `directive`, and `confidence`; `directive` is persisted as `mainChatGoal.nextStepDirective` and injected into the next synthetic continuation prompt so the loop keeps doing the specific missing work instead of vaguely continuing.


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
