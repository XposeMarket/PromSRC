import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/config';

export const GATEWAY_PROGRESS_LEASE_FILENAME = 'gateway-progress-lease.json';
export const GATEWAY_PROGRESS_LEASE_VERSION = 1 as const;

export type GatewayProgressLeaseState = 'active' | 'idle';

export interface GatewayProgressLease {
  version: typeof GATEWAY_PROGRESS_LEASE_VERSION;
  pid: number;
  processStartedAt: number;
  leaseId: string;
  runtimeId: string;
  kind: string;
  sessionId?: string;
  state: GatewayProgressLeaseState;
  phase: string;
  activeToolName?: string;
  progressSeq: number;
  startedAt: number;
  lastProgressAt: number;
  lastCheckpointAt: number;
  expiresAt: number;
  updatedAt: number;
}

export interface GatewayProgressLeaseFreshnessOptions {
  now?: number;
  expectedPid?: number;
}

export function isGatewayProgressLeaseFresh(
  lease: GatewayProgressLease | null | undefined,
  options: GatewayProgressLeaseFreshnessOptions = {},
): boolean {
  if (!lease || lease.version !== GATEWAY_PROGRESS_LEASE_VERSION || lease.state !== 'active') return false;
  if (!Number.isInteger(lease.pid) || lease.pid <= 0) return false;
  if (options.expectedPid != null && lease.pid !== options.expectedPid) return false;
  if (!lease.leaseId || !lease.runtimeId) return false;
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  return Number.isFinite(lease.lastProgressAt)
    && Number.isFinite(lease.expiresAt)
    && lease.lastProgressAt > 0
    && lease.expiresAt > now;
}

export function readGatewayProgressLease(filePath: string): GatewayProgressLease | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || parsed.version !== GATEWAY_PROGRESS_LEASE_VERSION) return null;
    return parsed as GatewayProgressLease;
  } catch {
    return null;
  }
}

const NON_PROGRESS_EVENTS = new Set([
  'heartbeat',
  'keepalive',
  'keep_alive',
  'ping',
  'runtime_heartbeat',
]);

export function isMeaningfulRuntimeProgressEvent(event: unknown): boolean {
  const normalized = String(event || '').trim().toLowerCase();
  return !!normalized && !NON_PROGRESS_EVENTS.has(normalized);
}

function boundedLabel(value: unknown, maxLength: number): string {
  return String(value || '').trim().slice(0, maxLength);
}

function phaseForEvent(event: unknown): string {
  const normalized = boundedLabel(event, 80).toLowerCase();
  if (!normalized) return 'working';
  if (normalized === 'token' || normalized === 'thinking' || normalized === 'thinking_delta' || normalized === 'reasoning_summary') {
    return 'model_stream';
  }
  if (normalized === 'tool_call' || normalized === 'tool_progress') return 'tool_running';
  if (normalized === 'tool_result') return 'tool_completed';
  if (normalized === 'ui_preflight') return 'preparing';
  return normalized;
}

export interface RuntimeProgressLeaseRegistration {
  runtimeId: string;
  kind: string;
  sessionId?: string;
  startedAt?: number;
  phase?: string;
}

export interface RuntimeProgressLeaseRenewal {
  phase?: string;
  event?: string;
  activeToolName?: string;
  checkpoint?: boolean;
  at?: number;
}

export interface RuntimeProgressLeaseStoreOptions {
  filePath: string;
  pid?: number;
  processStartedAt?: number;
  ttlMs?: number;
  writeThrottleMs?: number;
  now?: () => number;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

/**
 * Maintains one supervisor-readable summary for the freshest active runtime.
 * Calls renew only in response to observed work. The timer coalesces writes; it
 * never advances progress timestamps or extends a lease by itself.
 */
export class RuntimeProgressLeaseStore {
  private readonly filePath: string;
  private readonly pid: number;
  private readonly processStartedAt: number;
  private readonly ttlMs: number;
  private readonly writeThrottleMs: number;
  private readonly now: () => number;
  private readonly active = new Map<string, GatewayProgressLease>();
  private pending: GatewayProgressLease | null = null;
  private writeTimer: NodeJS.Timeout | null = null;
  private writeActive = false;
  private lastWriteAt = 0;
  private idleWaiters = new Set<() => void>();

  constructor(options: RuntimeProgressLeaseStoreOptions) {
    this.filePath = options.filePath;
    this.pid = Number.isInteger(options.pid) && Number(options.pid) > 0 ? Number(options.pid) : process.pid;
    this.processStartedAt = Number.isFinite(options.processStartedAt)
      ? Number(options.processStartedAt)
      : Date.now() - Math.floor(process.uptime() * 1000);
    this.ttlMs = boundedInt(options.ttlMs, 90_000, 10_000, 10 * 60_000);
    this.writeThrottleMs = boundedInt(options.writeThrottleMs, 500, 0, 5_000);
    this.now = options.now || Date.now;
  }

  register(input: RuntimeProgressLeaseRegistration): GatewayProgressLease | null {
    const runtimeId = boundedLabel(input.runtimeId, 160);
    if (!runtimeId) return null;
    const now = this.now();
    const startedAt = Number.isFinite(input.startedAt) && Number(input.startedAt) > 0 ? Number(input.startedAt) : now;
    const lease: GatewayProgressLease = {
      version: GATEWAY_PROGRESS_LEASE_VERSION,
      pid: this.pid,
      processStartedAt: this.processStartedAt,
      leaseId: crypto.randomUUID(),
      runtimeId,
      kind: boundedLabel(input.kind, 80) || 'unknown',
      sessionId: boundedLabel(input.sessionId, 160) || undefined,
      state: 'active',
      phase: boundedLabel(input.phase, 80) || 'registered',
      progressSeq: 1,
      startedAt,
      lastProgressAt: now,
      lastCheckpointAt: 0,
      expiresAt: now + this.ttlMs,
      updatedAt: now,
    };
    this.active.set(runtimeId, lease);
    this.queueCurrentSnapshot();
    return { ...lease };
  }

  renew(runtimeIdValue: string, input: RuntimeProgressLeaseRenewal = {}): GatewayProgressLease | null {
    const runtimeId = boundedLabel(runtimeIdValue, 160);
    const lease = this.active.get(runtimeId);
    if (!lease) return null;
    if (input.event && !isMeaningfulRuntimeProgressEvent(input.event)) return { ...lease };
    const now = Number.isFinite(input.at) ? Number(input.at) : this.now();
    lease.progressSeq += 1;
    lease.lastProgressAt = Math.max(lease.lastProgressAt, now);
    if (input.checkpoint) lease.lastCheckpointAt = Math.max(lease.lastCheckpointAt, now);
    lease.expiresAt = lease.lastProgressAt + this.ttlMs;
    lease.updatedAt = now;
    lease.phase = boundedLabel(input.phase || phaseForEvent(input.event), 80) || lease.phase;
    const toolName = boundedLabel(input.activeToolName, 160);
    if (lease.phase === 'tool_running' && toolName) lease.activeToolName = toolName;
    else if (lease.phase !== 'tool_running') delete lease.activeToolName;
    this.queueCurrentSnapshot();
    return { ...lease };
  }

  finish(runtimeIdValue: string): void {
    const runtimeId = boundedLabel(runtimeIdValue, 160);
    if (!runtimeId || !this.active.delete(runtimeId)) return;
    this.queueCurrentSnapshot();
  }

  snapshot(): GatewayProgressLease {
    let freshest: GatewayProgressLease | null = null;
    for (const lease of this.active.values()) {
      if (!freshest || lease.lastProgressAt > freshest.lastProgressAt) freshest = lease;
    }
    if (freshest) return { ...freshest };
    const now = this.now();
    return {
      version: GATEWAY_PROGRESS_LEASE_VERSION,
      pid: this.pid,
      processStartedAt: this.processStartedAt,
      leaseId: '',
      runtimeId: '',
      kind: '',
      state: 'idle',
      phase: 'idle',
      progressSeq: 0,
      startedAt: 0,
      lastProgressAt: now,
      lastCheckpointAt: 0,
      expiresAt: now,
      updatedAt: now,
    };
  }

  private queueCurrentSnapshot(): void {
    this.pending = this.snapshot();
    if (this.writeActive || this.writeTimer) return;
    const delay = Math.max(0, this.writeThrottleMs - Math.max(0, this.now() - this.lastWriteAt));
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.drain();
    }, delay);
    if (typeof (this.writeTimer as any).unref === 'function') (this.writeTimer as any).unref();
  }

  private async drain(): Promise<void> {
    if (this.writeActive) return;
    this.writeActive = true;
    try {
      while (this.pending) {
        const snapshot = this.pending;
        this.pending = null;
        const dir = path.dirname(this.filePath);
        const tempPath = `${this.filePath}.tmp-${this.pid}-${crypto.randomUUID()}`;
        try {
          await fs.promises.mkdir(dir, { recursive: true });
          await fs.promises.writeFile(tempPath, JSON.stringify(snapshot), 'utf-8');
          await fs.promises.rename(tempPath, this.filePath);
          this.lastWriteAt = this.now();
        } finally {
          await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
        }
        if (this.pending && this.writeThrottleMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.writeThrottleMs));
        }
      }
    } catch (error: any) {
      console.warn('[gateway-progress-lease] Failed to persist progress lease:', error?.message || error);
    } finally {
      this.writeActive = false;
      if (this.pending) this.queueCurrentSnapshot();
      this.resolveIdleWaiters();
    }
  }

  private resolveIdleWaiters(): void {
    if (this.pending || this.writeActive || this.writeTimer) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.writeActive && this.pending) void this.drain();
    if (!this.pending && !this.writeActive) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }
}

let productionStore: RuntimeProgressLeaseStore | null = null;

function getProductionStore(): RuntimeProgressLeaseStore {
  if (!productionStore) {
    productionStore = new RuntimeProgressLeaseStore({
      filePath: path.join(getConfig().getConfigDir(), GATEWAY_PROGRESS_LEASE_FILENAME),
      ttlMs: boundedInt(process.env.PROMETHEUS_GATEWAY_PROGRESS_LEASE_TTL_MS, 90_000, 10_000, 10 * 60_000),
      writeThrottleMs: boundedInt(process.env.PROMETHEUS_GATEWAY_PROGRESS_LEASE_WRITE_THROTTLE_MS, 500, 0, 5_000),
    });
  }
  return productionStore;
}

export function registerRuntimeProgressLease(input: RuntimeProgressLeaseRegistration): GatewayProgressLease | null {
  return getProductionStore().register(input);
}

export function renewRuntimeProgressLease(runtimeId: string, input: RuntimeProgressLeaseRenewal = {}): GatewayProgressLease | null {
  return getProductionStore().renew(runtimeId, input);
}

export function finishRuntimeProgressLease(runtimeId: string): void {
  getProductionStore().finish(runtimeId);
}

export function getRuntimeProgressLeaseSnapshot(): GatewayProgressLease {
  return getProductionStore().snapshot();
}

export async function flushRuntimeProgressLease(): Promise<void> {
  await getProductionStore().flush();
}
