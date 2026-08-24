import { fork, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getInjectedMasterKey } from '../../security/vault-key-bootstrap.js';
import {
  DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES,
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  runtimeWorkerMessageBytes,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
  type RuntimeWorkerResourceSample,
} from './runtime-worker-protocol.js';
import {
  deriveRuntimeWorkerResourceStatus,
  type RuntimeWorkerResourceStatus,
} from './runtime-worker-resources.js';

export type RuntimeWorkerBrokerState = 'stopped' | 'starting' | 'ready' | 'busy' | 'stopping' | 'failed';

export interface RuntimeWorkerBrokerPolicy {
  idleTtlMs: number;
  maxJobs: number;
  maxRssBytes: number;
  maxHeapUsedBytes: number;
  oneShot: boolean;
  resourceSampleIntervalMs: number;
}

export interface RuntimeWorkerBrokerStatus {
  name: string;
  state: RuntimeWorkerBrokerState;
  pid?: number;
  activeRequestId?: string;
  activeKind?: string;
  activeSince?: number;
  lastStartedAt?: number;
  lastHeartbeatAt?: number;
  lastCompletedAt?: number;
  lastExitAt?: number;
  lastExitCode?: number | null;
  lastExitSignal?: NodeJS.Signals | null;
  lastError?: string;
  lastStdoutTail?: string;
  lastStderrTail?: string;
  resource?: RuntimeWorkerResourceStatus;
  resourceSampleCount?: number;
  completedJobs?: number;
  retirementReason?: string;
  policy: RuntimeWorkerBrokerPolicy;
}

export interface RuntimeWorkerBrokerOptions {
  name: string;
  entryBasename: string;
  maxMessageBytes?: number;
  startupTimeoutMs?: number;
  defaultJobTimeoutMs?: number;
  idleTtlMs?: number;
  maxJobs?: number;
  maxRssBytes?: number;
  maxHeapUsedBytes?: number;
  oneShot?: boolean;
  resourceSampleIntervalMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface PendingRequest {
  kind: string;
  startedAt: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const OUTPUT_TAIL_MAX_CHARS = 8000;
const DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS = 5_000;
const MIN_RESOURCE_SAMPLE_INTERVAL_MS = 1_000;
const MAX_RESOURCE_SAMPLE_INTERVAL_MS = 60_000;
const activeBrokers = new Set<RuntimeWorkerBroker>();
let processExitHookRegistered = false;

function normalizePositiveLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeSampleInterval(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS;
  return Math.max(MIN_RESOURCE_SAMPLE_INTERVAL_MS, Math.min(MAX_RESOURCE_SAMPLE_INTERVAL_MS, Math.floor(parsed)));
}

function registerActiveBroker(broker: RuntimeWorkerBroker): void {
  activeBrokers.add(broker);
  if (processExitHookRegistered) return;
  processExitHookRegistered = true;
  // Normal gateway shutdown uses the async lifecycle hook. This one shared
  // synchronous hook is the last line of defense for direct process.exit()
  // paths, without adding one process listener per future turn worker.
  process.once('exit', () => {
    for (const active of activeBrokers) active.forceKill();
  });
}

function unregisterActiveBroker(broker: RuntimeWorkerBroker): void {
  activeBrokers.delete(broker);
}

export interface RuntimeWorkerDiagnosticWorker {
  name: string;
  state: string;
  pid?: number;
  activeRequestId?: string;
  resource?: RuntimeWorkerResourceStatus;
}

export interface RuntimeWorkerDiagnostics {
  at: number;
  workers: RuntimeWorkerDiagnosticWorker[];
  aggregate: {
    workers: number;
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    cpuPercent: number;
  };
}

const externalDiagnosticProviders = new Set<() => RuntimeWorkerDiagnosticWorker[]>();

export function registerRuntimeWorkerDiagnosticProvider(
  provider: () => RuntimeWorkerDiagnosticWorker[],
): () => void {
  externalDiagnosticProviders.add(provider);
  return () => externalDiagnosticProviders.delete(provider);
}

export function getRuntimeWorkerDiagnostics(): RuntimeWorkerDiagnostics {
  const workers: RuntimeWorkerDiagnosticWorker[] = Array.from(activeBrokers, (broker) => broker.getStatus());
  for (const provider of externalDiagnosticProviders) {
    try {
      workers.push(...provider().filter((worker) => Boolean(worker?.pid)));
    } catch {}
  }
  const aggregate = {
    workers: workers.length,
    rssBytes: 0,
    heapTotalBytes: 0,
    heapUsedBytes: 0,
    externalBytes: 0,
    arrayBuffersBytes: 0,
    cpuPercent: 0,
  };
  for (const worker of workers) {
    const resource = worker.resource;
    if (!resource) continue;
    aggregate.rssBytes += resource.rssBytes;
    aggregate.heapTotalBytes += resource.heapTotalBytes;
    aggregate.heapUsedBytes += resource.heapUsedBytes;
    aggregate.externalBytes += resource.externalBytes;
    aggregate.arrayBuffersBytes += resource.arrayBuffersBytes;
    aggregate.cpuPercent += resource.cpuPercent || 0;
  }
  return { at: Date.now(), workers, aggregate };
}

function appendTail(current: string, chunk: unknown): string {
  return `${current}${String(chunk || '')}`.slice(-OUTPUT_TAIL_MAX_CHARS);
}

function resolveWorkerEntry(entryBasename: string): string {
  const candidates = [
    path.join(__dirname, `${entryBasename}.js`),
    path.join(__dirname, `${entryBasename}.ts`),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  throw new Error(`Runtime worker entry not found: ${candidates.join(' or ')}`);
}

export class RuntimeWorkerBroker {
  private readonly options: {
    name: string;
    entryBasename: string;
    maxMessageBytes: number;
    startupTimeoutMs: number;
    defaultJobTimeoutMs: number;
    idleTtlMs: number;
    maxJobs: number;
    maxRssBytes: number;
    maxHeapUsedBytes: number;
    oneShot: boolean;
    resourceSampleIntervalMs: number;
    env?: NodeJS.ProcessEnv;
  };
  private child: ChildProcess | null = null;
  private state: RuntimeWorkerBrokerState = 'stopped';
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, PendingRequest>();
  private runClaimed = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private retirementPending = false;
  private completedJobs = 0;
  private resourceSampleCount = 0;
  private status: RuntimeWorkerBrokerStatus;

  constructor(options: RuntimeWorkerBrokerOptions) {
    this.options = {
      name: options.name,
      entryBasename: options.entryBasename,
      maxMessageBytes: Math.max(16 * 1024, Number(options.maxMessageBytes || DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES)),
      startupTimeoutMs: Math.max(1000, Number(options.startupTimeoutMs || 30_000)),
      defaultJobTimeoutMs: Math.max(1000, Number(options.defaultJobTimeoutMs || 15 * 60_000)),
      idleTtlMs: normalizePositiveLimit(options.idleTtlMs),
      maxJobs: normalizePositiveLimit(options.maxJobs),
      maxRssBytes: normalizePositiveLimit(options.maxRssBytes),
      maxHeapUsedBytes: normalizePositiveLimit(options.maxHeapUsedBytes),
      oneShot: options.oneShot === true,
      resourceSampleIntervalMs: normalizeSampleInterval(options.resourceSampleIntervalMs),
      env: options.env,
    };
    this.status = {
      name: this.options.name,
      state: 'stopped',
      resourceSampleCount: 0,
      completedJobs: 0,
      policy: this.getPolicy(),
    };
  }

  getStatus(): RuntimeWorkerBrokerStatus {
    const resource = this.status.resource
      ? {
          ...this.status.resource,
          heapSpaces: this.status.resource.heapSpaces.map((space) => ({ ...space })),
          sampleAgeMs: Math.max(0, Date.now() - this.status.resource.at),
        }
      : undefined;
    return {
      ...this.status,
      state: this.state,
      pid: this.child?.pid || this.status.pid,
      resource,
      policy: this.getPolicy(),
    };
  }

  private getPolicy(): RuntimeWorkerBrokerPolicy {
    return {
      idleTtlMs: this.options.idleTtlMs,
      maxJobs: this.options.maxJobs,
      maxRssBytes: this.options.maxRssBytes,
      maxHeapUsedBytes: this.options.maxHeapUsedBytes,
      oneShot: this.options.oneShot,
      resourceSampleIntervalMs: this.options.resourceSampleIntervalMs,
    };
  }

  private setState(state: RuntimeWorkerBrokerState, patch: Partial<RuntimeWorkerBrokerStatus> = {}): void {
    this.state = state;
    this.status = { ...this.status, ...patch, name: this.options.name, state };
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private resetGenerationState(): void {
    this.completedJobs = 0;
    this.resourceSampleCount = 0;
    this.retirementPending = false;
    this.status = {
      ...this.status,
      resource: undefined,
      resourceSampleCount: 0,
      completedJobs: 0,
      retirementReason: undefined,
    };
  }

  private updateResource(sample: RuntimeWorkerResourceSample | undefined): void {
    if (!sample || sample.pid !== (this.child?.pid || sample.pid)) return;
    const resource = deriveRuntimeWorkerResourceStatus(this.status.resource, sample);
    this.status = {
      ...this.status,
      resource,
      resourceSampleCount: ++this.resourceSampleCount,
    };
    if (this.options.maxRssBytes > 0 && resource.rssBytes >= this.options.maxRssBytes) {
      this.requestRetirement(`rss_limit_${this.options.maxRssBytes}`);
    } else if (this.options.maxHeapUsedBytes > 0 && resource.heapUsedBytes >= this.options.maxHeapUsedBytes) {
      this.requestRetirement(`heap_used_limit_${this.options.maxHeapUsedBytes}`);
    }
  }

  private markJobComplete(): void {
    this.completedJobs += 1;
    this.status.completedJobs = this.completedJobs;
    if (this.options.oneShot) this.requestRetirement('one_shot');
    if (this.options.maxJobs > 0 && this.completedJobs >= this.options.maxJobs) {
      this.requestRetirement(`max_jobs_${this.options.maxJobs}`);
    }
  }

  private requestRetirement(reason: string): void {
    this.retirementPending = true;
    this.status.retirementReason = reason;
    this.clearIdleTimer();
    this.retireIfIdle();
  }

  private retireIfIdle(): void {
    if (!this.retirementPending || this.runClaimed || this.pending.size > 0) return;
    if (!this.child || this.state === 'stopped' || this.state === 'stopping') return;
    void this.shutdown().catch((error) => {
      this.status.lastError = boundedRuntimeWorkerError(error);
    });
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (this.options.idleTtlMs <= 0 || this.runClaimed || this.pending.size > 0 || this.state !== 'ready' || !this.child) {
      this.retireIfIdle();
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.state === 'ready' && !this.runClaimed && this.pending.size === 0) {
        this.requestRetirement(`idle_ttl_${this.options.idleTtlMs}`);
      }
    }, this.options.idleTtlMs);
    this.idleTimer.unref?.();
  }

  private async discardFailedChild(): Promise<void> {
    const child = this.child;
    if (!child || this.state !== 'failed') return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once('exit', finish);
      this.forceKill();
      const fallback = setTimeout(finish, 250);
      fallback.unref?.();
    });
    if (this.child === child) {
      this.child = null;
      unregisterActiveBroker(this);
    }
  }

  private rejectReady(error: Error): void {
    this.clearStartupTimer();
    const reject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    this.readyPromise = null;
    reject?.(error);
  }

  private resolveReady(): void {
    this.clearStartupTimer();
    const resolve = this.readyResolve;
    this.readyResolve = null;
    this.readyReject = null;
    this.readyPromise = null;
    resolve?.();
  }

  private handleMessage(raw: unknown): void {
    const size = runtimeWorkerMessageBytes(raw);
    if (size > this.options.maxMessageBytes) {
      const error = new Error(`${this.options.name} emitted an oversized IPC message (${size} bytes; max ${this.options.maxMessageBytes}).`);
      this.setState('failed', { lastError: error.message });
      this.rejectAll(error);
      this.forceKill();
      return;
    }
    if (!isRuntimeWorkerProtocolMessage(raw)) return;
    const message = raw as RuntimeWorkerChildMessage;
    if (message.type === 'ready') {
      this.setState(this.pending.size ? 'busy' : 'ready', {
        pid: message.pid,
        lastError: undefined,
      });
      this.updateResource(message.resourceSample);
      this.resolveReady();
      this.armIdleTimer();
      return;
    }
    if (message.type === 'heartbeat') {
      this.status.lastHeartbeatAt = message.at;
      this.updateResource(message.resourceSample);
      return;
    }
    if (message.type === 'started') {
      const request = this.pending.get(message.requestId);
      this.setState('busy', {
        pid: message.pid,
        activeRequestId: message.requestId,
        activeKind: message.kind,
        activeSince: request?.startedAt || message.startedAt,
        lastStartedAt: message.startedAt,
      });
      return;
    }
    if (message.type === 'result') {
      const request = this.pending.get(message.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.requestId);
      this.updateResource(message.resourceSample);
      this.markJobComplete();
      this.setState('ready', {
        activeRequestId: undefined,
        activeKind: undefined,
        activeSince: undefined,
        lastCompletedAt: message.completedAt,
        lastError: undefined,
      });
      request.resolve(message.result);
      this.armIdleTimer();
      return;
    }
    if (message.type === 'error') {
      const error = new Error(`${this.options.name}: ${boundedRuntimeWorkerError(message.message)}`);
      if (message.requestId) {
        const request = this.pending.get(message.requestId);
        if (request) {
          clearTimeout(request.timer);
          this.pending.delete(message.requestId);
          this.updateResource(message.resourceSample);
          this.markJobComplete();
          request.reject(error);
        }
      }
      this.setState(this.child?.connected ? 'ready' : 'failed', {
        activeRequestId: undefined,
        activeKind: undefined,
        activeSince: undefined,
        lastCompletedAt: message.completedAt,
        lastError: error.message,
      });
      this.armIdleTimer();
    }
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.rejectReady(error);
  }

  private handleExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    const wasStopping = this.state === 'stopping';
    const error = new Error(`${this.options.name} exited (${signal || (code ?? 'unknown')}).`);
    this.child = null;
    unregisterActiveBroker(this);
    this.clearStartupTimer();
    this.rejectAll(error);
    this.setState(wasStopping ? 'stopped' : 'failed', {
      pid: undefined,
      activeRequestId: undefined,
      activeKind: undefined,
      activeSince: undefined,
      lastExitAt: Date.now(),
      lastExitCode: code,
      lastExitSignal: signal,
      lastError: wasStopping ? undefined : error.message,
    });
    this.clearIdleTimer();
  }

  private async ensureReady(): Promise<void> {
    if (this.state === 'stopping' && this.shutdownPromise) await this.shutdownPromise;
    if (this.state === 'failed' && this.child) await this.discardFailedChild();
    if (this.child?.connected && (this.state === 'ready' || this.state === 'busy')) return;
    if (this.readyPromise) return this.readyPromise;

    const entry = resolveWorkerEntry(this.options.entryBasename);
    this.resetGenerationState();
    this.setState('starting', { lastStartedAt: Date.now(), lastError: undefined });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    try {
      // Runtime workers can transitively read vault-backed configuration. In
      // Electron-managed mode they need the same OS-unsealed key as the
      // gateway; otherwise they fall back to generating a separate plaintext
      // vault key and silently lose access to saved credentials.
      const managedVaultKey = process.env.PROMETHEUS_ELECTRON_MANAGED === '1'
        ? (getInjectedMasterKey()?.toString('hex') || '')
        : null;
      const child = fork(entry, [], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...(this.options.env || {}),
          PROMETHEUS_RUNTIME_WORKER: '1',
          PROMETHEUS_RUNTIME_WORKER_NAME: this.options.name,
          PROMETHEUS_RUNTIME_WORKER_RESOURCE_SAMPLE_MS: String(this.options.resourceSampleIntervalMs),
        },
        execArgv: process.execArgv,
        serialization: 'json',
        stdio: [managedVaultKey !== null ? 'pipe' : 'ignore', 'pipe', 'pipe', 'ipc'],
      });
      if (managedVaultKey !== null) child.stdin?.write(`${managedVaultKey}\n`);
      this.child = child;
      registerActiveBroker(this);
      this.status.pid = child.pid;
      child.stdout?.on('data', (chunk) => {
        this.status.lastStdoutTail = appendTail(this.status.lastStdoutTail || '', chunk);
      });
      child.stderr?.on('data', (chunk) => {
        this.status.lastStderrTail = appendTail(this.status.lastStderrTail || '', chunk);
      });
      child.on('message', (message) => this.handleMessage(message));
      child.once('error', (error) => {
        this.setState('failed', { lastError: boundedRuntimeWorkerError(error) });
        this.rejectAll(error);
        this.forceKill();
      });
      child.once('exit', (code, signal) => this.handleExit(child, code, signal));
      this.startupTimer = setTimeout(() => {
        const error = new Error(`${this.options.name} did not become ready within ${this.options.startupTimeoutMs}ms.`);
        this.setState('failed', { lastError: error.message });
        this.rejectAll(error);
        this.forceKill();
      }, this.options.startupTimeoutMs);
      this.startupTimer.unref?.();
    } catch (error: any) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.setState('failed', { lastError: normalized.message });
      this.rejectAll(normalized);
      throw normalized;
    }

    return this.readyPromise;
  }

  /** Start the child process without submitting work. Safe to call repeatedly. */
  async warmup(): Promise<void> {
    await this.ensureReady();
  }

  async run<TResult = unknown>(kind: string, payload: unknown, timeoutMs = this.options.defaultJobTimeoutMs): Promise<TResult> {
    if (this.runClaimed || this.pending.size > 0 || this.state === 'busy') {
      throw new Error(`${this.options.name} is already running a job.`);
    }
    this.runClaimed = true;
    try {
      await this.ensureReady();
      const requestId = `${this.options.name}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
      const message: RuntimeWorkerParentMessage = {
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'run',
        requestId,
        kind: String(kind || '').trim(),
        payload,
      };
      const size = runtimeWorkerMessageBytes(message);
      if (size > this.options.maxMessageBytes) {
        throw new Error(`${this.options.name} request is too large for bounded IPC (${size} bytes; max ${this.options.maxMessageBytes}).`);
      }
      if (!this.child?.connected) throw new Error(`${this.options.name} IPC channel is not connected.`);

      return await new Promise<TResult>((resolve, reject) => {
        const safeTimeoutMs = Math.max(1000, Number(timeoutMs || this.options.defaultJobTimeoutMs));
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          const error = new Error(`${this.options.name} job ${kind} timed out after ${safeTimeoutMs}ms.`);
          this.setState('failed', { lastError: error.message });
          reject(error);
          this.forceKill();
        }, safeTimeoutMs);
        timer.unref?.();
        this.pending.set(requestId, {
          kind,
          startedAt: Date.now(),
          resolve: (value) => resolve(value as TResult),
          reject,
          timer,
        });
        this.setState('busy', {
          activeRequestId: requestId,
          activeKind: kind,
          activeSince: Date.now(),
        });
        this.child!.send(message, (error) => {
          if (!error) return;
          const request = this.pending.get(requestId);
          if (!request) return;
          clearTimeout(request.timer);
          this.pending.delete(requestId);
          const normalized = error instanceof Error ? error : new Error(String(error));
          this.setState('failed', { lastError: normalized.message });
          request.reject(normalized);
          this.forceKill();
        });
      });
    } finally {
      this.runClaimed = false;
      this.armIdleTimer();
    }
  }

  async shutdown(graceMs = 1000): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    const child = this.child;
    if (!child) {
      this.clearIdleTimer();
      this.setState('stopped', { pid: undefined, activeRequestId: undefined, activeKind: undefined, activeSince: undefined });
      return;
    }
    this.clearIdleTimer();
    this.setState('stopping');
    this.shutdownPromise = new Promise<void>((resolve) => {
      let settled = false;
      let killTimer: NodeJS.Timeout | null = null;
      let fallbackTimer: NodeJS.Timeout | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        resolve();
      };
      child.once('exit', finish);
      killTimer = setTimeout(() => {
        try { child.kill(); } catch {}
      }, Math.max(50, graceMs));
      killTimer.unref?.();
      fallbackTimer = setTimeout(() => {
        try { child.disconnect(); } catch {}
        if (this.child === child) {
          this.child = null;
          unregisterActiveBroker(this);
          this.setState('stopped', {
            pid: undefined,
            activeRequestId: undefined,
            activeKind: undefined,
            activeSince: undefined,
          });
        }
        finish();
      }, Math.max(250, graceMs + 1500));
      fallbackTimer.unref?.();
    });
    try {
      const message: RuntimeWorkerParentMessage = {
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'shutdown',
        reason: 'broker_shutdown',
      };
      try {
        if (child.connected) child.send(message);
      } catch {}
      await this.shutdownPromise;
    } finally {
      this.shutdownPromise = null;
    }
  }

  forceKill(): void {
    const child = this.child;
    if (!child) return;
    try { child.kill(); } catch {}
    try { child.disconnect(); } catch {}
  }

  /**
   * Keep an idle worker available without letting it keep a short-lived host
   * process alive. Active broker requests remain referenced by their pending
   * IPC/timer handles; long-lived gateways already have their server handles.
   */
  unref(): void {
    const child = this.child;
    if (!child) return;
    try { child.unref(); } catch {}
    try { child.channel?.unref?.(); } catch {}
  }
}
