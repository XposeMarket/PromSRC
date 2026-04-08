***great so - "For each message you send, my runtime context is built from layered instructions + memory files, roughly in this order:




Where Logs Are***



***Daily chat transcript logs: workspace/memory/YYYY-MM-DD.md via src/gateway/prompt-context.ts, called from src/gateway/routes/chat.router.ts and src/gateway/routes/chat.router.ts.***

***Intraday notes: workspace/memory/YYYY-MM-DD-intraday-notes.md (used by boot + note tools) in src/gateway/boot.ts.***

***Tool/policy audit log: .prometheus/audit-log.jsonl in src/gateway/audit-log.ts.***

***Error audit log path: .prometheus/logs/audit.log set in src/gateway/server-v2.ts.***

***Session files: .prometheus/sessions/\*.json from src/gateway/session.ts.***

***Workspace tool audit: workspace/tool\_audit.log in src/gateway/chat/chat-helpers.ts.***







***System prompt (highest priority)***

***Core safety/behavior rules from the platform.***



***Developer/runtime instructions***

***Prometheus-specific operating rules (tool usage, plan rules, style constraints, etc.).***



***Injected memory docs***



***USER.md (about you, preferences, identity)***

***SOUL.md (my operating principles/persona)***

***BUSINESS.md (business context)***

***These are typically injected as context text (sometimes truncated in display, but still part of runtime context).***

***Skill registry / skill directives***

***The available skills list + “read matching SKILL.md before acting” policy.***



***Tool schemas***

***Full tool definitions (names, arguments, constraints) so I know what I can call.***



***Conversation history window***

***Recent turns (not always the entire lifetime chat — depends on context window management/summarization).***



***Current user message***

***Your newest prompt is appended last as the immediate task target.***



***Important debugging nuance***

***Not every file is literally re-read from disk every turn; many are pre-injected snapshots by the runtime layer.***

***Some content may be trimmed/summarized when long.***

***Priority is: system > developer > user > assistant memory/preferences when conflicts happen.***

***If you want, I can give you a copy-paste “prompt precedence checklist” you can use to debug why I did X instead of Y on any specific reply."***





***I wanna talk about the first 2 - can you find me the files and lines where the first 2 are built. - the main system prompt - and the developer runtime instructions***



***Files and lines***



Here are the exact places for those first two layers:



Main system prompt

chat.router.ts (line 1086)

This is the primary role: 'system' message (You are Prom...) sent each turn.

Developer/runtime instructions (Prometheus behavior/tool rules)

chat.router.ts (line 1056)

Builds executionModeSystemBlock (background/cron/heartbeat runtime behavior rules).

chat.router.ts (line 1079)

Builds response-style runtime rule text.

chat.router.ts (line 1031)

Calls buildPersonalityContext(...) to construct injected runtime instruction context.

prompt-context.ts (line 286)

buildPersonalityContext(...) assembles runtime instruction blocks.

prompt-context.ts (line 217)

TOOL\_BLOCKS text (tool usage instructions) used in runtime injection.

prompt-context.ts (line 385)

Injects \[TOOLS] block into the context payload.

One important note: the “platform core safety system prompt” is not built in this repo; that layer comes from the model/provider side outside your codebase.





***Great - now can you show me where the context runtimes are - where the AI gets sent the previous messages within the chat session.***

FIles and lines





Here are the exact places where previous chat messages are pulled and injected into runtime context:



Load prior session history for this turn

chat.router.ts (line 456)

const history = getHistoryForApiCall(sessionId, 5);



Append prior messages into model messages payload

chat.router.ts (line 1098)

Loop over history and push each prior user/assistant turn.

chat.router.ts (line 1101)

Then appends current user message last.



Where session history is retrieved + trimmed for API use

session.ts (line 336)

getHistory(...) returns last N turns (maxTurns \* 2 messages).

session.ts (line 343)

getHistoryForApiCall(...) prunes long assistant messages before sending to model.



Where messages are stored into session history (so they become “previous messages” next turn)

chat.router.ts (line 3915)

Adds incoming user message to history.

chat.router.ts (line 3985)

Adds assistant reply to history.





***Great and how about the whole context/memory/message compaction system that we built - this whole system was originally centered around ollama thatas why i built that - but id like to know where all of that is -***



***Files and lines***





Absolutely. Here’s the full compaction/memory/message system map with exact files + lines.



Core Session + Compaction Engine



Session state flags and compaction prompts

session.ts (line 25) pendingMemoryFlush, pendingCompaction

session.ts (line 31) PRE\_COMPACTION\_MEMORY\_FLUSH\_PROMPT

session.ts (line 40) PRE\_COMPACTION\_SUMMARY\_PROMPT



Token estimation + thresholds (Ollama-context aware)

session.ts (line 66) resolveNumCtx() (llm.num\_ctx / env)

session.ts (line 85) estimateMessageTokens()

session.ts (line 97) resolveSessionPolicy() (maxMessages, thresholds)



Actual compaction algorithm

session.ts (line 133) compactHistoryWithSummary(...)

session.ts (line 156) persists compaction summary to daily memory note



Injection/deferral/apply logic on each addMessage

session.ts (line 238) addMessage(...) entry

session.ts (line 254) compaction trigger path

session.ts (line 276) memory flush trigger path

session.ts (line 305) apply compaction when assistant summary arrives

session.ts (line 321) returns compaction/memory flush result metadata



API-history pruning (long assistant messages trimmed)

session.ts (line 41) prune constants

session.ts (line 343) getHistoryForApiCall(...) pruning logic



Session persistence + lifecycle

session.ts (line 193) getSession(...) load persisted session + flags

session.ts (line 357) clearHistory(...) resets compaction flags

session.ts (line 367) cleanupSessions(...) stale session cleanup

session.ts (line 417) debounced saveSession(...)



Runtime Wiring (Where it executes in chat flow)



Entry point that calls compaction/memory flush deferral

chat.router.ts (line 3915) addMessage(..., { deferOnMemoryFlush: true, deferOnCompaction: true })



Internal compaction turn execution

chat.router.ts (line 3916) compaction branch

chat.router.ts (line 3919) internal compaction context message

chat.router.ts (line 3920) calls handleChat(compactionPrompt, ...)

chat.router.ts (line 3929) stores compaction result as assistant message



Internal pre-compaction memory flush execution

chat.router.ts (line 3940) memory flush branch

chat.router.ts (line 3943) internal memory-flush context message

chat.router.ts (line 3944) calls handleChat(memoryFlushPrompt, ...)

chat.router.ts (line 3953) stores flush result as assistant message



Re-add original user message after internal turn

chat.router.ts (line 3939) (after compaction)

chat.router.ts (line 3963) (after memory flush)



Config Surface (tunable knobs)



Default settings

config.ts (line 176) session block

config.ts (line 177) maxMessages

config.ts (line 178) compactionThreshold

config.ts (line 179) memoryFlushThreshold



Config schema validation

config-schema.ts (line 256) session schema

config-schema.ts (line 257) maxMessages

config-schema.ts (line 258) compactionThreshold

config-schema.ts (line 259) memoryFlushThreshold



If you want, I can also produce a “what to remove to fully disable this system” patch plan next.





***Can you find the files and lines where rthe whole declare plan system for the main agent. and find out where this is from as well.***



***2:48:41 AM · INFO Checklist guard: plan incomplete (1 step remaining).***



***1:50:03 AM · INFO Post-check: continuing (1/4) — intent-only response with no tool execution.***



***File and line***





Found them. Here are exact origins:



declare\_plan system instruction (main agent prompt)

chat.router.ts (line 1086)

This is where the main system prompt tells the model to call declare\_plan first for 2+ tool-call tasks.



declare\_plan tool definition (schema exposed to model)

tool-builder.ts (line 828)

name: 'declare\_plan' + description/params.



declare\_plan runtime handling (main agent loop)

chat.router.ts (line 3405)

Special-case handler seeds progress steps and short-circuits execution.

chat.router.ts (line 3410)

Calls seedProgressFromLines(...).

chat.router.ts (line 3419)

Emits tool\_result summary for plan.



duplicate-plan guard message

chat.router.ts (line 3282)

Returns “Plan already declared and active...” when declare\_plan is repeated.



Checklist guard: plan incomplete (...) source

chat.router.ts (line 2728)

Emitted via sendSSE('info', { message: ... }).



Post-check: continuing (...) — intent-only response with no tool execution. source

chat.router.ts (line 2750) sets reason text

chat.router.ts (line 2753) emits the info SSE message.



Why you see it as INFO in UI

ChatPage.js (line 1174) handles SSE info events into process log

ChatPage.js (line 937) maps type info to INFO label styling.



passthrough fallback (if declare\_plan reaches executor)

subagent-executor.ts (line 139)

Returns “Plan acknowledged.” (handled upstream normally).





*Can you find where the progress panel on the main chat builds and gets the info tat populates it from - both where the progress panel is built and where the data comes from - what does the AI have to do in order for the progress panel to be populated, is it just the declare\_plan? r what?*



File and line





Worked for 40s

Yes, it’s not just declare\_plan.



UI: where progress panel is built + populated



Panel renderer (builds DOM from progress items)

ChatPage.js (line 820)



SSE handler that receives backend progress\_state and stores it

ChatPage.js (line 1259)



It writes into window.runtimeProgressState and re-renders

ChatPage.js (line 1260)

ChatPage.js (line 1269)



State is persisted/restored per chat session

ChatPage.js (line 142)

ChatPage.js (line 180)



Backend: where progress data comes from



Progress state object + SSE emitter

chat.router.ts (line 493)

chat.router.ts (line 505)



Plan seeding helper (seedProgressFromLines)

chat.router.ts (line 520)



declare\_plan path (explicit plan from AI) seeds panel

chat.router.ts (line 3405)

chat.router.ts (line 3410)



Auto-plan fallback (no declare\_plan): after enough observed tools, it synthesizes steps

chat.router.ts (line 559)

chat.router.ts (line 565)



Step lifecycle updates from tool execution

chat.router.ts (line 569) (start)

chat.router.ts (line 592) (result/advance)



Preflight can also seed progress (without declare\_plan)

chat.router.ts (line 1289)

chat.router.ts (line 1298)



Request-start reset event

chat.router.ts (line 3898)



Direct answer to your question



declare\_plan is one way, but not the only way.

Progress panel can populate from:

declare\_plan with 2+ steps.

Preflight quick\_plan/task\_plan with 2+ steps.

Auto-generated plan from observed tool calls (fallback).





**Dynamically injected runtime prompts**





Here’s the full secondary/dynamic runtime-prompt map I found (outside the main chat prompt body), with file + line anchors.



Primary Dynamic Context Builders



prompt-context.ts (line 286) buildPersonalityContext(...) (injects IDENTITY/USER/SOUL/BUSINESS/tool blocks/memory snippets/skills by mode)

prompt-context.ts (line 217) TOOL\_BLOCKS (dynamic tool instruction blocks that get injected)

chat.router.ts (line 1031) consumes personality context + browser state

chat.router.ts (line 1083) runtime messages assembly with dynamic callerContext, personalityCtx, workflow block

Preflight / Secondary Advisor Injection



secondary-calls.ts (line 543) buildPreflightSystemPrompt(...)

secondary-calls.ts (line 891) preflight system prompt used in secondary call

formatters.ts (line 16) formatPreflightExecutionObjective(...)

formatters.ts (line 34) formatPreflightHint(...)

chat.router.ts (line 1212) preflight routing flow starts

chat.router.ts (line 1389) injects direct preflight objective

chat.router.ts (line 1431) objective replacement + hint injection for primary\_with\_plan

chat.router.ts (line 1297) preflight plan -> progress seeding

Browser/Desktop Advisor Runtime Prompts



chat.router.ts (line 1709) browser advisor event + routing

chat.router.ts (line 1830) browser advisor hint formatting/injection

chat.router.ts (line 1905) stripped browser executor system prompt (advisor-driven)

chat.router.ts (line 2044) stripped desktop executor system prompt

formatters.ts (line 123) browser advisor hint block formatter

formatters.ts (line 144) desktop advisor hint block formatter

Session Compaction / Memory Flush Internal Prompts



session.ts (line 31) PRE\_COMPACTION\_MEMORY\_FLUSH\_PROMPT

session.ts (line 40) PRE\_COMPACTION\_SUMMARY\_PROMPT

session.ts (line 267) injects compaction prompt into history

session.ts (line 290) injects memory-flush prompt into history

chat.router.ts (line 3916) runs deferred compaction turn

chat.router.ts (line 3941) runs deferred pre-compaction memory-flush turn

Background Tasks / Manager-Worker / Self-Healing



background-task-runner.ts (line 342) \_buildCallerContext(...) (autonomous injected runtime instructions)

background-task-runner.ts (line 416) core autonomy instruction text

background-task-runner.ts (line 1458) manager brief injected as worker caller context

task-manager.ts (line 66) MANAGER\_BRIEF\_SYSTEM

task-manager.ts (line 89) MANAGER\_VERIFY\_SYSTEM

task-manager.ts (line 224) brief system prompt sent

task-manager.ts (line 312) verify system prompt sent

task-self-healer.ts (line 83) ERROR\_HEALER\_SYSTEM

task-self-healer.ts (line 252) COMPLETION\_VERIFIER\_SYSTEM

task-self-healer.ts (line 192) healer system call

task-self-healer.ts (line 348) completion verifier call

task-runner.ts (line 237) buildStepMessages() (legacy task runtime system prompt)

task-runner.ts (line 264) buildTaskPrompt()

Teams / Dispatch / Subagents / Manager Prompts



team-dispatch-runtime.ts (line 164) dispatch callerContext injected to team agent run

team-dispatch-runtime.ts (line 377) buildTeamDispatchTask(...) (dispatch prompt composition)

team-dispatch-runtime.ts (line 444) tool-rules section in dispatch prompt

team-manager-runner.ts (line 296) MANAGER\_SYSTEM\_PROMPT

team-manager-runner.ts (line 667) buildManagerPrompt(...)

team-manager-runner.ts (line 1264) manager system prompt injection in review loop

team-manager-runner.ts (line 1488) conversational manager system prompt

team-manager-runner.ts (line 1568) conversational manager system prompt usage

subagent-manager.ts (line 283) system prompt file template builder

subagent-manager.ts (line 317) subagent task prompt builder

Scheduling / Heartbeat / Webhooks / Goal Decompose / Self-Improvement



cron-scheduler.ts (line 547) schedule memory + self-reflection prompt augmentation

cron-scheduler.ts (line 639) scheduled run handleChat(...) with effective prompt

heartbeat-runner.ts (line 423) heartbeat callerContext injection

webhook-handler.ts (line 194) webhook wake prompt

webhook-handler.ts (line 306) webhook automated callerContext

goal-decomposer.ts (line 129) decomposition prompt builder

goal-decomposer.ts (line 201) JSON-only system callerContext for decomposition run

prompt-mutation.ts (line 96) mutation-analysis prompt builder

prompt-mutation.ts (line 184) JSON-only analysis system callerContext

self-improvement-engine.ts (line 354) weekly insight-generation prompt

self-improvement-engine.ts (line 530) JSON-only performance analyst system callerContext

boot.ts (line 54) boot runtime prompt builder

boot.ts (line 121) boot prompt execution

error-watchdog.ts (line 294) self-repair trigger prompt builder

Proposals / One-off Proposal Dispatch Prompts



proposals.router.ts (line 93) builds rich proposal execution prompt

proposals.router.ts (line 101) \[PROPOSAL EXECUTION] prompt header

tasks.router.ts (line 685) proposal auto-dispatch prompt builder

tasks.router.ts (line 693) \[PROPOSAL EXECUTION] prompt header in tasks path

Secondary Advisor System Prompts (all in one file)



secondary-calls.ts (line 102) RESCUE\_ADVISOR\_SYSTEM

secondary-calls.ts (line 130) PLANNER\_ADVISOR\_SYSTEM

secondary-calls.ts (line 161) BROWSER\_ADVISOR\_SYSTEM

secondary-calls.ts (line 278) DESKTOP\_ADVISOR\_SYSTEM

secondary-calls.ts (line 317) FILE\_ANALYZER\_SYSTEM

secondary-calls.ts (line 334) FILE\_VERIFIER\_SYSTEM

secondary-calls.ts (line 363) FILE\_PATCH\_PLANNER\_SYSTEM

secondary-calls.ts (line 394) FILE\_OP\_CLASSIFIER\_SYSTEM

secondary-calls.ts (line 1780) TASK\_STEP\_AUDITOR\_SYSTEM









Background Task System (Backend)



Queue/status model, plan/checklist state, runtime progress, final summary, evidence bus:



task-store.ts:46 (TaskStatus, includes queued/running/paused/stalled/needs\_assistance/awaiting\_user\_input/complete/failed/waiting\_subagent)

task-store.ts:94 (TaskRuntimeProgressState)

task-store.ts:124 (TaskRecord, includes plan, currentStepIndex, runtimeProgress, finalSummary)

task-store.ts:277 (createTask)

task-store.ts:436 (updateTaskRuntimeProgress)

task-store.ts:478 (mutatePlan)

task-store.ts:661 (loadEvidenceBus)

task-store.ts:688 (writeToEvidenceBus)

task-store.ts:735 (formatEvidenceBusForPrompt)

Background runner (progress, checklist guard, failures, retries, summary, events):



background-task-runner.ts:133 (BackgroundTaskRunner)

background-task-runner.ts:261 (start)

background-task-runner.ts:527 (\_runRoundWithRetry)

background-task-runner.ts:731 (maps progress\_state into task runtime progress)

background-task-runner.ts:845 (end-of-plan completion path)

background-task-runner.ts:869 (callCompletionVerifier, final summary logic)

background-task-runner.ts:1304 (\_attemptSelfHeal)

background-task-runner.ts:1661 (\_pauseForClarification, awaiting\_user\_input)

background-task-runner.ts:1691 (\_pauseForAssistance, failure/needs-help flow)

background-task-runner.ts:1426 (manager/worker orchestration events)

Task control + blocked follow-up handling:



task-router.ts:37 (initTaskRouter)

task-router.ts:193 (launchBackgroundTaskRunner)

task-router.ts:199 (handleTaskControlAction)

task-router.ts:470 (tryHandleBlockedTaskFollowup)

HTTP routes for task page + streams + error response:



tasks.router.ts:320 (GET /api/bg-tasks)

tasks.router.ts:325 (GET /api/bg-tasks/:id)

tasks.router.ts:334 (GET /api/bg-tasks/:id/evidence)

tasks.router.ts:359 (POST pause)

tasks.router.ts:376 (POST resume)

tasks.router.ts:403 (POST error-response)

tasks.router.ts:526 (POST message)

tasks.router.ts:549 (GET stream)

tasks.router.ts:587 (scheduleTaskFollowup)

Main chat hook points that spawn/update background tasks:



chat.router.ts:1212 (preflight branch into background-task path)

chat.router.ts:1320 (createTask)

chat.router.ts:1333 (updateTaskRuntimeProgress)

chat.router.ts:1344 (emits progress\_state)

chat.router.ts:1362 (emits task\_queued)

chat.router.ts:3406 (declare\_plan handling)

Tool definitions used by agent:



tools/defs/agent-team-schedule.ts (start\_task, task\_control, declare\_plan, team\_manage, schedule\_job, spawn\_subagent etc.)

tools/defs/file-web-memory.ts (list\_files, read\_file, web\_search, memory\_write, write\_note etc.)

tools/defs/cis-system.ts (deploy\_analysis\_team, social\_intel, gateway\_restart, write\_proposal etc.)

tool-builder.ts (thin assembler — imports and spreads the above 3 files + browser/desktop/MCP)

Task Page + Progress UI (Frontend)



Task page (board, panel, progress, checklist, evidence, failures, queue):



TasksPage.js:73 (status columns incl queue/failure)

TasksPage.js:106 (refreshBgTasks)

TasksPage.js:224 (openBgtPanel)

TasksPage.js:332 (final summary render)

TasksPage.js:354 (progress/checklist render)

TasksPage.js:376 (evidence bus render)

TasksPage.js:427 (pause/resume action)

TasksPage.js:442 (reply/assistance submit)

TasksPage.js:529 (load evidence entries)

TasksPage.js:618 (error-response panel)

TasksPage.js:910 (WS event subscriptions)

TasksPage.js:956 (task\_panel\_update live refresh)

TasksPage.js:974 (task\_evidence\_update)

Main chat progress panel (separate from task page):



ChatPage.js:820 (renderProgressPanel)

ChatPage.js:790 (getTaskProgressItems)

ChatPage.js:1259 (handles progress\_state stream updates)

API constants used by UI:



api.js:39 (task-related API endpoint definitions)

If you want, I can do the same “everything map” for multi-agent orchestration next in this exact format.



Found. I scanned for telegram across src, web-ui, and workspace and built this full index.



src/gateway/comms/telegram-channel.ts: 2,4,8,11,12,16,27,59,108,127,149,179,181,182,183,200,208,218,226,241,243,257,260,287,291,313,316,323,342,392,419,431,435,439,445,581,623,673,711,991,993,1853,1854,1966,1974,1978,1979,2112,2117,2284,2293,2305,2416,2515,2524,2525,2645,2673,2678,2680,2698,2702,2704,2711,2713,2722,2728,2841,2846,2869

src/gateway/routes/chat.router.ts: 7,103,234,237,241,409,414,420,424,425,459,460,462,482,976,1302,1305,1306,1314,1315,1317,1318,1325,1358,1396,1397,1404,1405,1407,1408,1415,1419,2211,3441,3545,3646,3843,3844,3847,3849,3850,3855,3858

src/gateway/routes/channels.router.ts: 2,5,20,27,31,37,38,40,84,89,90,91,92,93,121,127,132,135,138,143,154,155,156,182,184,321

src/gateway/comms/broadcaster.ts: 6,41,68,78,113,115,177,178,179,184,189,193,282,287

src/gateway/comms/webhook-handler.ts: 46,356,358,359,361

src/gateway/core/startup.ts: 64,75,188,190,241,255,260,268,282,284,287,291,293,294,297,298,301,302,306,368,379,380,385,386,392

src/gateway/core/server.ts: 50

src/gateway/server-v2.ts: 65,121,123,124,218,325,344,355,359,377,379,380,389,450,476,477,479,485,521,535

src/gateway/tool-builder.ts: 229,233,235,238,381,1100,1102

src/gateway/agents-runtime/subagent-executor.ts: 59,79,455,456,457,458,459,469,475,479,482,483,486,848,1393,1394,1396,1831,1833,1834

src/gateway/agents-runtime/subagent-manager.ts: 88,94,99,185

src/gateway/chat/chat-helpers.ts: 503,508,512,668,776

src/gateway/tasks/background-task-runner.ts: 147,163,172,1093,1113,1272,1591,1685,1686,1687,1752,1753,1754,1767,1801,1803,1804,1806,1809

src/gateway/tasks/task-router.ts: 24,25,31,194,195,513

src/gateway/tasks/task-store.ts: 129,130,281,282,301

src/gateway/routes/tasks.router.ts: 37,44,50,392,518,541,604

src/gateway/routes/goals.router.ts: 25,31,36,70,90,91,96,100,102,140,264

src/gateway/routes/teams.router.ts: 27,35,42,198,199,201,202

src/gateway/routes/canvas.router.ts: 165,166,273

src/gateway/scheduling/cron-scheduler.ts: 10,50,152,153,154,156,157,159,160,162,182,745,746,748,749

src/gateway/desktop-tools.ts: 741,745,747,750,753,754,768,773,775,1433,1437,1438

src/gateway/browser-tools.ts: 1963,1978

src/gateway/teams/managed-teams.ts: 157,865,889,890

src/gateway/errors/error-watchdog.ts: 6,322

src/gateway/errors/error-templates.ts: 11

src/gateway/tasks/task-self-healer.ts: 291

src/gateway/scheduling/self-improvement-engine.ts: 16

src/gateway/goal-decomposer.ts: 12

src/tools/self-update.ts: 4,8,65,82

src/tools/self-repair.ts: 8,9,25,69,121,187,190,237,238,263,287

src/tools/source-access.ts: 39

src/config/config.ts: 182,296,380,381,382,383,392

src/config/config-schema.ts: 101,168,267,268,271

src/types.ts: 204,205,208,305,312

src/cli/index.ts: 460

web-ui/src/pages/SettingsPage.js: 445,1619,1658,1664,1669,1674,1678,1704,1766,1776,1792

web-ui/src/pages/TasksPage.js: 191,279

workspace/SELF.md: 72,83,97

workspace/SOUL.md: 79,81

workspace/proposals/denied/prop\_1773601336266\_ef0366.json: 4,5,6,7,10,17,20,21,24

workspace/teams/team\_mmmehast\_9be94d/workspace/xpose-news-channel/config/publish.targets.json: 19

workspace/teams/team\_mmmehast\_9be94d/workspace/xpose-news-channel/src/content/article.schema.json: 112

