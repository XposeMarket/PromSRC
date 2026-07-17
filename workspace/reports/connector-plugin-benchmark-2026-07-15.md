# Connector / Plugin Tool Benchmark — 2026-07-15

## Scope

Read-only benchmark of Prometheus connector/plugin control-plane and connected service tools. No writes, posts, emails, deployments, orders, or trades were executed.

Telemetry is the per-call `[TOOL_STOPWATCH]` emitted by the runtime. Token cost is the runtime's built-in estimate for `openai_codex/gpt-5.6-sol`; it measures tool argument/result context cost, not third-party API billing.

## Executive result

- Healthy data-plane connectors: **GitHub, Vercel**
- Broken/stale auth: **Gmail, X, Robinhood MCP**
- Deprecated endpoint: **xAI live search**
- Control-plane inconsistency: canonical Robinhood connection says verified/healthy/exposed while MCP runtime says 401 token revoked and no tools.
- Largest token offender: `connection_ops(list_connections)` at **5,054 context tokens / $0.006318**, overwhelmingly larger than ordinary connector calls.
- Largest setup latency: `request_tool_category(external_apps)` at **4.257 s**, largely because it repeats the full connector/tool inventory.

## Full benchmark telemetry

| # | Tool / operation | Result | Latency | Arg tok | Result tok | Context tok | Est. cost |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | connector_list | Success | 3,734 ms | 1 | 821 | 822 | $0.001028 |
| 2 | request_tool_category(external_apps) | Success | 4,257 ms | 18 | 850 | 868 | $0.001085 |
| 3 | request_tool_category(integration_admin) | Success | 660 ms | 19 | 24 | 43 | $0.000054 |
| 4 | request_tool_category(mcp_server_tools) | Success | 727 ms | 19 | 24 | 43 | $0.000054 |
| 5 | connection_ops(list_connections) | Success, oversized | 1,014 ms | 10 | 5,044 | 5,054 | $0.006318 |
| 6 | mcp_server_manage(list) | Error state returned | 225 ms | 6 | 69 | 75 | $0.000094 |
| 7 | GitHub list repos, limit 5 | Success | 1,568 ms | 5 | 151 | 156 | $0.000195 |
| 8 | Gmail profile | Fail: invalid_grant | 1,601 ms | 1 | 39 | 40 | $0.000050 |
| 9 | Gmail labels | Fail: invalid_grant | 1,183 ms | 1 | 39 | 40 | $0.000050 |
| 10 | Vercel status | Success | 1,726 ms | 45 | 38 | 83 | $0.000104 |
| 11 | X me | Fail: invalid token refresh | 1,646 ms | 33 | 46 | 79 | $0.000099 |
| 12 | X usage | Fail: invalid token refresh | 1,625 ms | 23 | 48 | 71 | $0.000089 |
| 13 | GitHub list repos, limit 1, run A | Success | 1,352 ms | 5 | 20 | 25 | $0.000031 |
| 14 | GitHub list repos, limit 1, run B | Success | 1,268 ms | 5 | 20 | 25 | $0.000031 |
| 15 | GitHub repo search, limit 1 | Success | 1,734 ms | 22 | 37 | 59 | $0.000074 |
| 16 | Vercel list projects, limit 3 | Success | 2,051 ms | 45 | 85 | 130 | $0.000163 |
| 17 | Vercel list projects, limit 1 | Success | 1,574 ms | 45 | 28 | 73 | $0.000091 |
| 18 | MCP Robinhood status | Error: 401 token revoked | 227 ms | 15 | 69 | 84 | $0.000105 |
| 19 | MCP Robinhood list_tools | Fail: connect first | 242 ms | 16 | 14 | 30 | $0.000038 |
| 20 | connection_ops verify without attempt ID | Validation fail | 1 ms | 94 | 10 | 104 | $0.000130 |
| 21 | xAI live search | Fail: endpoint deprecated | 1,422 ms | 63 | 34 | 97 | $0.000121 |
| 22 | request_tool_category(workspace_write) | Success | 727 ms | 18 | 23 | 41 | $0.000051 |
| 23 | connection_ops status, Gmail | Validation fail | 1 ms | 27 | 8 | 35 | $0.000044 |
| 24 | connection_ops status, X | Validation fail | 0 ms | 23 | 8 | 31 | $0.000039 |
| 25 | connection_ops status, Robinhood | Validation fail | 0 ms | 40 | 8 | 48 | $0.000060 |
| 26 | GitHub list repos, limit 1, run C | Success | 1,696 ms | 5 | 20 | 25 | $0.000031 |
| 27 | Vercel status, run B | Success | 1,899 ms | 45 | 38 | 83 | $0.000104 |

### Aggregate

- Calls: **27**
- Success / useful state response: **17**
- Failures / validation failures: **10**
- Total measured serial latency: **34.13 s** (calls were partly parallel, so this is not wall-clock elapsed time)
- Total argument tokens: **644**
- Total result tokens: **7,773**
- Total context tokens: **8,417**
- Total estimated context cost: **$0.010244**
- `connection_ops(list_connections)` alone: **60.0% of tokens** and **61.7% of estimated cost**
- Connector inventory duplication (`connector_list` + external-app activation): **1,690 context tokens / $0.002113**

## Repeated-call latency

### GitHub list repos, limit 1

- Samples: 1,352 / 1,268 / 1,696 ms
- Mean: **1,439 ms**
- Median: **1,352 ms**
- Range: **428 ms**
- Payload: **25 context tokens / $0.000031 each**

### Vercel status

- Samples: 1,726 / 1,899 ms
- Mean: **1,813 ms**
- Payload: **83 context tokens / $0.000104 each**

### Vercel list projects

- Limit 1: 1,574 ms, 73 context tokens
- Limit 3: 2,051 ms, 130 context tokens
- Two extra records added **57 tokens** and **477 ms** in this sample.

## Errors and inconsistencies

1. **Robinhood stale canonical health**
   - `connection_ops(list_connections)` reports installed, authenticated, registered, exposed, verified, authState healthy, health healthy.
   - MCP runtime reports `HTTP 401 Unauthorized — token revoked`, disconnected, and no tools.
   - This is the highest-severity defect because routing can trust stale readiness metadata.

2. **Gmail stale connected state**
   - Connector inventory says connected.
   - Both profile and label reads fail with OAuth `invalid_grant`.
   - Two separate calls paid ~1.2–1.6 seconds before discovering the same stale credential.

3. **X stale connected state**
   - Connector inventory says OAuth user context is connected.
   - `me` and `get_usage` both fail during refresh: token invalid.

4. **xAI deprecated tool remains exposed**
   - `xai_live_search` spends 1.422 seconds only to return that Live Search is deprecated and callers must use Agent Tools API.

5. **`connection_ops status/verify` schema is attempt-centric and easy to misuse**
   - `status` silently expects `connection_attempt_id`, even when a canonical service/connection is supplied.
   - `verify` also requires an attempt ID and cannot verify an existing canonical connection directly.
   - Validation is fast but burns unnecessary argument/context tokens and creates orchestration retries.

6. **Telemetry aggregation did not capture sibling tool calls**
   - `workspace_run(action=telemetry)` returned zero calls during this benchmark.
   - Per-call stopwatches work, but there is no usable scoped aggregate API for the current turn/run.

## Improvement suggestions

### P0 — correctness and error prevention

1. **Live health must override persisted connection metadata.** On `connector_list` / `list_connections`, probe or consult recent runtime auth health; mark stale credentials `reauth_required`, never `healthy`.
2. **Invalidate canonical state on auth failures.** OAuth `invalid_grant`, invalid token refresh, or MCP 401/token revoked should atomically update the connection record and suppress exposed tools until repaired.
3. **Remove or migrate deprecated xAI live search.** Route to Agent Tools API or fail locally before a network round trip.

### P1 — token consumption

1. **Add compact modes to connector inventory APIs.** Default `connection_ops(list_connections)` to one summary row per connection; move per-tool classification arrays behind `detail:"full"` or a single-connection detail call. Expected saving here: roughly **4,500–4,900 tokens (89–97%)** on that call.
2. **Do not duplicate inventory on category activation.** `request_tool_category(external_apps)` should return only activation status plus counts/delta; the prior `connector_list` result already contained the registry. Expected saving: about **800 tokens** and potentially most of its 4.26-second latency.
3. **Use concise structured error envelopes.** Return `{code, service, authState, retryable, action}` rather than embedding provider JSON and reminder text repeatedly.
4. **Trim tool schemas/default empty arguments.** `vercel_ops` status required 45 argument tokens because irrelevant fields were supplied. Discriminated per-action schemas would cut prompt/tool-call overhead and misuse.
5. **Cap tool lists and classifications.** Return counts and top-level readiness by default, with pagination or `include_tools:true` for details.
6. **Suppress repeated goal reminders in every benchmark result.** They are not included in stopwatch result-token counts here, but they inflate actual model context and visual noise across long tool runs.

### P1 — latency

1. **Local auth preflight/cache.** Before Gmail/X/MCP network calls, inspect token expiry/revocation state and short-circuit repeated failures for a small TTL. This would avoid duplicate 1–1.6 second failures.
2. **Cache connector registry and category exposure.** Registry enumeration should be local and sub-100 ms; 3.7–4.3 seconds for list/activation is too high.
3. **Connection pooling and parallel provider calls.** Healthy GitHub/Vercel reads sit around 1.3–2.1 seconds. Reuse HTTP clients/TLS sessions and expose batch read operations where practical.
4. **Return pagination metadata.** Current compact connector outputs omit cursors/hasMore/rate-limit headers, preventing intelligent paging and forcing redundant calls.
5. **Add a first-class `connector_smoke_test` tool.** It should run auth, status, one safe read, pagination, error-shape, and optional dry-run checks, then emit scoped aggregate telemetry and a report.

### P2 — telemetry quality

1. Add a benchmark/run ID accepted by all tool calls and a `telemetry_summary(run_id)` endpoint.
2. Record provider/network time separately from gateway dispatch, serialization, and model context accounting.
3. Include cache hit, retry count, HTTP status, response bytes, rate-limit headers, and error taxonomy.
4. Report p50/p95/p99 over configurable repetitions rather than relying on tiny samples.
5. Distinguish tool-context cost from model reasoning/output cost and third-party API cost.

## Recommended acceptance targets

- Connector registry list: **p50 <150 ms**, compact payload **<250 tokens**
- Category activation: **p50 <250 ms**, result **<80 tokens**
- Healthy simple API read: **p50 <800 ms**, p95 <1.5 s
- Known-invalid auth preflight: **<100 ms** after first failure
- Canonical health convergence after provider auth failure: **immediate / same call**
- Aggregate benchmark telemetry coverage: **100% of tagged calls**
- Default `list_connections` payload: **<500 tokens** for five connections

## Safety note

Robinhood write/trading tools were not called. Gmail send, X mutations, GitHub writes, and Vercel deploy/env mutations were also excluded.
