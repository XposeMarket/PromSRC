# Tool Latency and Prompt Payload Benchmark — 2026-08-09

This is the source-grounded latency pass for the live local gateway. It measures the end-to-end `/api/chat` stream, provider/model rounds, prompt payload, tool executor wall time, result delivery, and the gap from a tool result to the next visible model token. The harness retains only opaque IDs, categories, byte counts, token counts, and timings; it does not retain prompts, credentials, file contents, page contents, or tool results.

## Environment and runs

- Gateway: `http://127.0.0.1:18789`, Windows 10.0.26200, Node v20.20.2.
- Provider/model: `openai_codex` / `gpt-5.6-luna`, reasoning `low`.
- Harness: `scripts/benchmark-tool-performance.mjs`.
- Families: desktop, browser, workspace, terminal, web/fetch, connector, subagent, and core.
- Full baseline: 24 turns, 3 samples per family, captured before this pass at 16:28Z. No errors.
- Corrected compact-memory A/B: 6 paired turns (terminal and subagent, 3 each), full versus compact, with automatic category routing and no forced `request_tool_category` call. No errors.
- Compact all-family verification: 24 turns, 3 samples per family. No errors and every expected tool was observed.

## What the latency is actually coming from

The local executor/transport is not the dominant delay. In the compact all-family run, tool wall-time p50/p95 was:

| Family | Tool wall p50 | p95/max | Result → next visible token p50 |
|---|---:|---:|---:|
| desktop | 850 ms | 1,339 ms | 1,372 ms |
| browser | 885 ms | 1,858 ms | 3,077 ms |
| workspace | 13 ms | 15 ms | 1,751 ms |
| terminal | 489 ms | 610 ms | 1,890 ms |
| web/fetch | 646 ms | 779 ms | 1,821 ms |
| connector | 14 ms | 15 ms | 2,530 ms |
| subagent list | 4 ms | 4 ms | 2,309 ms |
| core/timer | 6 ms | 10 ms | 2,361 ms |

The expensive part is usually the provider/model decision and follow-up round: accepted-to-tool-call was commonly 3.6–8.2 seconds, even when the executor itself took 4–15 ms. Therefore, making the tool function itself faster cannot remove most of the observed delay. The next high-value work is reducing provider input and unnecessary model rounds while retaining the deterministic router and fallback.

## MEMORY.md A/B result

`workspace/MEMORY.md` is 30,637 characters. Normal interactive prompt construction currently injects it in full through `src/gateway/prompt-context.ts`. The corrected benchmark-only compact mode caps that one block at 8,000 characters; it does not change `USER.md`, either soul layer, tool routing, or automatic retrieval.

| Measurement | Full | Compact | Change |
|---|---:|---:|---:|
| Terminal system-prompt chars | 87,026 | 64,390 | −22,636 (−26.0%) |
| Subagent system-prompt chars | 84,793 | 62,157 | −22,636 (−26.7%) |
| Terminal first model-round input | ~20,352 tokens | ~15,139 | −5,213 (−25.6%) |
| Terminal follow-up input | ~20,618 tokens | ~15,403 | −5,215 (−25.3%) |
| Subagent first model-round input | ~19,817 tokens | ~14,604 | −5,213 (−26.3%) |
| Subagent follow-up input | ~20,257 tokens | ~15,045 | −5,212 (−25.7%) |

This proves that full MEMORY.md is a major token and cost driver. A tool turn usually has two provider rounds, so the observed reduction is roughly 10.4k input tokens per two-round turn. No provider dollar amount is stated because the live `gpt-5.6-luna` route does not expose a verified billing rate in this repository.

It did not prove a deterministic wall-clock reduction. In the paired six-turn A/B, compact p50 end-to-end was 7.00s versus 7.25s full, and p50 first visible token was 5.78s versus 6.06s full, but the compact run had a provider tail outlier. The honest conclusion is: compact memory materially reduces payload/cost and can reduce latency, but provider variance and model rounds still dominate wall time.

## Important safety boundary

The 8k cap is not safe as a production design by itself. It is a head slice. The current MEMORY sections are approximately:

- `project_memory`: 14,624 chars
- `key_decisions`: 6,413 chars
- `migrated_operating_runbooks`: 2,842 chars
- `operational_rules`: 5,962 chars

The first 8k therefore omits many current decisions and operational rules. The compact path remains benchmark-only until the memory/context-compiler work replaces the slice with ranked atoms/capsules plus bounded retrieval. Raw MEMORY.md should remain available out-of-band for explicit evidence requests.

Automatic memory search is already bounded to a 250 ms budget and starts in parallel with project/skill context work (`src/gateway/prompt-context.ts`). The benchmark traces did not show it as the source of multi-second tool delays; it should remain optional/bounded rather than becoming a synchronous deep search.

## Reporting accuracy fix

The context-window estimator in `src/gateway/routes/chat.router.ts` previously displayed MEMORY.md using an 8,000-character cap even though normal interactive runtime injected the full file. It now reuses `loadFullMemoryProfile`, so the UI’s memory row reflects the actual normal prompt path. This is a reporting fix only; it does not increase or decrease runtime prompt content.

## Safe improvements and next decisions

1. Keep deterministic automatic category activation. The earlier A/B showed accepted-to-tool p50 falling from about 7.17s to 5.27s for terminal and 6.95s to 4.09s for subagent when the model did not have to emit a separate category-request call. Keep `request_tool_category` as fallback.
2. Implement the memory atom/context compiler in the parallel memory workstream. It should preserve the full evidence store, inject a small relevant capsule, use automatic memory search only as a bounded/cacheable sidecar, and test decisions/operational rules explicitly.
3. Audit tool-schema payloads next. Even after the memory reduction, compact runs still sent roughly 12.2k–15.8k input tokens per round. Category schemas and stable runtime instructions are the next large controllable payload.
4. Optimize desktop/browser executors separately. Their local p50s are approximately 0.85–0.89s and their tails approach 1.3–1.9s; workspace/core/subagent/connector dispatch is already in the millisecond range. Browser/network work cannot honestly be promised at zero milliseconds, so reuse/warmth and parallel independent observations are the safe levers.

## Live verification

- Backend build passed after the benchmark and estimator changes.
- Managed quick restart completed; final health check was `ok: true`, `fastPath: true`, PID `30588`.
- Post-restart full-memory smoke: core, desktop, browser; 3 turns, all expected tools observed, errors 0.
- Passed: TypeScript no-emit check, context-window usage regression, tool-category routing regression, and prompt-cache assembly regression.
- The combined context-window UI script still fails on an unrelated dirty-worktree generated `ChatPage.js` sync assertion in `scripts/test-context-window-ui.mjs`; the context-window usage regression itself passes.

