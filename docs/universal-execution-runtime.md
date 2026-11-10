# Universal execution runtime contract

## Goal

Prometheus already has durable live-runtime persistence, restart recovery, background tasks, managed teams, schedules, model-call workers, context workers, and other isolated worker pools. The missing boundary is one execution contract that all of those lanes can share while complete-turn orchestration is gradually moved out of the gateway process.

This change deliberately does **not** recreate the retired `turn-jobs/` or `turn-workers/` architecture. `src/gateway/live-runtime-registry.ts` remains the durable runtime authority.

## New contract

`src/gateway/runtime/execution-contract.ts` adds a stable execution identity above individual worker/process attempts:

- `executionId` — stable for the logical run;
- `attemptId` + `attempt` — changes when the logical run is retried/recovered;
- owner correlation — session/task/team/agent/schedule/client request;
- recovery policy — resume, rerun, mark interrupted, or never resume;
- effect class — read-only, idempotent, mutating, or unknown;
- optional idempotency key;
- explicit execution phases.

The stable execution ID is intentionally separate from a child-process PID or provider request ID. A child can die and a new attempt can continue under the same logical execution.

## Safety rule

Automatic replay is fail-closed:

- read-only work can be rerun;
- idempotent work can be rerun only with an idempotency key;
- mutating or ambiguous work requires operator/recovery logic unless an explicit resume path owns the checkpoint;
- explicit user/operator cancellation is terminal.

This prevents a worker crash from blindly repeating side effects such as posts, purchases, file mutations, or external API writes.

## Controller (removed)

An earlier `src/gateway/runtime/execution-controller.ts` wrapped the live-runtime registry with a prepared/running/checkpoint/complete lifecycle and a worker envelope packet. No runtime lane ever adopted it, so it was deleted in the 2026-11 dead-code sweep. The contract in `execution-contract.ts` (including `decideExecutionReplay(...)`) remains; a lane that migrates should add its lifecycle wrapper together with the first real caller.

## Migration path

This PR is the compatibility layer, not the final process extraction. Existing code can migrate incrementally without changing its durable store.

Recommended order:

1. BackgroundTaskRunner + direct background agents.
2. Scheduled jobs / heartbeat runs.
3. Managed-team manager/member turns.
4. Main interactive turns.
5. Introduce a full-turn child that speaks gateway-owned tool/approval RPC while retaining the same execution envelope.

During migration, the current provider/model worker pool remains valid. The eventual complete-turn child should call gateway-owned tools through a bounded RPC protocol; it should not duplicate session storage, approval state, connector auth, or workspace ownership inside the child.

## Crash/restart contract for the future full-turn worker

A full-turn child should be considered disposable. The durable authorities remain:

- live-runtime ledger / execution envelope;
- session/task/team/schedule stores;
- tool observations and approval state;
- explicit command/process ownership records.

After a crash, the gateway should:

1. load the recoverable live runtime;
2. reconstruct the execution envelope;
3. classify the last checkpoint's side-effect boundary;
4. call `decideExecutionReplay(...)`;
5. resume/rerun only when the decision permits it;
6. increment the attempt while preserving `executionId`.

Child commands/processes launched by a turn still require explicit ownership and verification before arbitrary mid-tool replay can be enabled.

## Regression coverage

`src/gateway/runtime/crash-fault-injection.regression.ts` (`npm run test:crash-recovery`) loads `execution-contract.ts` directly. The deleted controller's regression covered:

- stable execution IDs across attempts;
- safe read-only reruns;
- idempotent retry requirements;
- fail-closed mutation handling;
- lifecycle/checkpoint correlation;
- failure finalization.

Suggested validation:

```bash
npm run test:crash-recovery
npx tsc --noEmit
npm run test:restart-retrigger
npm run test:runtime-workers
```
