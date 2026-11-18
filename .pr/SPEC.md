# SPEC: rounds that ran as one parallel batch are not idle rounds

Tier: 1 + review (fix inside a sensitive area: core chat engine)
Surface: backend
Parity: n/a (shared turn loop, every surface, model and agent type uses it)
Test: npx tsx src/testing/replay/idle-round-ceiling.regression.ts

## Problem
The idle-round ceiling ends a turn after 8 consecutive rounds in which the runtime dispatched no tool. When every call in a round is parallel-safe, the whole round runs up front as one batch (`handle-chat.ts` `if (canRunParallelBatch)`), which increments `toolDispatchCount`. The round-start snapshot `toolDispatchCountAtRoundStart` was taken after that batch, and the ordered loop then reuses the batch results without dispatching again. So the counter equals the snapshot and the round is counted as idle even though every call ran.

Evidence, 2026-11-10: background agent bg_fe35a9f2 (Haiku 5.5) ran 8 rounds of batched reads, 21 calls, 20 results, and was ended with "the model kept requesting calls that were not run (8 rounds in a row)". A second agent was cut off the same way mid-fix. Agents are told to batch independent reads, so this hits well-behaved turns.

## Existing code
- `src/gateway/routes/chat/pipeline/handle-chat.ts`: counter declared near line 1011, incremented in `executeToolWithTelemetry`, compared after the ordered loop.
- `src/gateway/chat/tool-dispatch-policy.ts`: `resolveIdleRoundLimit`, default 8.
- `src/testing/replay/scenarios.ts`: `runaway-turn-has-a-ceiling` covers the ceiling itself. No scenario covers consecutive fully parallel rounds.

## Options
1. Take the snapshot before the up-front parallel batch (2 lines moved). Smallest, fully works.
2. Track "round dispatched" as a boolean set in every dispatch path. More code, same result.
3. Raise the limit. Does not fix it.

## Chosen approach
Option 1.

## Acceptance
- 10 consecutive rounds of two parallel-safe calls each all run, and the turn ends with the model's final text.
- A model repeating a blocked call is still stopped by the ceiling (`runaway-turn-has-a-ceiling` unchanged and passing).

## Out of scope
The limit value, the cut-off message, lazy parallel groups (already counted: they dispatch inside the ordered loop, after the snapshot).

## Files
- `src/gateway/routes/chat/pipeline/handle-chat.ts` - move the snapshot above the parallel batch
- `src/testing/replay/scenarios.ts` - new contract scenario `parallel-rounds-are-not-idle` (also runs in `npm run test:replay`)
- `src/testing/replay/idle-round-ceiling.regression.ts` - runs both polarities: the new scenario and `runaway-turn-has-a-ceiling`
- `package.json` - `test:idle-round-ceiling` script

## Risks
A round is now idle only if nothing was dispatched in either path, which is what the comment at the comparison already says. Rollback: revert the commit.
