# Prometheus architecture

This is the map a reviewer (human or agent) should read first. It describes how
a request becomes an agent turn, where authority is enforced, and which files
own which responsibility. Every path below exists at the commit this file ships
with; `npm run test:docs-evidence` fails CI if one of them disappears.

Related: [SECURITY.md](SECURITY.md) (trust model and enforcement),
[TESTING.md](TESTING.md) (how behaviour is verified).

## Layers

```
 Surfaces      Electron desktop (electron/main.js) · web UI (web-ui/src) · mobile PWA + native app (apps/mobile)
               CLI (src/cli) · Telegram and other channels (src/gateway/comms) · webhooks/triggers (src/gateway/triggers)
                                   │
 Gateway       src/gateway/server-v2.ts  (HTTP/SSE/WebSocket, auth, admission, routing, lifecycle)
                                   │
 Agent turn    handleChat / runInteractiveTurn  (src/gateway/routes/chat.router.ts)
               context + prompt → provider → tool calls → dispatch policy → executeTool → results → loop
                                   │
 Tool runtime  src/gateway/tool-builder.ts          tool surface, categories, schemas
               src/gateway/chat/tool-dispatch-policy.ts  dispatch-time authority (offered surface, allowlists)
               src/gateway/agents-runtime/subagent-executor.ts  executeTool: the single tool executor
                                   │
 Services      sessions (src/gateway/session.ts) · memory (src/gateway/memory, memory-index) · skills (src/gateway/skills-runtime)
               teams (src/gateway/teams) · scheduling (src/gateway/scheduling) · background tasks (src/gateway/tasks)
               Brain (src/gateway/brain) · connectors/MCP (src/connections, src/integrations) · providers (src/providers)
```

## One agent loop

Prometheus has exactly one model/tool loop: `handleChat` in
`src/gateway/routes/chat.router.ts`, entered through `runInteractiveTurn`.
Every way of running an agent goes through it:

| Entry point | File | Reaches the loop via |
|---|---|---|
| Main chat (desktop, web, mobile) | `src/gateway/server-v2.ts` | `runInteractiveTurn` |
| Background agents (`background_ops spawn`) | `src/gateway/tasks/background-task-runner.ts` | `handleChat` |
| Standalone subagent tasks, "Run task" button | `src/gateway/routes/channels.router.ts` (`runAgentTaskOnce`) | `runInteractiveTurn` |
| Managed team manager and members | `src/gateway/teams/team-manager-runner.ts`, `team-member-room.ts` | `runInteractiveTurn` |
| Scheduled jobs, heartbeat | `src/gateway/scheduling/cron-scheduler.ts`, `heartbeat-runner.ts` | `handleChat` |
| Timers, internal watches, session wake | `src/gateway/timers/timer-runner.ts`, `src/gateway/internal-watch/internal-watch-runner.ts`, `src/gateway/session-wake.ts` | `runInteractiveTurn` |
| Telegram and channels | `src/gateway/comms/telegram-channel.ts` | `runInteractiveTurn` |
| Brain thought/dream runs | `src/gateway/brain/brain-runner.ts` | `handleChat` |

There is no second engine. The earlier `node_call` Reactor (model-written
JavaScript in a VM), its second tool registry, and the orchestration and
file-op-v2 stubs were deleted in the 2026-10 legacy cleanup (PRs #557, #576,
#590, #600, #607, #608). `scripts/prune-dist.js` keeps their compiled output
from coming back into `dist/`.

## What happens in a turn

1. **Admission.** The gateway authenticates the request, resolves the session,
   and admits the turn into its execution lane.
2. **Context.** `src/gateway/prompt-context.ts` and `src/gateway/context/`
   build the system prompt, inject memory, notes and skills, and budget the
   context window for the selected model. Long turns compact mid-workflow
   (`src/gateway/context/compaction-safety.ts`, `src/gateway/session.ts`).
3. **Tool surface.** `buildTools` in `src/gateway/tool-builder.ts` assembles
   the schemas the model is offered: a small core set plus categories the turn
   has activated (`request_tool_category`).
4. **Provider call.** `src/providers/factory.ts` resolves an `LLMProvider`
   (`src/providers/LLMProvider.ts`); adapters normalise streaming, reasoning,
   tool calls and usage across Anthropic, OpenAI/Codex, xAI, Gemini and local
   runtimes.
5. **Dispatch.** Each requested call is checked by `evaluateToolDispatch`
   (`src/gateway/chat/tool-dispatch-policy.ts`) against the surface the model
   was actually offered and any agent allowlist, then by approval and path
   policy, then executed by `executeTool`. Independent calls run in parallel
   (`src/tools/parallel-tool-calls.ts`).
6. **Loop control.** Results go back to the model. The loop ends on a final
   answer, a stop, an approval wait, the repeated-call detector, or the
   idle-round ceiling (rounds where nothing was allowed to run).
7. **Persistence and recovery.** Sessions, tool observations, approvals and
   live-runtime checkpoints are durable. After a restart the gateway
   reconstructs the execution envelope and asks
   `decideExecutionReplay` (`src/gateway/runtime/execution-contract.ts`)
   whether resuming is safe; side-effecting work is not blindly replayed.

## Where to change things

| You want to… | Start in |
|---|---|
| Add a tool | `src/gateway/tools/defs/` (schema), `src/gateway/tool-builder.ts` (category), `subagent-executor.ts` (handler) |
| Add a provider | `src/providers/` (implement `LLMProvider`), register in `provider-registry.ts` |
| Add a connector | `src/integrations/connectors/`; every connector also exposes an approval-gated `<name>_api_request` |
| Change what an agent may run | `src/gateway/chat/tool-dispatch-policy.ts` (+ its regression and the replay scenarios) |
| Change approvals | `src/gateway/verification-flow.ts`, `src/gateway/approval-actions.ts` |
| Change recovery after restart | `src/gateway/runtime/execution-contract.ts`, `src/gateway/runtime-recovery.ts` |

## Known structural debt

Stated plainly so reviewers do not have to discover it:

- `chat.router.ts` (~22.7k lines) and `subagent-executor.ts` (~21.4k lines)
  are still the largest files. The loop is unified but not yet extracted into a
  standalone, independently importable module.
- The harness can be run headless only through the replay harness
  (`src/testing/replay/`), not yet through a public embedding API.

Both are tracked work, not hidden assumptions.
