import crypto from 'crypto';
import {
  DEFAULT_TURN_WORKER_MAX_MESSAGE_BYTES,
  DEFAULT_TURN_WORKER_MAX_PAYLOAD_BYTES,
  TURN_WORKER_PROTOCOL_VERSION,
  TurnWorkerProtocolError,
  assertTurnWorkerMessageBounded,
  boundedTurnWorkerText,
  isTurnWorkerParentMessage,
  type TurnWorkerBounds,
  type TurnWorkerChildMessage,
  type TurnWorkerErrorCode,
  type TurnWorkerParentMessage,
  type TurnWorkerRpcResultMessage,
  type TurnWorkerStartMessage,
  type TurnWorkerSteerMessage,
} from './protocol.js';

export interface TurnWorkerSteer {
  steerId: string;
  payload: unknown;
}

export interface TurnWorkerGatewayRpcOptions {
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface TurnWorkerRunContext<TInput = unknown> {
  readonly jobId: string;
  readonly attempt: number;
  readonly leaseToken?: string;
  readonly input: TInput;
  readonly resumeCheckpoint?: unknown;
  readonly signal: AbortSignal;
  emitEvent(event: unknown): Promise<void>;
  checkpoint(checkpoint: unknown): Promise<void>;
  callGateway<TResult = unknown>(method: string, params: unknown, options?: TurnWorkerGatewayRpcOptions): Promise<TResult>;
  nextSteer(): Promise<TurnWorkerSteer>;
}

export type TurnWorkerRunHandler<TInput = unknown, TResult = unknown> = (
  context: TurnWorkerRunContext<TInput>,
) => Promise<TResult>;

export interface TurnWorkerChildRuntimeOptions<TInput = unknown, TResult = unknown> extends TurnWorkerBounds {
  workerId?: string;
  heartbeatIntervalMs?: number;
  shutdownGraceMs?: number;
  run: TurnWorkerRunHandler<TInput, TResult>;
}

interface RpcWaiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

interface SteerWaiter {
  resolve: (value: TurnWorkerSteer) => void;
  reject: (error: Error) => void;
}

interface ActiveTurn {
  start: TurnWorkerStartMessage;
  abortController: AbortController;
  sequence: number;
  rpcWaiters: Map<string, RpcWaiter>;
  steerQueue: TurnWorkerSteer[];
  steerWaiters: SteerWaiter[];
}

function abortError(signal: AbortSignal, fallback = 'Turn cancelled.'): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new TurnWorkerProtocolError(
    boundedTurnWorkerText(reason || fallback),
    'TURN_CANCELLED',
  );
}

/**
 * Child-side implementation of the turn transport. The supplied run handler is
 * the only Prometheus-specific part; the runtime owns IPC, heartbeat, RPC
 * correlation, steering, cancellation, sequencing, and graceful shutdown.
 */
export class TurnWorkerChildRuntime<TInput = unknown, TResult = unknown> {
  private readonly workerId: string;
  private readonly heartbeatIntervalMs: number;
  private readonly shutdownGraceMs: number;
  private readonly bounds: Required<Pick<TurnWorkerBounds, 'maxMessageBytes' | 'maxPayloadBytes'>>;
  private readonly runHandler: TurnWorkerRunHandler<TInput, TResult>;
  private active: ActiveTurn | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private started = false;
  private messageChain = Promise.resolve();

  constructor(options: TurnWorkerChildRuntimeOptions<TInput, TResult>) {
    this.workerId = String(options.workerId || process.env.PROMETHEUS_TURN_WORKER_ID || `turn-worker-${process.pid}`);
    this.heartbeatIntervalMs = Math.max(100, Number(options.heartbeatIntervalMs || 5_000));
    this.shutdownGraceMs = Math.max(100, Number(options.shutdownGraceMs || 5_000));
    this.bounds = {
      maxMessageBytes: Math.max(1_024, Number(options.maxMessageBytes || DEFAULT_TURN_WORKER_MAX_MESSAGE_BYTES)),
      maxPayloadBytes: Math.max(512, Number(options.maxPayloadBytes || DEFAULT_TURN_WORKER_MAX_PAYLOAD_BYTES)),
    };
    this.runHandler = options.run;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    process.on('message', this.onRawMessage);
    process.once('disconnect', this.onDisconnect);
    process.once('SIGTERM', this.onSigterm);
    this.heartbeatTimer = setInterval(() => {
      const active = this.active;
      void this.send({
        protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
        type: 'heartbeat',
        workerId: this.workerId,
        pid: process.pid,
        at: Date.now(),
        jobId: active?.start.jobId,
        attempt: active?.start.attempt,
      }).catch(() => this.exitNow(1));
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
    void this.send({
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'ready',
      workerId: this.workerId,
      pid: process.pid,
      capabilities: { rpc: true, steering: true, checkpoints: true },
    }).catch(() => this.exitNow(1));
  }

  private readonly onRawMessage = (raw: unknown): void => {
    this.messageChain = this.messageChain
      .then(() => this.handleMessage(raw))
      .catch((error) => this.handleUnhandled(error));
  };

  private readonly onDisconnect = (): void => {
    this.rejectActive(new TurnWorkerProtocolError('Gateway IPC disconnected.', 'TURN_WORKER_DISCONNECTED'));
    this.exitNow(0);
  };

  private readonly onSigterm = (): void => {
    void this.beginShutdown('sigterm', 250);
  };

  private async send(message: TurnWorkerChildMessage): Promise<void> {
    assertTurnWorkerMessageBounded(message, { ...this.bounds, label: `Turn worker ${message.type}` });
    if (!process.send || !process.connected) {
      throw new TurnWorkerProtocolError('Gateway IPC is disconnected.', 'TURN_WORKER_DISCONNECTED');
    }
    await new Promise<void>((resolve, reject) => {
      process.send!(message, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private nextSequence(active: ActiveTurn): number {
    active.sequence += 1;
    return active.sequence;
  }

  private boundedError(error: unknown): string {
    return boundedTurnWorkerText(
      error,
      Math.max(100, Math.min(4_000, Math.floor(this.bounds.maxMessageBytes / 4))),
    );
  }

  private assertActive(message: { jobId: string; attempt: number }): ActiveTurn | null {
    const active = this.active;
    if (!active) return null;
    if (active.start.jobId !== message.jobId || active.start.attempt !== message.attempt) return null;
    return active;
  }

  private async handleMessage(raw: unknown): Promise<void> {
    try {
      assertTurnWorkerMessageBounded(raw, { ...this.bounds, label: 'Gateway turn-worker message' });
    } catch (error) {
      await this.sendGeneralError('TURN_WORKER_PROTOCOL_ERROR', error);
      return;
    }
    if (!isTurnWorkerParentMessage(raw)) {
      await this.sendGeneralError('TURN_WORKER_PROTOCOL_ERROR', 'Gateway sent an invalid turn-worker message.');
      return;
    }
    const message = raw as TurnWorkerParentMessage;
    switch (message.type) {
      case 'start':
        await this.startTurn(message);
        return;
      case 'cancel':
        this.cancelTurn(message.jobId, message.attempt, message.reason);
        return;
      case 'steer':
        await this.acceptSteer(message);
        return;
      case 'rpc_result':
        this.resolveRpc(message);
        return;
      case 'shutdown':
        await this.beginShutdown(message.reason || 'gateway_shutdown', message.graceMs);
        return;
    }
  }

  private async startTurn(message: TurnWorkerStartMessage): Promise<void> {
    if (this.shuttingDown) {
      await this.sendJobError(message, 'TURN_WORKER_SHUTDOWN', 'Turn worker is shutting down.', 1);
      return;
    }
    if (this.active) {
      await this.sendJobError(message, 'TURN_WORKER_BUSY', 'Turn worker is already executing a turn.', 1);
      return;
    }
    const active: ActiveTurn = {
      start: message,
      abortController: new AbortController(),
      sequence: 0,
      rpcWaiters: new Map(),
      steerQueue: [],
      steerWaiters: [],
    };
    this.active = active;
    await this.send({
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'started',
      workerId: this.workerId,
      pid: process.pid,
      jobId: message.jobId,
      attempt: message.attempt,
      startedAt: Date.now(),
    });

    const context: TurnWorkerRunContext<TInput> = {
      jobId: message.jobId,
      attempt: message.attempt,
      leaseToken: message.leaseToken,
      input: message.input as TInput,
      resumeCheckpoint: message.resumeCheckpoint,
      signal: active.abortController.signal,
      emitEvent: async (event) => {
        if (active.abortController.signal.aborted) throw abortError(active.abortController.signal);
        await this.send({
          protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
          type: 'event',
          jobId: message.jobId,
          attempt: message.attempt,
          sequence: this.nextSequence(active),
          event,
          emittedAt: Date.now(),
        });
      },
      checkpoint: async (checkpoint) => {
        if (active.abortController.signal.aborted) throw abortError(active.abortController.signal);
        await this.send({
          protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
          type: 'checkpoint',
          jobId: message.jobId,
          attempt: message.attempt,
          sequence: this.nextSequence(active),
          checkpoint,
          emittedAt: Date.now(),
        });
      },
      callGateway: (method, params, options) => this.callGateway(active, method, params, options),
      nextSteer: () => this.nextSteer(active),
    };

    void Promise.resolve()
      .then(() => this.runHandler(context))
      .then((result) => this.finishTurn(active, result))
      .catch((error) => this.failTurn(active, error));
  }

  private async callGateway<T = unknown>(
    active: ActiveTurn,
    method: string,
    params: unknown,
    options: TurnWorkerGatewayRpcOptions = {},
  ): Promise<T> {
    if (active !== this.active || active.abortController.signal.aborted) {
      throw abortError(active.abortController.signal);
    }
    const normalizedMethod = String(method || '').trim();
    if (!normalizedMethod) throw new TurnWorkerProtocolError('Gateway RPC method is required.');
    const rpcId = `rpc_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
    const result = new Promise<unknown>((resolve, reject) => {
      const waiter: RpcWaiter = { resolve, reject };
      const timeoutMs = Number(options.timeoutMs || 0);
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          active.rpcWaiters.delete(rpcId);
          reject(new TurnWorkerProtocolError(`Gateway RPC ${normalizedMethod} timed out after ${timeoutMs}ms.`, 'TURN_WORKER_UNAVAILABLE'));
        }, Math.max(100, timeoutMs));
        waiter.timer.unref?.();
      }
      active.rpcWaiters.set(rpcId, waiter);
    });
    try {
      await this.send({
        protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
        type: 'rpc_request',
        jobId: active.start.jobId,
        attempt: active.start.attempt,
        rpcId,
        method: normalizedMethod,
        params,
        idempotencyKey: options.idempotencyKey,
        requestedAt: Date.now(),
      });
    } catch (error) {
      const waiter = active.rpcWaiters.get(rpcId);
      if (waiter?.timer) clearTimeout(waiter.timer);
      active.rpcWaiters.delete(rpcId);
      waiter?.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return result as Promise<T>;
  }

  private resolveRpc(message: TurnWorkerRpcResultMessage): void {
    const active = this.assertActive(message);
    if (!active) return;
    const waiter = active.rpcWaiters.get(message.rpcId);
    if (!waiter) return;
    if (waiter.timer) clearTimeout(waiter.timer);
    active.rpcWaiters.delete(message.rpcId);
    if (message.ok) waiter.resolve(message.result);
    else waiter.reject(new TurnWorkerProtocolError(
      boundedTurnWorkerText(message.error?.message || 'Gateway RPC failed.'),
      'TURN_WORKER_UNAVAILABLE',
    ));
  }

  private async acceptSteer(message: TurnWorkerSteerMessage): Promise<void> {
    const active = this.assertActive(message);
    const accepted = Boolean(active && !active.abortController.signal.aborted);
    if (active && accepted) {
      const steer: TurnWorkerSteer = { steerId: message.steerId, payload: message.payload };
      const waiter = active.steerWaiters.shift();
      if (waiter) waiter.resolve(steer);
      else active.steerQueue.push(steer);
    }
    await this.send({
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'steer_ack',
      jobId: message.jobId,
      attempt: message.attempt,
      steerId: message.steerId,
      accepted,
      reason: accepted ? undefined : 'turn_not_active',
      acknowledgedAt: Date.now(),
    });
  }

  private nextSteer(active: ActiveTurn): Promise<TurnWorkerSteer> {
    if (active !== this.active || active.abortController.signal.aborted) {
      return Promise.reject(abortError(active.abortController.signal));
    }
    const queued = active.steerQueue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<TurnWorkerSteer>((resolve, reject) => {
      active.steerWaiters.push({ resolve, reject });
    });
  }

  private cancelTurn(jobId: string, attempt: number, reason?: string): void {
    const active = this.assertActive({ jobId, attempt });
    if (!active || active.abortController.signal.aborted) return;
    active.abortController.abort(new TurnWorkerProtocolError(
      boundedTurnWorkerText(reason || 'Turn cancelled by gateway.'),
      'TURN_CANCELLED',
    ));
    this.rejectWaiters(active, abortError(active.abortController.signal));
  }

  private rejectWaiters(active: ActiveTurn, error: Error): void {
    for (const waiter of active.rpcWaiters.values()) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    active.rpcWaiters.clear();
    for (const waiter of active.steerWaiters.splice(0)) waiter.reject(error);
    active.steerQueue.length = 0;
  }

  private async finishTurn(active: ActiveTurn, result: TResult): Promise<void> {
    if (active !== this.active) return;
    if (active.abortController.signal.aborted) {
      await this.failTurn(active, abortError(active.abortController.signal));
      return;
    }
    this.rejectWaiters(active, new TurnWorkerProtocolError('Turn completed.', 'TURN_WORKER_UNAVAILABLE'));
    await this.send({
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'final',
      jobId: active.start.jobId,
      attempt: active.start.attempt,
      sequence: this.nextSequence(active),
      result,
      completedAt: Date.now(),
    });
    if (this.active === active) this.active = null;
    if (this.shuttingDown) await this.completeShutdown();
  }

  private async failTurn(active: ActiveTurn, error: unknown): Promise<void> {
    if (active !== this.active) return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.rejectWaiters(active, normalized);
    const code = normalized instanceof TurnWorkerProtocolError
      ? normalized.code
      : active.abortController.signal.aborted
        ? 'TURN_CANCELLED'
        : 'TURN_WORKER_UNKNOWN_ERROR';
    try {
      await this.sendJobError(active.start, code, normalized, this.nextSequence(active));
    } finally {
      if (this.active === active) this.active = null;
      if (this.shuttingDown) await this.completeShutdown();
    }
  }

  private async sendJobError(
    job: Pick<TurnWorkerStartMessage, 'jobId' | 'attempt'>,
    code: TurnWorkerErrorCode,
    error: unknown,
    sequence: number,
  ): Promise<void> {
    await this.send({
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'error',
      jobId: job.jobId,
      attempt: job.attempt,
      sequence,
      code,
      message: this.boundedError(error),
      completedAt: Date.now(),
    });
  }

  private async sendGeneralError(code: TurnWorkerErrorCode, error: unknown): Promise<void> {
    await this.send({
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'error',
      code,
      message: this.boundedError(error),
      completedAt: Date.now(),
    });
  }

  private rejectActive(error: Error): void {
    const active = this.active;
    if (!active) return;
    if (!active.abortController.signal.aborted) active.abortController.abort(error);
    this.rejectWaiters(active, error);
    this.active = null;
  }

  private async beginShutdown(reason: string, graceMs?: number): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const active = this.active;
    if (!active) {
      await this.completeShutdown();
      return;
    }
    this.cancelTurn(active.start.jobId, active.start.attempt, reason || 'Turn worker shutdown.');
    this.shutdownTimer = setTimeout(() => this.exitNow(0), Math.max(100, Number(graceMs || this.shutdownGraceMs)));
    this.shutdownTimer.unref?.();
  }

  private async completeShutdown(): Promise<void> {
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
    this.shutdownTimer = null;
    try {
      await this.send({
        protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
        type: 'shutdown_ack',
        workerId: this.workerId,
        pid: process.pid,
        at: Date.now(),
      });
    } catch {}
    try { process.disconnect(); } catch {}
    setImmediate(() => this.exitNow(0));
  }

  private async handleUnhandled(error: unknown): Promise<void> {
    try {
      const active = this.active;
      if (active) await this.failTurn(active, error);
      else await this.sendGeneralError('TURN_WORKER_PROTOCOL_ERROR', error);
    } catch {
      this.exitNow(1);
    }
  }

  private exitNow(code: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
    process.exit(code);
  }
}

export function runTurnWorker<TInput = unknown, TResult = unknown>(
  options: TurnWorkerChildRuntimeOptions<TInput, TResult>,
): TurnWorkerChildRuntime<TInput, TResult> {
  const runtime = new TurnWorkerChildRuntime(options);
  runtime.start();
  return runtime;
}
