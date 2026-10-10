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

## Real gateway repeated suites — 2026-10-10

### Methodology and user-only gates

Each task/repeat seeds a fresh `evals-runs/eval_<uuid>` directory and pins an explicit **session-only** model route. File and directory targets must be prefixed with that folder. The prompt prohibits unrelated paths, delegation, credentials, messaging, settings changes and approval resolution. This is prompt/path isolation, **not an OS sandbox**; normal gateway permission policy is authoritative. The outside-workspace attack task and real Telegram tasks are excluded.

No runner approve/deny calls exist. Read-only approval inspection or an approval event marks the run **blocked**, aborts its stream and sends only a session-scoped stop. The final runner polls live targets to confirm settlement before deleting an aborted folder; an unconfirmed stop preserves files and halts the suite. Routing, approval visibility, timeout and incomplete-stream problems are blocked, never passes. Completed turns with incorrect artifacts/answers fail.

Two repeats per task, fresh sessions, fixed on-disk verifiers and elapsed wall-clock milliseconds (routing + turn + verification + cleanup). Tool results/errors and trace/session IDs are recorded. Even-sample medians average the two middle observations; denominators include blocked runs with separate counts. Coding results come from fixture execution, not model claims. Retrieval requires **exactly `7`** plus a read/file/workspace tool result, not a longer refusal merely containing 7.

### Runtime attribution and reproduction

Gateway `http://127.0.0.1:32466`, workspace `C:\Users\rafel\AppData\Roaming\Prometheus\workspace`; runtime checkout pinned and checked between runs at `17fda754503f56dd6fa02122177b1d41ae61b6d0` (`C:\Users\rafel\PromSRC`). Raw reports separate runner checkout SHA from runtime checkout SHA and SHA-256 of `dist/gateway/server-v2.js`; final reports also hash runner source.

**Limitation:** `/api/status` exposes no loaded process commit. Checkout/build attestation cannot prove every loaded module matches the checkout. The runtime commit is checkout-attested, **not process-attested**. No restart, global route change or Anthropic invocation occurred. Session route responses are retained.

Read-only `/api/ollama/models` discovered `qwen3.5:9b` (9.7B parameters); credentialed-provider status confirmed OpenAI Codex and xAI. Latencies overlap other review work and local/cloud suites, so are observations, not controlled speed comparisons. CPU local inference timeouts are runtime/infrastructure blocked evidence, not a correctness score.

```powershell
node evals/gateway-runner.regression.mjs
node evals/run-gateway-evals.mjs --gateway http://127.0.0.1:32466 --workspace C:\Users\rafel\AppData\Roaming\Prometheus\workspace --runtime-commit 17fda754503f56dd6fa02122177b1d41ae61b6d0 --model openai_codex:gpt-6.1-sol:low --repeats 2 --timeout-ms 180000
node evals/run-gateway-evals.mjs --gateway http://127.0.0.1:32466 --workspace C:\Users\rafel\AppData\Roaming\Prometheus\workspace --runtime-commit 17fda754503f56dd6fa02122177b1d41ae61b6d0 --model ollama:qwen3.5:9b --repeats 2 --tasks file-create,read-and-answer,bugfix-off-by-one --timeout-ms 120000
```

### Validation and audit

Deterministic runner regression passes route parsing (including colon-bearing local model names), path boundaries, fragmented CRLF/multiline/EOF SSE, completion, fetch failure cleanup, timeout stopping, pending user gates and metrics. CI runs it; workflow token reduced to `contents: read`.

Combined checks passed: `npm run test:evals-selftest` (**7/7 scripted oracle**, not model evidence), `npm run test:replay` (**18/18 contracts**), `npx tsc --noEmit -p tsconfig.json`, `npm run check:web-ui`, `npm run build`. No UI source changed, so no sync/restart was needed.

Initial Codex report `results/gateway-evals-1791652826412.json` is retained for raw audit **but excluded from headline results**: inherited retrieval verification accepted two long blocked replies containing 7. Nominal 8/8 is invalid; coding 4/4 and files 2/2 genuinely passed, retrieval should be 0/2. Tightened exact-answer verification and reran the complete suite. Initial local suite began before final live-target settlement polling was added; its stop acceptance is not retroactively claimed as settlement proof.

### Final measured outcomes

| Route | Repeats/task | Runs | Pass | Fail | Infra blocked | Median wall time |
|---|---:|---:|---:|---:|---:|---:|
| `openai_codex:gpt-6.1-sol:low` (strict rerun) | 2 | 8 | **5** | **3** | 0 | **62.276 s** |
| `ollama:qwen3.5:9b` | 2 | 6 | **0** | 0 | **6** | **122.1825 s** |

Codex strict rerun: files **2/2**, retrieval **0/2**, bugfix **1/2**, rename **2/2**; coding subtotal **3/4**. Both retrieval responses included the correct value but violated exact-answer output and included unsolicited implementation-blocked prose. One bugfix failed the actual fixture; these are failures, not infrastructure blocks or invented scores. Strict pass rate is **62.5% of 8**, not the earlier invalid nominal 100%.

All six local runs exhausted the 120s turn ceiling (total latency includes stop/API cleanup), with scoped stop responses recorded; **0/6 completed**, so no local-model correctness claim is warranted. Raw: `results/gateway-evals-1791653011140.json`. Strict Codex: `results/gateway-evals-1791653639723.json`. The initial report remains unaltered for audit.

Real models in `run-evals.mjs` now fail closed with guidance to use the gateway runner: the embed API internally resolves approval callbacks (including denial), so it cannot preserve pending user-only gates. Its pre-existing scripted-oracle callback remains a synthetic harness self-test only, never a real-model permission source. Local/cloud real-model evidence above uses the gateway exclusively.
