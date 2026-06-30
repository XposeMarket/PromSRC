# Browser Tool Benchmark

Started: 2026-06-28

Goal: exercise Prometheus browser tools on real websites, estimate relative latency/heaviness, identify bottlenecks, and record speedup recommendations.

Sites requested: Amazon, Walmart, GitHub, Vercel, Reddit, X.com, YouTube.

Reports:
- `browser-latency-results-2026-06-28.md` — original browser + desktop latency pass.
- `prometheus-tool-benchmark-2026-06-29.md` — full main-tool benchmark across workspace, dev-source, browser, desktop, memory, skills, automation, connectors, and core tools.
- `browser-desktop-speed-retest-2026-06-29.md` — focused retest after browser/desktop speed changes, with before/after timings and remaining bottlenecks.


Notes:
- No purchases, posts, logins, sensitive entries, or destructive actions.
- Downloads are limited to safe public/static assets or browser-triggered non-sensitive files.
- Timings use model-facing `[TOOL_STOPWATCH] elapsed_ms=...` when available.

