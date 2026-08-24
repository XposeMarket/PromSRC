# 44) Gateway and Runtime Process Isolation

Last source verification: 2026-08-24.

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

### Common worker lifecycle and resource telemetry

- `RuntimeWorkerBroker` now accepts opt-in `idleTtlMs`, `maxJobs`, `maxRssBytes`, `maxHeapUsedBytes`, and `oneShot` policies. Retirement happens only after an active job releases the broker, and `shutdown()` is idempotent so a retirement race cannot spawn duplicate children.
- Child status samples include RSS, V8 heap total/used, external and ArrayBuffer memory, cumulative user/system CPU, and bounded V8 heap-space statistics. Broker status derives a CPU percentage from successive samples and exposes the policy, sample age, completed-job count, and retirement reason.
- Gateway runtime status, event-loop stall records, and `/api/status` expose the aggregate generic-worker sample. Model workers expose the same resource classes in their per-slot status while retaining their RSS recycle counter.
- Brain activity uses `oneShot` because package assembly is a heavy burst and does not benefit from a resident child. Automatic memory-search keeps one floor worker warm for the 40–250 ms prompt-retrieval path; only the second elastic slot uses the idle TTL (30 seconds by default) and RSS threshold. Context/model workers remain warm where useful, but their initial warmup and model-slot expansion are demand-aware.

### Provider/model calls

- `src/gateway/turn-workers/` defines a second, turn-oriented process protocol with start, ordered event, checkpoint, heartbeat, RPC, steer, cancel, final, error, and shutdown messages. Messages and payloads are byte-bounded, attempts carry an opaque fencing token, and a worker owns only one submitted job at a time.
- `src/gateway/turn-workers/model-call-dispatcher.ts` runs provider/model calls made through `OllamaClient.chatWithThinking(...)` and `generateWithThinking(...)` in a bounded child-process pool. The child resolves the requested provider/model, streams token/thinking/reasoning/model events back to the gateway, and persists the complete result in the blob store rather than returning it inline.
- The model envelope carries both provider ID and the selected provider account ID. `getProviderAccountId(...)` preserves the originating instance's credential identity, and the child rebuilds it through `buildProviderById(providerId, accountId)` instead of silently falling back to a different active/default OAuth or API-key account. Credentials themselves are not copied into the request blob. Rotating OpenAI Codex/xAI OAuth remains gateway-owned: the gateway preflights once at admission and again through a bounded child-to-gateway RPC when a queued worker actually starts. Runtime children only read the refreshed vault entry; migration writes are suppressed and refresh/save/clear operations are rejected in those children so parallel processes cannot race a rotating refresh token or overwrite the vault.
- The default pool has three configured workers, is clamped to one through four workers, queues at most 12 jobs, recycles a worker after 20 completed model jobs or 1 GiB RSS, treats 30 seconds without a heartbeat as failure, and grants five seconds for cancellation before force termination. The pool expands lazily with demand, so the first model request does not automatically start every configured slot. Each model child receives a 1,024 MiB V8 old-space ceiling by default (operator-clamped 128–8,192 MiB) unless an explicit inherited Node `--max-old-space-size` is already present. This limits V8 old space, not total RSS/native memory, so RSS recycling remains necessary. There is deliberately no fixed one-hour-style turn timeout.
- A failed or recycled model worker does not take down the gateway. The pool replaces it, while the owning gateway turn receives the bounded error/cancellation result.
- The model-call request sent over IPC contains blob-root/request references, not a copied conversation history. This keeps IPC bounded even when a turn has a large context.
- Preparing turn attachments/admission payloads, central tool-effect results, and model requests no longer runs canonical JSON serialization, gzip, file write, and fsync as one synchronous gateway operation. Attachment writes use bounded concurrency; the large-value normalizer/serializer yields cooperatively; compression/write/fsync use the asynchronous blob path before referenced state is admitted, committed, or submitted.

Environment controls:

- `PROMETHEUS_MODEL_WORKER_COUNT` — configured model worker count; default 3, clamped to 1–4. Slots are started lazily as queue demand requires.
- `PROMETHEUS_MODEL_WORKER_MAX_QUEUE` — queued model requests; default 12, clamped to 0–100.
- `PROMETHEUS_MODEL_WORKER_RECYCLE_JOBS` — model calls completed before recycling a child; default 20.
- `PROMETHEUS_MODEL_WORKER_RECYCLE_RSS_BYTES` — per-child RSS recycle threshold; default 1 GiB.
- `PROMETHEUS_MODEL_WORKER_MAX_OLD_SPACE_MB` — per-model-child V8 old-space ceiling; default 1,024 MiB, clamped to 128–8,192 MiB. An explicit inherited Node `--max-old-space-size` remains authoritative.
- `PROMETHEUS_DISABLE_MODEL_WORKERS=1` — diagnostic fallback to provider calls in the gateway process. Child workers also disable redispatch automatically to prevent recursion.
- `PROMETHEUS_MEMORY_REFRESH_WORKER_TIMEOUT_MS` — per-refresh timeout; default 15 minutes, minimum 30 seconds.
- `PROMETHEUS_MEMORY_REFRESH_WORKER_STARTUP_TIMEOUT_MS` — maintenance-child readiness timeout; default 45 seconds, minimum 1 second.
- `PROMETHEUS_RUNTIME_WORKER_RESOURCE_SAMPLE_MS` — generic child resource heartbeat interval; default 5 seconds, clamped to 1–60 seconds.
- `PROMETHEUS_CONTEXT_BUILD_WARM_WORKER_COUNT` — context workers warmed before listen; default 1, while later demand may use the configured pool.
- `PROMETHEUS_CONTEXT_BUILD_MAX_HEAP_USED_BYTES` — optional context-child V8 heap-used retirement threshold; zero disables the threshold.
- `PROMETHEUS_AUTOMATIC_MEMORY_SEARCH_WORKERS` — automatic prompt-retrieval slots; default 2, clamped to 1–2. Slot one is the permanently warm latency floor; slot two is elastic.
- `PROMETHEUS_AUTOMATIC_MEMORY_SEARCH_IDLE_TTL_MS` — idle retirement for elastic automatic-memory slots; default 30 seconds, clamped to 1 second–10 minutes.

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
- The session hot cache is bounded by both 256 entries and an estimated 256 MiB of UTF-8 serialized session state by default; the estimate includes full retained history/tool logs and artifact metadata, not just entry count. Entries must also be idle for 30 minutes and not live/pending before eviction. `getSessionCacheStatus()` returns the last estimate and an `estimateStale` flag; dirty sessions are recursively remeasured at most once per five seconds or when the last estimate shows pressure, so status polling does not walk a giant transcript on the gateway thread. `PROMETHEUS_SESSION_CACHE_MAX_BYTES` controls the byte budget (16 MiB–4 GiB).
- Automatic project learning and model-generated titles are post-terminal maintenance. Project lookup uses async bounded metadata reads; title transcript selection stops after six visible messages, title work is one global/single-flight job, and an abortable eight-second default deadline prevents it from occupying the shared model pool indefinitely. Completion notifications are also scheduled only after final/done publication.

### Turn-context continuity and cancellation

- `src/gateway/context/turn-context-packet.ts` defines the bounded safe handoff retained in `Session.workingContextPackets` (five recent rich turns at most). It carries findings, decisions, completed actions, compact tool/progress state, uncertainties, pending work, and continuation instructions; it does not persist private/raw model thinking.
- Provider reasoning-summary events are accumulated separately from the private thinking stream. The safe summary is available to the next turn and to both rolling and mid-workflow compaction under `[RECENT_REASONING_AND_DECISIONS]`.
- The main-chat live-runtime abort hook flushes an immediate packet from the live checkpoint. The normal post-turn finalizer merges that packet by `turnId` with any completed tool observations, so cancellation before regular unwinding still leaves a usable continuation packet.
- In-flight tool effects remain uncertain in the packet and must be verified before retry. Progress-state events are reduced into the checkpoint so active plan state is retained as well as tool boundaries.

Environment controls added by this layer include `PROMETHEUS_CONTEXT_FOOTPRINT_HEAP_MB`, `PROMETHEUS_CONTEXT_FOOTPRINT_MAX_SNAPSHOT_MB`, `PROMETHEUS_TOOL_OBSERVATION_HEAP_MB`, `PROMETHEUS_TOOL_OBSERVATION_MAX_SNAPSHOT_MB`, `PROMETHEUS_TOOL_OBSERVATION_WORKERS`, `PROMETHEUS_TOOL_OBSERVATION_FAST_PATH_MS`, `PROMETHEUS_TOOL_OBSERVATION_TAIL_MAX_BYTES`, `PROMETHEUS_TOOL_OBSERVATION_LINE_MAX_BYTES`, and `PROMETHEUS_AUTO_TITLE_TIMEOUT_MS`.

### Runtime admission and reserved capacity

- `runtime-admission.ts` separates interactive, system, and background lanes. Brain/cron work intentionally remains in the `system` lane; it is not mislabeled as background. Background work remains capped independently.
- By default one active slot is reserved for interactive work (`PROMETHEUS_RUNTIME_RESERVED_INTERACTIVE_SLOTS=1`). Noninteractive leases also carry a relative resource weight (interactive 1, system/background 2), with optional process-wide weight and byte budgets. The reservation and budgets are visible in the admission snapshot; they do not replace worker RSS/heap caps.
- Controls are `PROMETHEUS_RUNTIME_MAX_ACTIVE`, `PROMETHEUS_RUNTIME_MAX_BACKGROUND_ACTIVE`, `PROMETHEUS_RUNTIME_MAX_QUEUE`, `PROMETHEUS_RUNTIME_ADMISSION_MAX_WAIT_MS`, `PROMETHEUS_RUNTIME_RESERVED_INTERACTIVE_SLOTS`, `PROMETHEUS_RUNTIME_MAX_RESOURCE_WEIGHT`, and the optional `PROMETHEUS_RUNTIME_MAX_RESOURCE_BYTES`.

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
- `runtimeWorkers` — aggregate generic broker child count, RSS, heap, external/ArrayBuffer memory, CPU percentage, per-worker samples, lifecycle policy, and retirement state. This is also persisted in gateway runtime status and event-loop stall diagnostics.

Runtime workers are internal gateway children, not user-managed command processes. They do not appear under `<configDir>/processes/`.

## Exact current isolation boundary

Provider/model network calls and their stream parsing now run outside the gateway. Memory-index maintenance, finalization file-change scanning, stored-thread footprint diagnostics, and tool-observation persistence also run outside the gateway. Session persistence and remaining large prompt/reference reads stay gateway-owned but are asynchronous, bounded, and/or cooperative so they yield to client traffic.

The complete `runInteractiveTurn(...)` / `handleChat(...)` orchestration does **not** yet run in a child. Prompt construction, session/history mutation, plan/Goal control, the tool loop, tool execution, approvals/questions, browser/desktop ownership, task/team managers, scheduler services, MCP services, and final client routing remain gateway-owned. A model-heavy hour-long turn benefits immediately from process isolation, but a synchronous CPU loop, native crash, or unbounded allocation in any of those remaining gateway paths can still affect every client.

The 2026-08-08 tool-performance pass makes that boundary measurable without moving it: the gateway owns tool admission/dispatch/execution and records opaque tool spans, while model-call workers report provider-round queue/IPC/event/RSS timing. The local safe fixtures showed dispatch and result transport at only a few milliseconds, with provider emission and post-result model visibility dominating. Do not infer that model-worker isolation means complete tool-loop isolation; browser, desktop, workspace, MCP, approvals, and task/subagent execution still cross the gateway-owned executor.

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
## P0-1 performance record — 2026-08-08

- The full gateway remains the owner of request ingress, prompt/context assembly, session mutation, tool orchestration, approvals, and channel delivery. The performance pass did not move the complete turn loop into a child process.
- Existing worker isolation and bounded stream delivery remain relevant to tail latency, but the current investigation found a separate gateway-owned risk: the session transcript cache was process-long and unbounded. The hot cache now has both a 256-entry bound and a byte-weighted default budget, while still protecting active/pending sessions.
- The managed gateway restarts on 2026-08-08 replaced PID 21480 with PID 20108 and later PID 20108 with PID 23796; the replacement exposed memory byte fields and reported a clean bounded cache. Treat this as live-code/clean-start verification, not a completed leak soak.
- Model/tool latency must be analyzed by unique turn and provider attempt. The local timing log has provider-request-start marks in the thousands because retries/attempts can occur inside fewer turns; do not report those marks as unique user requests.
- `chat.router.ts` now keeps per-provider-round first-event and first-visible timestamps as well as turn-level marks. This prevents a later tool-round `providerWaitMs` or `provider_done` delta from subtracting the current round's start from an earlier round's event.
- The local Luna-medium surface smoke confirmed the correction: the pre-fix multi-pass trace emitted an impossible negative provider wait, while the post-fix trace reported a positive per-round wait. The remaining user-visible wall time is still dominated by provider/tool round trips, so complete-turn worker extraction and per-round queue/tool spans remain follow-up work.
- Future memory profiling should use the health byte fields, sessionCache status, worker RSS, and retained stream counts together. Do not attribute all gateway RSS to model workers or durable raw-observation disk usage.

## P0-1 focused follow-up — provider rounds, startup readiness, and tool tails — 2026-08-08

- `src/gateway/chat/context-build-worker-client.ts` already exposes worker-pool warmup; `server-v2.ts` now awaits it and prewarms the lazy chat router before opening the HTTP listener. The remaining startup wiring that previously began one second after listen also completes before the listener, preventing a port-open but event-loop-blocked first-message window.
- Final controlled samples showed context-worker ready waits of 0–1 ms and context builds of roughly 0.33–0.68 s. The model/provider round remained the dominant accepted→tool-call and result→visible span, while local dispatch/result transport stayed in the low single-digit milliseconds.
- `chat.router.ts` now reuses the built tool surface and full system prompt across rounds within a turn. Final traces show initial tool-surface work of 0–98 ms and later `cacheHit=true` builds at 0 ms; this removes repeated schema/prompt assembly without changing the normal tool contract.
- A startup-window benchmark timeout was excluded because it had no trace and occurred while the managed listener was rotating. The final post-restart desktop/browser batch completed 6/6 turns with zero tool errors, and the harness now retries only disposable setup/cleanup calls during that rotation.
- Desktop/browser remain gateway-owned tool execution paths; model-call process isolation does not isolate synchronous desktop PowerShell, OCR, UI Automation, CDP, or tool orchestration work. Continue measuring those spans separately before attempting full-turn extraction.

## Desktop target lifecycle — 2026-08-08

- `src/gateway/desktop-target-lease.ts` now owns the background-target state
  machine: on-demand acquire, single-flight start/readiness, renew, explicit
  session release, bounded idle stop, stale ownership recovery, cancellation,
  and shutdown race protection. The default idle grace is ten minutes;
  `PROMETHEUS_DESKTOP_WARM_MODE=1` is opt-in.
- The default repository target is the local Windows Sandbox folder bridge.
  The foreground native helper is host-native and is a separate boundary.
  The registered Hyper-V `Prometheus-Desktop` VM is external to the current
  repository transport; `src/gateway/desktop-hyperv-target.ts` provides an
  exact-name, ownership-marked control boundary but background commands remain
  disabled in Hyper-V mode until an authenticated worker protocol exists.
- Lifecycle status is persisted under `.prometheus/desktop-background/` with a
  bounded event log that contains metadata only. Gateway shutdown rehydrates
  persisted ownership before stopping an owned target, while active leases
  defer cleanup for the next recovery boundary.
