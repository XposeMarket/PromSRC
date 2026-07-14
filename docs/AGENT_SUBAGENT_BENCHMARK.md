# Agent and subagent benchmark stabilization

The 2026-07-11 benchmark confirmed persistent subagent chat and ephemeral
background handoff, but found incorrect background model routing, broken fresh
agent creation, and unbounded history hydration.

## Routing

`background_ops(action="spawn")` now resolves
`agent_model_defaults.background_task`, labels that source truthfully, and calls
the chat loop with execution mode `background_task`. Explicit `model` and
`provider` overrides remain available and are reported as spawn overrides.

## Disposable creation

`spawn_subagent` accepts an omitted `subagent_id` only when
`create_if_missing` is present, in which case it generates a safe ID. Creation
validates description, system instructions, constraints, success criteria, and
all optional array fields before writing anything. Internal definitions also
normalize every array, preventing raw `undefined.map` failures.

## Compact hydration

- `agent_run_ops(action="list")` defaults to compact ID, agent, title, status,
  elapsed time, current step/progress, capped last issue, runner state, and
  recovery availability. `detail="full"` remains explicit; `get` hydrates one
  run.
- `task_control(action="list")` no longer includes every scheduled job unless
  `include_scheduled=true`.
- `chat_with_subagent` returns the new reply only. Recent history and thinking
  require `include_history`/`include_thinking`.

## Disposable benchmark

`agent_run_ops(action="benchmark_disposable")` provisions a temporary agent,
runs a bounded no-side-effect prompt, verifies the routed model/result, waits
for terminal state, cancels on timeout, deletes the task, deletes the agent,
and reports elapsed time plus cleanup status.

Run `npm run test:agents` to verify background routing, conditional ID
generation, typed creation errors, compact hydration, delta chat, benchmark
schema, and lifecycle contracts.
