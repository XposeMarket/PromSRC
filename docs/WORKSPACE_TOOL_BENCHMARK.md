# Workspace tool benchmark hardening

The 2026-07-11 end-to-end benchmark created and repaired a local browser game,
validated files, managed local servers, exercised Git discovery, and cleaned up
all processes. Workspace reads, edits, validation, safety, and code navigation
passed. The remaining process issue was that a supervised process could be
`running` while its HTTP service returned an empty response.

## Service-health status

`workspace_run(action="status")` now accepts:

- `health_url`: HTTP endpoint to probe;
- `health_timeout_ms`: bounded probe timeout;
- `port`: localhost port to probe and inspect for a listening owner;
- `max_chars`: recent stdout/stderr budget.

The response separates the process record from `service_health`,
`listening_socket`, and `recent_output`, and returns one of:

- `running_and_healthy`
- `running_but_unhealthy`
- `running_unprobed`
- a terminal process-state verdict

This preserves the existing supervised-process model while making “alive” and
“serving correctly” distinct facts.

## Automatic benchmark ledger

`workspace_run(action="telemetry")` or `benchmark_summary` aggregates the
session’s automatically persisted tool observations. It returns wall-clock and
cumulative execution time, calls, successes, failures, inferred retries,
argument/result/context tokens, estimated cost, p50/p95 latency, per-tool and
per-action buckets, largest payloads, and error taxonomy.

Run `npm run test:workspace-tools` for a disposable supervised HTTP service
test. It verifies command/cwd evidence, listening PID, HTTP 200 health, recent
stderr/stdout, and the `running_and_healthy` verdict, then kills and removes the
fixture.
