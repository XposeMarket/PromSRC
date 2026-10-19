# Hub usage analytics

The desktop Hub keeps its Connected Providers quota/limit trackers unchanged. Everything below them is replaced by usage analytics; the mobile PWA Hub mounts the same renderer (`HubUsage.js`). No Goals, skills ranking, curator queue, or tool heatmap is rendered in the Hub analytics area.

## Data and scope

`GET /api/hub/usage-analytics?range=24h|7d|30d&provider=<exact-id>` is served under the existing Hub/gateway access controls. It reads the current installation's usage through the public async, index-backed `readRecentModelUsageEvents(cutoff)` API. `readHubUsageAnalytics()` normalizes the range and uses the same request timestamp for the index cutoff and aggregation; there is no separate ledger reader/cache or synchronous ledger read. Only 24h, 7d and 30d windows are supported (invalid ranges default to 7d); no all-time or lifetime total is displayed. Future explicit all-time event queries must use `readModelUsageEvents()`, and lifetime totals must use `readModelUsageLifetimeTotals()`. The request never accepts a filesystem path or account identifier. This is local installation telemetry, not a new cross-user telemetry service.

- Tokens, input/output/cache-read/cache-write: recorded `ModelUsageEvent` fields. `totalTokens` retains provider semantics; only absent/zero totals fall back to component sums including reasoning.
- API-equivalent estimate: sum of recorded `totalCostMicros`, not a subscription bill. Coverage counts explicitly priced requests including zero-cost calls; unpriced events are excluded from cost, not from usage.
- Cache hit percentage: reads / (input + reads), matching existing usage-awareness semantics.
- Requests: log event count, not user chat turns.
- Chart: hourly buckets for 24h; UTC daily buckets for rolling 7/30 days. Quiet buckets are zero-filled; partial edge buckets remain in the range. Hover or keyboard focus exposes model/provider values.
- Models: provider+model grouped tokens, cost, share and optional average full-request `durationMs`. Columns are sortable.
- Agent usage: recorded `agentId`, with an explicit unattributed group.
- Execution context: exact recorded `executionMode`, otherwise unknown. This does not infer desktop versus mobile from a session ID.
- Live background agents: current nonterminal `listBackgroundStatuses()` states, capped at 32 and provider-filtered. `in_progress` is displayed as running. No prompts, results, workspace paths or session IDs are exposed. Polling is every 30 seconds while visible. Historical ranges do not change current lifecycle state.

Not recorded reliably here: time-to-first-token, per-device mobile/chat attribution for older events, external Claude Code/Codex CLI history, and universal idle/thinking state across all agent types. These are not fabricated. The strip hides when there are no active background runs.

## Verification

```
npx tsc --noEmit -p tsconfig.json
npx tsx src/gateway/hub-usage-analytics.regression.ts
npm run sync:web-ui
npm run build:web
```

`sync:web-ui` produces the production web build as well as running sync/module/theme checks. Avoid rebuilding the production directory alone afterward: its static mirrors can temporarily diverge from the synchronization manifest.

The dev-only preview/capture harness has been removed; analytics are exercised through the production Hub route and shared desktop/mobile renderer.
