# P0-1 tool performance and telemetry pass — 2026-08-08

## Executive result

The local tool path is not dominated by gateway dispatch or result serialization. In the controlled Luna run, dispatch-to-first-output was 0 ms for every observed safe tool call, completion-to-result delivery was 2–4 ms at p50, and result-to-model delivery was 4–8 ms at p50. The large user-visible waits are before the model emits a tool call and after the result is returned while Luna decides and begins the next visible response.

The pass adds privacy-conscious, opaque-ID telemetry across the existing boundaries and a repeatable family harness. It does not claim a provider speedup. No new semantic tool-execution optimization was justified by the controlled data; the highest-value next work is provider-round/desktop-tail investigation and recovery behavior, not shaving the already-small dispatch/serialization path.

## Conditions and commands

- Local Windows 10 build 10.0.26200; Node v20.20.2; local gateway `http://127.0.0.1:18789`.
- Provider `openai_codex`, model `gpt-5.6-luna`, reasoning `low`; no Terra samples are included.
- Three samples per family for the stable controlled run; one disposable session per sample; read-only fixtures only.
- The final stable run used a gateway PID that remained stable for the complete run. A separate three-sample attempt overlapped the managed restart lifecycle and was discarded rather than treated as data.
- No production traffic, physical phone/emulator, Codex baseline, external connector mutation, deployment, purchase, message, or destructive fixture was used.

Commands:

```text
npm run build:backend
npm run sync:web-ui
npm run check:web-ui
npx tsx src/gateway/chat/tool-performance-telemetry.regression.ts
$env:PROMETHEUS_TOOL_BENCH_SAMPLES='3'; node scripts/benchmark-tool-performance.mjs
```

The harness is available as `npm run benchmark:tool-performance`. It pins each disposable session to Luna low reasoning, requests only the safe tool family, stops at SSE `done`/`error`, deletes the session, and records only bounded metadata. A follow-up recovery message is now sent when the initial attempt does not emit its required tool; the separate eight-family recovery check had 8/8 initial successes, so no follow-up was needed in that run.

## A. Architecture and tool-family map

```text
ChatPage / mobile-compatible SSE client
  -> POST /api/chat + X-Prometheus-Trace-Id
  -> chat.router handleChat / provider-round loop
  -> tool-builder category surface
  -> executeToolWithTelemetry in subagent-executor
  -> browser/desktop/workspace/connector/MCP/tool implementation
  -> bounded tool result + SSE tool_result
  -> next Luna provider round
  -> client token/tool-result receipt and visible render
```

Static inventory: 148 tools across 23 registered categories. Dynamic MCP/connector tools are live-dependent and were not counted as static tools. The representative measured families were:

| Family | Representative safe call | Registry/owner |
|---|---|---|
| desktop | `desktop_screen(action:"doctor")` | desktop wrapper and desktop-tools |
| browser | local `browser_session` + `browser_observe` | browser session manager |
| workspace | bounded `workspace_read` | workspace wrapper/executor |
| terminal | `workspace_run(node --version)` | workspace process path |
| web/search | `web_fetch(https://example.com)` | web fetch path |
| MCP/connector | `connector_list` | extension/connector registry |
| subagent/task | category activation + `agent_ops(action:"list")` | agent/task runtime |
| core | `timer(action:"list")` | core executor |

Creative/media, skills/memory, automation, Prometheus-source, composite, and other registered families are in the static inventory but were not invoked in this pass because safe local fixtures would either mutate files/schedules, depend on a live external service, or require a separate artifact/media fixture. They remain follow-up benchmark cases.

## B. Telemetry schema and boundaries

The new `ToolPerformanceTracker` in `src/gateway/chat/tool-performance-telemetry.ts` creates a separate opaque `tool_<random>` ID for each provider tool call. Provider call IDs are used only in memory to join events and are not written as identifying content. The trace is the existing opaque turn ID.

Recorded stage labels:

`tool.call_emitted` → `tool.dispatch_start` → `tool.executor_start` → `tool.first_output` → `tool.complete` → `tool.result_serialized` → `tool.result_delivered` → `tool.result_to_model` → `tool.next_visible_token` → client-visible/terminal state.

The tracker also records `cancelled` and `abandoned` terminal boundaries. Model worker callbacks record queue entry, worker start, provider start, event batches, completion/error, request/result bytes, event counts, PID, RSS, and queue wait. Model usage rows carry the same opaque turn trace ID and retain provider/model/round token counts only.

The client records sanitized receipt/visibility marks for tool-call, progress, and result events. No prompt, message text, token text, file content, browser page content, tool arguments, credentials, or tool result content is emitted by this instrumentation. Numeric fields include elapsed milliseconds, byte lengths, estimated result tokens, counts, and categorical names only.

## C. Controlled baseline/post-instrumentation measurements

The first pre-harness sweep was intentionally retained as a validity baseline. With ordinary automatic selection, desktop, browser, workspace-read, web-fetch, and connector calls appeared, but terminal, subagent, and core samples sometimes completed without invoking the requested tool. Those missing calls are not reported as zero-latency tools. The local benchmark-only allowlist plus category activation and the terminal follow-up recovery path were added to make the measurement reproducible.

The stable controlled run below is n=3 samples per family. p95 is meaningful only as a small local indicator; it is not a production percentile. Times are milliseconds.

| Family | Tool calls | Submit→accepted p50 / p95 | Accepted→tool call p50 / p95 | Dispatch→first output p50 | First output→complete p50 | Tool wall p50 / p95 | Complete→delivered p50 | Delivered→model p50 | Result→next visible p50 | Result bytes p50 | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| desktop | 3 | 2 / 3 | 3,897 / 4,537 | 0 | 0 | 19,598 / 21,215 | 2 | 19,312 | 2,388 | 938 | 2 |
| browser | 6 | 2 / 3 | 3,395 / 7,429 | 0 | 0 | 907 / 2,253 | 2 | 7 | 1,026 | 50 | 2 |
| workspace | 3 | 1 / 1 | 6,941 / 7,564 | 0 | 0 | 15 / 23 | 4 | 8 | 1,961 | 349 | 0 |
| terminal | 3 | 4 / 7 | 7,992 / 12,817 | 0 | 0 | 464 / 1,093 | 3 | 6 | 2,134 | 63 | 0 |
| web/search | 3 | 2 / 4 | 4,287 / 4,646 | 0 | 0 | 545 / 686 | 2 | 4 | 2,011 | 113 | 0 |
| MCP/connector | 3 | 4 / 4 | 3,648 / 3,868 | 0 | 0 | 28 / 33 | 2 | 4 | 1,731 | 505 | 0 |
| subagent/task | 3 | 1 / 2 | 5,755 / 7,172 | 0 | 0 | 3 / 10 | 2 | 4 | 2,360 | 1,145 | 0 |
| core/timer | 3 | 2 / 2 | 3,646 / 5,271 | 0 | 0 | 4 / 6 | 2 | 5 | 2,345 | 137 | 0 |

Turn-level controlled totals across the 24 samples were:

| Metric | p50 | p75 | p95 | p99 | n |
|---|---:|---:|---:|---:|---:|
| End-to-end disposable turn | 8,475 ms | 11,122 ms | 47,386 ms | 62,483 ms | 24 |
| Submit to first visible model token | 7,966 ms | 9,368 ms | 46,671 ms | 61,956 ms | 24 |

The post-instrumentation recovery check used one sample per family and reported 8/8 required-tool initial successes, 0 recovery attempts, and 0 benchmark errors. This confirms the follow-up path is dormant when the tool surface is ready; it does not prove the original first-message race cannot occur.

### Provider rounds and tokens

All rows were Luna rounds. Representative per-family p50s from the same controlled samples are shown for attribution, not as a cost or quality target:

| Family | Provider rounds | Input tokens p50 | Output tokens p50 | Provider round duration p50 / p95 |
|---|---:|---:|---:|---:|
| desktop | 6 | 18,610 | 69 | 3,140 / 4,069 ms |
| browser | 9 | 19,399 | 60 | 2,333 / 3,038 ms |
| workspace | 14 | 20,786 | 92 | 3,873 / 7,195 ms |
| terminal | 9 | 21,756 | 62 | 3,472 / 8,013 ms |
| web/search | 6 | 19,129 | 18 | 3,275 / 4,417 ms |
| MCP/connector | 6 | 17,851 | 29 | 2,831 / 3,515 ms |
| subagent/task | 9 | 19,196 | 22 | 2,729 / 4,371 ms |
| core/timer | 6 | 17,793 | 14 | 2,725 / 4,678 ms |

The token counts include the normal local prompt/context envelope and should not be interpreted as tool-result-only tokens. Exact tool-result token usage is unavailable in this provider path, so result token estimates remain `ceil(resultBytes/4)`.

## D. Findings ranked by impact and confidence

1. **High / high confidence — provider-round latency dominates.** Family accepted→tool-call p50s are 3.4–8.0 seconds, while dispatch and executor overhead are effectively sub-millisecond at this resolution. Result→next-visible p50s are 1.0–2.4 seconds for most families. The next performance pass should target provider queue/admission/context size, model round count, and late-visible-token scheduling.
2. **High / medium confidence — desktop doctor is a real local tail.** `desktop_screen(doctor)` was 19.6–21.2 seconds at p50/p95 in this run and returned two error-marked results out of three. The implementation performs Windows context probing through a bounded PowerShell/UI path; errors and host/UI state need a dedicated trace before changing it. A cached fast health path or narrower probe is a likely high-value candidate, but was not changed without a paired diagnosis.
3. **Medium / high confidence — category activation adds a model round.** Terminal and subagent tests include `request_tool_category` before the representative tool. Their accepted→tool-call times are therefore model/category-surface latency, not process startup latency. The telemetry now makes this visible instead of mislabeling it as tool execution.
4. **Medium / medium confidence — first-message tool availability needs recovery semantics.** The initial uncontrolled sweep showed missing terminal/subagent/core tool calls. The harness now sends one same-session, bounded follow-up if the required tool was not emitted. The warmed stable run succeeded on the first attempt, so the race was not reproduced during the final eight-family check.
5. **Medium / medium confidence — browser lifecycle errors need isolation.** One of three browser samples returned error-marked session/observe results, but the successful samples had 0.9–2.3 second tool walls. The next pass should capture browser-process/session lifecycle state and distinguish “browser unavailable” from page/tool failure.
6. **Low / high confidence — dispatch/serialization is not the current bottleneck.** Result delivery was 2–4 ms at p50 and 4–33 ms for the connector/workspace/web families at p95-scale observations. No batching or IPC rewrite is justified yet.
7. **Low / high confidence — streaming tool events remain unmeasured in these fixtures.** All representative calls returned a single result with event count 0. A separate controlled long-output/process/browser-stream fixture is required before making claims about cadence or UI update scheduling.

## E. Implemented changes

- Added `ToolPerformanceTracker` and lifecycle regression coverage.
- Added per-round model-worker queue/provider/event/RSS telemetry and trace propagation into model-usage rows.
- Added safe tool metadata to SSE tool events and client receipt/visible marks.
- Added `toolFilter` only for `origin.source=local_benchmark`, reusing the existing allowlist semantics without changing normal chat selection.
- Added category activation to safe terminal/subagent benchmark fixtures.
- Added one bounded same-session follow-up when a required tool was not emitted initially.
- Fixed tool-family classification for `workspace_run` → `terminal` and `timer` → `core`.
- Closed unfinished telemetry records as `abandoned` at the turn terminal boundary.
- Fixed family aggregation so category-activation calls from terminal/subagent samples are not incorrectly counted in the core-family totals.

These are measurement/recovery improvements. The controlled results do not support claiming a new end-user latency speedup from this pass. Earlier P0-1 fixes remain in effect: lazy Projects loading, identical in-flight GET coalescing, bounded session cache, per-provider-round timing correctness, and bounded stream/client telemetry.

## F. Verification and limitations

Passed in this pass: `npm run build:backend`, `npm run sync:web-ui`, `npm run check:web-ui`, `node --check scripts/benchmark-tool-performance.mjs`, and `npx tsx src/gateway/chat/tool-performance-telemetry.regression.ts`. Earlier P0-1 checks remain recorded in the main performance report.

Unavailable or intentionally not claimed: production traffic, a true Codex tool baseline, physical mobile/emulator jank/memory, live external MCP tool execution, creative/media mutation fixtures, long-running tool streams, heap snapshots, and CPU attribution per individual tool. The local status snapshot after the stable runs reported gateway RSS about 418 MB with 35 cached session entries and model-worker RSS totaling about 235 MB across three workers; this is a post-run observation, not a leak slope.

## G. Recommendation

Do not close P0 tool performance as fully solved. Close the telemetry/harness implementation portion, then run one focused pass on: (1) per-round provider/context/queue latency, (2) desktop doctor fast-path/error diagnosis, (3) browser session lifecycle, and (4) streaming-tool/process output fixtures. Keep the 24-hour soak deferred while active editing/restarts continue.

## H. Focused follow-up: provider rounds, desktop doctor, and browser lifecycle

This addendum is the completed focused pass requested after the initial telemetry report. It supersedes the earlier “next pass” hypotheses where the new controlled evidence is available. All measurements below are local/synthetic, Windows 10 release `10.0.26200`, Node `v20.20.2`, local gateway `127.0.0.1:18789`, provider `openai_codex`, model `gpt-5.6-luna`, reasoning `low`, read-only/disposable fixtures, and no production traffic.

### H.1 Implemented changes

- `src/gateway/server-v2.ts` now waits for context-build worker warmup, initializes the lazy chat/tool router, and completes the existing startup wiring before opening the HTTP listener. The previous one-second post-listen startup block was the source of a port-open/event-loop-busy first-message window.
- `src/gateway/routes/chat.router.ts` reuses tool-surface and full-system-prompt builds across provider/tool rounds within a turn. Each build emits numeric duration/cache-hit telemetry; no prompt or schema contents are logged.
- `src/gateway/desktop-tools.ts` makes `desktop_doctor` fast by default (`deep=false`): it skips the full window enumeration and all screenshot/OCR/UI Automation probes. Explicit deep doctor runs now use a doctor-only 5-second OCR budget (`PROMETHEUS_DESKTOP_DOCTOR_OCR_TIMEOUT_MS` can raise/lower it within the safe clamp) while the general OCR timeout remains unchanged.
- `src/gateway/browser-tools.ts` coalesces same-session initialization, checks liveness, evicts stale sessions, cleans live streams and extension locks during recovery, retries one closed-target navigation, bounds CDP attach retries, and separates personal-Chrome extension-unavailable errors from CDP lifecycle errors.
- `scripts/benchmark-tool-performance.mjs` now records context/personality stages, supports `PROMETHEUS_TOOL_BENCH_DESKTOP_DEEP=true`, pins browser tests to `target="prometheus"`, and retries only disposable setup/cleanup requests during a local listener rotation. Missing required tools still trigger one same-session follow-up, retained in the result.

### H.2 Final controlled results

The initial baseline was not fully like-for-like: the model selected the old deep desktop path and mixed browser target lanes. It is retained to show the original tail, while the final controlled run explicitly required fast desktop doctor and Prometheus browser target.

| Area | Earlier observed baseline | Final controlled result | Interpretation |
|---|---:|---:|---|
| Desktop doctor, old/uncontrolled path | 21,231 ms tool-wall p50; 3/3 error-marked | Fast `deep=false`: 2,249 ms p50 / 2,524 ms p95; 0/3 errors | The default path no longer pays deep screenshot/OCR/UIA work or an automatic extra screenshot round. |
| Desktop doctor, explicit deep path | 24,307 ms before doctor-only OCR budget; OCR probe 15,081 ms | 10,846 ms in the stable bounded sample; OCR 5,039 ms; UI Automation 781 ms | Deep remains intentionally diagnostic, but the unavailable/slow OCR case fails fast. n=1 each; not a production percentile. |
| Browser, mixed old target lane | 6 tool calls; 4 error-marked; target could be personal Chrome extension | Explicit Prometheus target: 6 tool calls; 0 error-marked; 1,847 ms p50 / 6,191 ms p95 tool-wall | Lifecycle classification/recovery is now measurable without mixing extension onboarding with CDP. Cold CDP attach remains variable. |
| Admission | 1–3 ms in the earlier desktop/browser traces | 1 ms desktop p50; 5 ms browser p50; 1–5 ms across the final family samples | Admission itself is not the dominant tail. |
| Context build | Roughly 0.26–0.60 s in earlier traces, with a restart warmup outlier | 0.328–0.677 s across final desktop/browser samples; worker ready wait 0–1 ms | Worker prewarm removes the readiness wait; personality snapshot/context assembly remains a measurable but sub-second cost. |
| Repeated tool/system prompt builds | Rebuilt on later provider rounds | Final traces: initial tool-surface 0–98 ms, initial system prompt 0–2 ms; later rounds `cacheHit=true`, 0 ms | Duplicate per-round gateway work is removed. |
| First post-restart controlled batch | One listener-rotation timeout with no trace was excluded | Final post-restart desktop/browser batch: 6/6 turns completed, 0 tool errors, 0 recovery follow-ups | The excluded timeout was startup-state evidence, not a tool-latency datapoint; the pre-listen readiness change addresses that window. |

The final fast desktop/browser aggregate was:

| Family | Tool calls | Accepted→tool call p50 / p95 | Tool wall p50 / p95 | Complete→delivered p50 | Delivered→model p50 | Result→next visible p50 | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| Desktop fast doctor | 3 | 3,359 / 4,128 ms | 2,249 / 2,524 ms | 2 ms | 5 ms | 974 ms | 0 |
| Browser Prometheus target | 6 | 5,789 / 11,266 ms | 1,847 / 6,191 ms | 4 ms | 10 ms | 2,450 ms | 0 |

The six-family controlled run (three samples each, completed before the final listener-ordering rebuild) also remained clean: workspace tool wall 17 ms p50, terminal 687 ms, web/fetch 693 ms, MCP/connector 14 ms, subagent/task 5 ms, core/timer 6 ms; all had 0 tool errors. Their accepted→tool-call p50s were 6,111 / 8,269 / 4,039 / 3,243 / 7,271 / 3,320 ms respectively, which is provider/category-emission time rather than local dispatch time. Across those 18 turns, end-to-end p50 was 8,832 ms and p95 20,860 ms.

### H.3 Root causes and current disposition

1. **High impact / high confidence — provider-round decision time.** Final accepted→tool-call p50 ranged from 3.2 s to 8.3 s across safe families; local dispatch-to-first-output was 0 ms at this resolution and result delivery was 2–5 ms p50. Provider/model round variance and category/tool emission dominate. No provider speedup is claimed.
2. **High impact / high confidence — desktop deep probes.** Screenshot/context, OCR, and UI Automation accounted for nearly all deep-doctor wall time. Fast default and bounded deep OCR are implemented; deep still reports OCR availability problems on this host and should remain explicit/opt-in.
3. **High impact / high confidence — startup readiness ordering.** The listener previously opened before post-listen synchronous startup work. A restart-window timeout reproduced the failure class; listener readiness now waits for worker/router/startup wiring. The final first controlled batch after the rebuild completed cleanly.
4. **Medium impact / high confidence — browser cold CDP attach.** Explicit Prometheus samples were error-free, but cold attach ranged from 682 ms to 3,585 ms and drove the browser p95. Single-flight initialization, bounded attach retries, stale-session recreation, and cleanup are implemented. Concurrent recovery/live-stream soak is still needed.
5. **Medium impact / high confidence — repeated per-round gateway assembly.** Tool-surface and full-system-prompt caches now eliminate later-round rebuilds within a turn. The remaining per-turn context assembly is sub-second and should not be traded for stale cross-turn context without stronger evidence.

### H.4 Verification and remaining gaps

Passed after the final source changes: `npm run build:backend`, `node --check scripts/benchmark-tool-performance.mjs`, `npx tsx src/gateway/chat/tool-performance-telemetry.regression.ts`, `npm run test:turn-safety`, `npm run test:runtime-workers`, `npx tsx src/gateway/chat/turn-timing.regression.ts`, `npm run test:mobile-recovery`, the three context-worker regressions (`context-build-worker`, `context-build-worker-pool`, and `context-build-limiter`), `npm run check:web-ui`, and `git diff --check` (only existing LF/CRLF normalization warnings). Production, physical mobile/emulator, true Codex baseline, long-running streaming tools, concurrent browser recovery, and live external MCP execution remain unavailable or intentionally unclaimed.

Next highest-value work is provider-round reduction/measurement (context size, category activation, queue waits, and model-round count), followed by a concurrent browser-session/live-stream soak and a long-output streaming fixture. Keep the 24-hour memory soak deferred while active edits and restarts continue.
