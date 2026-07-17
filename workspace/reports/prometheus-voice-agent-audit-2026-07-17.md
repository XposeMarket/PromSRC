# Prometheus Voice Agent Audit

**Date:** 2026-07-17  
**Scope:** Current Voice Agent architecture, direct tools versus Prometheus Worker, realtime/mobile media pipeline, handoff behavior, reliability, latency, and maintainability.  
**Method:** Read-only inspection of current `src/`, `web-ui/`, and `workspace/self/` documentation.

## Executive judgment

The Voice Agent is already unusually powerful. It can directly search/fetch the web, search memory, manage timers, inspect automation/tasks/agents, control browser and desktop surfaces, load skills, show rich UI, create media, and hand durable work to Prometheus. The problem is not simply that it needs more tools.

The main weakness is that Voice has evolved into a second orchestration stack embedded largely inside two enormous files:

- `src/gateway/routes/chat.router.ts` (about 19,826 lines)
- `web-ui/src/mobile/mobile-pages.js` (about 31,890 lines)

It duplicates tool schemas, argument normalization, execution, result compaction, routing policy, worker lifecycle, narration, final-response summarization, transcript suppression, TTS fallback, and UI state. This makes the system powerful but brittle, difficult to test, and expensive to evolve.

The strongest path is not “give Voice every main-agent tool.” It is:

1. Make Voice the fast conversational/control plane.
2. Give it a small set of coherent capability families backed by the exact same canonical executors as main Prometheus.
3. Route durable or long-running work into one unified Worker lane with a durable operation ID.
4. Keep Voice present during the operation through structured progress events.
5. Remove the second-pass LLM summarization hop when it adds latency but no value.

## What Voice can actually do today

The current public Voice surface is four wrappers plus canonical skill tools:

- `voice_ops`
- `voice_browser`
- `voice_desktop`
- `show_ui`
- skill list/read/resource access
- worker dispatch

The wrappers normalize into a much larger hidden compatibility set in `src/gateway/routes/chat.router.ts:11973-12153`.

### Direct Voice operations

`voice_ops` exposes at least:

- web search and fetch
- write note
- Voice-Agent-only memory (`VOICEAGENT.md`)
- wake phrase and quiet mode
- long-term memory search
- timers
- automation dashboard
- worker status
- task directory/control/watch
- agent directory/control
- screenshot delivery
- image and video generation

Evidence: `src/gateway/routes/chat.router.ts:12156-12231`.

### Direct browser control

Voice directly supports open, snapshot, screenshot, page text, focused item, click, vision click, fill, type, vision type, key press, scroll, drag, wait, and close.

Evidence: `src/gateway/routes/chat.router.ts:12235-12270`, normalization at `12060-12078`, execution around `13880-14000`.

### Direct desktop control

Voice directly supports screenshots, monitor discovery, app/window discovery, focus/launch/window control, click, drag, scroll, type/raw type, key press, wait, clipboard, and window-scoped actions.

Evidence: `src/gateway/routes/chat.router.ts:12080-12107`, `12273+`.

### Memory and skills

Voice can search indexed memory with quick/deep/project/timeline modes and read a record. It can load full skill instructions and skill resources.

Evidence: `src/gateway/routes/chat.router.ts:13750-13833`.

This is already enough capability for Voice to feel powerful. Its main deficits are coherence, execution guarantees, and user-visible continuity, not raw tool count.

# Priority findings

## Immediate P0 media fixes

These should be fixed before or alongside the larger architectural work because they are concrete current defects.

### Desktop VAD settings are sent by the UI but discarded by the gateway

Desktop requests `vadThreshold`, `prefixPaddingMs`, and `silenceDurationMs` in `web-ui/src/pages/ChatPage.js:18581-18590`, but `buildRealtimeClientSecretBody(...)` in `src/gateway/routes/realtime.router.ts:254-272` does not forward a `turn_detection` configuration or those values.

**Impact:** Voice-turn tuning in the desktop UI does not actually control upstream VAD. This can cause delayed submission, clipped speech, or missing automatic turn completion.

**Fix:** Normalize and validate the fields server-side and emit an explicit `server_vad` configuration. Add a contract test proving client values reach the upstream Realtime session body.

### Mobile OpenAI fallback can stop the shared warm iOS microphone

The OpenAI mobile path correctly reuses the shared warm microphone around `web-ui/src/mobile/mobile-pages.js:16890-16906`, but a gateway-call failure path calls `track.stop()` around `16980-17000`. That contradicts the shared-mic teardown behavior around `17103-17108` and the documented rule in `self/16-mobile-app.md:298-299`.

**Impact:** One failed setup can kill the microphone shared by the visualizer and realtime providers, leaving retries with a dead track or forcing a new iOS capture/permission cycle.

**Fix:** Centralize ownership in a `MicrophoneLease`; transport and fallback code must never directly stop a shared stream. Route every failure and teardown through one idempotent owner-aware cleanup path.

### Always-listening disables genuine acoustic barge-in while output plays

During assistant output, mobile disables xAI capture sending and the OpenAI WebRTC mic track around `web-ui/src/mobile/mobile-pages.js:17159-17176`, restoring them only after output ends/watchdog cleanup around `17179-17195` and `18498-18511`. A speech-start cancellation handler exists around `17246-17272`, but muted input prevents server VAD from hearing the interruption.

**Impact:** The product appears to support hands-free interruption, but the microphone transport is disabled during the exact interval where barge-in must be detected.

**Fix:** Decide explicitly that always-listening supports real barge-in, keep input capture active during output, and use echo cancellation/output-reference suppression plus a short confidence gate. Do not rely on muting the input transport.

## P0 — Do not stream speech before the routing decision is valid

### Problem

The non-realtime decision path can stream `spokenReply` fragments while the model is still producing a tool/action JSON decision. Tool calls, JSON parsing, deterministic abort/pause overrides, and fallback normalization happen afterward. Desktop and mobile speak those chunks immediately.

Evidence: decision streaming and post-stream validation in `src/gateway/routes/chat.router.ts:16511-16586`; SSE emission at `17087-17093`; desktop consumption at `web-ui/src/pages/ChatPage.js:17961-17973`; mobile consumption at `web-ui/src/mobile/mobile-pages.js:20421-20432`.

### Risk

The user can hear speech from an intermediate tool-call pass, malformed decision, or action later superseded by a deterministic interrupt/abort rule. Spoken output cannot be recalled.

### Change

Finish the decision/tool loop, validate the final action, then emit speech. Permit immediate speech only for deterministic control acknowledgements such as stop, pause, wake, or a server-authoritative handoff confirmation.

## P0 — Fix transcript-insensitive Voice context caching

### Problem

`getVoiceAgentContextBlock(...)` receives the transcript and uses it to build personality/retrieval context, but the 30-second cache/pending-build identity is based on session/target/history length rather than the transcript or a context revision.

Evidence: `src/gateway/routes/chat.router.ts:11110-11184`; prefetch around `16977-17003`; realtime bootstrap around `17777-17784`.

### Risk

Two different turns with the same recent history length can receive context selected for the first transcript. A pending build for turn A can also be awaited by turn B. This directly threatens routing accuracy and personalization.

### Change

Cache only stable session identity/personality. Build turn-specific retrieval separately and fence it by normalized transcript fingerprint plus memory/history revision and generation.

## P0 — Make the server the sole owner of Voice turn persistence and dispatch

### Problem

Server, desktop, and mobile all participate in constructing/persisting visible Voice turns, session rotation, acknowledgements, handoff markers, and Worker placeholders. Some dedupe is event-based, while other dedupe uses recent content/time.

Evidence: server handoff/persistence around `src/gateway/routes/chat.router.ts:15896-15959` and `17177-17281`; desktop around `web-ui/src/pages/ChatPage.js:14444-14599`; mobile around `web-ui/src/mobile/mobile-pages.js:20442+` and `24186+`.

### Change

The server-side Voice Turn Coordinator should atomically own canonical session ID, voice event/turn ID, action, acknowledgement, history records, and Worker creation/steering. Clients should render authoritative records and use idempotency keys instead of rebuilding the workflow.

## P0 — Split the Voice runtime out of `chat.router.ts` and `mobile-pages.js`

### Problem

Voice schemas, wrapper normalization, executors, result summaries, routing checks, skill scouting, prompts, context construction, task/agent controls, browser/desktop adapters, and worker status all live inside `chat.router.ts`. The client state machine, WebRTC, capture, transcript handling, worker streams, TTS, narration, final summaries, reconnect behavior, and UI state live inside `mobile-pages.js`.

### Why it matters

- A browser click change can affect model schemas, routing, executor behavior, trace display, speech state, and mobile UI.
- The same state is represented by many booleans: `activeResponse`, `realtimeSpeechActiveResponse`, `speaking`, `finalSummaryPending`, `suppressAssistantTranscript`, queued summary fields, worker state, and TTS state.
- Unit-testing a single transition requires importing or simulating giant route/UI modules.
- Desktop and mobile behavior will drift because behavior is encoded in UI files rather than a shared runtime module.

### Change

Create explicit modules:

- `src/gateway/voice/capabilities.ts` — canonical Voice capability registry
- `src/gateway/voice/executor.ts` — adapters to canonical Prometheus tools
- `src/gateway/voice/router.ts` — direct/worker/approval routing decision
- `src/gateway/voice/context.ts` — bounded context packet builder
- `src/gateway/voice/operations.ts` — durable operation/workgroup state
- `src/gateway/voice/events.ts` — typed progress/final/interruption events
- `web-ui/src/voice/voice-session-controller.js` — shared client state machine
- provider transports beneath the controller, not mixed with UI rendering

The route and mobile page should become composition layers, not the runtime itself.

## P0 — Replace boolean soup with one explicit Voice session state machine

### Problem

Final worker speech alone checks and mutates multiple overlapping flags. `_requestMobileRealtimeAgentFinalSummary` queues based on `finalSummaryPending`, `activeResponse`, `realtimeSpeechActiveResponse`, and `speaking`; it separately sets transcript suppression and summary keys.

Evidence: `web-ui/src/mobile/mobile-pages.js:16384-16456`.

Worker completion has both `onFinal` and `onDone` speech paths guarded by `finalSpoken`, each invoking the realtime summary or TTS fallback.

Evidence: `web-ui/src/mobile/mobile-pages.js:24636-24718`.

### Risk

This structure naturally produces the historical symptoms already associated with Voice: duplicate visible messages, stale transcript reuse, silent turns, double speech, stuck orb state, and lost queued summaries.

### Change

Use one reducer/state machine with generation-fenced events:

- `idle`
- `listening`
- `user_speaking`
- `committing_turn`
- `thinking_direct`
- `working`
- `speaking_progress`
- `speaking_final`
- `interrupted`
- `reconnecting`
- `failed`

Every input carries `voiceSessionId`, `turnId`, `generation`, and optional `operationId`. Old-generation transcript/audio/final events are ignored. One event owns the transition to final speech. `onFinal` stores content; `onDone` commits it exactly once.

## P0 — Establish one durable operation contract between Voice and Worker

### Problem

The current code distinguishes dispatch, current-chat handoff, voice workgroups, task watches, active runtime context, and final summarization. The user experiences one request, but the system models several partially overlapping identities.

The UI also labels and handles `realtime_agent_dispatch` and `realtime_agent_chat_handoff` separately, with special reuse and display logic in `web-ui/src/pages/ChatPage.js:14444+` and mobile worker stream logic around `mobile-pages.js:24590+`.

### Change

Every nontrivial spoken request should create or attach to a single durable `VoiceOperation`:

```ts
interface VoiceOperation {
  id: string;
  voiceSessionId: string;
  turnId: string;
  owner: 'voice' | 'prometheus' | 'subagent' | 'team';
  status: 'accepted' | 'running' | 'waiting_approval' | 'waiting_user' | 'complete' | 'failed' | 'cancelled';
  objective: string;
  latestMilestone?: string;
  finalResultRef?: string;
}
```

Voice can answer directly without creating one for small talk or tiny reads. Once work becomes durable, all progress, steering, stopping, reconnect recovery, and final speech point to this operation ID. Remove separate ad hoc notions where possible.

## P0 — Add a real capability/risk policy before making Voice stronger

### Problem

Voice directly controls browser and desktop clicks, typing, clipboard, apps, and windows. It does not expose the main agent’s structured final-action approval tool as an obvious first-class Voice capability. Relying on prompt wording or downstream incidental gating is too weak for send/post/purchase/delete/submit actions.

### Change

Every capability must declare:

- latency class
- read/write/destructive class
- whether it may run directly
- whether it requires visual grounding
- whether it requires confirmation/approval
- whether it is durable
- whether it supports interruption/cancellation
- expected result size

High-impact UI actions must enter `waiting_approval`, show the prepared action on phone/desktop, and accept spoken approval only through a bound, expiring approval token. Voice should never infer approval from conversational context.

## P1 — Stop treating the Voice tool pool as a manually maintained parallel tool universe

### Problem

There are public wrappers, hidden compatibility tool names, normalization maps, individual schemas, and a large name-based executor. The same operation is represented several ways.

Evidence:

- wrapper names: `chat.router.ts:11973-11978`
- hidden compatibility names: `11980-12033`
- normalization maps: `12040-12153`
- schemas: `12156+`
- name-based execution: approximately `13750-14497`

This is accidental complexity. It also invites mismatches: a name can exist in a normalization map but be absent from the hidden compatibility set, schema, routing classifier, trace formatter, or executor.

### Change

Build Voice schemas and wrapper actions from one typed registry that points to canonical main-tool executors. Keep only the four model-facing wrapper names for low token cost. Generate:

- JSON schemas
- action enums
- argument adapters
- risk metadata
- trace labels
- executor dispatch
- documentation
- tests

from the same entries.

## P1 — Make fallback capability loss explicit

### Problem

The OpenAI Realtime bootstrap tries full, no-speed, and lean session variants. The lean variant can omit the Voice tools while retaining the normal Voice Agent identity/instructions.

Evidence: full session configuration around `src/gateway/routes/chat.router.ts:17813-17835`; lean fallback at `17838-17863`.

### Risk

A session can connect successfully in a silent `speech_only` downgrade, then claim or imply capabilities it no longer has.

### Change

Keep tools when only shrinking prompt/options. If tools truly must be removed, return and display `capabilityMode: speech_only`, inject a speech-only prompt, and require Worker handoff for every action.

## P1 — Make network/model failure idempotent instead of defaulting to heavy Worker execution

### Problem

Broad client error fallbacks continue to Worker. A direct request can become a full Worker turn after SSE/JSON/network failure, even if the direct operation already succeeded and only its response was lost.

Evidence: desktop fallback around `web-ui/src/pages/ChatPage.js:18027-18030`; mobile fallback around `web-ui/src/mobile/mobile-pages.js:20433-20441`.

### Change

Persist Voice decisions by event ID. On ambiguous failure, query or retry the same event ID and execute only the server-authoritative result. Every deterministic fallback action should also include a valid deterministic spoken response.

## P1 — Use a three-lane router, not prompt-only “direct versus handoff” judgment

### Recommended lanes

1. **Reflex lane**: conversational answer, device/runtime status, tiny memory lookup. Target first audio under ~500 ms where provider permits.
2. **Direct tool lane**: bounded read or simple reversible control, normally one to three tool calls under ~5 seconds.
3. **Worker lane**: filesystem/code/shell/git, connectors/accounts, long browsing, research, multiple app steps, approvals, persistent artifacts, teams, or anything likely over ~5 seconds.

The model can propose a lane, but deterministic policy should enforce it using capability metadata, expected duration, risk, and required durability.

### Why

The current prompt has to teach the model many exceptions: when to skill-scout, when not to; when to use quick voice tools; when to dispatch; how to narrate; how to update Voice memory. That is policy encoded as prose rather than runtime guarantees.

Evidence: `src/gateway/routes/chat.router.ts:17688-17720` and skill-scout logic `14508-14595`.

## P1 — Remove unnecessary second-model final summarization

### Problem

When Worker completes, mobile injects up to 5,000 characters into the realtime conversation and asks the realtime model to produce a second paraphrased spoken wrap-up.

Evidence: `web-ui/src/mobile/mobile-pages.js:16384-16449`.

This adds:

- another model round trip
- additional cost
- another failure/queue path
- possible semantic drift
- duplicate/stale summary risk
- a strange instruction to avoid preserving sentence order rather than simply requesting a dedicated spoken summary from Worker

### Change

Have Worker return two channels in its terminal event:

- `finalText` — full durable answer
- `spokenSummary` — concise speech-ready answer, generated during the same finalization

The realtime layer speaks `spokenSummary` directly. Only use realtime paraphrasing when the user has selected a special conversational restyling mode.

## P1 — Unify TTS ownership

### Problem

There are at least two final speech paths: realtime-model audio and server/browser TTS fallback. Worker completion decides between `_requestMobileRealtimeAgentFinalSummary(...)` and `_ttsSpeak(...)`; other task/subagent/hot-restart paths also call the summary helper.

Evidence: call sites around `mobile-pages.js:4312`, `16384`, `18485`, `24027`, `24657`, `24709`, and `31855`.

### Change

A single Speech Scheduler should own all output. Inputs are typed utterances with priority, dedupe key, operation ID, interruptibility, and source. It selects provider audio or TTS, not the caller. It must provide exactly-once completion/cancel events.

## P1 — Separate conversational memory from routing configuration

### Problem

Voice has a dedicated mutable `VOICEAGENT.md`, loaded through prompt context and directly writable/replacable by Voice. Evidence: `src/gateway/prompt-context.ts:454+`, `chat.router.ts:11943-11963`, tool schema around `12383+`.

This file mixes behavioral memory, routing notes, and live Voice configuration. Free-form full replacement is too broad and can cause unreviewed behavior drift.

### Change

Split into:

- user voice preferences: durable USER memory
- runtime voice settings: structured config schema
- learned interaction facts: ordinary memory with provenance
- developer routing policy: source-controlled Voice policy

If `VOICEAGENT.md` remains, make it append-only from Voice by default; reserve replace for settings UI/dev approval.

## P1 — Context should be incremental and event-based, not repeatedly rebuilt/injected

### Problem

Docs describe Voice Worker context packets built from active runtime state, recent stream events, process activity, advisor packets, and recent messages, with mobile prewarming (`self/16-mobile-app.md:317-325`). This is useful but potentially costly and stale if rebuilt or reinjected wholesale.

### Change

Send a compact initial snapshot, then typed deltas:

- worker started
- phase changed
- tool started/finished
- approval requested
- artifact produced
- worker completed

Each carries version and operation ID. Realtime should not need to reread a large pseudo-transcript to infer current state.

## P1 — Add contract tests and deterministic replay

### Problem

No focused Voice-Agent tests were surfaced by repository searches for typical `*.test.*` / `*.spec.*` patterns. The most failure-prone logic is event order and race behavior, which manual smoke tests do not cover well.

### Required test matrix

- transcript finalized twice
- old transcript arrives after new turn starts
- user barges in during direct answer
- user barges in during Worker milestone
- Worker `onFinal` then `onDone`
- `onDone` without `onFinal`
- realtime disconnect during final speech
- fallback TTS begins while realtime reconnects
- queued summary superseded by a newer operation
- same worker final delivered twice
- approval arrives after operation cancellation
- iOS shared mic survives reconnect without second capture
- desktop and mobile emit the same logical events

Capture event traces and replay them through the state reducer in tests.

## P1 — Repair realtime connection lifecycle and desktop architecture

### Mobile recovery

On `closed`, `failed`, or `disconnected`, mobile can merely null `__pmRealtimeAgent.conn` around `web-ui/src/mobile/mobile-pages.js:17060-17066` without full media cleanup, visible recovery state, or reconnect. Route this through the same idempotent teardown used for normal shutdown and reconnect with bounded backoff while Voice remains enabled and the page is visible.

### Desktop teardown

Desktop output connection failure similarly nulls its reference around `web-ui/src/pages/ChatPage.js:19225-19228`, while dictation has a more complete teardown around `18559-18570`. Both need one `RealtimeMediaSession.close(reason)` and explicit `idle → connecting → ready → recovering → closed` transitions.

### Two desktop Realtime sessions

Desktop currently uses one Realtime connection for transcription and a second receive-only Realtime conversation to read Prometheus text aloud (`ChatPage.js:18572-18661`, `19118-19228`, `19425-19459`). This doubles authentication, SDP, autoplay, cancellation, and recovery complexity.

Choose one architecture. The simplest is one STT input transport, authoritative Prometheus Worker execution, and purpose-built streaming TTS. Do not use a second conversational model session purely as a text reader.

## P1 — Normalize provider events before they reach UI state

Mobile handles multiple OpenAI/xAI event families directly and deduplicates some transcript events by normalized text within 4.5 seconds (`mobile-pages.js:16274-16294`). Legitimate repeated commands such as “stop,” “yes,” or “continue” can be dropped. Multiple response delta/completion families can also drive one mutable visible assistant turn around `18389-18458`.

Normalize providers into a small internal event vocabulary (`input.started`, `input.delta`, `input.final`, `response.started`, `response.delta`, `response.final`, `audio.started`, `audio.ended`, `session.failed`). Key reducers by provider item/response ID plus local turn generation. Use text only as an extremely narrow fallback dedupe signal.

## P2 — Reduce model-facing tool schema size further

The four wrappers are directionally correct, but `voice_ops` carries a very broad flat argument object for unrelated actions. This is hard for models to call reliably and wastes schema tokens.

Change it to either discriminated action schemas (`oneOf`) or a compact action plus `params` object validated against the registry. Keep descriptions concise and inject only capability families relevant to the current mode.

## P2 — Improve browser/desktop grounding contracts

Direct Voice UI controls are powerful. Require fresh observation IDs and generation fencing for coordinate/ref actions. A click should declare which screenshot/snapshot it is grounded in; stale refs should fail and trigger a fresh observation. High-impact actions then route to approval.

## P2 — Make progress narration semantic, not timer-driven

Current worker narration has 20-second and 8-second gap rules and asks the realtime model to inspect “freshest Live Worker context.” Evidence: `mobile-pages.js:16349-16380`.

Replace timing heuristics with semantic milestones emitted by Worker. Narrate only when severity/importance changes, user asked for updates, approval is needed, or estimated remaining time crosses a threshold.

## P2 — Enforce result bounds and escalation in runtime, not prose

Only the common `summary` is centrally compacted; arbitrary nested data can still consume the tiny next-pass context. Likewise, results such as `escalateToWorker: true` can remain advisory to the model.

Add one recursive Voice result sanitizer with serialized-byte caps, string/array limits, artifact references, and `truncated` metadata. Convert escalation directives into hard routing constraints after tool execution.

## P2 — Add a few high-value read-only capabilities, not the whole main pool

The best missing direct capabilities are:

- connector/connection status
- focused recurring schedule/job lookup
- browser tabs/current URL/title/session health
- semantic desktop/accessibility inspection
- workspace artifact metadata (`exists`, size, modified time), not file contents
- a first-class Voice approval/confirmation operation

These reduce unnecessary Worker handoffs while keeping mutations and durable execution centralized.

## P2 — Move slow/durable media work out of the direct loop

Direct video generation can take minutes and can save files. It does not belong inside a bounded low-latency Voice loop. Always create a VoiceOperation and dispatch video generation; consider direct image generation only when provider latency is bounded and no workspace path mutation is requested.

## P2 — Instrument latency and reliability as a product surface

Track per turn:

- speech end to committed transcript
- transcript to routing decision
- route to first tool/worker start
- first spoken byte
- barge-in cancellation latency
- worker final to spoken final
- duplicate transcript/final suppressions
- reconnect count
- fallback TTS use
- dropped/stale event count

Display a developer-only Voice trace timeline. The existing `/api/mobile/voice-debug` path is a start, but metrics should be structured and operation/turn correlated.

# Voice versus main Prometheus: recommended boundary

## Voice should handle directly

- conversation and follow-up questions
- current time/runtime status
- quick memory lookup
- timers and quiet/wake settings
- small web lookup/fetch
- screenshots and read-only visual inspection
- one-step reversible browser/desktop navigation
- checking operation/task/agent status
- speaking semantic progress and final summaries

## Voice should normally delegate

- workspace file changes
- shell/process execution
- Git operations
- Prometheus source edits
- deep research
- long browser workflows
- connected apps/accounts and external messages
- schedules beyond simple timer semantics
- team creation/coordination
- multi-artifact creative work
- any operation requiring durable files, extensive context, or more than a few tool calls

## Voice must use approval

- send/post/publish/submit
- purchase/transfer/trade
- destructive delete
- credential/permission changes
- external account mutations
- any ambiguous UI action with material consequences

# Recommended implementation sequence

## Phase 1 — Reliability foundation

1. Introduce typed `VoiceSessionEvent` and the reducer/state machine.
2. Add `voiceSessionId`, `turnId`, `generation`, and `operationId` everywhere.
3. Make final speech exactly-once and remove `onFinal`/`onDone` duplication.
4. Add replay tests for known stale/duplicate/interruption races.

## Phase 2 — Capability consolidation

1. Create one capability registry.
2. Generate wrapper schemas, normalizers, risk metadata, and executor routing from it.
3. Delegate to canonical Prometheus tool executors rather than maintaining Voice-specific copies.
4. Add explicit approval policy.

## Phase 3 — Worker continuity

1. Implement `VoiceOperation` as the durable bridge.
2. Replace handoff variants/workgroup ambiguity with operation ownership and events.
3. Emit semantic progress events.
4. Return `spokenSummary` with the Worker terminal result.

## Phase 4 — Product strength

1. Shared desktop/mobile Voice Session Controller.
2. Developer Voice trace timeline and latency metrics.
3. Strong reconnect/resume behavior across phone lock, network switches, and gateway restart.
4. Personal voice preferences in structured memory/config.
5. Optional proactive mode built on explicit user rules and semantic events, not polling narration.

# Bottom line

Prometheus Voice does not need to become a full copy of main Prometheus. It already has enough direct power to feel exceptional. It needs to become the fastest, most coherent interface to the same underlying Prometheus capabilities.

The winning architecture is:

**Realtime Voice = conversation, perception, routing, control, and narration.**  
**Prometheus Worker = durable reasoning and execution.**  
**Capability registry = one source of truth.**  
**VoiceOperation = one continuity contract.**  
**State machine = one owner of turn/audio lifecycle.**

That change would make Voice both stronger and substantially simpler.
