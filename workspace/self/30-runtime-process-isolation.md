# 44) Gateway and Runtime Process Isolation

Last source verification: 2026-07-15.

## Why this boundary exists

The gateway is the control plane. Mobile, Telegram, desktop, HTTP, SSE, and WebSocket clients all depend on its event loop staying responsive even when a Prometheus run is long, CPU-heavy, memory-heavy, waiting on a tool, or failing.

Before the first isolation change, scheduled memory search maintenance used `setImmediate(...)` and then called the synchronous `refreshMemoryIndexFromAudit(...)` inside the gateway process. `setImmediate` delayed the work; it did not move the work off the event loop. On the current large workspace, one observed refresh held the gateway for roughly 136 seconds while the process used nearly all of one CPU core and about 1.88 GB of heap. Mobile appeared frozen, active turns paused, and a Telegram `/new` looked like a “ping” because its request was finally serviced when the blocked event loop returned.

## Implemented process boundaries

### Memory-index maintenance

- `src/gateway/process/runtime-worker-protocol.ts` defines the original versioned, bounded maintenance-worker envelope. A single IPC message is capped at 256 KiB by default; large logs, transcripts, or artifacts must be persisted and referenced instead of copied through IPC.
- `src/gateway/process/runtime-worker-broker.ts` owns child startup, readiness, one-job-at-a-time admission, timeouts, crash detection, output tails, shutdown, and clean respawn after failure. Electron's injected vault key is handed to a child once through stdin rather than copied into its environment.
- `src/gateway/process/memory-index-worker.ts` runs the synchronous evidence/operational/SQLite refresh in a child Node process.
- `src/gateway/memory-index/refresh-worker-client.ts` coalesces same-workspace refresh requests, serializes all work through one child, returns results to callers that explicitly await a refresh, and serves the last good index if maintenance fails.
- The memory child is recycled after every refresh. A large legacy JSON index can temporarily require gigabytes of heap; recycling returns that heap to the operating system instead of making it the gateway's permanent baseline.
- Automatic search/graph refresh, manual `memory_index_refresh`, explicit/automatic embedding backfill, the memory provider sync path, memory-note creation, the refresh API, Obsidian changes, and consolidation changes all use this boundary. Production gateway code no longer calls the synchronous audit refresh directly.
- The legacy `scheduleOperationalIndexRefresh(...)` entry point also delegates to the child queue; `setImmediate(...)` is not treated as isolation.

### Provider/model calls

- `src/gateway/turn-workers/` defines a second, turn-oriented process protocol with start, ordered event, checkpoint, heartbeat, RPC, steer, cancel, final, error, and shutdown messages. Messages and payloads are byte-bounded, attempts carry an opaque fencing token, and a worker owns only one submitted job at a time.
- `src/gateway/turn-workers/model-call-dispatcher.ts` runs provider/model calls made through `OllamaClient.chatWithThinking(...)` and `generateWithThinking(...)` in a bounded child-process pool. The child resolves the requested provider/model, streams token/thinking/reasoning/model events back to the gateway, and persists the complete result in the blob store rather than returning it inline.
- The model envelope carries both provider ID and the selected provider account ID. `getProviderAccountId(...)` preserves the originating instance's credential identity, and the child rebuilds it through `buildProviderById(providerId, accountId)` instead of silently falling back to a different active/default OAuth or API-key account. Credentials themselves are not copied into the request blob. Rotating OpenAI Codex/xAI OAuth remains gateway-owned: the gateway preflights once at admission and again through a bounded child-to-gateway RPC when a queued worker actually starts. Runtime children only read the refreshed vault entry; migration writes are suppressed and refresh/save/clear operations are rejected in those children so parallel processes cannot race a rotating refresh token or overwrite the vault.
- The default pool has three workers, is clamped to one through eight workers, queues at most 100 jobs, recycles a worker after ten completed model jobs, treats 45 seconds without a heartbeat as failure, and grants five seconds for cancellation before force termination. Each model child receives a 1,024 MiB V8 old-space ceiling by default (operator-clamped 256–4,096 MiB) so a bad worker allocation fails that child rather than inheriting an effectively unbounded heap. There is deliberately no fixed one-hour-style turn timeout.
- A failed or recycled model worker does not take down the gateway. The pool replaces it, while the owning gateway turn receives the bounded error/cancellation result.
- The model-call request sent over IPC contains blob-root/request references, not a copied conversation history. This keeps IPC bounded even when a turn has a large context.
- Preparing turn attachments/admission payloads, central tool-effect results, and model requests no longer runs canonical JSON serialization, gzip, file write, and fsync as one synchronous gateway operation. Attachment writes use bounded concurrency; the large-value normalizer/serializer yields cooperatively; compression/write/fsync use the asynchronous blob path before referenced state is admitted, committed, or submitted.

Environment controls:

- `PROMETHEUS_TURN_WORKER_COUNT` or `PROMETHEUS_MODEL_WORKER_COUNT` — model worker count; default 3, clamped to 1–8.
- `PROMETHEUS_MODEL_WORKER_RECYCLE_JOBS` — model calls completed before recycling a child; default 10.
- `PROMETHEUS_MODEL_WORKER_MAX_OLD_SPACE_MB` — per-model-child V8 old-space ceiling; default 1,024 MiB, clamped to 256–4,096 MiB. An explicit inherited Node `--max-old-space-size` remains authoritative.
- `PROMETHEUS_DISABLE_MODEL_WORKERS=1` — diagnostic fallback to provider calls in the gateway process. Child workers also disable redispatch automatically to prevent recursion.
- `PROMETHEUS_MEMORY_REFRESH_WORKER_TIMEOUT_MS` — per-refresh timeout; default 15 minutes, minimum 30 seconds.
- `PROMETHEUS_MEMORY_REFRESH_WORKER_STARTUP_TIMEOUT_MS` — maintenance-child readiness timeout; default 45 seconds, minimum 1 second.

The worker pools provide process isolation, not workspace isolation. The normal shared workspace remains authoritative.

### Finalization file-change scans

- The final response path no longer runs its git status/diff, filesystem stat, and bounded text-read scan in the gateway process. `turn-file-change-dispatcher.ts` sends a blob reference to `turn-file-change-worker.ts`; the child runs the shared exact collector and stores the result behind another blob reference, so large diff previews do not cross IPC.
- The pool defaults to two reusable workers so two unrelated threads can finalize concurrently, queues at most 32 scans, and recycles a child after 25 jobs. Each child has a default 384 MiB V8 old-space limit. Worker crashes, heartbeat loss, or admission failure omit the optional `fileChanges` metadata and emit a durable degradation event; they do not fall back to synchronous git/stat/read work on the gateway.
- `PROMETHEUS_FILE_CHANGE_WORKER_COUNT` controls capacity and is clamped to 1–2. `PROMETHEUS_FILE_CHANGE_WORKER_RECYCLE_JOBS` controls recycling. `PROMETHEUS_FILE_CHANGE_WORKER_OLD_SPACE_MB` defaults to 384 and is clamped to 128–1,024 MiB. `PROMETHEUS_DISABLE_FILE_CHANGE_WORKERS=1` is an explicit diagnostic-only in-process mode.
- This boundary does not change files, tools, workspace selection, or final-response content. It only computes the same optional change summary in a bounded child instead of on the control-plane event loop.

### Context diagnostics and tool-observation persistence

- `context-footprint-client.ts` snapshots session state cooperatively and runs the expensive full stored-thread/tool-observation/raw-result footprint calculation in `context-footprint-worker.ts`. The single child has a bounded queue, a 384 MiB default old-space cap, and a 96 MiB default snapshot cap. The context-window API returns its live-context rows even when this optional stored-thread diagnostic is unavailable.
- `tool-observation-persistence-client.ts` owns a two-child-by-default pool for raw oversized tool-result writes, compact observation JSONL append, and tool-state summary generation. Each child has a 512 MiB default old-space cap; admission and snapshots are bounded. Artifact entries retain only small identifying metadata and never duplicate base64/blob bodies into observation JSONL.
- Observation persistence starts alongside finalization file-change work. It gets only a 25 ms fast-path window; a slower result attaches its bounded `toolLog`/budget metadata to the exact assistant message and flushes cooperatively after terminal delivery. Queue saturation, worker failure, or snapshot rejection records a bounded degradation and never fails the user's final response.
- Async observation readers scan backward from the JSONL tail instead of loading the whole file. Gateway-side tail materialization defaults to 2 MiB and rejects legacy individual lines over 256 KiB; Goal judge/summary and prompt callers use this async path.

### Gateway-owned session and prompt work

- Session history remains gateway-owned, but normal debounced saves and authoritative final-boundary saves now scrub/serialize/write/fsync cooperatively and atomically. Per-session generation fences retry overlapping mutations; a post-rename fence prevents an in-flight save from resurrecting a deleted session. Restart preflight and shutdown await the same asynchronous persistence path.
- Runtime process entries are bounded (including encoded/large tool arguments), attached to the assistant message before the authoritative final flush, and therefore included in the committed session that precedes final/done publication.
- Large prompt/profile reads, memory-index search, recent observation reads, and Creative reference image reads use async/bounded paths. Creative references use bounded aggregate/per-file bytes and limited concurrency rather than synchronous stat/read/base64 work on the gateway.
- Automatic project learning and model-generated titles are post-terminal maintenance. Project lookup uses async bounded metadata reads; title transcript selection stops after six visible messages, title work is one global/single-flight job, and an abortable eight-second default deadline prevents it from occupying the shared model pool indefinitely. Completion notifications are also scheduled only after final/done publication.

Environment controls added by this layer include `PROMETHEUS_CONTEXT_FOOTPRINT_HEAP_MB`, `PROMETHEUS_CONTEXT_FOOTPRINT_MAX_SNAPSHOT_MB`, `PROMETHEUS_TOOL_OBSERVATION_HEAP_MB`, `PROMETHEUS_TOOL_OBSERVATION_MAX_SNAPSHOT_MB`, `PROMETHEUS_TOOL_OBSERVATION_WORKERS`, `PROMETHEUS_TOOL_OBSERVATION_FAST_PATH_MS`, `PROMETHEUS_TOOL_OBSERVATION_TAIL_MAX_BYTES`, `PROMETHEUS_TOOL_OBSERVATION_LINE_MAX_BYTES`, and `PROMETHEUS_AUTO_TITLE_TIMEOUT_MS`.

## Durable turn journal

`src/gateway/turn-jobs/` adds the durable control-plane record for interactive, Goal, background, proposal, scheduled, team, and Brain turns:

- The authoritative database is `<configDir>/runtime/turn-jobs.sqlite`, opened in SQLite WAL mode with foreign keys, bounded busy waiting, and transactional state transitions.
- Content-addressed payloads, checkpoints, results, and oversized delivery values live under `<configDir>/runtime/turn-blobs/`. Job/worker messages carry immutable references instead of large values.
- Immutable reuse validates only the bounded envelope header and file length on the gateway path; it does not reread, decompress, and rehash the complete body. A real blob read still verifies decoded length and SHA-256 content.
- `runInteractiveTurn(...)` and direct `handleChat(...)` entry points create a journal job unless they are already inside the same durable execution context. Nested same-session calls reuse that context instead of trying to acquire a second session lease.
- A job records its session/kind/request fingerprint, optional client request ID and actor/task/Goal identity, attempt, state, heartbeat, event sequence, checkpoint, final reference, and terminal outcome.
- Exactly one active journal job may hold a session lease. The default lease is 45 seconds and the gateway refreshes it every ten seconds. Every worker event, checkpoint, and tool-effect mutation is fenced by the current opaque lease token so a late message from a replaced attempt cannot commit. Lease-renewal or journal-boundary failure now marks the in-memory execution with a typed fatal fence, aborts its shared tool/provider signal, and makes later event/checkpoint/tool/final boundaries throw. A fenced attempt never uses the unfenced cancellation path against a possible replacement attempt; stale-lease reconciliation owns its durable transition.
- Startup and a serialized, bounded 15-second maintenance pass reconcile expired running/leased jobs. Safe work becomes checkpointed/interrupted; an uncertain side effect with a non-safe replay policy becomes `needs_review`. Stale jobs, delivery leases, and orphan-resource cleanup are each capped per pass and report their remaining backlog. The same pass closes the narrow final-only crash window: a `final_persisted` job with no delivery rows becomes `completed`, while its exact final remains replayable by the original session/client request. A final with even one outbox row is never auto-completed. This is durable state recovery, not an automatic recovered-job execution loop or channel redelivery service.
- Events are gap-free and deduplicated per job. High-volume token/thinking/heartbeat deltas are intentionally not journaled; reconnect replay for those live frames remains the gateway's bounded in-memory stream buffer.
- The central `executeToolWithTelemetry(...)` path records a prepared/running/succeeded/failed tool effect with an argument hash and `safe_retry`, `verify_before_retry`, or `never_replay` policy. A completed result can be reused; an uncertain non-safe result is refused for blind replay.
- Lease-expiry reconciliation, explicit failed-attempt transition, and cancellation convert any still-running effect to `unknown`; a non-`safe_retry` failed/expired effect moves the job directly to `needs_review` instead of leaving a nominally retryable row that could continue blindly. Final persistence refuses to cross any still-prepared/running effect.
- Tool resource leases serialize shared browser sessions, global desktop input, scheduler storage, and lifecycle/dev-apply operations. Existing gateway manager locks remain authoritative for task/team orchestration to avoid parent/child lease inversion. Conflicting file paths and repository-wide commands can additionally be serialized with `PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES=1`, but that policy is off by default so this backend phase does not change the normal shared-workspace/concurrent-thread workflow.
- The schema includes a deduplicated, leased final-delivery outbox. Final persistence is atomic with outbox creation, but current chat callers do not yet populate that outbox and there is no general delivery-drainer/restart-redelivery service yet. Final-state recovery therefore handles only zero-delivery rows and refuses to consume, acknowledge, or complete any row carrying explicit outbox intent.
- The gateway initializes and reconciles the journal during boot. If that fails, startup fails rather than silently running without the durability boundary. Restart lifecycle and `SIGINT`/`SIGTERM` shutdown stop ingress first, durably snapshot and mark recoverable live runtimes interrupted, then await memory/model/file-change/context/observation/retention worker drains and cooperative session flushes before closing the journal. Shutdown-specific abort hooks do not reuse operator-abort handlers, so an orderly restart does not falsely mark tasks failed or cancelled. Signal shutdown retains an operator-configurable hard deadline (30 seconds by default).

### Bounded journal and blob retention

- `src/gateway/turn-jobs/retention-client.ts` lazily schedules one maintenance pass per day. A saturated bounded pass schedules another after five minutes until the cursor/backlog drains; a failed pass retries after 15 minutes. The synchronous SQLite/filesystem work runs only in the recycled `turn-journal-retention-worker.ts` child, never on the gateway event loop.
- A pass deletes at most 500 journal jobs by default, and only `completed`, `failed`, or `cancelled` rows whose `completed_at` is older than 30 days. SQLite foreign keys cascade their events, checkpoints, effects, deliveries, and resource leases. Queued/leased/running, waiting-user/approval, checkpointed/interrupted, `final_persisted`, and `needs_review` jobs are never selected.
- Blob GC uses a persisted, shard-resuming cursor. By default a pass examines at most 2,000 `.turnblob` files and deletes at most 500 files older than 90 days. It checks every explicit database reference column (`payload_ref`, checkpoint/final refs, event payload refs, checkpoint continuations, and tool-effect results) before unlinking.
- Immutable blob reads, existence/reuse checks, and content-addressed reuse refresh file mtime. GC re-stats a candidate immediately before deletion, so a concurrent read/touch or file change wins and the file remains.
- Blob retention is always clamped longer than job retention by at least one day. The longer default also gives signed delivery URLs and nested references inside final blobs a conservative grace period after their parent journal row expires.
- Controls are `PROMETHEUS_TURN_JOB_RETENTION_MS` (30 days), `PROMETHEUS_TURN_BLOB_RETENTION_MS` (90 days), `PROMETHEUS_TURN_RETENTION_INTERVAL_MS` (daily), `PROMETHEUS_TURN_RETENTION_INITIAL_DELAY_MS` (2 minutes), `PROMETHEUS_TURN_RETENTION_CATCHUP_DELAY_MS` (5 minutes), `PROMETHEUS_TURN_RETENTION_FAILURE_RETRY_MS` (15 minutes), `PROMETHEUS_TURN_RETENTION_JOB_BATCH` (500), `PROMETHEUS_TURN_RETENTION_BLOB_SCAN_BATCH` (2,000), `PROMETHEUS_TURN_RETENTION_BLOB_DELETE_BATCH` (500), and `PROMETHEUS_DISABLE_TURN_RETENTION=1` for diagnostics.
- Runtime reconciliation is bounded by `PROMETHEUS_TURN_RECOVERY_INTERVAL_MS` (15 seconds, clamped to 5 seconds–10 minutes) and `PROMETHEUS_TURN_RECOVERY_BATCH` (100, clamped to 1–10,000). The older final-only environment names remain accepted as aliases.

`PROMETHEUS_DISABLE_TURN_JOURNAL=1` is a diagnostic fallback that bypasses the new journal wrapper. It is not the normal production path.

## Bounded progress and final delivery

The final-response path is now explicitly bounded so a large tool result, screenshot, generated artifact, or slow phone cannot make the gateway serialize and retain an unbounded frame:

- `src/gateway/turn-delivery/bounded-payload.ts` bounds progress, final, and done envelopes by exact UTF-8 bytes, limits string/tool-result/base64 depth and breadth, and records replacements. Default whole-frame ceilings are 96 KiB for progress, 384 KiB for final, and 256 KiB for done.
- Oversized text/raw values become content-addressed references. Oversized media data URIs are decoded into the blob store and replaced with a signed same-origin `/api/turn-blobs/:hash` URL so existing image/video fields remain renderable. Grants are hash-scoped and expiring; the default URL lifetime is 30 days and verification rejects grants beyond 90 days.
- `mainChatStreams` retains at most 12,000 frames and 16 MiB per session, evicting oldest frames by both count and exact serialized bytes. Sequence numbers remain monotonic so mobile can detect an evicted gap and cold-recover.
- SSE delivery respects Node backpressure. While a consumer is not draining, nonterminal live frames are dropped from that socket (they remain available in replay), while a deduplicated queue retains at most two bounded terminal frames so the normal `final` → `done` pair survives. A later `error` supersedes a pending `done`. A connection still blocked after 30 seconds is closed without cancelling the turn.
- Replay writes also wait for drain with a 30-second bound instead of building an unlimited response buffer.
- Session state is flushed before final/done publication. The durable final blob is persisted before the terminal frame is appended, and the normal live path marks the journal job complete only after terminal publication. If the process dies in that narrow interval, zero-outbox final-state recovery marks the durable result complete on restart/its next bounded pass; an exact client retry still replays that same final.
- Oversized final replacements are staged with their deterministic content references, then their asynchronous writes and the bounded final blob are awaited before the journal enters `final_persisted`. Live/replay stream bounding only reuses already-durable references, so it cannot introduce a new large compression/fsync pause at publication time.

These changes do not alter Prometheus's user-facing workflow, tools, shared workspace, prompts, or task/team identity. They change where model calls execute and how internal state/results are fenced, stored, and delivered. One deliberate scheduling behavior changed: a scheduled job no longer interrupts every unrelated `BackgroundTaskRunner`; separate jobs remain independent and contend only through bounded capacity and real resource locks/leases.

## Health and lifecycle

`GET /api/health` now has two relevant sections:

- `memoryMaintenance` — maintenance-worker isolation, state/PID, active kind, queue counts, and last-run timestamps.
- `turnRuntime` — `model-process-pool+file-change-process+context-process+observation-process+durable-turn-journal`, configured model capacity plus file-change/context/observation worker capacity, heap/snapshot limits, queues and worker health; cooperative session-persistence status; shared-workspace/file-lease policy; journal queued/active/waiting counts; bounded lease-and-final recovery; and isolated retention state. Recovery status explicitly reports `turnRedispatch: false` and `channelRedelivery: false`.

Runtime workers are internal gateway children, not user-managed command processes. They do not appear under `<configDir>/processes/`.

## Exact current isolation boundary

Provider/model network calls and their stream parsing now run outside the gateway. Memory-index maintenance, finalization file-change scanning, stored-thread footprint diagnostics, and tool-observation persistence also run outside the gateway. Session persistence and remaining large prompt/reference reads stay gateway-owned but are asynchronous, bounded, and/or cooperative so they yield to client traffic.

The complete `runInteractiveTurn(...)` / `handleChat(...)` orchestration does **not** yet run in a child. Prompt construction, session/history mutation, plan/Goal control, the tool loop, tool execution, approvals/questions, browser/desktop ownership, task/team managers, scheduler services, MCP services, and final client routing remain gateway-owned. A model-heavy hour-long turn benefits immediately from process isolation, but a synchronous CPU loop, native crash, or unbounded allocation in any of those remaining gateway paths can still affect every client.

Request ingress is also still gateway-owned. `core/app.ts` uses a global `express.json({ limit: '50mb' })`, so a legitimately large JSON request can still impose one synchronous parse/allocation pause before route code or blob references take over. Replacing that safely requires route-specific limits/streaming attachment admission and client compatibility work; it is a remaining API-boundary project, not silently changed by this phase. Cold loading/parsing of a large legacy session and a few legacy synchronous endpoints are similarly outside the completed hot-path work.

Also keep these durability limits explicit:

- Journal reconciliation does not yet automatically resume a recovered queued/checkpointed job after restart. It only settles zero-outbox finals that were already durably produced.
- The delivery-outbox schema exists, but current chat completion delivery is not yet driven/retried from that outbox.
- Tool-effect fencing covers the central telemetry path plus inline goal completion/blocking, plan declare/advance/step completion, subagent spawn, outer `start_task`, and `request_secondary_assist`. Child commands/processes started by a turn still need an explicit ownership/verification contract before arbitrary mid-tool crash replay can be called complete.
- The generic turn-worker protocol supports RPC and steering, but the production workers currently implement model-call and finalization file-change-scan jobs rather than owning the complete tool loop.
- “Parallel agent” therefore still does not mean “one OS process per complete agent turn.”

## Remaining full-turn extraction plan

1. **Completed: maintenance isolation.** The measured memory-index stall runs in a recycled child with no synchronous production bypass.
2. **Completed: journal, blob store, fencing, and bounded process transport.** New turns receive durable identity/session admission, events/checkpoints/finals, tool-effect records, and resource leases.
3. **Completed: provider/model isolation.** Model calls run in a bounded, heartbeating, recyclable pool and return referenced results.
4. **Completed for main-chat delivery: bounded, nonblocking replay/final transport.** Frames are byte-bounded/blob-backed, slow SSE consumers cannot grow gateway memory without bound, large compression/write/fsync work is awaited asynchronously, stream replay only reuses durable references, and final persistence precedes terminal publication.
5. **Completed: finalization file-change isolation.** Git/diff/stat/read summary work runs in a two-child bounded pool and degrades by omitting optional metadata rather than blocking the gateway.
6. **Next: extract one complete durable turn class.** Move an opt-in background/Goal turn's orchestration and model/tool loop into `turn-worker-process`, with gateway RPC for tools, approvals/questions, browser/desktop/MCP access, session commits, and channel delivery.
7. **Partially completed: final-state restart recovery.** Startup and periodic bounded reconciliation now settle an already-persisted zero-outbox final without rerunning work, preserving exact-client replay. Next, add a bounded dispatcher for reconciled jobs and a real delivery-outbox drainer; restore checkpointed work only after replay policy proves every in-flight effect safe or sends it to review.
8. **Partially completed: close remaining effect ownership gaps.** Outer `start_task` and `request_secondary_assist` now have explicit durable effects. Next, define ownership, verification, and restart behavior for child commands/processes started by a turn.
9. **Gate default full-turn workers with fault injection.** Kill workers during model streaming, tool execution, approval waits, checkpoint writes, and final publication; saturate one worker's CPU/heap; disconnect/reconnect mobile; restart the gateway; verify no duplicate side effects, lost finals, or control-plane freeze.

Do not fork `chat.router.ts` wholesale into every child. It still depends on gateway-owned singletons and callbacks that cannot be duplicated safely. The correct next step is a serializable turn-runtime facade plus explicit gateway RPC, using the journal and protocol already in place.

## Verification

- `npm run test:runtime-workers` covers maintenance broker responsiveness, bounded IPC, crash/respawn, refresh coalescing, and distinct process identity.
- `src/gateway/turn-jobs/turn-job-store.regression.ts` covers durable journal transitions, leases/fencing, checkpoints, tool-effect replay state, outbox records, and stale reconciliation.
- `src/gateway/turn-jobs/turn-final-recovery.regression.ts` fault-tests the crash-after-final window, exact completed-request replay, bounded backlog draining, recovery event provenance, and the rule that any explicit outbox row prevents automatic completion.
- `src/gateway/turn-jobs/turn-fencing.regression.ts` covers fatal in-memory fencing, abort propagation, late-boundary rejection, and stale-attempt local settlement. `turn-shutdown-interruption.regression.ts` and `live-runtime-registry.regression.ts` cover orderly-restart interruption, non-replayable-effect review, shutdown-only abort hooks, and the bounded signal deadline. `src/gateway/turn-workers/credential-ownership.regression.ts` covers the runtime-child OAuth write/refresh prohibition.
- `npm run test:turn-retention` covers terminal-only bounded pruning, FK cascades, preservation of every nonterminal/waiting/review/final-persisted state, every direct blob-reference column, mtime refresh, blob scan/delete caps and cursor continuation, plus distinct child-process identity.
- `src/gateway/turn-delivery/turn-delivery.regression.ts` covers byte-bounded frames, media/reference replacement, Unicode-safe truncation, and replay eviction.
- `src/gateway/turn-jobs/blob-store.regression.ts` and `blob-runtime.regression.ts` cover cooperative asynchronous writes, streamed large-data decoding, canonical sync/async identity, compressed round-trip integrity, and header-only immutable reuse. `resource-policy.regression.ts` covers fail-closed replay classification and bounded recursive file-resource inference.
- `src/gateway/gateway-smoothness.regression.ts` covers large cooperative atomic session writes, overlapping-mutation fencing, delete-vs-rename safety, exact async observation tails, observation/context child PIDs, heap-bounded workers, and post-terminal metadata attachment. `scripts/test-gateway-smoothness-contract.mjs` guards final ordering, failure degradation, bounded process entries, post-terminal maintenance, and lifecycle cleanup.
- `src/gateway/turn-workers/model-call-turn-worker.regression.ts` and `scripts/test-turn-worker-transport.mjs` cover model-worker reference transport and turn-worker heartbeat/cancel/crash/protocol behavior.
- `src/gateway/turn-workers/turn-file-change-worker.regression.ts` verifies distinct/reusable child identity, exact shared-collector output, bounded reference-only terminal IPC, and the explicit diagnostic direct mode.
- `npm run test:turn-safety`, `npm run test:mobile-recovery`, and `npm run test:automations` cover admission/replay/mobile/scheduler contracts around this boundary.
- `npx tsc --noEmit --pretty false` covers the TypeScript source boundary.
