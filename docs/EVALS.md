# Public cross-harness evaluation suite

This is a small deterministic smoke benchmark, not a leaderboard or proof of general reliability. Task JSON is harness-neutral; graders examine files (exact UTF-8 bytes) and, for bug fixing, execute an immutable test. Each task gets a fresh directory, seeded inputs, its own deadline, and a fresh harness session. Reference solutions live under `evals/harness-suite/tasks/<id>/solution` and are never supplied to real adapters.

## Run

From the repository root with Node dependencies installed (Node 20+, Git for the fresh-repo task):

```powershell
npm run -s test:eval-graders
npx tsx evals/harness-suite/run.ts --adapter dry --noop
npx tsx evals/harness-suite/run.ts --adapter prometheus --model ollama:qwen3.5:9b --workspace C:\path\to\gateway-workspace
npx tsx evals/harness-suite/run.ts --adapter hermes --model qwen3.5:9b
npx tsx evals/harness-suite/run.ts --adapter openclaw --model qwen3.5:9b
```

Use `--tasks 01-file-edit,03-bugfix` to select tasks and `--out <directory>` to select report output. Default reports are `evals/harness-suite/results/<ISO-date>-<adapter>-<model>.json` and `.md`. Self-test creates separate `dry` and `dry-noop` reports, exits nonzero unless all 12 references pass and all 12 no-ops fail. These are grader checks, **not real-model scores**.

### Adapter contracts and limitations

- **Prometheus:** defaults to `http://127.0.0.1:32466`; only loopback is permitted. No Authorization or proxy headers are sent: direct local loopback uses the gateway's existing trusted-local policy. PUT `/api/sessions/<unique-id>/model-route` selects an explicit provider/model; POST `/api/chat` consumes SSE through a `done` event. It does not change the global model. `--workspace` must match the gateway's configured workspace; fresh child directories are created there to avoid external-path permissions. A timeout requests session-scoped stop and confirms stop targets. Error directories are preserved conservatively. Successful directories are removed. Session history remains for audit. This adapter has not been run against the live gateway as part of this change.
- **Hermes / OpenClaw:** detected using `where.exe hermes/openclaw` on Windows, `which` elsewhere. Missing binaries produce `not_run: harness not installed`, never simulated results. Contracts are `hermes chat --model MODEL --query PROMPT` and `openclaw agent --local --session-id ID --model MODEL --message PROMPT`, invoked in the task directory. CLI versions differ: unsupported flags, Windows command shims that cannot be spawned as executables, and process errors are published as errors. These contracts have not been verified against installed CLIs here. No shell command interpolation is used. CLI multi-turn memory is `not_run` until a verified session-continuation contract exists, not silently concatenated into one prompt. The deadline aborts the direct CLI process; descendant termination is not guaranteed. Run CLIs in a sandbox when isolation matters.
- **Dry:** copies known-good reference files, or does nothing under `--noop`. It never invokes a model. Its cost-budget task verifies artifact discrimination only.

## Corpus

12 tasks: fresh Git file edit; shell sorting/deduplication; failing inclusive-sum test repair; injected nonzero shell failure/retry; instruction injection in an untrusted file with a protected sentinel; earlier-turn fact recall; nine-step dependency chain; 30-second time ceiling; USD 0.01 cost ceiling; JSON aggregation; multi-file edit with preserved sentinel; CSV filter/sort.

The recovery and long-horizon graders establish final-state correctness, not a trustworthy action trace: an agent may compute the final state directly. Injection grading establishes protected-file integrity, not a natural-language refusal. Exact output formats are specified in prompts. Graders run locally and task files are trusted repository fixtures; this is not a sandbox for arbitrary third-party graders.

## Fairness and reporting

Use the **same underlying model/version/quantization, hardware, model server, timeouts, tasks, context settings, tool/approval permissions and sampling settings** across harnesses. Model spelling alone does not establish identical routes: record each harness's resolved route and CLI version externally when publishing. Do not tune a harness on private task-specific instructions. Run repeated trials and publish every failure, timeout, unavailable category and raw report; never drop blocked tasks from a headline denominator. Category reports retain all tasks in the denominator with separate not-run counts. Compare only common runnable tasks, explicitly listing exclusions. Time is wall clock including setup/cleanup; median excludes not-run rows. Tool counts are observed Prometheus tool-result events only; CLI tool counts and all real costs are currently unavailable (`null`, not zero). No unsupported speed/cost superiority claims.

**Cost ceiling limitation:** no adapter currently supplies trusted live cost telemetry, so real cost-budget tasks are marked `not_run` *before execution*. This avoids spending an unverified budget or calling an artifact pass a cost pass. Add provider/harness telemetry before using this category for comparative scores. The runner checks time ceilings; it cannot verify a model did not make hidden network calls. Temp repositories and prompt constraints are not OS-level isolation.

## Local tool-loop regression

`npm run -s test:local-tool-loop` covers Qwen/Hermes XML envelopes, fenced JSON, string/object arguments, malformed output, advertised-name allowlists, native-call precedence, and actual mocked Ollama/OpenAI-compatible streaming and nonstreaming paths. Text recovery is restricted to Ollama, LM Studio and llama.cpp; it does not enable text calls on cloud adapters or when no tools were advertised. Thinking blocks are excluded. Native Ollama complete calls from successive chunks are retained rather than overwriting earlier chunks.

Historical `evals/RESULTS.md` reports six local runs hitting 120-second ceilings. That proves a completion problem, not that text parsing caused those specific runs. This change fixes concrete missing-fallback and overwritten-call defects; it does not claim those historical runs now pass. Ollama's tags endpoint was reachable with `qwen3.5:9b`; LM Studio's models endpoint was unavailable. No live inference or gateway benchmark was executed during implementation. Existing small-context fitting remains unchanged; no arbitrary tool removal or larger timeout was used to inflate results.
