# Real-Site Browser Tool Benchmark

Started: 2026-06-28 16:22 local

Scope requested by Raul: test browser tools across real websites: Amazon, Walmart, GitHub, Vercel, Reddit, X.com, YouTube. Exercise opening, snapshots/screenshots, clicks, scrolling, typing/filling, extraction, JS inspection, network/console checks, downloads where safe, and identify slow/heavy tools plus speedups.

Constraints:
- No login, password, payment, purchase, posting, account mutation, checkout, or destructive actions.
- Avoid add-to-cart / submit flows unless explicitly approved.
- Use public assets only for downloads.

Timing note:
- Browser tools currently do not expose exact per-call elapsed milliseconds in their normal result payloads.
- I will record observed relative latency buckets and exact blockers/failure modes. Recommended product fix: add elapsed_ms to every tool result at the tool-router layer so this can be measured automatically.

## Running Findings

