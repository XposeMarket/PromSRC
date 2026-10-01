---
name: "evidence-driven-agent-model-router"
description: "Benchmark and route agent roles using measured quality, latency, cost, and tool reliability. Use when choosing or revising agent model assignments; use model-routing-incident-response for a live outage, not this benchmark."
---

# Evidence-Driven Agent Model Router

Classify lanes as planning, coding, research/context, computer action, review, summarization, or mixed. Define representative tasks and pass criteria. Benchmark comparable prompts/tools/settings and capture success, pass rate, latency, tokens/cost, tool errors, retries, failure mode, and sample size. Prefer the least expensive route meeting the quality floor. Maintain a versioned table with primary, fallback, escalation trigger, evidence date, and confidence. Local benchmarks and recent telemetry outrank bookmarks and leaderboards. Re-benchmark after model/provider/tool/pricing changes or production drift. State uncertainty and never generalize beyond tested lane classes.

For background agent benchmarks or production spawns, only use fully qualified `openai_codex/gpt-6-sol` or `openai_codex/gpt-6-luna`; compare other models with isolated provider/API evaluation, not Prometheus spawns. Review Luna results before promoting a route.
