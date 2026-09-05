# 44) Gateway and Runtime Process Isolation

Last source verification: 2026-09-05.

## Why this boundary exists

The gateway is the control plane. Mobile, Telegram, desktop, HTTP, SSE, and WebSocket clients all depend on its event loop staying responsive while Prometheus performs expensive maintenance, context construction, provider/model work, or other CPU/memory-heavy operations.

A timer or `async` function is not process isolation. Work is isolated only when it actually runs in a child process (or another external runtime) and the gateway communicates with it through a bounded interface.

## Current source map

### Shared runtime-worker infrastructure

Current generic worker infrastructure lives under `src/gateway/process/`:

- `runtime-worker-protocol.ts` — bounded/versioned generic worker messages.
- `runtime-worker-broker.ts` — child startup/readiness, one-job admission, timeouts, crash handling, resource telemetry, retirement, respawn, and shutdown.
- `runtime-worker-resources.ts` — normalized RSS/heap/CPU/heap-space telemetry used by internal worker diagnostics.

The same directory also contains the current model/context/memory worker entry points. Do not use the retired `src/gateway/turn-workers/` path when locating worker code.

### Memory-index maintenance

- `src/gateway/process/memory-index-worker.ts` runs synchronous memory-index refresh work outside the gateway event loop.
- `src/gateway/memory-index/refresh-worker-client.ts` owns the gateway-side request/coalescing/status boundary.
- `GET /api/health` exposes the current memory-maintenance status as `memoryMaintenance`, including isolation, state/PID, active kind, queue counts, and last-run timestamps.

This remains the important protection against a large memory-index refresh freezing the entire control plane.

### Memory search

- `src/gateway/process/memory-search-worker.ts` is the isolated search worker entry point.
- `src/gateway/memory-index/search-worker-client.ts` owns query and automatic-memory worker clients/pools.
- Worker regressions live under `src/gateway/memory-index/`, including `memory-search-worker.regression.ts`, readiness coverage, automatic-memory search, and prewarm coverage.

### Context construction

- `src/gateway/process/context-build-worker.ts` is the child entry point for isolated context/personality build work.
- `src/gateway/chat/context-build-worker-client.ts` owns the pool, warmup, fallback/isolation status, and shutdown lifecycle.
- `src/gateway/chat/context-build-worker-pool.regression.ts` covers this boundary.

The context-build pool is reported through `/api/status` under `gatewayQueues.contextBuildWorkers`; the related gateway limiter is `gatewayQueues.contextBuild`.

### Provider/model calls

Provider/model isolation is now a dedicated model-call worker pool under `src/gateway/process/`:

- `model-call-worker-protocol.ts` — bounded model-call request/stream/result protocol.
- `model-call-worker-pool.ts` — queue, child slots, lazy expansion, heartbeat/cancel handling, recycling, resource telemetry, and shutdown.
- `model-call-worker.ts` — child entry that executes the requested provider/model call.
- `src/agents/ollama-client.ts` calls `dispatchModelCallWorker(...)` when model workers are enabled and forwards token/thinking/reasoning/model events through the pool callbacks.

Current pool defaults verified in `model-call-worker-pool.ts`:

- enabled unless `PROMETHEUS_MODEL_CALL_WORKERS=0`;
- 3 configured workers by default, clamped to 1–4 (`PROMETHEUS_MODEL_WORKER_COUNT`);
- 1 warm slot by default (`PROMETHEUS_MODEL_WORKER_WARM_SLOTS`);
- non-warm idle TTL 60 seconds by default (`PROMETHEUS_MODEL_WORKER_IDLE_TTL_MS`);
- queue limit 12 (`PROMETHEUS_MODEL_WORKER_MAX_QUEUE`);
- model-call timeout 15 minutes by default (`PROMETHEUS_MODEL_WORKER_TIMEOUT_MS`), clamped to 1 second–60 minutes;
- startup timeout 20 seconds, heartbeat timeout 30 seconds, cancel grace 5 seconds;
- recycle after 20 jobs or 1 GiB RSS by default;
- V8 old-space ceiling 1,024 MiB by default, clamped to 128–8,192 MiB unless an explicit inherited Node heap flag is already authoritative.

`src/gateway/process/model-call-worker-pool.regression.ts` and `model-call-worker-pool-expansion.regression.ts` are the current direct regressions for this pool.

### Brain activity packaging

Brain activity packaging has its own child-process boundary rather than living in the old turn-worker tree:

- `src/gateway/brain/activity-package-worker-client.ts` owns the gateway-side lifecycle/status.
- Its status is included in `/api/status.gatewayQueues.brainActivityWorker`.

### Thread/session search

Thread/session search also uses a worker boundary. Current regression coverage is `src/gateway/threads/session-search-worker.regression.ts`.

## What remains gateway-owned

Process isolation is targeted, not one OS process per complete Prometheus turn.

Current source keeps orchestration and durable chat/session ownership in the gateway. In particular:

- session/history persistence remains in `src/gateway/session.ts`;
- active runtime ownership/recovery uses `src/gateway/live-runtime-registry.ts`, `src/gateway/runtime-recovery.ts`, and history reconciliation helpers;
- file-change summaries are derived by `src/gateway/file-change-summary.ts`, including recovery from persisted process entries;
- compact tool observations are owned by `src/gateway/tool-observations.ts`;
- chat routing/tool orchestration remains gateway-owned under the current chat/runtime modules.

Do not infer that every heavy-looking concern has its own worker simply because an older self-documentation revision once described one.

## Current observability

Two endpoints matter, and their roles are different:

### `GET /api/health`

Current `src/gateway/core/app.ts` exposes:

- process/gateway basics (`ok`, uptime, PID, timestamp);
- model-busy and active-runtime summaries;
- `memoryMaintenance` worker status.

There is **no current `/api/health.turnRuntime` object**.

### `GET /api/status`

Current `src/gateway/server-v2.ts` exposes internal queue/worker state under `gatewayQueues`, including at least:

- `contextBuild`;
- `contextBuildWorkers`;
- `modelCallWorkers`;
- `brainActivityWorker`;
- post-turn/session-persistence/session-cache status supplied by the current gateway queue-status builder.

Use `/api/status.gatewayQueues.*` for the model/context/Brain worker pool view instead of the retired `health.turnRuntime` map.

## Retired architecture names — do not treat as current

The following names existed in an earlier process-isolation design but are not present in the current source tree and must not be used as current implementation locations:

- `src/gateway/turn-workers/`;
- `src/gateway/turn-jobs/`;
- `src/gateway/turn-delivery/`;
- `model-call-turn-worker.ts` / `model-call-dispatcher.ts` under `turn-workers`;
- `turn-file-change-worker.ts` / `turn-file-change-dispatcher.ts`;
- `context-footprint-worker.ts` / `context-footprint-client.ts`;
- `tool-observation-persistence-client.ts` and its old worker pool;
- `<configDir>/runtime/turn-jobs.sqlite` as a current authoritative turn store;
- `<configDir>/runtime/turn-blobs/` and `/api/turn-blobs/:hash` as current delivery architecture;
- `/api/health.turnRuntime`;
- old turn-journal/file-change/context-footprint/observation-worker environment controls that have no source owner on current `main`.

If a future refactor reintroduces any of these concepts, document the new actual path/API rather than reviving an old name by analogy.

## Recovery and file-change notes

Current recovery logic is source-backed by `src/gateway/runtime-recovery.ts`. It rebuilds recoverable assistant/runtime state from current session/live-runtime/process-entry data and uses `collectTurnFileChangesFromProcessEntries(...)` from `src/gateway/file-change-summary.ts` where a recovered file-change summary is needed.

That is different from the retired design where a dedicated finalization file-change child and durable turn journal were described as authoritative.

## Verification checklist for future self-documentation edits

Before changing this file:

1. Verify every named implementation directory/file exists on current `main`.
2. For an environment variable, search current source and identify the owning implementation before documenting a default.
3. Verify diagnostic field ownership against `src/gateway/core/app.ts` (`/api/health`) or `src/gateway/server-v2.ts`/`core/server.ts` (`/api/status`) rather than copying an old response shape.
4. Distinguish internal gateway workers from the managed user/tool process supervisor under `src/gateway/process/`.
5. Prefer current direct regressions (`runtime-worker-broker.regression.ts`, model-call worker regressions, context-build worker regression, memory-search regressions, session-search worker regression, and `core/server-status.regression.ts`) over references to deleted test files.
6. When a subsystem is removed, remove its operational claims from every self-reference that tells Prometheus how to locate or inspect it.

## Maintenance truth

The architectural principle still holds: isolate expensive work that can starve the gateway, keep worker communication bounded, expose enough diagnostics to tell an internal worker from a managed command, and degrade safely when an optional isolated path fails.

The implementation map must follow the source. A correct architectural idea attached to a deleted directory is still incorrect self-documentation.
