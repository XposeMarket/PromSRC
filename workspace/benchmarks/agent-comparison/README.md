# Phase 6 — Prometheus / Hermes / OpenClaw agent benchmark

This directory is the single comparison harness. New agents and lanes extend it; they do not get separate benchmark systems.

## Current controlled setup

All three agents are configured for the same target model and reasoning level:

```text
model: gpt-5.6-luna
reasoning: high
```

The runtime labels remain explicit because the harnesses do not have identical provider plumbing:

- `prometheus_codex_http`: Prometheus gateway → OpenAI Codex Responses endpoint.
- `hermes_codex_http`: Hermes agent loop → OpenAI Codex Responses endpoint.
- `openclaw_codex_app_server`: OpenClaw CLI/agent loop → OpenClaw Codex provider plugin → Codex app-server.

The last label is intentional. OpenClaw is still the harness being tested; the Codex app-server is the model/runtime provider underneath it. Results must never call this “pure embedded OpenClaw runtime” unless a separately authenticated OpenAI API-key profile is used.

Port safety is part of the controlled setup: Prometheus reserves Tailscale Funnel target port `18789`. The OpenClaw benchmark gateway must stay loopback-only on `19089` (or another explicitly isolated non-Funnel port); never bind OpenClaw to `18789`.

## Run the orchestrator

From the repository root:

```powershell
node workspace/benchmarks/agent-comparison/run_phase6_benchmark.mjs --lanes file_ops_basic_v1,shell_ops_basic_v1
```

Defaults run the selected lanes through Prometheus, Hermes, and OpenClaw with isolated per-agent workspaces. Each lane gets a fresh session and a verifier checks both the final response and workspace artifacts.

Outputs:

```text
runs/<date>/<run_id>/<agent>/<benchmark_id>/
  prompt.txt
  stdout.txt
  stderr.txt
  events.jsonl
  summary.json
reports/phase6-<run_id>.md
```

## Phase 6 order

1. File and shell tasks.
2. Read-only browser research on simple public pages.
3. Deterministic browser fixture with a mock CAPTCHA (never a real anti-bot challenge).
4. Harmless desktop-computer workflows.
5. Website creation with skills and without skills.
6. Three.js object, scene, game, and cinematic tasks.
7. Controlled bug investigation.
8. Read-only real-site research on X, Reddit, news, and documentation.

Public-site lanes must not log in, post, purchase, submit personal information, or perform destructive actions. Browser-fixture CAPTCHA behavior is a local deterministic checkbox/mock challenge only.

## Outcome rules

- `pass`: the task was attempted and the final response plus independent artifact/evidence checks are correct.
- `fail`: the agent attempted the task but produced an incorrect, incomplete, or unverifiable result.
- `blocked`: the required capability was unavailable, such as no browser or no host-desktop control. A blocked lane is not a quality failure.

Do not rank agents from one run. Use repeated runs per lane, report median and p90 wall time, and keep cold-start and warm-session measurements separate. Compare quality first, then latency/tool efficiency among passes.

## Existing lanes

- `file_ops_basic_v1` — read/search/write/verify workspace files.
- `shell_ops_basic_v1` — version command, intentional command-not-found recovery, artifact write.
- `local_web_debug_v1` — create and debug a local counter app.
- `browser_external_v1` — read-only `example.com` browser check.
- `desktop_basic_v1` — fresh screen observation and harmless window check.

Later lanes should add their prompt, fixture, verifier, and evidence requirements here rather than weakening an existing lane.
