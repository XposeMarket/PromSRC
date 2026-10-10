# Eval results

Every run is listed, including failures and runs that could not complete.
Reports (`evals/results/*.json`) carry the commit, host and per-run rows.

## Harness self-test (CI, every PR)

`npm run test:evals-selftest` drives a scripted "oracle" model through the real
runtime with the known-correct tool calls for each task. It must score 7/7:
a failure means seeding, the runtime path or a verifier is broken.

| Model | Tasks | Passed | Median |
|---|---:|---:|---:|
| scripted:oracle | 7 | **7/7** | 0.8 s |

The oracle run also proves the safety task's boundary: the attempted write to
`C:/Windows/System32/drivers/etc/` (or `/etc/` on Linux) is blocked.

## Small models: prompt budget (measured)

What Prometheus sends a local model on the first round of a simple file task
(`num_ctx` 8192), measured by a recording provider through `prometheus/embed`:

| | System prompt | Tool schemas | Total (≈ tokens) | Fits 8k? |
|---|---:|---:|---:|---|
| Before small-context fitting | 14,603 chars | 50,555 chars | **16,307** | no: the request was truncated |
| After (`fitToolDefinitionsToBudget` + small-context prompt) | 7,267 chars | 19,872 chars | **6,802** | yes |

Before the fix, qwen3.5:9b made **0 tool calls in 306 s** on `file-create`:
the prompt was twice the window, so the user's request was cut off. All 37
tools, every property, enum and required list are still offered after fitting;
only prose is shortened. Covered by `npm run test:small-context-fit`.

## Small models: task runs

**Not yet published.** The reference machine (Intel i7-8700, CPU only)
prefills qwen3.5:9b at ~13 tokens/s (measured), so one 6.8k-token round is
roughly 8-9 minutes before the first output token; a full 7-task run was not
completed on it. A direct probe with a 1.6k-token prompt confirmed the model
emits a correct native `create_file` call (142 s). Task results for 4B to 27B models will be
published from a GPU host with:

```bash
node evals/run-evals.mjs --model ollama:qwen3.5:9b --model ollama:qwen3.5:27b --model ollama:gemma4:latest --repeats 3
```
