# Observability

## Turn traces

Every agent turn gets a trace id. Prometheus has one turn loop (`handleChat`),
so this covers main chat, background agents, subagent tasks, team members,
cron, heartbeat, Brain and channels alike.

The id is carried on the turn's async path (`AsyncLocalStorage`, see
`src/gateway/observability/turn-trace.ts`), so these all record spans against
the same trace without threading ids through every call:

| Span kind | Recorded where | Fields |
|---|---|---|
| `turn` | `handleChat` wrapper | execution mode, duration, status (`ok` / `error` / `aborted`), tool count |
| `model_call` | each provider round in the loop | provider, model, message count, duration |
| `tool` | `executeTool` (every path, incl. delegated wrappers) | tool, action, duration, `ok` / `error` |
| `tool_dispatch` | dispatch policy refusals | tool, refusal code |
| `approval` | `ApprovalQueue.create` / `resolve` | approval id, kind, risk, `pending` → `approved` / `rejected`, wait time |

A turn started from inside another traced turn (a child agent) gets its own
trace whose spans carry `parentTraceId`, so a delegation tree is readable from
the root.

**Where to read them**

- `handleChat` results include `traceId`.
- `GET /api/traces` lists recent traces; `GET /api/traces/:traceId` returns
  the spans plus `childTraceIds`.
- Spans persist to `<config dir>/traces/YYYY-MM-DD.jsonl` (20 MB/day cap).
- `X-Prometheus-Trace-Id` is set on chat HTTP responses.

Tested by `npm run test:turn-trace` (CI): spans for model calls, tools,
refusals; separate turns never share spans; interleaved concurrent traces stay
isolated; child traces link to their parent.

## Other telemetry

- **Tool observations** (`src/gateway/tool-observations.ts`): per-session JSONL
  of every tool call with args/result previews, paths touched, exit code,
  duration and token cost.
- **Turn timing** (`src/gateway/chat/turn-timing.ts`): time-to-first-token and
  phase timings per turn, `<config dir>/logs/turn-timing.log`.
- **Live runtimes** (`src/gateway/live-runtime-registry.ts`): durable ledger of
  in-flight work with checkpoints, used for crash recovery.
- **Stream events** (SSE): `token`, `thinking`, `tool_call`, `tool_result`,
  `progress_state`, `compaction`, `done`, consumed by the desktop and mobile UI.
