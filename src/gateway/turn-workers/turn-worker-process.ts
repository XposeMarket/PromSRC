import { fork, type ChildProcess } from 'child_process';
import { AsyncResource } from 'async_hooks';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getInjectedMasterKey } from '../../security/vault-key-bootstrap.js';
import {
  DEFAULT_TURN_WORKER_MAX_MESSAGE_BYTES,
  DEFAULT_TURN_WORKER_MAX_PAYLOAD_BYTES,
  TURN_WORKER_PROTOCOL_VERSION,
  TurnWorkerProtocolError,
  assertTurnWorkerMessageBounded,
  boundedTurnWorkerText,
  isTurnWorkerChildMessage,
  type TurnWorkerBounds,
  type TurnWorkerCheckpointMessage,
  type TurnWorkerChildMessage,
  type TurnWorkerErrorCode,
  type TurnWorkerErrorMessage,
  type TurnWorkerEventMessage,
  type TurnWorkerFinalMessage,
  type TurnWorkerHeartbeatMessage,
  type TurnWorkerRpcRequestMessage,
  type TurnWorkerSteerAckMessage,
} from './protocol.js';

export type TurnWorkerProcessState = 'stopped' | 'starting' | 'ready' | 'busy' | 'stopping' | 'failed';

export interface TurnWorkerProcessOptions extends TurnWorkerBounds {
  name?: string;
  entryPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  execArgv?: string[];
  startupTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  heartbeatCheckIntervalMs?: number;
  heartbeatIntervalMs?: number;
  cancelGraceMs?: number;
  steerAckTimeoutMs?: number;
  outputTailChars?: number;
}

export interface TurnWorkerProcessStatus {
  name: string;
  state: TurnWorkerProcessState;
  workerId?: string;
  pid?: number;
  activeJobId?: string;
  activeAttempt?: number;
  activeSince?: number;
  jobsCompleted: number;
  lastHeartbeatAt?: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastExitAt?: number;
  lastExitCode?: number | null;
  lastExitSignal?: NodeJS.Signals | null;
  lastError?: string;
  stdoutTail?: string;
  stderrTail?: string;
}

export interface TurnWorkerJobRequest {
  jobId: string;
  attempt?: number;
  input: unknown;
  resumeCheckpoint?: unknown;
  leaseToken?: string;
}

export interface TurnWorkerRpcContext {
  jobId: string;
  attempt: number;
  rpcId: string;
  method: string;
  params: unknown;
  idempotencyKey?: string;
  signal: AbortSignal;
}

export interface TurnWorkerJobHandlers<TResult = unknown> {
  onStarted?: (details: { jobId: string; attempt: number; workerId: string; pid: number; startedAt: number }) => void | Promise<void>;
  onEvent?: (message: TurnWorkerEventMessage) => void | Promise<void>;
  onCheckpoint?: (message: TurnWorkerCheckpointMessage) => void | Promise<void>;
  onHeartbeat?: (message: TurnWorkerHeartbeatMessage) => void;
  onRpc?: (request: TurnWorkerRpcContext) => unknown | Promise<unknown>;
  /** Runs before the result promise resolves, so durable final persistence can be ordered first. */
  onFinal?: (message: TurnWorkerFinalMessage) => void | Promise<void>;
  onError?: (message: TurnWorkerErrorMessage) => void | Promise<void>;
}

export interface TurnWorkerJobHandle<TResult = unknown> {
  readonly jobId: string;
  readonly attempt: number;
  readonly started: Promise<{ workerId: string; pid: number; startedAt: number }>;
  readonly result: Promise<TResult>;
  readonly pid?: number;
  cancel(reason?: string): Promise<void>;
  steer(payload: unknown, steerId?: string): Promise<TurnWorkerSteerAckMessage>;
}

export class TurnWorkerProcessError extends Error {
  readonly code: TurnWorkerErrorCode | string;
  readonly jobId?: string;
  readonly attempt?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { code?: TurnWorkerErrorCode | string; jobId?: string; attempt?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'TurnWorkerProcessError';
    this.code = options.code || 'TURN_WORKER_UNKNOWN_ERROR';
    this.jobId = options.jobId;
    this.attempt = options.attempt;
    this.details = options.details;
  }
}

interface SteerWaiter {
  resolve: (ack: TurnWorkerSteerAckMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ActiveJob {
  request: Required<Pick<TurnWorkerJobRequest, 'jobId' | 'attempt'>> & TurnWorkerJobRequest;
  handlers: TurnWorkerJobHandlers<unknown>;
  startedAt: number;
  lastSequence: number;
  settled: boolean;
  abortController: AbortController;
  inFlightRpcIds: Set<string>;
  steerWaiters: Map<string, SteerWaiter>;
  startedResolve: (value: { workerId: string; pid: number; startedAt: number }) => void;
  startedReject: (error: Error) => void;
  resultResolve: (value: unknown) => void;
  resultReject: (error: Error) => void;
  cancelTimer?: NodeJS.Timeout;
  /** Restores the submitter's async-local context around reusable-child callbacks. */
  callbackScope: AsyncResource;
}

const activeProcesses = new Set<TurnWorkerProcess>();
let exitHookInstalled = false;

function registerProcess(worker: TurnWorkerProcess): void {
  activeProcesses.add(worker);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const active of activeProcesses) active.forceKill();
  });
}

function unregisterProcess(worker: TurnWorkerProcess): void {
  activeProcesses.delete(worker);
}

function appendTail(current: string, chunk: unknown, limit: number): string {
  return `${current}${String(chunk || '')}`.slice(-limit);
}

/** Parent-side owner of one reusable, one-turn-at-a-time child process. */
export class TurnWorkerProcess {
  private readonly options: Required<Omit<TurnWorkerProcessOptions, 'env' | 'execArgv' | 'label'>>
    & Pick<TurnWorkerProcessOptions, 'env' | 'execArgv'>;
  private child: ChildProcess | null = null;
  private active: ActiveJob | null = null;
  private state: TurnWorkerProcessState = 'stopped';
  private status: TurnWorkerProcessStatus;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageChain = Promise.resolve();

  constructor(options: TurnWorkerProcessOptions) {
    const entryPath = path.resolve(options.entryPath);
    this.options = {
      name: String(options.name || `turn-worker-${crypto.randomBytes(4).toString('hex')}`),
      entryPath,
      cwd: path.resolve(options.cwd || process.cwd()),
      maxMessageBytes: Math.max(1_024, Number(options.maxMessageBytes || DEFAULT_TURN_WORKER_MAX_MESSAGE_BYTES)),
      maxPayloadBytes: Math.max(512, Number(options.maxPayloadBytes || DEFAULT_TURN_WORKER_MAX_PAYLOAD_BYTES)),
      startupTimeoutMs: Math.max(250, Number(options.startupTimeoutMs || 30_000)),
      heartbeatTimeoutMs: Math.max(1_000, Number(options.heartbeatTimeoutMs || 45_000)),
      heartbeatCheckIntervalMs: Math.max(100, Number(options.heartbeatCheckIntervalMs || 1_000)),
      heartbeatIntervalMs: Math.max(100, Number(options.heartbeatIntervalMs || 5_000)),
      cancelGraceMs: Math.max(100, Number(options.cancelGraceMs || 5_000)),
      steerAckTimeoutMs: Math.max(100, Number(options.steerAckTimeoutMs || 10_000)),
      outputTailChars: Math.max(1_000, Number(options.outputTailChars || 8_000)),
      env: options.env,
      execArgv: options.execArgv,
    };
    this.status = { name: this.options.name, state: 'stopped', jobsCompleted: 0 };
  }

  getStatus(): TurnWorkerProcessStatus {
    return { ...this.status, state: this.state, pid: this.child?.pid || this.status.pid };
  }

  get isBusy(): boolean {
    return Boolean(this.active);
  }

  get jobsCompleted(): number {
    return this.status.jobsCompleted;
  }

  private setState(state: TurnWorkerProcessState, patch: Partial<TurnWorkerProcessStatus> = {}): void {
    this.state = state;
    this.status = { ...this.status, ...patch, name: this.options.name, state };
  }

  private boundedError(error: unknown): string {
    return boundedTurnWorkerText(
      error,
      Math.max(100, Math.min(4_000, Math.floor(this.options.maxMessageBytes / 4))),
    );
  }

  private clearStartup(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private resolveReady(): void {
    this.clearStartup();
    const resolve = this.readyResolve;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    resolve?.();
  }

  private rejectReady(error: Error): void {
    this.clearStartup();
    const reject = this.readyReject;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    reject?.(error);
  }

  private async ensureReady(): Promise<void> {
    if (this.child?.connected && (this.state === 'ready' || this.state === 'busy')) return;
    if (this.readyPromise) return this.readyPromise;
    if (!fs.existsSync(this.options.entryPath)) {
      throw new TurnWorkerProcessError(`Turn worker entry does not exist: ${this.options.entryPath}`, {
        code: 'TURN_WORKER_UNAVAILABLE',
      });
    }
    this.setState('starting', { lastStartedAt: Date.now(), lastError: undefined });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    try {
      const child = fork(this.options.entryPath, [], {
        cwd: this.options.cwd,
        env: {
          ...process.env,
          ...(this.options.env || {}),
          PROMETHEUS_RUNTIME_WORKER: '1',
          PROMETHEUS_TURN_WORKER: '1',
          PROMETHEUS_TURN_WORKER_ID: this.options.name,
          PROMETHEUS_TURN_WORKER_MAX_MESSAGE_BYTES: String(this.options.maxMessageBytes),
          PROMETHEUS_TURN_WORKER_MAX_PAYLOAD_BYTES: String(this.options.maxPayloadBytes),
          PROMETHEUS_TURN_WORKER_HEARTBEAT_INTERVAL_MS: String(this.options.heartbeatIntervalMs),
        },
        execArgv: this.options.execArgv || process.execArgv,
        serialization: 'json',
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });
      this.child = child;
      registerProcess(this);
      this.status.pid = child.pid;
      const injectedKey = getInjectedMasterKey();
      try {
        child.stdin?.end(`${injectedKey ? injectedKey.toString('hex') : ''}\n`);
      } finally {
        injectedKey?.fill(0);
      }
      child.stdout?.on('data', (chunk) => {
        this.status.stdoutTail = appendTail(this.status.stdoutTail || '', chunk, this.options.outputTailChars);
      });
      child.stderr?.on('data', (chunk) => {
        this.status.stderrTail = appendTail(this.status.stderrTail || '', chunk, this.options.outputTailChars);
      });
      child.on('message', (raw: unknown) => this.receiveRawMessage(raw));
      child.once('error', (error) => this.handleProcessError(child, error));
      child.once('exit', (code, signal) => this.handleExit(child, code, signal));
      this.startupTimer = setTimeout(() => {
        const error = new TurnWorkerProcessError(
          `${this.options.name} did not become ready within ${this.options.startupTimeoutMs}ms.`,
          { code: 'TURN_WORKER_STARTUP_TIMEOUT' },
        );
        this.rejectReady(error);
        this.failActive(error);
        this.setState('failed', { lastError: error.message });
        this.forceKill();
      }, this.options.startupTimeoutMs);
      this.startupTimer.unref?.();
      this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), this.options.heartbeatCheckIntervalMs);
      this.heartbeatTimer.unref?.();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.rejectReady(normalized);
      this.setState('failed', { lastError: normalized.message });
      throw normalized;
    }
    return this.readyPromise;
  }

  private receiveRawMessage(raw: unknown): void {
    try {
      assertTurnWorkerMessageBounded(raw, {
        maxMessageBytes: this.options.maxMessageBytes,
        maxPayloadBytes: this.options.maxPayloadBytes,
        label: `${this.options.name} child message`,
      });
      if (!isTurnWorkerChildMessage(raw)) {
        throw new TurnWorkerProtocolError(`${this.options.name} emitted an invalid protocol message.`);
      }
      this.status.lastHeartbeatAt = Date.now();
    } catch (error) {
      this.handleProtocolFailure(error);
      return;
    }
    this.messageChain = this.messageChain
      .then(() => this.handleMessage(raw))
      .catch((error) => this.handleProtocolFailure(error));
  }

  private async handleMessage(message: TurnWorkerChildMessage): Promise<void> {
    if (message.type === 'ready') {
      this.setState(this.active ? 'busy' : 'ready', {
        workerId: message.workerId,
        pid: message.pid,
        lastHeartbeatAt: Date.now(),
        lastError: undefined,
      });
      this.resolveReady();
      return;
    }
    if (message.type === 'heartbeat') {
      this.status.lastHeartbeatAt = message.at;
      const active = this.active;
      if (active && active.request.jobId === message.jobId && active.request.attempt === message.attempt) {
        active.callbackScope.runInAsyncScope(() => active.handlers.onHeartbeat?.(message));
      }
      return;
    }
    if (message.type === 'shutdown_ack') return;
    if (message.type === 'error' && !message.jobId) {
      this.status.lastError = `${message.code}: ${boundedTurnWorkerText(message.message)}`;
      return;
    }

    const active = this.requireActiveMessage(message);
    if (message.type === 'started') {
      const details = {
        jobId: message.jobId,
        attempt: message.attempt,
        workerId: message.workerId,
        pid: message.pid,
        startedAt: message.startedAt,
      };
      await active.callbackScope.runInAsyncScope(() => active.handlers.onStarted?.(details));
      active.startedResolve({ workerId: message.workerId, pid: message.pid, startedAt: message.startedAt });
      return;
    }
    if (message.type === 'rpc_request') {
      if (active.inFlightRpcIds.has(message.rpcId)) {
        throw new TurnWorkerProtocolError(`Duplicate gateway RPC id: ${message.rpcId}`);
      }
      active.inFlightRpcIds.add(message.rpcId);
      void this.dispatchGatewayRpc(active, message);
      return;
    }
    if (message.type === 'steer_ack') {
      const waiter = active.steerWaiters.get(message.steerId);
      if (waiter) {
        clearTimeout(waiter.timer);
        active.steerWaiters.delete(message.steerId);
        waiter.resolve(message);
      }
      return;
    }
    if (message.type === 'event') {
      this.acceptSequence(active, message.sequence);
      await active.callbackScope.runInAsyncScope(() => active.handlers.onEvent?.(message));
      return;
    }
    if (message.type === 'checkpoint') {
      this.acceptSequence(active, message.sequence);
      await active.callbackScope.runInAsyncScope(() => active.handlers.onCheckpoint?.(message));
      return;
    }
    if (message.type === 'final') {
      this.acceptSequence(active, message.sequence);
      if (active.abortController.signal.aborted) {
        const reason = active.abortController.signal.reason;
        this.completeActive(active, reason instanceof Error ? reason : new TurnWorkerProcessError(
          this.boundedError(reason || 'Turn was cancelled before its final result was accepted.'),
          { code: 'TURN_CANCELLED', jobId: active.request.jobId, attempt: active.request.attempt },
        ));
        return;
      }
      await active.callbackScope.runInAsyncScope(() => active.handlers.onFinal?.(message));
      this.completeActive(active, undefined, message.result);
      return;
    }
    if (message.type === 'error') {
      if (message.sequence !== undefined) this.acceptSequence(active, message.sequence);
      await active.callbackScope.runInAsyncScope(() => active.handlers.onError?.(message));
      this.completeActive(active, new TurnWorkerProcessError(
        `${message.code}: ${boundedTurnWorkerText(message.message)}`,
        { code: message.code, jobId: message.jobId, attempt: message.attempt, details: message.details },
      ));
    }
  }

  private requireActiveMessage(message: Exclude<TurnWorkerChildMessage, { type: 'ready' | 'heartbeat' | 'shutdown_ack' }>): ActiveJob {
    const active = this.active;
    if (!active) throw new TurnWorkerProtocolError(`${this.options.name} emitted ${message.type} with no active job.`);
    if (message.jobId !== active.request.jobId || message.attempt !== active.request.attempt) {
      throw new TurnWorkerProtocolError(
        `${this.options.name} emitted a stale or mismatched ${message.type} for ${message.jobId}#${message.attempt}.`,
      );
    }
    return active;
  }

  private acceptSequence(active: ActiveJob, sequence: number): void {
    const expected = active.lastSequence + 1;
    if (sequence !== expected) {
      throw new TurnWorkerProtocolError(
        `${this.options.name} emitted sequence ${sequence}; expected ${expected} for ${active.request.jobId}.`,
      );
    }
    active.lastSequence = sequence;
  }

  private async dispatchGatewayRpc(active: ActiveJob, message: TurnWorkerRpcRequestMessage): Promise<void> {
    try {
      if (!active.handlers.onRpc) throw new Error(`No gateway RPC handler is registered for ${message.method}.`);
      const result = await active.callbackScope.runInAsyncScope(() => active.handlers.onRpc!({
        jobId: message.jobId,
        attempt: message.attempt,
        rpcId: message.rpcId,
        method: message.method,
        params: message.params,
        idempotencyKey: message.idempotencyKey,
        signal: active.abortController.signal,
      }));
      if (this.active !== active || active.settled || active.abortController.signal.aborted) return;
      await this.send({
        protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
        type: 'rpc_result',
        jobId: message.jobId,
        attempt: message.attempt,
        rpcId: message.rpcId,
        ok: true,
        result,
      });
    } catch (error) {
      if (this.active !== active || active.settled || active.abortController.signal.aborted) return;
      try {
        await this.send({
          protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
          type: 'rpc_result',
          jobId: message.jobId,
          attempt: message.attempt,
          rpcId: message.rpcId,
          ok: false,
          error: {
            code: error instanceof TurnWorkerProcessError ? error.code : 'GATEWAY_RPC_FAILED',
            message: this.boundedError(error),
          },
        });
      } catch (sendError) {
        this.handleProtocolFailure(sendError);
      }
    } finally {
      active.inFlightRpcIds.delete(message.rpcId);
    }
  }

  private async send(message: import('./protocol.js').TurnWorkerParentMessage): Promise<void> {
    assertTurnWorkerMessageBounded(message, {
      maxMessageBytes: this.options.maxMessageBytes,
      maxPayloadBytes: this.options.maxPayloadBytes,
      label: `${this.options.name} gateway message`,
    });
    const child = this.child;
    if (!child?.connected) {
      throw new TurnWorkerProcessError(`${this.options.name} IPC channel is disconnected.`, {
        code: 'TURN_WORKER_DISCONNECTED',
      });
    }
    await new Promise<void>((resolve, reject) => {
      child.send(message, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async runJob<TResult = unknown>(
    request: TurnWorkerJobRequest,
    handlers: TurnWorkerJobHandlers<TResult> = {},
  ): Promise<TurnWorkerJobHandle<TResult>> {
    const jobId = String(request.jobId || '').trim();
    const attempt = Math.max(1, Number(request.attempt || 1));
    if (!jobId) throw new TurnWorkerProtocolError('Turn jobId is required.');
    if (!Number.isSafeInteger(attempt)) throw new TurnWorkerProtocolError('Turn attempt must be a positive integer.');
    const startMessage = {
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'start' as const,
      jobId,
      attempt,
      input: request.input,
      resumeCheckpoint: request.resumeCheckpoint,
      leaseToken: request.leaseToken,
    };
    // Fail an oversized input before consuming a worker slot or spawning a child.
    assertTurnWorkerMessageBounded(startMessage, {
      maxMessageBytes: this.options.maxMessageBytes,
      maxPayloadBytes: this.options.maxPayloadBytes,
      label: `${this.options.name} start request`,
    });
    if (this.active) throw new TurnWorkerProcessError(`${this.options.name} is already executing a turn.`, { code: 'TURN_WORKER_BUSY' });
    await this.ensureReady();
    if (this.active) throw new TurnWorkerProcessError(`${this.options.name} is already executing a turn.`, { code: 'TURN_WORKER_BUSY' });

    let startedResolve!: ActiveJob['startedResolve'];
    let startedReject!: ActiveJob['startedReject'];
    let resultResolve!: ActiveJob['resultResolve'];
    let resultReject!: ActiveJob['resultReject'];
    const started = new Promise<{ workerId: string; pid: number; startedAt: number }>((resolve, reject) => {
      startedResolve = resolve;
      startedReject = reject;
    });
    const result = new Promise<unknown>((resolve, reject) => {
      resultResolve = resolve;
      resultReject = reject;
    });
    // Avoid process-level unhandled rejection noise when a caller only observes result.
    void started.catch(() => {});
    const normalizedRequest: ActiveJob['request'] = { ...request, jobId, attempt };
    const active: ActiveJob = {
      request: normalizedRequest,
      handlers: handlers as TurnWorkerJobHandlers<unknown>,
      startedAt: Date.now(),
      lastSequence: 0,
      settled: false,
      abortController: new AbortController(),
      inFlightRpcIds: new Set(),
      steerWaiters: new Map(),
      startedResolve,
      startedReject,
      resultResolve,
      resultReject,
      callbackScope: new AsyncResource('PrometheusTurnWorkerJob'),
    };
    this.active = active;
    this.setState('busy', {
      activeJobId: jobId,
      activeAttempt: attempt,
      activeSince: active.startedAt,
      lastHeartbeatAt: Date.now(),
      lastError: undefined,
    });
    try {
      await this.send(startMessage);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.completeActive(active, normalized);
      this.forceKill();
      throw normalized;
    }

    const owner = this;
    return {
      jobId,
      attempt,
      started,
      result: result as Promise<TResult>,
      get pid() { return owner.child?.pid; },
      cancel: (reason?: string) => owner.cancelJob(active, reason),
      steer: (payload: unknown, steerId?: string) => owner.steerJob(active, payload, steerId),
    };
  }

  private async cancelJob(active: ActiveJob, reason?: string): Promise<void> {
    if (this.active !== active || active.settled) return;
    const cancellationReason = this.boundedError(reason || 'Turn cancelled by gateway.');
    const cancellationError = new TurnWorkerProcessError(cancellationReason, {
      code: 'TURN_CANCELLED',
      jobId: active.request.jobId,
      attempt: active.request.attempt,
    });
    // Gateway-owned RPC work must observe cancellation immediately; waiting
    // for the child to process the IPC message can otherwise leave an external
    // operation running throughout the worker's cancellation grace period.
    if (!active.abortController.signal.aborted) active.abortController.abort(cancellationError);
    if (active.cancelTimer) clearTimeout(active.cancelTimer);
    active.cancelTimer = setTimeout(() => {
      if (this.active !== active || active.settled) return;
      const error = new TurnWorkerProcessError(
        `${this.options.name} did not stop within ${this.options.cancelGraceMs}ms after cancellation.`,
        { code: 'TURN_CANCELLED', jobId: active.request.jobId, attempt: active.request.attempt },
      );
      this.completeActive(active, error);
      this.forceKill();
    }, this.options.cancelGraceMs);
    active.cancelTimer.unref?.();
    await this.send({
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'cancel',
      jobId: active.request.jobId,
      attempt: active.request.attempt,
      reason: cancellationReason,
    });
  }

  private async steerJob(
    active: ActiveJob,
    payload: unknown,
    requestedSteerId?: string,
  ): Promise<TurnWorkerSteerAckMessage> {
    if (this.active !== active || active.settled) {
      throw new TurnWorkerProcessError('Cannot steer a turn that is not active.', { code: 'TURN_WORKER_UNAVAILABLE' });
    }
    const steerId = String(requestedSteerId || `steer_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`);
    const message = {
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'steer' as const,
      jobId: active.request.jobId,
      attempt: active.request.attempt,
      steerId,
      payload,
    };
    assertTurnWorkerMessageBounded(message, {
      maxMessageBytes: this.options.maxMessageBytes,
      maxPayloadBytes: this.options.maxPayloadBytes,
      label: `${this.options.name} steer request`,
    });
    const ack = new Promise<TurnWorkerSteerAckMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        active.steerWaiters.delete(steerId);
        reject(new TurnWorkerProcessError(`Steer ${steerId} was not acknowledged.`, { code: 'TURN_WORKER_UNAVAILABLE' }));
      }, this.options.steerAckTimeoutMs);
      timer.unref?.();
      active.steerWaiters.set(steerId, { resolve, reject, timer });
    });
    try {
      await this.send(message);
    } catch (error) {
      const waiter = active.steerWaiters.get(steerId);
      if (waiter) clearTimeout(waiter.timer);
      active.steerWaiters.delete(steerId);
      waiter?.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return ack;
  }

  private completeActive(active: ActiveJob, error?: Error, result?: unknown): void {
    if (this.active !== active || active.settled) return;
    active.settled = true;
    if (active.cancelTimer) clearTimeout(active.cancelTimer);
    if (!active.abortController.signal.aborted) {
      active.abortController.abort(error || new TurnWorkerProcessError('Turn completed.', { code: 'TURN_WORKER_UNAVAILABLE' }));
    }
    for (const waiter of active.steerWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error || new TurnWorkerProcessError('Turn completed before steer acknowledgement.', { code: 'TURN_WORKER_UNAVAILABLE' }));
    }
    active.steerWaiters.clear();
    if (error) {
      active.startedReject(error);
      active.resultReject(error);
    } else {
      active.resultResolve(result);
    }
    this.active = null;
    const nextState: TurnWorkerProcessState = this.state === 'stopping'
      ? 'stopping'
      : this.child?.connected
        ? 'ready'
        : 'failed';
    this.setState(nextState, {
      activeJobId: undefined,
      activeAttempt: undefined,
      activeSince: undefined,
      jobsCompleted: this.status.jobsCompleted + 1,
      lastCompletedAt: Date.now(),
      lastError: error?.message,
    });
    active.callbackScope.emitDestroy();
  }

  private failActive(error: Error): void {
    if (this.active) this.completeActive(this.active, error);
  }

  private handleProtocolFailure(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.setState('failed', { lastError: normalized.message });
    this.failActive(normalized);
    this.rejectReady(normalized);
    this.forceKill();
  }

  private handleProcessError(child: ChildProcess, error: Error): void {
    if (this.child !== child) return;
    const normalized = new TurnWorkerProcessError(`${this.options.name} process error: ${boundedTurnWorkerText(error)}`, {
      code: 'TURN_WORKER_CRASHED',
    });
    this.setState('failed', { lastError: normalized.message });
    this.rejectReady(normalized);
    this.failActive(normalized);
  }

  private handleExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    const wasStopping = this.state === 'stopping';
    this.child = null;
    unregisterProcess(this);
    this.clearStartup();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    const error = new TurnWorkerProcessError(
      `${this.options.name} exited (${signal || (code ?? 'unknown')}).`,
      { code: wasStopping ? 'TURN_WORKER_SHUTDOWN' : 'TURN_WORKER_CRASHED' },
    );
    this.rejectReady(error);
    this.failActive(error);
    this.setState(wasStopping ? 'stopped' : 'failed', {
      pid: undefined,
      workerId: undefined,
      activeJobId: undefined,
      activeAttempt: undefined,
      activeSince: undefined,
      lastExitAt: Date.now(),
      lastExitCode: code,
      lastExitSignal: signal,
      lastError: wasStopping ? undefined : error.message,
    });
  }

  private checkHeartbeat(): void {
    if (!this.child || this.state === 'starting' || this.state === 'stopping' || this.state === 'stopped') return;
    const last = this.status.lastHeartbeatAt || this.status.lastStartedAt || Date.now();
    if (Date.now() - last <= this.options.heartbeatTimeoutMs) return;
    const error = new TurnWorkerProcessError(
      `${this.options.name} stopped heartbeating for ${Date.now() - last}ms.`,
      { code: 'TURN_WORKER_HEARTBEAT_TIMEOUT', jobId: this.active?.request.jobId, attempt: this.active?.request.attempt },
    );
    this.setState('failed', { lastError: error.message });
    this.failActive(error);
    this.forceKill();
  }

  async shutdown(graceMs = 2_000): Promise<void> {
    const child = this.child;
    if (!child) {
      this.setState('stopped', { pid: undefined, workerId: undefined });
      return;
    }
    this.setState('stopping');
    const boundedGraceMs = Math.max(100, graceMs);
    const stopped = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        clearTimeout(fallbackTimer);
        resolve();
      };
      child.once('exit', finish);
      const killTimer = setTimeout(() => {
        try { child.kill(); } catch {}
      }, boundedGraceMs);
      killTimer.unref?.();
      const fallbackTimer = setTimeout(() => {
        try { child.disconnect(); } catch {}
        finish();
      }, Math.max(500, boundedGraceMs + 1_000));
      fallbackTimer.unref?.();
    });
    // Arm the termination deadline before touching IPC. A connected child can
    // have a saturated send queue whose callback never arrives; shutdown must
    // not wait on that callback before its kill/fallback timers exist.
    void this.send({
      protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
      type: 'shutdown',
      reason: 'gateway_shutdown',
      graceMs: boundedGraceMs,
    }).catch(() => {});
    await stopped;
  }

  forceKill(): void {
    const child = this.child;
    if (!child) return;
    try { child.kill(); } catch {}
    try { child.disconnect(); } catch {}
  }
}
