/**
 * Wires the warm-handoff host/client into the live gateway subsystems.
 *
 * Host side (the gateway that is draining after a planned restart):
 *   - routes its durable runtime writes to the replacement instead of the
 *     shared ledger file, relays WebSocket broadcasts, and answers control
 *     requests (abort/steer/pause/cancel) for the turns it still owns.
 *
 * Client side (the replacement gateway):
 *   - mirrors the host's still-running runtimes as remote records so admission,
 *     task listings, and the UI see them as busy, forwards control requests,
 *     and drops stale session/task caches when the host reports a write.
 */
import { getConfig } from '../../config/config';
import { broadcastWS, enterGatewayDrainMode } from '../comms/broadcaster';
import { suspendRuntimeProgressLeaseWrites } from '../gateway-progress-lease';
import {
  abortLiveRuntime,
  addPendingRuntimeSteer,
  countLocalRunningRuntimes,
  dropRemoteLiveRuntimesForHost,
  getLiveRuntime,
  listLocalRunningRuntimes,
  markRemoteHostRuntimesInterrupted,
  removeRemoteLiveRuntime,
  setLiveRuntimePersistenceSink,
  setRemoteRuntimeControlForwarder,
  syncRemoteLiveRuntimes,
  toDurableLiveRuntimeSnapshot,
  upsertRemoteLiveRuntime,
  type LiveRuntimeSnapshot,
  type RemoteRuntimeControlOp,
} from '../live-runtime-registry';
import { evictSessionFromCache, setSessionWriteObserver } from '../session';
import { invalidateTaskIndexCaches } from '../tasks/task-store';
import { GatewayHandoffHost, type GatewayHandoffControlResult } from './gateway-handoff-host';
import {
  GatewayHandoffClient,
  adoptGatewayHandoffHosts,
  type GatewayHandoffClientAdapter,
} from './gateway-handoff-client';
import {
  GATEWAY_HANDOFF_MAX_FRAME_BYTES,
  gatewayHandoffFrameBytes,
  type GatewayHandoffRuntimeSnapshot,
} from './gateway-handoff-protocol';

// ─── Client side (replacement gateway) ───────────────────────────────────────

const adoptedHosts = new Map<number, GatewayHandoffClient>();
let recoveryHandler: (() => void) | null = null;
let recoveryPassScheduled = false;

/**
 * startup.ts registers the same interrupted-runtime recovery pass it runs at
 * boot, so runtimes a host interrupts (drain timeout / host crash) get the
 * normal task-pause + main-chat checkpoint handling.
 */
export function setHandoffRecoveryHandler(handler: (() => void) | null): void {
  recoveryHandler = handler;
}

function scheduleRecoveryPass(reason: string): void {
  if (!recoveryHandler || recoveryPassScheduled) return;
  recoveryPassScheduled = true;
  setTimeout(() => {
    recoveryPassScheduled = false;
    try {
      console.log(`[gateway-handoff] running interrupted-runtime recovery (${reason})`);
      recoveryHandler?.();
    } catch (error: any) {
      console.warn('[gateway-handoff] recovery pass failed:', error?.message || error);
    }
  }, 50).unref?.();
}

function forgetSessionState(runtime: Record<string, any> | LiveRuntimeSnapshot | null | undefined): void {
  const sessionId = String(runtime?.sessionId || '').trim();
  if (sessionId) evictSessionFromCache(sessionId);
  if (runtime?.taskId) invalidateTaskIndexCaches();
}

function createRegistryAdapter(): GatewayHandoffClientAdapter {
  return {
    syncHostRuntimes(hostPid, runtimes) {
      const result = syncRemoteLiveRuntimes(hostPid, runtimes as Array<Record<string, any>>);
      console.log(`[gateway-handoff] adopted host ${hostPid}: ${result.mirrored.length} running runtime(s) carried over${result.dropped.length ? `, ${result.dropped.length} already finished` : ''}`);
      invalidateTaskIndexCaches();
    },
    upsertHostRuntime(hostPid, runtime, eventType, extra) {
      const before = getLiveRuntime(String(runtime.id || ''));
      const snapshot = upsertRemoteLiveRuntime(hostPid, runtime as Record<string, any>, eventType, extra);
      if (snapshot?.status === 'interrupted') {
        forgetSessionState(snapshot);
        scheduleRecoveryPass(`host ${hostPid} interrupted runtime ${snapshot.id}`);
      } else if (snapshot && (!before || before.status !== snapshot.status) && snapshot.status !== 'running') {
        forgetSessionState(snapshot);
      }
    },
    deleteHostRuntime(hostPid, runtimeId, eventType, runtime, extra) {
      const previous = getLiveRuntime(runtimeId);
      const snapshot = removeRemoteLiveRuntime(hostPid, runtimeId, eventType, runtime as Record<string, any> | undefined, extra);
      forgetSessionState(snapshot || previous);
    },
    broadcast(data) {
      broadcastWS(data);
    },
    sessionFlushed(sessionId) {
      evictSessionFromCache(sessionId);
    },
    hostDrained(hostPid, interruptedRuntimeIds) {
      const dropped = dropRemoteLiveRuntimesForHost(hostPid);
      for (const runtime of dropped) forgetSessionState(runtime);
      invalidateTaskIndexCaches();
      adoptedHosts.delete(hostPid);
      console.log(`[gateway-handoff] host ${hostPid} finished draining${interruptedRuntimeIds.length ? ` (${interruptedRuntimeIds.length} runtime(s) interrupted at the drain deadline)` : ''}`);
      if (interruptedRuntimeIds.length) scheduleRecoveryPass(`host ${hostPid} drain deadline`);
      broadcastWS({ type: 'gateway_handoff_complete', hostPid, interruptedRuntimeIds });
    },
    hostLost(hostPid, reason) {
      const interrupted = markRemoteHostRuntimesInterrupted(hostPid, `handoff_host_lost:${reason}`);
      for (const runtime of interrupted) forgetSessionState(runtime);
      invalidateTaskIndexCaches();
      adoptedHosts.delete(hostPid);
      console.warn(`[gateway-handoff] host ${hostPid} was lost (${reason}); ${interrupted.length} runtime(s) routed to crash recovery`);
      if (interrupted.length) scheduleRecoveryPass(`host ${hostPid} lost`);
      broadcastWS({ type: 'gateway_handoff_lost', hostPid, reason, interruptedRuntimeIds: interrupted.map((runtime) => runtime.id) });
    },
    log(message) {
      console.log(message);
    },
  };
}

async function forwardControl(hostPid: number, op: RemoteRuntimeControlOp, args: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const client = adoptedHosts.get(hostPid);
  if (!client) return { ok: false, error: `No adopted handoff host with pid ${hostPid}.` };
  return client.control(op, args);
}

/**
 * Adopt every live draining host before interrupted-runtime recovery runs, so
 * their still-running work is mirrored instead of treated as crashed.
 */
export async function adoptGatewayHandoffHostsAtBoot(): Promise<{ hosts: number; staleManifests: number; unreachable: number }> {
  if (process.env.PROMETHEUS_GATEWAY_HANDOFF === '0') return { hosts: 0, staleManifests: 0, unreachable: 0 };
  const stateDir = getConfig().getConfigDir();
  const result = await adoptGatewayHandoffHosts({
    stateDir,
    adapter: createRegistryAdapter(),
    connectTimeoutMs: Math.max(1_000, Number(process.env.PROMETHEUS_GATEWAY_HANDOFF_CONNECT_TIMEOUT_MS || 8_000)),
  });
  for (const client of result.hosts) adoptedHosts.set(client.hostPid, client);
  if (adoptedHosts.size) setRemoteRuntimeControlForwarder(forwardControl);
  return { hosts: result.hosts.length, staleManifests: result.staleManifests, unreachable: result.unreachable };
}

/** True while a live, connected previous gateway still owns this runtime. */
export function isRuntimeHostedByLiveHandoffHost(runtime: Pick<LiveRuntimeSnapshot, 'pid' | 'status' | 'remoteHostPid'> | null | undefined): boolean {
  if (!runtime || runtime.status !== 'running') return false;
  const hostPid = Number(runtime.remoteHostPid || runtime.pid || 0);
  if (!hostPid || hostPid === process.pid) return false;
  const client = adoptedHosts.get(hostPid);
  if (!client) return false;
  return client.currentState === 'connected' || client.currentState === 'reconnecting' || client.currentState === 'connecting';
}

export function listAdoptedHandoffHosts(): Array<{ hostPid: number; state: string; lastHeartbeatAt: number }> {
  return Array.from(adoptedHosts.values()).map((client) => ({
    hostPid: client.hostPid,
    state: client.currentState,
    lastHeartbeatAt: client.lastHeartbeat,
  }));
}

export function closeAdoptedHandoffHosts(): void {
  for (const client of adoptedHosts.values()) client.close();
  adoptedHosts.clear();
  setRemoteRuntimeControlForwarder(null);
}

// ─── Host side (draining gateway) ────────────────────────────────────────────

let activeHost: GatewayHandoffHost | null = null;

export function getActiveHandoffHost(): GatewayHandoffHost | null {
  return activeHost;
}

async function handleHostControl(op: RemoteRuntimeControlOp, args: Record<string, unknown>): Promise<GatewayHandoffControlResult> {
  switch (op) {
    case 'runtime_abort': {
      const result = abortLiveRuntime(String(args.runtimeId || ''), String(args.reason || 'operator_abort'), { source: args.source ? String(args.source) : undefined });
      return { ok: result.ok, error: result.error };
    }
    case 'runtime_steer': {
      const input = (args.input && typeof args.input === 'object' ? args.input : {}) as any;
      const result = addPendingRuntimeSteer(String(args.runtimeId || ''), input);
      return { ok: result.ok, error: result.error, result: result.event ? { steerId: result.event.id } : undefined };
    }
    case 'task_pause': {
      const { BackgroundTaskRunner } = require('../tasks/background-task-runner') as typeof import('../tasks/background-task-runner');
      BackgroundTaskRunner.requestPause(String(args.taskId || ''));
      return { ok: true };
    }
    case 'task_cancel': {
      const { BackgroundTaskRunner } = require('../tasks/background-task-runner') as typeof import('../tasks/background-task-runner');
      const ok = BackgroundTaskRunner.cancelTask(String(args.taskId || ''), args.reason ? String(args.reason) : undefined);
      return { ok, error: ok ? undefined : 'Task not found.' };
    }
    default:
      return { ok: false, error: `Unsupported handoff control op: ${String(op)}` };
  }
}

function transportSnapshot(runtime: LiveRuntimeSnapshot): GatewayHandoffRuntimeSnapshot {
  // Interrupted runtimes carry their full process log for recovery. Send it
  // when it fits the frame bound; otherwise fall back to the compact form.
  if (gatewayHandoffFrameBytes(runtime) <= GATEWAY_HANDOFF_MAX_FRAME_BYTES - 1024) return runtime as unknown as GatewayHandoffRuntimeSnapshot;
  return toDurableLiveRuntimeSnapshot(runtime) as unknown as GatewayHandoffRuntimeSnapshot;
}

/**
 * Enter drain mode: open the handoff socket, stop advertising this process as
 * the live gateway, and route ledger writes and broadcasts to the replacement.
 */
export async function beginGatewayHandoffHost(input: { reason: string; restartTimestamp?: number }): Promise<GatewayHandoffHost> {
  if (activeHost) return activeHost;
  const stateDir = getConfig().getConfigDir();
  const host = new GatewayHandoffHost({
    stateDir,
    reason: input.reason,
    restartTimestamp: input.restartTimestamp,
    listRunningRuntimes: () => listLocalRunningRuntimes().map(transportSnapshot),
    onControl: handleHostControl,
  });
  await host.start();
  activeHost = host;
  suspendRuntimeProgressLeaseWrites();
  setLiveRuntimePersistenceSink({
    upsert: (runtime, eventType, extra) => host.upsertRuntime(transportSnapshot(runtime), eventType, extra),
    delete: (runtimeId, eventType, runtime, extra) => host.deleteRuntime(runtimeId, eventType, runtime ? transportSnapshot(runtime) : undefined, extra),
  });
  setSessionWriteObserver((sessionId) => host.sessionFlushed(sessionId));
  enterGatewayDrainMode((data) => host.broadcast(data as Record<string, unknown>));
  return host;
}

export interface HandoffDrainWaitResult {
  timedOut: boolean;
  waitedMs: number;
}

/** Resolve once no locally owned runtime is still running (plus a settle grace), or at the deadline. */
export async function waitForGatewayHandoffDrain(options: {
  maxMs: number;
  pollMs?: number;
  settleMs?: number;
  onTick?: (running: number, waitedMs: number) => void;
}): Promise<HandoffDrainWaitResult> {
  const startedAt = Date.now();
  const pollMs = Math.max(250, Number(options.pollMs || 2_000));
  const settleMs = Math.max(0, Number(options.settleMs ?? 3_000));
  let idleSince = 0;
  for (;;) {
    const running = countLocalRunningRuntimes();
    const waitedMs = Date.now() - startedAt;
    try { options.onTick?.(running, waitedMs); } catch {}
    if (running === 0) {
      if (!idleSince) idleSince = Date.now();
      if (Date.now() - idleSince >= settleMs) return { timedOut: false, waitedMs };
    } else {
      idleSince = 0;
    }
    if (waitedMs >= options.maxMs) return { timedOut: true, waitedMs };
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(50, options.maxMs - waitedMs))).unref?.());
  }
}

/**
 * Test fixture: a model-free long-running runtime so the end-to-end handoff
 * script can restart a real supervised gateway with live work and watch it
 * carry over. Enabled only by PROMETHEUS_HANDOFF_SYNTHETIC_RUNTIME_MS.
 */
export function startHandoffSyntheticRuntimeFixture(): void {
  const durationMs = Number(process.env.PROMETHEUS_HANDOFF_SYNTHETIC_RUNTIME_MS || 0);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  const { registerLiveRuntime, updateLiveRuntimeCheckpoint, finishLiveRuntime } = require('../live-runtime-registry') as typeof import('../live-runtime-registry');
  const abortSignal = { aborted: false as boolean, reason: undefined as string | undefined };
  const startedAt = Date.now();
  const runtimeId = registerLiveRuntime({
    kind: 'background_task',
    label: 'Handoff synthetic runtime (test fixture)',
    sessionId: 'handoff_synthetic_fixture',
    taskId: 'handoff-synthetic-fixture',
    source: 'handoff_fixture',
    recoveryPolicy: 'resume',
    abortSignal,
  });
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const elapsed = Date.now() - startedAt;
    if (abortSignal.aborted || elapsed >= durationMs) {
      clearInterval(timer);
      finishLiveRuntime(runtimeId);
      broadcastWS({ type: 'handoff_synthetic_done', runtimeId, pid: process.pid, tick, aborted: abortSignal.aborted });
      console.log(`[gateway-handoff] synthetic runtime ${runtimeId} finished after ${tick} tick(s)${abortSignal.aborted ? ' (aborted)' : ''}`);
      return;
    }
    updateLiveRuntimeCheckpoint(runtimeId, { event: 'working', message: `synthetic tick ${tick}`, tick });
    broadcastWS({ type: 'handoff_synthetic_tick', runtimeId, pid: process.pid, tick });
  }, 1_000);
  console.log(`[gateway-handoff] synthetic runtime ${runtimeId} registered for ${durationMs}ms`);
}

export async function completeGatewayHandoffHost(interruptedRuntimeIds: string[] = []): Promise<void> {
  const host = activeHost;
  if (!host) return;
  activeHost = null;
  setSessionWriteObserver(null);
  await host.complete(interruptedRuntimeIds);
  // Keep the ledger frozen: anything this process still writes after the
  // handoff is over would only clobber the replacement's copy.
  setLiveRuntimePersistenceSink({ upsert: () => undefined, delete: () => undefined });
}
