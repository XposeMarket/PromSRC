# Prometheus vs Hermes Agent Benchmark

Purpose: compare Prometheus and Hermes on real workflow execution, with normalized telemetry around latency, tool usage, cost/usage where available, errors, retries, artifacts, and pass/fail outcome.

## Current Hermes readiness

Hermes is installed at:

```text
oss agents/hermes-agent
```

Hermes is configured to use Raul's OpenAI Codex OAuth account with:

```text
provider: openai-codex
model: gpt-5.5
```

Browser readiness is now verified after Chromium was installed into the Playwright cache.

Smoke command used by Prometheus:

```powershell
cd "oss agents\hermes-agent"
python -m uv run hermes chat --provider openai-codex -m gpt-5.5 --quiet --query "Use your browser tool to open https://example.com, read the page title or main heading, then close/cleanup if your tools support it. Reply with exactly: HERMES_BROWSER_SMOKE_OK: <title-or-heading>. If browser tools are unavailable, reply HERMES_BROWSER_SMOKE_BLOCKED: <reason>."
```

Observed result:

```text
HERMES_BROWSER_SMOKE_OK: Example Domain
```

## Benchmark lanes for v1

1. `file_ops_basic_v1` — read/search/write/patch/verify workspace files.
2. `shell_ops_basic_v1` — version command, failing command classification, corrected command, artifact write.
3. `local_web_debug_v1` — create local HTML/JS bug fixture, serve it, browser-test it, diagnose console/UI issue, patch it, retest.
4. `browser_external_v1` — open a simple public page, extract visible heading/title, screenshot/cleanup.
5. `desktop_basic_v1` — screenshot/list/focus/click/type/verify where each agent has equivalent host-desktop tools. If Hermes lacks equivalent host desktop control, mark capability unavailable rather than failure.

## Normalized output shape

Each benchmark run should produce:

- `runs/<date>/<agent>/<benchmark_id>/events.jsonl`
- `runs/<date>/<agent>/<benchmark_id>/summary.json`
- benchmark artifacts such as logs, screenshots, diffs, generated files
- a combined Markdown report under `reports/`

Summary fields:

```json
{
  "run_id": "bench_...",
  "agent": "prometheus|hermes",
  "benchmark_id": "local_web_debug_v1",
  "status": "pass|fail|blocked",
  "blocked_reason": null,
  "total_wall_ms": 0,
  "tool_calls": 0,
  "tool_errors": 0,
  "retries": 0,
  "tokens_input": null,
  "tokens_output": null,
  "estimated_cost_usd": null,
  "artifacts": [],
  "notes": ""
}
```

## Fairness rule

Separate capability availability from task quality. If an agent lacks a browser or desktop lane, that lane is `blocked`, not `fail`. File/shell/browser lanes should be run first because Hermes is now browser-ready.
