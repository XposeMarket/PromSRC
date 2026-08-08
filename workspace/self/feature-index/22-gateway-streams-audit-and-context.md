# Gateway, Tool Stream, Audit, and Context Window

This reference explains the part of Prometheus that users see while a response is happening: how a message becomes a gateway turn, which live events exist, how the desktop/mobile UI renders them, what gets written to audit/continuity records, and what the context-window indicator actually measures. Last source verification: 2026-07-22.

It complements the per-page UI guides and the tool indexes. It does not expose secrets or promise that a live activity card is proof an external side effect completed.

## 1. What the gateway owns

The gateway is the runtime boundary between clients/channels and the agent/tool system. Its chat route accepts a session-scoped request, admits/serializes the turn, captures a model-route snapshot so a Settings change does not alter an in-flight budget, assembles prompt/context, executes the model/tool loop, persists message and operational records, and streams progress back to the caller.

The gateway also owns the routes and runtime adapters around sessions, models/providers, tools, approvals/questions, files/workspace, browser/desktop, tasks/agents/teams, schedules, memory, skills, connections/extensions, Creative, channels, mobile pairing, diagnostics, audit, and self-maintenance. The route-family map is [07-api-surface.md](07-api-surface.md); the execution overview is [06-runtime-architecture.md](06-runtime-architecture.md).

The important boundary: the desktop and mobile clients render gateway state. They do not decide that a tool is approved, a connector is healthy, a model is available, or an external action succeeded.

## 2. From Send to final reply

```text
typed/voice/channel message
  -> session + turn admission
  -> route/model/context snapshot
  -> prompt + bounded history + skill/memory/tool context
  -> model token/thinking/tool loop
  -> normalized tool call/progress/result events
  -> final response, artifacts, approvals/questions, persistence
  -> SSE/channel delivery + UI reconciliation
```

For a long-lived turn, context/model routing is snapshotted before execution. A later Settings save can affect later turns, but should not silently change the current turn’s provider/model context allowance. An aborted, errored, disconnected, or interrupted client stream is not proof the gateway work never started; the task/session/audit recovery paths exist to distinguish that case.

## 3. The live tool stream

Desktop Chat uses the streaming chat endpoint; mobile has matching SSE consumers. The browser client keeps stream state per session so an event can be applied to the session that produced it even if the user switches chats. A visible answer can therefore be composed from live token deltas while tool/activity entries update beside it.

### Event families and their visible meaning

| Gateway stream family | Typical UI treatment | What it means / does not mean |
|---|---|---|
| `token` | Appends assistant response text in the live response bubble | Text generation is arriving; it is not necessarily the final persisted response yet. |
| `thinking_delta`, `reasoning_summary_delta`, `agent_thought`, `thinking` | Optional thinking/trace entries, according to visibility/source rules | A bounded user-facing reasoning/agent-status signal, not raw hidden model state. |
| provider tool-call start/delta/done | Bridges model-native function-call construction into activity state | The model is forming a call; the gateway still owns validation/execution. |
| `tool_call` | Opens/updates an operation row and the live turn trace | A requested/started normalized tool operation. It does not on its own certify success. |
| `tool_progress` | Updates the running operation/terminal/progress line | Intermediate status from a tool or process; it can later fail, be cancelled, or require approval. |
| `tool_result` | Closes the operation row with a success/failure/result summary and expandable detail | The gateway returned a normalized tool result. External reality still follows the tool’s documented verification semantics. |
| `info` | Compact status/process-log line | Informational runtime state such as a handoff or reference summary. |
| `error` / transport failure | Error/recovery UI and reconciliation behavior | A stream/client failure; inspect task/audit/live state before retrying a consequential action. |
| `creative_mode` | Selects/clears the matching Creative workspace UI | Current mode selection, not a completed creative render. |
| `vision_injected` | Visible visual-input/activity indication and context refresh | A camera/image payload was prepared for this turn; model/provider limits still apply. |
| `decomposed` | Displays an informational split into subquestions | A decomposition/execution planning event, not automatically a team/background run. |
| approval/question/proposal/goal/task events | Render the corresponding inline card, live dock, badge, or panel state | A request for a decision or an operational state change; it is not auto-approved by appearing. |

Channels may translate the same core events differently. For example, Telegram can show compact progress messages, whereas desktop/mobile preserve richer expandable activity and cards. Voice may stream speech and still reconcile the normal turn record afterward.

### One operation row plus one result row

`web-ui/src/tool-activity.js` deliberately folds provider events and normalized gateway events into a readable lifecycle:

1. an operation row moves from **preparing** to **running**;
2. a result row reports the outcome.

Raw tool name, arguments, technical output, and errors remain in expandable details. Before display, sensitive-looking fields such as tokens, secrets, passwords, authorization values, API keys, cookies, and credentials are redacted by the presentation helper. Terminal output is cleaned and capped for UI use. This is why a friendly line such as “Fetching page” or “Running command” may not look like the underlying schema name.

The display layer recognizes common families—plan/compaction, memory/skills, file read/search/edit, commands, browser, desktop, web, and media—and falls back to a title-cased generic tool action. It is a usability layer, not an alternate authorization path.

### Process output is its own stream

A managed command/process can contribute live terminal output and lifecycle state. Its stdout/stderr is not the same record as the assistant’s natural-language process log, a tool event, an evidence entry, or a final reply. The Chat stream may show a terminal disclosure; the Tasks page provides the durable process/task view. See [Tasks and process logs](pages/02-tasks.md).

### Compaction appears as a system event

When context compaction runs, the activity layer recognizes `context_compaction` as a system/compaction entry rather than showing it as an opaque tool name. Desktop groups it separately in the live turn trace and can display compacting, completed, skipped, or failed state plus a generated summary where available. It must not be confused with a user asking the assistant to summarize a conversation.

### Progress is a live summary; reasoning is durable prose

`progress_state` drives the dedicated declared-plan/progress UI. It is not a generic tool operation and runtime checkpoint copies of `progress_state` must not be serialized or recovered as fake tool rows such as `Plan update: plan_created` or `Plan: Run Browser Session`.

Operational narration from `agent_thought`, complete `thinking`, and action-style reasoning-summary packets is a mutable, single latest status for the active collapsed tool group. Each update replaces that summary. User-facing `reasoning_summary` prose is a different trace entry: once displayed it remains in the visible timeline, apart from normal transport-fragment joining. Both desktop and mobile repair incomplete Markdown only in this trace path; final-answer Markdown retains its original layout.

During a chat steer, each client freezes the actual pre-steer segment, renders the steer message, and starts a new post-steer segment from a fresh process boundary. Incoming tool events must not replay the full earlier stream below the steer. The first segment owns the active-work timer. Once the response finalizes, the temporary steer labels/split collapse back to normal conversation history while the durable response and its retained process/tool records remain available.

## 4. UI rendering and reconciliation rules

### Desktop Chat

Desktop Chat renders a live response with the activity trace before/alongside generated answer text. It preserves the user’s focused textbox/caret and scroll behavior across stream re-renders. It supports concurrent independent session stream state, so switching sessions should not merge a tool result into the wrong conversation. Finalization flushes pending render work, reconciles a final response with any accumulated token deltas, saves the session state, and refreshes context-window state.

Desktop transport recovery is part of that reconciliation contract. `ChatPage.js` records the active session's request/stream cursor, treats an incomplete or network-failed SSE response as a disconnect rather than proof that the gateway turn ended, and keeps the live process state available for replay. On reload or foreground return it force-hydrates the remembered session, then replays `/api/mobile/chat/stream/:sessionId?after=<lastSeq>` through a single-flight recovery path. Frames are deduped by session/stream/sequence; a stream-id change or retained-frame gap resets the cursor to `after=0`, and replay bypasses the local-SSE ownership filter so desktop-owned tool frames are not lost. `pagehide`, `pageshow`, focus, `online`, visibility, WebSocket reconnect, and stream-update events are lifecycle triggers. The bounded server retention (12,000 frames and 16 MiB per session) remains the recovery boundary, and explicit user abort/error handling remains distinct from transport loss.

For a live tool trace, the normal update path reconciles stable DOM groups rather than replacing the whole chat body. A user can keep a tool result, terminal disclosure, or compaction card open while later tool events arrive; its disclosure state and inner scroll must survive the update. A full render remains valid only for a first paint or a required structural change.

Pending structured questions are docked in the live response while the turn waits. Approvals, proposal cards, artifacts, media, browser/process state, goals, and Creative controls render through their respective client components and route data; they are not free-form HTML emitted by a tool.

### Mobile Chat and Voice

Mobile consumes the same main categories—tool call, tool result, tool progress, tokens/final response—with its own router/cached-list/revalidation behavior. The mobile context chip listens for tool activity, visual input, and runtime registration events to refresh estimates. Voice is a separate realtime path with a Worker handoff; see [Voice Agent and Worker](16-voice-agent-and-worker.md) and [mobile page guide](mobile-pages/README.md).

Mobile follows the same trace reconciliation contract: live updates patch the affected message/group and preserve expanded tool/result/compaction disclosures instead of closing them on every event. Stream recovery is incremental by sequence; it appends only retained frames after the last known sequence unless a retention gap requires a cold replay.

### Other screens

The full page-by-page control/data inventory is [09-client-surface-inventory.md](09-client-surface-inventory.md). That document covers desktop Chat/Tasks/Schedule/Teams/Subagents/Proposals/Audit/Memory/Hub/Settings/Connections and every currently routed mobile surface, including the current Creative-router limitation.

## 5. Context window: the ring, budget, and compaction

The context indicator is a **diagnostic estimate**, not an account-quota or plan-usage meter. On desktop it appears beside the selected provider/model in Chat; on mobile it appears as a live chip. Both call `GET /api/sessions/:id/context-window` and do not mutate history or trigger compaction merely by being opened.

### How a context budget is calculated

The gateway resolves a model context profile using this priority:

1. explicit configured context override;
2. provider model metadata;
3. Ollama `num_ctx` where applicable;
4. known provider/model profile table;
5. a conservative provider fallback.

It then reserves output capacity, supported reasoning capacity, and safety headroom. The remaining input budget is the usable prompt/history space. The compaction trigger is calculated at 90% of that input budget; tool-context and summary budgets are separately bounded portions. Actual token counts are estimates tuned by tokenizer family and text/code/log density, not provider-billed exact usage.

### What the popover/chip breaks down

The UI can show estimated input/message history, active model context window, recent tool-observation contribution, and the compaction trigger. The live tool-result portion is refreshed after relevant tool activity because recent observations also consume context. It may show the largest message/role contributions where available. Side chats inherit parent context and display that boundary rather than pretending they own an independent context allowance.

### Compaction controls

Session settings expose rolling-compaction controls such as enabled state, threshold and related configured limits. Compaction is a bounded continuity mechanism: it summarizes/replaces the active API history when criteria are met, retains compaction artifacts for audit/review, and does not silently convert a summary into an approval or an external completion claim. Full continuity behavior is in [Goals, context, and continuity](19-goals-context-continuity.md).

## 6. Audit directory and evidence boundaries

The audit mirror is a review/debug/recovery snapshot system. It is not a second writable workspace and should not be treated as authorization to replay actions. The materializer explicitly describes it as snapshots for debugging and review.

Representative audit families include:

| Audit family | What it is for |
|---|---|
| `chats/sessions/` | Chat session snapshots |
| `chats/transcripts/` | Bounded transcript copies for review/recovery |
| `chats/continuity/` | Immediate continuity journals |
| `chats/compactions/` | Compaction artifacts/summaries |
| `chats/tool-observations/` | Bounded tool-result observations carried into context |
| `tasks/` | Task state/evidence snapshots |
| `cron/runs/` | Schedule/automation run history |
| `teams/` | Team activity where present |
| `proposals/` | Governed proposal state changes where present |
| `system/state/`, `system/audit/`, `system/logs/` | Selected system status/audit/log material |

The mirror has scope and retention protections: it is bounded/redacted; it intentionally excludes team/subagent workspace files; and its materialization is designed not to block WebSocket, SSE, HTTP, or Telegram traffic while handling larger append-only files. `prometheus_audit_ops` reads/reconstructs evidence but does not resume, approve, or mutate work. `diagnostic_packet` creates sanitized incident packets and likewise does not edit application source.

When work is interrupted, inspect evidence and then verify live Goal/request/task state. Use the existing recovery mechanism; do not infer that a started tool completed or automatically duplicate a consequential action. See [Audit and memory](pages/07-audit-and-memory.md), [Tasks](pages/02-tasks.md), and [Operational systems](20-operational-systems.md).

### Thought package boundary

Brain Thought has a separate direct-context assembly step before its normal `handleChat(..., executionMode: 'cron')` turn. The activity package reads canonical stores for the exact six-hour UTC window and hands the model a redacted event ledger, source manifest, unresolved-work list, and direct continuation refs. Thought must not use the audit mirror or search/list calls to rediscover activity already covered by that package. The package records stable IDs/provenance, deduplication, source failures, mtime/pagination caps, continuation hashes, and estimated prompt cost. This direct lane is Brain-specific; normal chat still uses its ordinary bounded observations and working-context packets.

## 7. Where to find every exact element

| Need | Reference |
|---|---|
| Exact static tool schemas and what each does | [11-static-tool-capability-index.md](11-static-tool-capability-index.md) |
| Dynamic connected-app tools | [12-bundled-connector-tool-index.md](12-bundled-connector-tool-index.md) |
| Browser/Windows tool shapes | [13-browser-and-desktop-tool-index.md](13-browser-and-desktop-tool-index.md) |
| Voice/realtime tool shapes | [14-voice-tool-capability-index.md](14-voice-tool-capability-index.md) |
| Screen controls and every visible UI route | [09-client-surface-inventory.md](09-client-surface-inventory.md), [desktop pages](pages/README.md), [mobile pages](mobile-pages/README.md) |
| Goals, compaction, sessions, recovery, timers/schedules/watches | [19-goals-context-continuity.md](19-goals-context-continuity.md) |
| Diagnostics, approvals, source-editing, Brain, release/maintenance | [20-operational-systems.md](20-operational-systems.md) |

## Source map

`src/gateway/routes/chat.router.ts`, `src/gateway/context/model-context.ts`, `src/gateway/session.ts`, `src/gateway/audit/`, `src/gateway/tool-observations.ts`, `src/gateway/comms/`, `web-ui/src/pages/ChatPage.js`, `web-ui/src/tool-activity.js`, `web-ui/src/mobile/mobile-api.js`, `web-ui/src/mobile/mobile-context-window.js`, and the linked page/system references.
