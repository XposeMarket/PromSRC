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
- recent tool log block, except in creative mode
- caller context
- active browser/session context when relevant
- personality context from `buildPersonalityContext(...)`
- project context when the session is project-bound
- skills runtime directives

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
