# Gateway warm handoff

## Why

Every lane in Prometheus (main chat, background tasks, subagents, teams, cron,
heartbeat, Brain) executes through `handleChat` inside the gateway process.
Until now a *planned* restart — self-edit apply, self-update, proposal apply,
manual/voice quick restart, stall or memory recovery — interrupted every live
runtime, exited, and relied on checkpoint recovery on the next boot. Recovery
pauses tasks and asks before resuming; long work was effectively lost.

Between 2026‑09‑01 and 2026‑09‑19 the gateway exited with code 42 (planned
restart) 42 times and crashed 0 times. The drops were all self-inflicted.

## What changes

A planned restart now becomes a **warm handoff** when there is live work to
protect:

1. The restarting gateway ("host") interrupts **only the runtime(s) that asked
   for the restart** — the turn inside `gateway_restart` /
   `prom_apply_dev_changes`, the task named in the restart context, or the
   sessions of a dev-edit continuation/apply batch. Those checkpoint exactly as
   before and resume on the replacement's new code through BOOT.
2. Everything else keeps running in the host. The host stops its schedulers
   and pollers (cron, heartbeat, Brain ticker, Telegram polling, internal
   watches, thread supervision, auto-settle), stops writing the supervisor
   status/lease files, terminates WebSocket clients (they reconnect to the
   replacement), and closes its listeners **without** destroying established
   connections, so an in-flight chat SSE response keeps streaming.
3. The host opens a local socket (`\\.\pipe\prometheus-handoff-<hash>-<pid>` on
   Windows, a temp-dir socket elsewhere) and writes a manifest under
   `<state>/runtimes/handoff-hosts/<pid>.json`.
4. The launcher starts the replacement: the CLI supervisor or the Electron
   desktop app receives a `gateway_handoff` IPC message and spawns the new
   child immediately without killing the host; an unsupervised
   `prom gateway start` host spawns the replacement itself. Under Electron the
   public relay enters a handoff state that keeps the host's established
   streams (chat SSE, tool output) piped to the UI while new requests wait for
   the replacement; the backend port is reused once the host releases it.
5. The replacement adopts every live host at boot (before interrupted-runtime
   recovery): it mirrors the host's running runtimes as **remote records**
   (`remoteHostPid`), relays the host's WebSocket broadcasts to its own
   clients, forwards abort / steer / task pause / task cancel to the host, and
   evicts its cached copy of a session or task index whenever the host reports
   a write. Admission treats a mirrored `main_chat` runtime as a busy session
   (409 `SESSION_TURN_ACTIVE`), so the user cannot start a second turn against
   a draining one.
6. The host is the only process that mutates its runtimes; its durable ledger
   writes are routed to the replacement over the socket (the shared ledger
   file has a single writer at all times). When the last carried runtime
   finishes (plus a short settle window) the host shuts its workers down,
   flushes sessions, sends `drain_complete`, removes its manifest, and exits
   with code 0. If the drain deadline (`PROMETHEUS_GATEWAY_HANDOFF_MAX_DRAIN_MS`,
   default 12 h) passes first, the remaining runtimes are checkpointed with the
   legacy path and the replacement runs recovery for them.
7. If the host dies mid-drain the replacement detects the dead pid, marks the
   host's runtimes interrupted with a fresh restart epoch, and runs the normal
   crash-recovery pass.

Cascading restarts work: a replacement that restarts while a host is still
draining hands its own runtimes to the next gateway, which re-adopts every live
host from the manifests.

## When the legacy restart is still used

`planGatewayHandoff` falls back to interrupt-and-exit when:

- `PROMETHEUS_GATEWAY_HANDOFF=0`;
- the restart context says `handoffPolicy: 'never'` (memory-pressure recovery
  does this: keeping the bloated process alive would defeat the purpose);
- `restartScope: 'supervisor'` (full supervisor replacement);
- the launcher (CLI supervisor or Electron main) has no IPC channel to the
  gateway — i.e. it is running a build from before this change and has not
  itself been restarted;
- there is no live runtime to carry other than the restart-initiating one.

## Files

| Area | File |
| --- | --- |
| Protocol, framing, manifests, socket paths | `src/gateway/runtime/gateway-handoff-protocol.ts` |
| Host (draining gateway) socket server | `src/gateway/runtime/gateway-handoff-host.ts` |
| Client (replacement) + manifest adoption | `src/gateway/runtime/gateway-handoff-client.ts` |
| Wiring into registry / session / tasks / broadcaster | `src/gateway/runtime/gateway-handoff-bridge.ts` |
| Restart decision + drain loop | `src/gateway/lifecycle.ts` (`planGatewayHandoff`, `beginGatewayHandoff`) |
| Remote runtime mirrors, persistence sink, ledger freeze | `src/gateway/live-runtime-registry.ts` |
| Hooks `stopSchedulersForHandoff` / `closeListenersForHandoff`, adoption at boot | `src/gateway/server-v2.ts` |
| Recovery skip for hosted runtimes, initiating-runtime checkpoint | `src/gateway/runtime-recovery.ts`, `src/gateway/core/startup.ts` |
| Supervisor IPC + draining children | `src/cli/index.ts` |
| Electron IPC, draining children, relay handoff state | `electron/main.js`, `electron/gateway-reverse-proxy.js` |
| Task pause/cancel forwarding | `src/gateway/tasks/background-task-runner.ts` |

## Operational notes

- The host keeps its own model-call / context / memory workers alive until it
  exits, so a drain window temporarily runs two sets of workers.
- Exclusive external resources (a Chrome profile, a desktop lease) stay with
  whichever process holds them; the replacement will fail to acquire them
  until the host finishes. This matches today's behaviour for a still-running
  tool and is bounded by the drain deadline.
- The host's turns may still call `send_telegram` etc. directly; only
  *polling* moves to the replacement.
- A restart requested from a draining host is rejected with a clear error; the
  replacement must issue it.

## Tests

```bash
npm run test:gateway-handoff        # protocol, host/client session, host loss, registry mirrors, plan rules
npm run test:gateway-handoff-e2e    # real supervised gateway: quick restart with a live synthetic runtime
```
