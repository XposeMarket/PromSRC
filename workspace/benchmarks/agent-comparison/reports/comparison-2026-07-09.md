# Prometheus vs Hermes benchmark — 2026-07-09

## Summary

Continued v1 benchmark after adding Hermes internal telemetry. Hermes now emits internal JSONL events for model calls and tool calls while the wrapper records outer wall-clock, stdout/stderr, exit code, and pass/fail.

## Current results

| Benchmark | Prometheus status | Prometheus wall | Hermes status | Hermes wall | Hermes model calls | Hermes model ms | Hermes tool calls | Hermes tool ms | Hermes tool errors | Hermes tokens in/out | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `file_ops_basic_v1` | PASS | n/a* | PASS | 38.671s | 5 | 20.575s | 6 | 8.842s | 0 | 154,690 / 376 | Clean pass with internal telemetry. |
| `shell_ops_basic_v1` | PASS | 2.075s | FAIL** | 60.122s | 11 | 40.983s | 10 | 5.545s | 1 | 345,121 / 703 | Hermes performed the shell work and wrote the report, but did not emit the required final pass line. |
| `browser_external_v1` | PASS | 7.109s | PASS | 20.276s | 2 | 7.011s | 1 | 2.424s | 0 | 61,040 / 71 | Hermes browser lane is working. |
| `local_web_debug_v1` | pending native export | pending | FAIL** | 171.949s | 25 | 138.047s | 25 | 19.888s | 1 | 919,454 / 2,196 | Hermes created the buggy page, served/opened it, diagnosed and patched it, wrote the report, but did not emit the required final pass line. |
| `desktop_basic_v1` | pending native export | pending | PASS | 67.691s | 7 | 47.743s | 8 | 6.819s | 0 | 242,118 / 1,541 | Hermes found a desktop path via Windows APIs/PowerShell rather than a first-class desktop tool. |

\* Prometheus file lane was executed as native workspace calls inside the chat turn before the wrapper existed; current artifact has pass/fail but not an outer harness stopwatch.

\** These are strict benchmark failures because the final answer contract was not satisfied. The artifacts show substantial task completion, so they should be reviewed separately as “work completed / final-format failed.”


## Strict rerun results

Reran the two strict-failed Hermes lanes with an added final-output suppression guard.

| Benchmark | Status | Wall | Model calls | Model ms | Tool calls | Tool ms | Tool errors | Tokens in/out | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `shell_ops_basic_v1_strict_rerun` | PASS | 28.228s | 4 | 13.097s | 3 | 4.520s | 0 | 123,351 / 284 | Strong improvement; original failure was mostly final-contract/diff leakage. |
| `local_web_debug_v1_strict_rerun` | FAIL* | 154.095s | 22 | 125.090s | 21 | 17.168s | 0 | 802,939 / 1,988 | Work appears completed again, but Hermes still leaked review diff output instead of the exact required pass line. |

\* `local_web_debug_v1` remains a strict scorer failure even though Hermes diagnosed and patched the page. The stdout shows review diffs for `index.html` and `report.md`; this confirms the remaining issue is Hermes/Codex CLI final-output control rather than tool capability.

## Post-fix rerun results

Applied a minimal Hermes CLI fix to suppress inline edit diff printing during benchmark runs:

- `oss agents/hermes-agent/cli.py` now respects `HERMES_SUPPRESS_INLINE_DIFFS=1` before rendering file-edit review diffs.
- `benchmarks/agent-comparison/rerun_failed_hermes_strict.py` sets that env var for strict reruns.
- Compile check passed: `python -m py_compile cli.py agent/benchmark_telemetry.py agent/tool_executor.py agent/codex_runtime.py`.

| Benchmark | Status | Wall | Model calls | Model ms | Tool calls | Tool ms | Tool errors | Tokens in/out | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `shell_ops_basic_v1_strict_rerun` | PASS | 24.038s | 3 | 12.763s | 2 | 2.786s | 0 | 92,293 / 231 | Fixed. Exact final pass line emitted. |
| `local_web_debug_v1_strict_rerun` | FAIL* | 129.089s | 24 | 98.435s | 29 | 16.334s | 0 | 938,289 / 2,118 | Inline diffs fixed/suppressed, but Hermes now finishes with only `session_id` and no final answer line. |
| `local_web_debug_v1_strict_rerun_noquiet` | FAIL* | 146.326s | 23 | 111.094s | 29 | 19.485s | 0 | 871,913 / 2,503 | Non-quiet retry still emitted only `session_id`, so the remaining bug is final-response emission, not diff leakage. |

\* Local-web task artifacts show the page was created and patched correctly under Hermes' working directory (`oss agents/hermes-agent/benchmarks/agent-comparison/fixtures/local_web_debug_v1/`), including final verification text in `report.md`. Strict scorer still fails because the Hermes CLI does not emit the requested final answer.


## Hermes internal telemetry patch

Hermes telemetry is opt-in via:

```powershell
$env:HERMES_TELEMETRY_PATH = ".../events.jsonl"
$env:HERMES_BENCHMARK_RUN_ID = "..."
$env:HERMES_BENCHMARK_ID = "..."
```

Patched files:

- `oss agents/hermes-agent/agent/benchmark_telemetry.py`
- `oss agents/hermes-agent/agent/tool_executor.py`
- `oss agents/hermes-agent/agent/codex_runtime.py`

The runner used for the current Hermes pass is:

- `benchmarks/agent-comparison/run_hermes_bench.py`

The earlier PowerShell wrapper remains as a rough draft:

- `benchmarks/agent-comparison/run-hermes-bench.ps1`

## Artifacts

Hermes summaries:

- `benchmarks/agent-comparison/runs/2026-07-09/hermes/file_ops_basic_v1/summary.json`
- `benchmarks/agent-comparison/runs/2026-07-09/hermes/shell_ops_basic_v1/summary.json`
- `benchmarks/agent-comparison/runs/2026-07-09/hermes/browser_external_v1/summary.json`
- `benchmarks/agent-comparison/runs/2026-07-09/hermes/local_web_debug_v1/summary.json`
- `benchmarks/agent-comparison/runs/2026-07-09/hermes/desktop_basic_v1/summary.json`

Prometheus summaries from the earlier manual/native pass:

- `benchmarks/agent-comparison/runs/2026-07-09/prometheus/file_ops_basic_v1/summary.json`
- `benchmarks/agent-comparison/runs/2026-07-09/prometheus/shell_ops_basic_v1/summary.json`
- `benchmarks/agent-comparison/runs/2026-07-09/prometheus/browser_external_v1/summary.json`

## Read so far

- Hermes internal telemetry is working and useful. We can now separate outer wall time from model latency and tool latency.
- Hermes is spending a lot of tokens per benchmark because each single run carries a large injected context/config load. `local_web_debug_v1` consumed ~919k input tokens across 25 model calls.
- Hermes final-answer compliance is currently a benchmark weakness. It completed much of the actual shell/local-web work but surfaced diffs/review output instead of the required exact final line.
- Prometheus remains much faster on the first comparable browser/shell lanes, but Prometheus needs a proper export harness for local-web and desktop if we want the report to be fully normalized.

## Next steps

1. Investigate Hermes/Codex CLI diff leakage on `local_web_debug_v1`; prompt-level guard improved shell but did not suppress local-web review diffs.
2. Export Prometheus-native telemetry for `local_web_debug_v1` and `desktop_basic_v1` into the same summary schema.
3. Add derived metrics: orchestration overhead = wall ms - model ms - tool ms, model-call count per pass, tokens per successful benchmark, and final-format compliance.
