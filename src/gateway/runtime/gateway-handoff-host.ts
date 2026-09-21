/**
 * Draining-gateway side of the warm handoff.
 *
 * The host owns the local socket, the on-disk manifest the replacement uses to
 * find it, and a bounded outbound queue for the window before the replacement
 * connects. It knows nothing about the registry: lifecycle.ts injects the
 * snapshot provider and control handlers so this module stays testable.
 */
import fs from 'node:fs';
import net from 'node:net';
import {
  GATEWAY_HANDOFF_MANIFEST_VERSION,
  GATEWAY_HANDOFF_PROTOCOL_VERSION,
  createGatewayHandoffFrameParser,
  encodeGatewayHandoffFrame,
  removeGatewayHandoffManifest,
  resolveGatewayHandoffSocketPath,
  writeGatewayHandoffManifest,
  type GatewayHandoffClientMessage,
  type GatewayHandoffControlOp,
  type GatewayHandoffHostMessage,
  type GatewayHandoffManifest,
  type GatewayHandoffRuntimeSnapshot,
} from './gateway-handoff-protocol';

export interface GatewayHandoffControlResult {
  ok: boolean;
  error?: string;
  result?: Record<string, unknown>;
}

export interface GatewayHandoffHostOptions {
  stateDir: string;
  reason: string;
  restartTimestamp?: number;
  hostPid?: number;
  processStartedAt?: number;
  socketPath?: string;
  /** Runtimes still running locally; sent on every connect as the authoritative set. */
  listRunningRuntimes: () => GatewayHandoffRuntimeSnapshot[];
  onControl: (op: GatewayHandoffControlOp, args: Record<string, unknown>) => Promise<GatewayHandoffControlResult> | GatewayHandoffControlResult;
  heartbeatIntervalMs?: number;
  /** Broadcast frames retained while no replacement is connected. */
  maxQueuedBroadcasts?: number;
  log?: (message: string) => void;
}

export interface GatewayHandoffHostStatus {
  socketPath: string;
  manifestPath: string;
  connected: boolean;
  clientPid?: number;
  queuedBroadcasts: number;
  droppedBroadcasts: number;
  sentFrames: number;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
}

export class GatewayHandoffHost {
  private server: net.Server | null = null;
  private client: net.Socket | null = null;
  private clientPid: number | undefined;
  private readonly queuedBroadcasts: GatewayHandoffHostMessage[] = [];
  private droppedBroadcasts = 0;
  private sentFrames = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastConnectedAt: number | undefined;
  private lastDisconnectedAt: number | undefined;
  private stopped = false;
  private readonly hostPid: number;
  private readonly processStartedAt: number;
  readonly socketPath: string;
  readonly manifestPath: string;
  private readonly connectWaiters = new Set<() => void>();

  constructor(private readonly options: GatewayHandoffHostOptions) {
    this.hostPid = options.hostPid || process.pid;
    this.processStartedAt = options.processStartedAt || Date.now() - Math.floor(process.uptime() * 1000);
    this.socketPath = options.socketPath || resolveGatewayHandoffSocketPath(options.stateDir, this.hostPid);
    this.manifestPath = writeGatewayHandoffManifest(options.stateDir, this.buildManifest());
  }

  private log(message: string): void {
    try { (this.options.log || ((line: string) => console.log(line)))(`[gateway-handoff/host] ${message}`); } catch {}
  }

  private buildManifest(): GatewayHandoffManifest {
    return {
      version: GATEWAY_HANDOFF_MANIFEST_VERSION,
      hostPid: this.hostPid,
      processStartedAt: this.processStartedAt,
      socketPath: this.socketPath,
      startedAt: Date.now(),
      reason: this.options.reason,
      restartTimestamp: this.options.restartTimestamp,
      runtimeIds: this.options.listRunningRuntimes().map((runtime) => runtime.id),
    };
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (process.platform !== 'win32') {
      try { fs.rmSync(this.socketPath, { force: true }); } catch {}
    }
    const server = net.createServer((socket) => this.acceptClient(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (error) => this.log(`socket server error: ${error?.message || error}`));
    const intervalMs = Math.max(1_000, Number(this.options.heartbeatIntervalMs || 5_000));
    this.heartbeat = setInterval(() => {
      this.send({
        protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION,
        type: 'heartbeat',
        at: Date.now(),
        runningCount: this.options.listRunningRuntimes().length,
      }, { queue: false });
    }, intervalMs);
    this.heartbeat.unref?.();
    this.log(`listening on ${this.socketPath}`);
  }

  private acceptClient(socket: net.Socket): void {
    if (this.stopped) {
      socket.destroy();
      return;
    }
    if (this.client && this.client !== socket) {
      // A newer replacement supersedes an older connection (cascading restarts).
      try { this.client.destroy(); } catch {}
    }
    this.client = socket;
    this.clientPid = undefined;
    this.lastConnectedAt = Date.now();
    socket.setNoDelay?.(true);
    const parser = createGatewayHandoffFrameParser(
      (message) => this.handleClientMessage(message as GatewayHandoffClientMessage),
      (error) => this.log(`client frame error: ${error.message}`),
    );
    socket.on('data', (chunk) => parser.push(chunk));
    socket.on('error', (error) => this.log(`client socket error: ${(error as any)?.code || error?.message || error}`));
    socket.on('close', () => {
      if (this.client === socket) {
        this.client = null;
        this.clientPid = undefined;
        this.lastDisconnectedAt = Date.now();
        this.log('replacement gateway disconnected');
      }
    });
    this.writeFrame(socket, {
      protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION,
      type: 'hello',
      hostPid: this.hostPid,
      processStartedAt: this.processStartedAt,
      runtimes: this.options.listRunningRuntimes(),
    });
    while (this.queuedBroadcasts.length) {
      const queued = this.queuedBroadcasts.shift()!;
      this.writeFrame(socket, queued);
    }
    for (const waiter of this.connectWaiters) waiter();
    this.connectWaiters.clear();
    this.log('replacement gateway connected');
  }

  private handleClientMessage(message: GatewayHandoffClientMessage): void {
    if (message.type === 'hello_ack') {
      this.clientPid = Number(message.clientPid) || undefined;
      return;
    }
    if (message.type === 'control') {
      void this.runControl(message.requestId, message.op, message.args || {});
    }
  }

  private async runControl(requestId: string, op: GatewayHandoffControlOp, args: Record<string, unknown>): Promise<void> {
    let outcome: GatewayHandoffControlResult;
    try {
      outcome = await this.options.onControl(op, args);
    } catch (error: any) {
      outcome = { ok: false, error: String(error?.message || error || 'Handoff control failed.').slice(0, 1_000) };
    }
    this.send({
      protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION,
      type: 'control_result',
      requestId,
      ok: outcome.ok,
      error: outcome.error,
      result: outcome.result,
    }, { queue: false });
  }

  private writeFrame(socket: net.Socket, message: GatewayHandoffHostMessage): boolean {
    const frame = encodeGatewayHandoffFrame(message);
    if (frame === null) {
      this.log(`dropped oversized ${message.type} frame`);
      return false;
    }
    try {
      socket.write(frame);
      this.sentFrames += 1;
      return true;
    } catch (error: any) {
      this.log(`write failed: ${error?.message || error}`);
      return false;
    }
  }

  private send(message: GatewayHandoffHostMessage, options: { queue: boolean }): void {
    if (this.stopped) return;
    if (this.client && !this.client.destroyed) {
      this.writeFrame(this.client, message);
      return;
    }
    if (!options.queue) return;
    const limit = Math.max(16, Number(this.options.maxQueuedBroadcasts || 2_000));
    if (this.queuedBroadcasts.length >= limit) {
      this.queuedBroadcasts.shift();
      this.droppedBroadcasts += 1;
    }
    this.queuedBroadcasts.push(message);
  }

  /** Runtime state changes are never queued: `hello` re-sends the authoritative set on connect. */
  upsertRuntime(runtime: GatewayHandoffRuntimeSnapshot, eventType: string, extra?: Record<string, unknown>): void {
    this.send({ protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION, type: 'runtime_upsert', runtime, eventType, extra }, { queue: false });
  }

  deleteRuntime(runtimeId: string, eventType: string, runtime?: GatewayHandoffRuntimeSnapshot, extra?: Record<string, unknown>): void {
    this.send({ protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION, type: 'runtime_delete', runtimeId, eventType, runtime, extra }, { queue: false });
  }

  broadcast(data: Record<string, unknown>): void {
    this.send({ protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION, type: 'broadcast', data }, { queue: true });
  }

  sessionFlushed(sessionId: string): void {
    this.send({ protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION, type: 'session_flushed', sessionId }, { queue: true });
  }

  waitForClient(timeoutMs: number): Promise<boolean> {
    if (this.client && !this.client.destroyed) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.connectWaiters.delete(waiter);
        resolve(false);
      }, Math.max(0, timeoutMs));
      timer.unref?.();
      const waiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.connectWaiters.add(waiter);
    });
  }

  get connected(): boolean {
    return !!this.client && !this.client.destroyed;
  }

  status(): GatewayHandoffHostStatus {
    return {
      socketPath: this.socketPath,
      manifestPath: this.manifestPath,
      connected: this.connected,
      clientPid: this.clientPid,
      queuedBroadcasts: this.queuedBroadcasts.length,
      droppedBroadcasts: this.droppedBroadcasts,
      sentFrames: this.sentFrames,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
    };
  }

  /**
   * Announce the end of the drain, give the socket a moment to flush, then
   * release the manifest so no later gateway tries to adopt a dead host.
   */
  async complete(interruptedRuntimeIds: string[] = [], flushMs = 750): Promise<void> {
    this.send({
      protocolVersion: GATEWAY_HANDOFF_PROTOCOL_VERSION,
      type: 'drain_complete',
      at: Date.now(),
      interruptedRuntimeIds,
    }, { queue: false });
    if (this.client && !this.client.destroyed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, flushMs));
        timer.unref?.();
      });
    }
    this.stop();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    removeGatewayHandoffManifest(this.options.stateDir, this.hostPid);
    try { this.client?.end(); } catch {}
    try { this.client?.destroy(); } catch {}
    this.client = null;
    try { this.server?.close(); } catch {}
    this.server = null;
    if (process.platform !== 'win32') {
      try { fs.rmSync(this.socketPath, { force: true }); } catch {}
    }
    for (const waiter of this.connectWaiters) waiter();
    this.connectWaiters.clear();
  }
}
