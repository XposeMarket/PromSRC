# Subagent, Team, Task, and Job Tool Benchmark — 2026-07-16

## Scope
Post-restart verification of recovered dev edit `dev_edit_mrny2bur_ff27f7d7`. Agent execution was explicitly routed to OpenAI Codex GPT-5.6 Luna; managed-team manager routing is GPT-5.6 Terra. GPT-5.6 Sol only hosted the foreground main chat/tool invocations and was not used as a benchmark executor.

## Recovery and build
- Existing request recovered in original session `mobile_mrnxexdy_7vyw1a`.
- `backend_build` passed: checks 465 ms; `npm run build:backend` 44.218 s.
- Applied live and restarted successfully. A second intentional lifecycle restart was also healthy; final verified gateway PID 23496, provider online, no interrupted runtimes, and no source/runtime errors reported.

## Successful post-restart cases
| Surface | Case | Result | Tool latency | Context tokens | Est. tool-context cost |
|---|---|---|---:|---:|---:|
| Agent | list | 4 including Main | 0 ms | 284 | $0.000355 |
| Agent | standalone chat | `STANDALONE_CHAT_OK` | 9.770 s | 174 | $0.000218 |
| Agent/task | `task_prompt` launch alias | task accepted | 102 ms | 195 | $0.000244 |
| Task | Luna task execution | `TASK_ALIAS_OK`; executor `openai_codex/gpt-5.6-luna` | 11.653 s runtime | — | provider completion cost unavailable |
| Agent | update with required name | success | 308 ms | 1,029 | $0.001286 |
| Team | list | one disposable team | 1 ms | 389 | $0.000486 |
| Team | dispatch using `message` alias | accepted | 84 ms | 250 | $0.000313 |
| Team/task | message-alias task execution | `TEAM_MESSAGE_ALIAS_OK`; Luna | 33.521 s runtime | — | provider completion cost unavailable |
| Team | `dispatch_team_agent` using `task_prompt` alias | `TEAM_TASK_PROMPT_ALIAS_OK` | 8.899 s | 295 | $0.000369 |
| Team | post chat | success | 8 ms | 210 | $0.000263 |
| Team | pause | success | 8 ms | 2,887 | $0.003609 |
| Team | resume | success | 252 ms | 2,993 | $0.003741 |
| Watch | create `notify_only` task watch | persisted correctly | 8 ms | 778 | $0.000973 |
| Watch | create `notify_only` team watch | persisted correctly | 8 ms | 883 | $0.001104 |
| Watch | match/list | both matched without starting a new control-flow turn | 2 ms list | 2,026 | $0.002533 |
| Job | create Luna one-shot | success | 6 ms | 529 | $0.000661 |
| Job | run now | queued; exact output later verified | 40.501 s | 166 | $0.000208 |
| Job | actual Luna run | `JOB_LUNA_OK` | 19.573 s runner; 58.677 s orchestration record | — | provider completion cost unavailable |
| Job | history | 3 records | 5 ms | 856 | $0.001070 |
| Job | detail | exact result and linked task | 1.080 s | 1,840 | $0.002300 |
| Job | log search | exact match | 4 ms | 582 | $0.000728 |
| Job | pause | success | 5 ms | 350 | $0.000438 |
| Job | patch preview | success | 2 ms | 752 | $0.000940 |
| Job | expected-result set | success on active fixture | 3 ms | 416 | $0.000520 |
| Job | patch apply | success | 8 ms | 672 | $0.000840 |
| Job | resume | success | 2 ms | 353 | $0.000441 |
| Job | expected-result check | returned passed | 1 ms | 477 | $0.000596 |
| Task | task get | complete | 5 ms | 290 | $0.000363 |
| Run | agent run list | 3 complete Luna runs | 1.506 s | 711 | $0.000889 |

## Reproducible remaining interface defects / improvement opportunities
1. `agent_ops(action:"update")` rejects a patch-only update unless top-level `name` is also populated. Empty wrapper defaults should be treated as omitted; patch-only update should work.
2. `team_ops_wrapper(action:"get_agent_result")` requires `task_id`, but the public wrapper schema does not expose a `task_id` property. Supplying `task`, `ref`, or `request_id` does not satisfy it. Result remains available through `agent_run_ops(get)`.
3. `request_member_turn` correctly enforces manager-session scope, but the wrapper available to main chat makes this easy to call incorrectly. Schema/help should state this restriction before execution.
4. `schedule_job_outputs` could not find a completed one-shot job that `schedule_job_detail/history` could resolve. It worked on an active paused job, suggesting inconsistent completed-job lookup/indexing.
5. `schedule_job_outputs(check)` reported a required textual result contract as passed on a job that had never run. A configured-but-unexecuted expected-result contract should report `pending/unverified`, not `passed`.
6. Scheduled exact-token task still performed a mandatory `write_note`, adding avoidable latency/context and schedule memory noise.
7. Team pause/resume payloads are far too large (~2.9K context tokens each) because they return full room/team history. Default should be compact with opt-in detail.
8. Broad `task_control(list)` returned a very large historical payload and dominated context. Default should be a compact summary with pagination/status filtering.
9. Full provider completion token usage and dollar cost are still absent from task/team/job result payloads; only foreground tool-context estimates are available.
10. Job `run_now` call blocked for 40.5 s merely to say queued, while the actual runner started later. Queue acknowledgement should return immediately (<250 ms).

## Aggregate latency, tokens, and cost
- Measured foreground tool calls in the successful-case table: 26.
- Tool-context tokens: 20,387.
- Estimated foreground tool-context cost: $0.025488.
- Longest synchronous tool call: job `run_now`, 40.501 s.
- Longest measured executor/orchestration path: one-shot job orchestration, 58.677 s.
- Backend verification: 44.218 s, plus 465 ms pre-check.
- Luna/Terra provider completion tokens and inference dollars are not returned by task/team/job result payloads, so exact end-to-end cost cannot be calculated. This remains an observability gap rather than a benchmark omission.

## Cost interpretation
The per-tool figures above are Prometheus `[TOOL_STOPWATCH]` context estimates under the foreground main-chat model. They exclude Luna/Terra inference because executor completion usage/cost is not returned. The largest avoidable context costs were full team pause/resume payloads and broad task/watch listings; compact-by-default responses are the clearest next efficiency win.

## Final cleanup verification
- Configured agents: only `Main` (1); no disposable subagents remain.
- Managed teams: 0.
- Scheduled jobs: only Raul’s two pre-existing jobs remain; no benchmark job is configured or scheduled.
- Active watches: 0. The old control-flow benchmark watch and both notify-only fixtures are cancelled; retained entries are terminal audit history only.
- Disposable benchmark task IDs return `no_candidate`, confirming their mutable task records were already removed. Historical completed run/audit evidence may remain by design.
- No managed Prometheus-thread supervisions remain active.

## Final assessment
The defects that broke the original benchmark are fixed and live: alias normalization works across standalone/team dispatch, omitted optional creation fields no longer require boilerplate, standalone chat routes correctly, and `notify_only` watches no longer inject a control-flow turn. The remaining items in the improvement section are non-blocking API ergonomics, response-size, telemetry, and queue-ack optimizations discovered by the expanded benchmark; none prevented the verified agent, team, task, watch, or job lifecycle from completing and cleaning up.
