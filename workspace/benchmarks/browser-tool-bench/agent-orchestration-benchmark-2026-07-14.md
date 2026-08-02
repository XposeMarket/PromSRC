# Prometheus Agent, Team, Task, and Schedule Benchmark — 2026-07-14

## Executive summary

This benchmark exercised Prometheus agent-oriented tooling using **GPT-5.6 Luna and GPT-5.6 Terra only for benchmark workers**. `background_spawn` was deliberately excluded. The interactive benchmark driver remained the current main-chat model (`openai_codex/gpt-5.6-sol`), but no requested worker execution was intentionally routed to Soul.

The short version:

- **Direct standalone agent chat works well.** Luna and Terra routing was correct, deterministic answers were correct, and responses arrived in about **5–10 seconds**.
- **A one-shot scheduled job owned by a Luna standalone agent worked end to end.** Create, run-now, task linkage, result persistence, history, and deletion all worked. The actual scheduled run took **22.3 seconds**; `run_now` acknowledgement took **29.7 seconds** and the job-level wall clock was **50.2 seconds**.
- **Managed-team creation failed completely.** The coordinator spent **8 minutes 26 seconds** trying, but the exposed team-management schema did not provide required `name` and `team_context` fields. No team was persisted and no team member task ran.
- **Durable standalone task execution is broken for this path.** The agent received model routing correctly but lost the usable assignment/tool surface, could not call the read-only workspace tools the boot runtime demanded, and was paused after three no-progress rounds.
- **Task recovery is broken in the current main runtime.** `agent_run_ops(recover)` failed immediately with `[task-router] Not initialized — call initTaskRouter() first`.
- **Disposable benchmark execution is broken for both Luna and Terra.** Both generated temporary agents and tasks, then paused with no result because the task context was missing the benchmark assignment. Luna failed in **42.0 s** and Terra in **72.0 s**.
- **Mailbox send succeeded, but reply-wait reliability is poor.** The send returned in **4 ms**, while the corresponding wait consumed **300.6 s** and returned `no_reply`.
- **Schedule observability has a serious semantic-validation gap.** The existing `Morning motivational wake-up` job is marked healthy/success even though its latest recorded output is an unrelated long “Prometheus Strategic Brief,” not a morning wake-up. With no expected outputs configured, `schedule_job_outputs(check)` incorrectly reports that all outputs look current.
- **Cleanup succeeded.** The disposable schedule, three benchmark tasks, and two leaked disposable agents were deleted. Original jobs and configured agents were preserved.

## Scope

### Included

- Model-routing inspection and per-agent overrides
- Agent list and agent detail
- Direct persistent standalone chat
- Direct request/turn path
- Asynchronous agent message/send path
- Reply wait
- Durable standalone background handoff
- Task list/get/latest/delete
- Agent run get/recover
- Disposable benchmark runner
- Managed-team coordinator path
- Direct team list
- Scheduled-job list/create/run-now/detail/history/log search/output check/delete
- Aggregate automation dashboard
- Workspace benchmark artifact creation and cleanup verification

### Excluded by request

- `background_spawn`

### Not destructively exercised

The following controls were not applied to Raul's pre-existing tasks or schedules solely to increase coverage:

- Pausing/resuming/cancelling a healthy user-owned task
- Mutating the existing morning job prompt or schedule
- Deleting existing configured agents
- Retrying old failed production work

The benchmark instead used disposable objects where possible.

## Model configuration used

| Agent / role | Route | Reasoning | Result |
|---|---|---:|---|
| Rin, standalone verifier | `openai_codex/gpt-5.6-luna` | low | Correctly resolved in direct chat and schedule run |
| Vera, deterministic worker | `openai_codex/gpt-5.6-luna` | low | Correct direct turn |
| Rowan, analysis worker | `openai_codex/gpt-5.6-terra` | medium | Correct direct turn |
| Niko, verifier | `openai_codex/gpt-5.6-luna` | low | Message delivered; no reply received |
| Rhea, intended team manager | `openai_codex/gpt-5.6-terra` | medium | Team could not be created |
| Disposable verifier | `openai_codex/gpt-5.6-luna` | low | Runtime failed before result |
| Disposable analyst | `openai_codex/gpt-5.6-terra` | medium | Runtime failed before result |

`get_agent_models` confirmed these individual overrides after testing. The benchmark did not intentionally assign `gpt-5.6-sol` to any worker.

## Test matrix

| Area | Operation | Route | Observed latency | Status | Evidence / result |
|---|---|---|---:|---|---|
| Agent registry | `agent_ops(list)` | driver | <1 ms | PASS | Six initial configured entries including Main; five named subagents |
| Agent detail | `agent_ops(info)` for Rin | driver | <1 ms | PASS | Returned workspace, allowed paths, identity, Luna route, reasoning |
| Model config | `get_agent_models` | driver | 0–4 ms | PASS | Defaults and individual overrides visible |
| Model config | Five `set_agent_model` calls | driver | 249–399 ms each | PASS | Luna/Terra overrides persisted for next spawn |
| Standalone chat | `chat_with_subagent` with Rin | Luna | 9.59 s | PASS | `MODEL_ROUTE: openai_codex/gpt-5.6-luna; RESULT: 37; CHECK: PASS.` |
| Direct agent turn | Vera | Luna | 8.55 s | PASS | `VALUE=5781`, correct for 123×47 |
| Direct agent turn | Rowan | Terra | 4.99 s | PASS | Correct supplied heading and Terra route |
| Agent chat action | `talk` to Rowan | Terra | <1 ms | FAIL | Tool treated Rowan as requiring team membership: “Could not find a team containing agent” |
| Mailbox send | Niko | Luna target | 4 ms | PASS | Message accepted and delivered asynchronously |
| Mailbox reply wait | Niko | Luna target | 300.59 s | FAIL | `success:true` but `status:no_reply`, empty replies |
| Durable handoff | Rin background message | Luna | 69 ms enqueue; ~198 s to pause | FAIL | Assignment/tool surface unusable; three no-progress rounds |
| Task get | `task_control(get)` | driver | 4 ms | PASS | Correct paused/needs-assistance state and error details |
| Run get | `agent_run_ops(get)` | driver | 9 ms | PASS | Rich run state, journal, model route, failure evidence |
| Run recovery | `agent_run_ops(recover)` | driver | 24 ms | FAIL | `[task-router] Not initialized — call initTaskRouter() first` |
| Disposable runner | Luna verifier | Luna | 41.98 s | FAIL | `needs_assistance`, empty result |
| Disposable runner | Terra analyst | Terra | 72.04 s | FAIL | `needs_assistance`, empty result |
| Team coordinator | Create/run disposable team | Luna coordinator; Terra manager; mixed members | 506.10 s | FAIL | No team persisted; required schema fields unavailable |
| Team list | `team_ops_wrapper manage/list` | driver | <1 ms | PASS | Correctly reported zero teams |
| Schedule list | `schedule_job(list)` | driver | 1 ms | PASS | Returned two original jobs |
| Schedule create | One-shot assigned to Rin | Luna | 5 ms | PASS | Correct owner, model, isolated session, run-at |
| Schedule run-now | Disposable one-shot | Luna | 29.72 s | PASS, slow ACK | Queued successfully |
| Scheduled execution | Agent task | Luna | 22.31 s execution | PASS | Correct value 391 and route; linked task complete |
| Schedule wall clock | Job-level | Luna | 50.22 s | PASS | Includes queue/orchestration overhead |
| Schedule detail | Disposable job | driver | 799 ms | PASS | Config, task link, result, history, memory surfaced |
| Schedule history | Disposable job | driver | 2 ms | PASS | Cron, run-log, structured-log records surfaced |
| Schedule output check | Existing morning job | driver | 1 ms | TECH PASS / SEMANTIC FAIL | No expected outputs means wrong-content run passes validation |
| Schedule log search | Existing morning job | driver | 4 ms | PASS | Found two records containing unrelated strategic brief |
| Schedule delete | Disposable job | driver | 2 ms | PASS | Removed cleanly |
| Task delete | Three benchmark tasks | driver | 24–26 ms each | PASS | Removed cleanly |
| Agent cleanup | Two leaked disposable agents | driver | 187–190 ms each | PASS | Agent chat records removed |
| Aggregate dashboard | Full agent/team/task/job snapshot | driver | 2.34 s | PASS, oversized | Useful but returned a very large payload |
| Task list | All sessions, 100 max | driver | 844 ms | PASS, oversized | Found 95 tasks and two jobs; result payload was extremely large |
| Tool telemetry | `workspace_run(telemetry)` | driver | 2 ms | INCONCLUSIVE | Returned zero calls because telemetry scope was not connected to these wrapper calls |

## Correctness checks

### Direct Luna chat

Expected: `19 + 18 = 37`.

Observed:

```text
MODEL_ROUTE: openai_codex/gpt-5.6-luna; RESULT: 37; CHECK: PASS.
```

Result: **PASS**.

### Luna direct agent turn

Expected: `123 × 47 = 5,781`.

Observed:

```text
MODEL=openai_codex/gpt-5.6-luna; VALUE=5781; PASS
```

Result: **PASS**.

### Terra direct agent turn

Expected supplied heading: `# Browser Tool Benchmark`.

Observed:

```text
MODEL=openai_codex/gpt-5.6-terra; HEADING=# Browser Tool Benchmark; PASS
```

The workspace benchmark driver independently read `browser-tool-bench/README.md` and confirmed the heading.

Result: **PASS**.

### Luna scheduled job

Expected: `17 × 23 = 391`.

Observed:

```text
SCHEDULE_BENCH_VALUE=391
PROVIDER_MODEL=openai_codex/gpt-5.6-luna
MIXED_AGENT_OK
```

Result: **PASS**.

## Detailed failures

### P0: Managed-team creation schema is unusable

The coordinator attempted to create a disposable managed team but reported that every create attempt was rejected because required fields were not available through the exposed schema:

- Required but unavailable: `name`
- Required but unavailable: `team_context`

Consequences:

- No team ID
- No persisted team
- No member task IDs
- No parallel dispatch
- No result collection
- No manager synthesis
- No status lifecycle to inspect

The coordinator call consumed **506.1 seconds** before returning failure. This is both a correctness failure and a severe latency/cost amplifier.

Recommended fix:

1. Align the public/coordinator-facing managed-team schema with the runtime create contract.
2. Add contract tests that create, list, dispatch, collect, and delete a disposable team.
3. Fail schema validation before invoking an LLM loop.
4. Cap coordinator retries for deterministic schema errors to one attempt.
5. Return the exact missing schema keys in a typed error immediately.

### P0: Durable standalone task loses actionable context/tools

The direct durable handoff created task `b184087d-ee9e-46a4-ae26-ab0991088400` and correctly routed Rin to Luna. The execution then failed because:

- The boot runtime instructed Rin to use `list_files` and `read_file`.
- Those tools were not actually exposed in the subagent thread.
- Planning/progress tools such as `bg_plan_advance` were disabled in boot mode.
- Subsequent rounds claimed the assignment details were unavailable even though the original prompt contained them.
- After three no-progress rounds, the task paused as `needs_assistance`.

The run result also contaminated the requested completion contract by surfacing an unrelated prior token (`MIXED_AGENT_OK`) instead of completing the current `BENCH_TASK_PASS` contract.

Recommended fix:

1. Guarantee assignment prompt persistence into every round and recovery round.
2. Make the boot instruction match the tools actually exposed.
3. Permit a valid final answer to count as progress for no-tool tasks.
4. Provide a non-tool `step_complete` path when tools are intentionally disabled.
5. Prevent previous-run result tokens from leaking into current run synthesis.
6. Add an integration test: create standalone task → read one workspace file → return result → complete.

### P0: Recovery router is not initialized

Attempting to recover the paused standalone run failed immediately:

```text
[task-router] Not initialized — call initTaskRouter() first
```

Recommended fix:

- Initialize the task router for interactive main-chat recovery tools before registering `agent_run_ops`.
- Add a startup health assertion and a direct recovery smoke test.
- If initialization is unavailable, hide/disable the tool with a clear readiness state rather than exposing a guaranteed failure.

### P1: Disposable benchmark runner drops its prompt

Both routes failed:

- Luna verifier: **41.97 s**, `needs_assistance`, empty result
- Terra analyst: **72.02 s**, `needs_assistance`, empty result

The task later reported that no benchmark inputs, target, commands, or expected artifacts were included in its context, despite the caller supplying a complete prompt.

Cleanup behavior was only partially correct: the tool claimed `agent_deleted:true`, but both disposable agents remained in `agent_ops(list)` and had to be explicitly deleted. Their tasks also remained and had to be explicitly deleted.

Recommended fix:

1. Verify prompt serialization from `benchmark_disposable` into the spawned task.
2. Treat no-tool textual answers as valid progress.
3. Make cleanup transactional and verify registry removal before reporting `agent_deleted:true`.
4. Delete or auto-expire failed disposable tasks.
5. Return failure journal excerpts directly in the benchmark response.

### P1: Agent action semantics are inconsistent

`agent_chat_ops(turn_request)` worked with standalone-configured Vera and Rowan, but `agent_chat_ops(talk)` on Rowan failed because it attempted team-member resolution:

```text
Could not find a team containing agent "analyst_teamverify_v1"
```

The same configured agent can therefore be treated as standalone in one action and team-only in another.

Recommended fix:

- Resolve target type explicitly from agent registry plus optional team ID.
- If an agent is not currently in a team, default `talk` to standalone persistent chat.
- Include `resolved_target_type` in every response.
- Add parity tests across `talk`, `turn_request`, `send`, and `reply_wait`.

### P1: Reply wait can consume the full timeout with no useful progress

Message send to Niko returned in **4 ms**, but `reply_wait` consumed **300.59 seconds** and returned:

```json
{"success":true,"status":"no_reply","replies":[]}
```

Problems:

- `success:true` is misleading for an operation whose purpose is to obtain a reply.
- No reason was provided for why the target did not run or respond.
- The full five-minute timeout was consumed.

Recommended fix:

1. Return `success:false` or a distinct `completed:false` on timeout/no reply.
2. Surface target liveness, queue state, and last mailbox event.
3. Use progressive status callbacks and a shorter default timeout.
4. Allow an option to request a turn automatically after send.

### P1: Schedule health does not validate intent

The existing `Morning motivational wake-up` schedule is configured to produce a short morning quote and deliver it to Telegram. Its latest stored output is instead a long `Prometheus Strategic Brief`. Nevertheless:

- Job health is `healthy`.
- Run status is `success`.
- `consecutiveErrors` is zero.
- `schedule_job_outputs(check)` says all expected outputs look current.

The technical scheduler executed, but the product contract failed.

Recommended fix:

1. Support semantic output contracts in addition to file checks.
2. At minimum allow required/absent text checks against final textual output.
3. Warn when no expected outputs are configured for a recurring user-facing job.
4. Store delivery evidence separately from generated output.
5. Mark content-contract mismatch as degraded/failed even when the runtime exits normally.

### P2: Schedule timing fields are confusing

For the disposable job:

- `run_now` acknowledgement: 29.72 s
- structured execution: 22.37 s
- schedule-run log: 22.31 s
- job `lastDuration`: 50.22 s

All may be internally valid, but the UI/API should label queue delay, runner duration, and total orchestration duration separately. As returned, users may interpret them as contradictory.

### P2: Aggregate tools return excessive payloads

- `automation_dashboard`: 2.34 s and a very large response
- `task_control(list, limit=100)`: 844 ms but over 22K result tokens before truncation
- `schedule_job_detail` for a simple job included extensive historical material

Recommended fix:

- Default to compact summaries with stable counts and IDs.
- Require explicit `depth:full` for full output bodies and event payloads.
- Add pagination/cursors to task lists.
- Truncate large `lastResult` fields in list views.
- Report payload bytes and result tokens in response metadata.

## Latency analysis

### Fast and healthy control-plane calls

Most registry/config/list/delete operations were excellent:

- Team list: <1 ms
- Agent list/info: <1 ms
- Model inspection: 0–4 ms
- Schedule list/history/delete: 1–2 ms
- Task get: 4 ms
- Schedule create: 5 ms
- Run get: 9 ms
- Task delete: 24–26 ms
- Agent delete: 187–190 ms
- Model override writes: 249–399 ms

### Model-backed calls

| Path | Model | Latency | Outcome |
|---|---|---:|---|
| Rowan direct turn | Terra | 4.99 s | PASS |
| Vera direct turn | Luna | 8.55 s | PASS |
| Rin persistent chat | Luna | 9.59 s | PASS |
| Scheduled execution | Luna | 22.31 s | PASS |
| Disposable Luna | Luna | 41.98 s | FAIL |
| Disposable Terra | Terra | 72.04 s | FAIL |
| Durable Rin task | Luna | ~198 s | FAIL |
| Niko reply wait | Luna target | 300.59 s | FAIL/no reply |
| Team coordinator | Luna coordinator plus attempted mixed team | 506.10 s | FAIL |

The model itself is not the dominant problem. Direct Luna/Terra calls were responsive. The worst latencies came from orchestration retries, unavailable schema, missing tools/context, and timeout policy.

## Token and cost telemetry

### What was observable

Every main-chat tool wrapper emitted stopwatch metadata containing:

- elapsed time
- argument tokens
- result tokens
- context tokens
- estimated USD cost
- pricing route/source

The largest observed driver-side payload costs were approximately:

- `task_control(list)`: **$0.02801 estimated**, dominated by a 22K-token result
- `automation_dashboard`: **$0.01827 estimated**, dominated by a 14K-token result
- `schedule_job_detail` on the existing morning job: **$0.01227 estimated**
- `agent_run_ops(get)` for the failed durable run: **$0.00578 estimated**

Across the visible wrapper metadata collected in this run, the rough driver-side estimate was on the order of **$0.08–$0.10**. This is an approximation, not a billing-grade total.

### What was not observable

The benchmark tools did **not** expose reliable per-agent:

- input tokens
- output tokens
- cached tokens
- model billing rate
- exact model cost
- retry-level token/cost breakdown

`workspace_run(action="telemetry")` returned zero calls and zero cost, demonstrating that it was not scoped to or connected with these agent/tool wrapper invocations.

Therefore, exact Luna/Terra token and cost totals cannot be honestly reported from the current public telemetry surface.

Recommended telemetry improvements:

1. Add `usage` to every model-backed agent result:
   - `input_tokens`
   - `cached_input_tokens`
   - `output_tokens`
   - `reasoning_tokens`, if applicable
   - `estimated_cost_usd`
   - `pricing_source`
2. Add orchestration totals to team/task/schedule results.
3. Separate driver-tool context cost from worker-model cost.
4. Include per-attempt usage for retries and no-progress loops.
5. Make telemetry queryable by task ID, agent ID, team ID, job ID, and session ID.
6. Report queue, model, tool, and synthesis latency separately.

## Existing system observations

The aggregate dashboard reported at benchmark start:

- 2 scheduled jobs
- 95 historical/background tasks from the broad task list
- 3 tasks needing assistance
- 10 paused tasks
- 37 completed tasks in the dashboard's bounded view
- 0 active managed teams
- 2 pending events
- Dirty repository state: 32 modified and 77 untracked files

The benchmark did not alter or clean unrelated repository work.

## Cleanup verification

Deleted after evidence capture:

- Disposable scheduled job `job_1784046039683_lx7m9`
- Failed durable Rin benchmark task `b184087d-ee9e-46a4-ae26-ab0991088400`
- Failed disposable Luna task `0ff5dbb6-8648-43fe-b4c5-98142f010df6`
- Failed disposable Terra task `a8ad0428-5715-4f77-a51e-f9502e6ac17b`
- Leaked disposable Luna agent `benchmark_disposable_mrkv67hi`
- Leaked disposable Terra agent `benchmark_disposable_mrkv73vw`

Post-cleanup verification:

- Scheduled-job list returned only Raul's two original jobs.
- Team list returned zero teams.
- Original configured agents were preserved.

The Luna/Terra overrides intentionally remain on Rin, Vera, Rowan, Niko, and Rhea because they match the requested benchmark routing and the existing default template's broad intent.

## Prioritized fix order

1. **Fix managed-team create schema exposure** and add an end-to-end disposable team contract test.
2. **Fix durable task prompt/tool propagation** so a standalone task can execute and complete.
3. **Initialize the task router for recovery** before exposing `agent_run_ops(recover)`.
4. **Fix disposable benchmark prompt propagation and cleanup truthfulness**.
5. **Unify target resolution across agent chat actions**.
6. **Make reply waits observable and timeout honestly**.
7. **Add semantic scheduled-output validation** and flag jobs with no contract.
8. **Add billing-grade per-agent telemetry** with latency phase breakdowns.
9. **Compact list/dashboard payloads by default**.
10. **Clarify schedule queue time vs execution time vs total wall time**.

## Overall scorecard

| Capability | Score | Assessment |
|---|---:|---|
| Direct standalone chat | 9/10 | Fast, correct, routed properly |
| Direct agent turns | 9/10 | Luna and Terra both correct and responsive |
| Agent registry/config | 9/10 | Fast and legible |
| Scheduled agent execution | 8/10 | Correct execution and persistence; orchestration latency needs labeling |
| Schedule observability | 5/10 | Rich detail, but semantic success can be completely wrong |
| Task inspection | 8/10 | Excellent diagnostics and journal visibility |
| Durable task execution | 2/10 | Context/tool/progress contract broken |
| Task recovery | 1/10 | Router not initialized |
| Disposable benchmark runner | 2/10 | Correct routing, failed execution, incomplete cleanup |
| Agent mailbox/reply | 4/10 | Send works; wait path is slow and opaque |
| Managed teams | 1/10 | Creation blocked by schema mismatch |
| Token/cost telemetry | 3/10 | Wrapper estimates exist; worker usage is missing |
| Cleanup controls | 9/10 | Explicit delete operations were fast and successful |

## Final assessment

The underlying Luna/Terra inference paths are healthy. The failures are concentrated in the orchestration layer around them: schema exposure, prompt propagation, boot-mode tool availability, task progress accounting, router initialization, timeout semantics, and telemetry.

That is actually useful news. The models are not the bottleneck. Prometheus can already deliver fast, correct direct agent responses and a successful Luna-owned scheduled task. Fixing the orchestration contracts above should convert a large part of this benchmark from failure to pass without changing models.
