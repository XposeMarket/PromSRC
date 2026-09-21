/**
 * Replacement-gateway side of the warm handoff.
 *
 * At boot the replacement reads the host manifests left by draining gateways,
 * connects to each live one, mirrors their still-running runtimes, relays their
 * WebSocket broadcasts to its own clients, and forwards abort/steer/pause
 * requests back to the process that actually owns the turn.
 *
 * All registry/session effects go through an adapter so this module can be
 * exercised against an in-memory registry.
 */
import net from 'node:net';
import crypto from 'node:crypto';
import {
  GATEWAY_HANDOFF_PROTOCOL_VERSION,
  createGatewayHandoffFrameParser,
  encodeGatewayHandoffFrame,
  isGatewayHandoffPidAlive,
  readGatewayHandoffManifests,
  removeGatewayHandoffManifest,
  type GatewayHandoffControlOp,
  type GatewayHandoffHostMessage,
  type GatewayHandoffManifest,
  type GatewayHandoffRuntimeSnapshot,
} from './gateway-handoff-protocol';
import type { GatewayHandoffControlResult } from './gateway-handoff-host';

export interface GatewayHandoffClientAdapter {
  /** Authoritative running set for the host; stale mirrored/ledger entries for it must go. */
  syncHostRuntimes(hostPid: number, runtimes: GatewayHandoffRuntimeSnapshot[]): void;
  upsertHostRuntime(hostPid: number, runtime: GatewayHandoffRuntimeSnapshot, eventType: string, extra?: Record<string, unknown>): void;
  deleteHostRuntime(hostPid: number, runtimeId: string, eventType: string, runtime?: GatewayHandoffRuntimeSnapshot, extra?: Record<string, unknown>): void;
  broadcast(data: Record<string, unknown>): void;
  sessionFlushed(sessionId: string): void;
  /** The host finished its drain; any runtimes it interrupted now follow crash recovery. */
  hostDrained(hostPid: number, interruptedRuntimeIds: string[]): void;
  /** The host died before finishing; its mirrored runtimes must be recovered as a crash. */
  hostLost(hostPid: number, reason: string): void;
  log?(message: string): void;
}

export interface GatewayHandoffClientOptions {
  manifest: GatewayHandoffManifest;
  adapter: GatewayHandoffClientAdapter;
  clientPid?: number;
  connectTimeoutMs?: number;
  connectRetryMs?: number;
  /** How long to keep retrying while the host pid is still alive. */
  reconnectWindowMs?: number;
  controlTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  isPidAlive?: (pid: number) => boolean;
  stateDir?: string;
}

type PendingControl = {
  resolve: (value: GatewayHandoffControlResult) => void;
  timer: NodeJS.Timeout;
};

export type GatewayHandoffClientState = 'connecting' | 'connected' | 'reconnecting' | 'drained' | 'lost' | 'closed';

export class GatewayHandoffClient {
  readonly hostPid: number;
  private socket: net.Socket | null = null;
  private state: GatewayHandoffClientState = 'connecting';
  private readonly pending = new Map<string, PendingControl>();
  private heartbeat: NodeJS.Timeout | null = null;
  private helloReceived = false;
  private lastHeartbeatAt = 0;
  private drainedRuntimeIds: string[] = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectStartedAt = 0;
  private readonly stateWaiters = new Set<() => void>();

  constructor(private readonly options: GatewayHandoffClientOptions) {
    this.hostPid = options.manifest.hostPid;
  }

  private log(message: string): void {
    try { (this.options.adapter.log || ((line: string) => console.log(line)))(`[gateway-handoff/client] host=${this.hostPid} ${message}`); } catch {}
  }

  get currentState(): GatewayHandoffClientState {
    return this.state;
  }

  get connected(): boolean {
    return this.state === 'connected' && !!this.socket && !this.socket.destroyed;
  }

  get lastHeartbeat(): number {
    return this.lastHeartbeatAt;
  }

  private setState(next: GatewayHandoffClientState): void {
    if (this.state === next) return;
    this.state = next;
    for (const waiter of this.stateWaiters) waiter();
  }

  /** Resolves once the host has sent its hello, or false on timeout/failure. */
  async connect(): Promise<boolean> {
    const timeoutMs = Math.max(250, Number(this.options.connectTimeoutMs || 5_000));
    const retryMs = Math.max(50, Number(this.options.connectRetryMs || 250));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.state !== 'closed') {
      const ok = await this.attemptConnect();
      if (ok) return true;
      if (!this.pidAlive()) {
        this.markLost('host_pid_exited_before_connect');
        return false;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, retryMs).unref?.());
    }
    if (this.state !== 'closed' && this.state !== 'lost') {
      this.log('could not connect before timeout');
    }
    return this.helloReceived;
  }

  private pidAlive(): boolean {
    return (this.options.isPidAlive || isGatewayHandoffPidAlive)(this.hostPid);
  }

  private attemptConnect(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const socket = net.createConnection(this.options.manifest.socketPath);
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const helloTimer = setTimeout(() => {
        if (!this.helloReceived) {
          try { socket.destroy(); } catch {}
          settle(false);
        }
      }, Math.max(250, Number(this.options.connectTimeoutMs || 5_000)));
      helloTimer.unref?.();
      const parser = createGatewayHandoffFrameParser(
        (message) => {
          this.handleHostMessage(message as GatewayHandoffHostMessage, socket);
          if (this.helloReceived) {
            clearTimeout(helloTimer);
            settle(true);
          }
        },
        (error) => this.log(`frame error: ${error.message}`),
      );
      socket.setNoDelay?.(true);
      socket.once('connect', () => {
        this.socket = socket;
        this.helloReceived = false;
        this.writeFrame({ protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION, type: 'hello_ack', clientPid: this.options.clientPid || process.pid });
        this.startHeartbeat();
      });
      socket.on('data', (chunk) => parser.push(chunk));
      socket.once('error', (error) => {
        if (!settled) {
          clearTimeout(helloTimer);
          settle(false);
          return;
        }
        this.log(`socket error: ${(error as any)?.code || error?.message || error}`);
      });
      socket.once('close', () => {
        clearTimeout(helloTimer);
        if (this.socket === socket) {
          this.socket = null;
          this.stopHeartbeat();
          this.handleDisconnect();
        }
        settle(false);
      });
    });
  }

  private handleDisconnect(): void {
    this.rejectPending('Handoff host disconnected.');
    if (this.state === 'closed' || this.state === 'drained' || this.state === 'lost') return;
    if (!this.pidAlive()) {
      this.markLost('host_pid_exited');
      return;
    }
    // The host is alive but its socket dropped (or it exited before flushing
    // drain_complete). Keep trying while the pid lives, then treat it as lost.
    this.setState('reconnecting');
    if (!this.reconnectStartedAt) this.reconnectStartedAt = Date.now();
    const windowMs = Math.max(1_000, Number(this.options.reconnectWindowMs || 30_000));
    const retry = async () => {
      this.reconnectTimer = null;
      if (this.state !== 'reconnecting') return;
      if (!this.pidAlive()) {
        this.markLost('host_pid_exited_while_reconnecting');
        return;
      }
      if (Date.now() - this.reconnectStartedAt > windowMs) {
        this.markLost('host_unreachable');
        return;
      }
      const ok = await this.attemptConnect();
      if (ok) {
        this.reconnectStartedAt = 0;
        return;
      }
      if (this.state === 'reconnecting') {
        this.reconnectTimer = setTimeout(retry, Math.max(250, Number(this.options.connectRetryMs || 1_000)));
        this.reconnectTimer.unref?.();
      }
    };
    this.reconnectTimer = setTimeout(retry, Math.max(100, Number(this.options.connectRetryMs || 1_000)));
    this.reconnectTimer.unref?.();
  }

  private markLost(reason: string): void {
    if (this.state === 'closed' || this.state === 'drained' || this.state === 'lost') return;
    this.log(`host lost (${reason})`);
    this.setState('lost');
    this.cleanupManifest();
    try { this.options.adapter.hostLost(this.hostPid, reason); } catch (error: any) {
      this.log(`hostLost handler failed: ${error?.message || error}`);
    }
  }

  private cleanupManifest(): void {
    if (this.options.stateDir) removeGatewayHandoffManifest(this.options.stateDir, this.hostPid);
  }

  private handleHostMessage(message: GatewayHandoffHostMessage, socket: net.Socket): void {
    if (socket !== this.socket && message.type !== 'hello') return;
    const adapter = this.options.adapter;
    switch (message.type) {
      case 'hello': {
        if (this.socket !== socket) this.socket = socket;
        this.helloReceived = true;
        this.setState('connected');
        try { adapter.syncHostRuntimes(this.hostPid, Array.isArray(message.runtimes) ? message.runtimes : []); } catch (error: any) {
          this.log(`sync failed: ${error?.message || error}`);
        }
        return;
      }
      case 'runtime_upsert':
        try { adapter.upsertHostRuntime(this.hostPid, message.runtime, message.eventType, message.extra); } catch (error: any) {
          this.log(`upsert failed: ${error?.message || error}`);
        }
        return;
      case 'runtime_delete':
        try { adapter.deleteHostRuntime(this.hostPid, message.runtimeId, message.eventType, message.runtime, message.extra); } catch (error: any) {
          this.log(`delete failed: ${error?.message || error}`);
        }
        return;
      case 'broadcast':
        try { adapter.broadcast(message.data); } catch {}
        return;
      case 'session_flushed':
        try { adapter.sessionFlushed(String(message.sessionId || '')); } catch {}
        return;
      case 'control_result': {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.requestId);
        pending.resolve({ ok: message.ok, error: message.error, result: message.result });
        return;
      }
      case 'heartbeat':
        this.lastHeartbeatAt = Number(message.at) || Date.now();
        return;
      case 'drain_complete': {
        this.drainedRuntimeIds = Array.isArray(message.interruptedRuntimeIds) ? message.interruptedRuntimeIds.map(String) : [];
        this.setState('drained');
        this.cleanupManifest();
        try { adapter.hostDrained(this.hostPid, this.drainedRuntimeIds); } catch (error: any) {
          this.log(`hostDrained handler failed: ${error?.message || error}`);
        }
        this.close();
        return;
      }
      default:
        return;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const intervalMs = Math.max(1_000, Number(this.options.heartbeatIntervalMs || 5_000));
    this.heartbeat = setInterval(() => {
      this.writeFrame({ protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION, type: 'heartbeat', at: Date.now() });
    }, intervalMs);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private writeFrame(message: Parameters<typeof encodeGatewayHandoffFrame>[0]): boolean {
    if (!this.socket || this.socket.destroyed) return false;
    const frame = encodeGatewayHandoffFrame(message);
    if (frame === null) return false;
    try {
      this.socket.write(frame);
      return true;
    } catch {
      return false;
    }
  }

  control(op: GatewayHandoffControlOp, args: Record<string, unknown>): Promise<GatewayHandoffControlResult> {
    if (!this.connected) {
      return Promise.resolve({ ok: false, error: `Handoff host ${this.hostPid} is not connected (${this.state}).` });
    }
    const requestId = crypto.randomUUID();
    return new Promise<GatewayHandoffControlResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: `Handoff control ${op} timed out.` });
      }, Math.max(1_000, Number(this.options.controlTimeoutMs || 15_000)));
      timer.unref?.();
      this.pending.set(requestId, { resolve, timer });
      if (!this.writeFrame({ protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION, type: 'control', requestId, op, args })) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ ok: false, error: 'Handoff control frame could not be sent.' });
      }
    });
  }

  private rejectPending(reason: string): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: reason });
      this.pending.delete(id);
    }
  }

  waitForState(predicate: (state: GatewayHandoffClientState) => boolean, timeoutMs: number): Promise<boolean> {
    if (predicate(this.state)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.stateWaiters.delete(waiter);
        resolve(false);
      }, Math.max(0, timeoutMs));
      timer.unref?.();
      const waiter = () => {
        if (!predicate(this.state)) return;
        clearTimeout(timer);
        this.stateWaiters.delete(waiter);
        resolve(true);
      };
      this.stateWaiters.add(waiter);
    });
  }

  close(): void {
    if (this.state === 'closed') return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.rejectPending('Handoff client closed.');
    const finalState: GatewayHandoffClientState = this.state === 'drained' || this.state === 'lost' ? this.state : 'closed';
    const socket = this.socket;
    this.socket = null;
    try { socket?.end(); } catch {}
    try { socket?.destroy(); } catch {}
    this.setState(finalState);
    for (const waiter of this.stateWaiters) waiter();
    this.stateWaiters.clear();
  }
}

export interface GatewayHandoffAdoptionOptions {
  stateDir: string;
  adapter: GatewayHandoffClientAdapter;
  connectTimeoutMs?: number;
  isPidAlive?: (pid: number) => boolean;
}

export interface GatewayHandoffAdoptionResult {
  hosts: GatewayHandoffClient[];
  staleManifests: number;
  unreachable: number;
}

/**
 * Connect to every live draining host. Manifests for dead pids are removed and
 * their ledger entries fall through to the normal crash-recovery path.
 */
export async function adoptGatewayHandoffHosts(options: GatewayHandoffAdoptionOptions): Promise<GatewayHandoffAdoptionResult> {
  const manifests = readGatewayHandoffManifests(options.stateDir);
  const hosts: GatewayHandoffClient[] = [];
  let staleManifests = 0;
  let unreachable = 0;
  const isPidAlive = options.isPidAlive || isGatewayHandoffPidAlive;
  for (const manifest of manifests) {
    if (manifest.hostPid === process.pid) continue;
    if (!isPidAlive(manifest.hostPid)) {
      removeGatewayHandoffManifest(options.stateDir, manifest.hostPid);
      staleManifests += 1;
      continue;
    }
    const client = new GatewayHandoffClient({
      manifest,
      adapter: options.adapter,
      connectTimeoutMs: options.connectTimeoutMs,
      isPidAlive,
      stateDir: options.stateDir,
    });
    const ok = await client.connect();
    if (!ok) {
      unreachable += 1;
      if (client.currentState !== 'lost') client.close();
      continue;
    }
    hosts.push(client);
  }
  return { hosts, staleManifests, unreachable };
}
