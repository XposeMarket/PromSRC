import path from 'path';
import { getConfig } from '../../config/config.js';
import {
  SqliteTurnJobStore,
  type ReconcileFinalizedTurnJobsResult,
} from './store.js';
import type { StaleLeaseReconciliation } from './types.js';

let store: SqliteTurnJobStore | null = null;
let storePath = '';
let openedAt = 0;
let shuttingDown = false;
let recoveryTimer: NodeJS.Timeout | null = null;
let recoveryScheduledFor = 0;
let recoveryRunning = false;
let lastRecoveryStartedAt = 0;
let lastRecoveryCompletedAt = 0;
let lastFinalRecovery: ReconcileFinalizedTurnJobsResult | null = null;
let lastStaleRecovery: StaleLeaseReconciliation | null = null;
let recoveredFinalsTotal = 0;
let lastRecoveryError = '';

function envInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function recoveryIntervalMs(): number {
  const legacyFinalOnly = process.env.PROMETHEUS_TURN_FINAL_RECOVERY_INTERVAL_MS;
  if (process.env.PROMETHEUS_TURN_RECOVERY_INTERVAL_MS == null && legacyFinalOnly != null) {
    const parsed = Number(legacyFinalOnly);
    if (Number.isFinite(parsed)) return Math.max(5_000, Math.min(10 * 60_000, Math.floor(parsed)));
  }
  return envInteger('PROMETHEUS_TURN_RECOVERY_INTERVAL_MS', 15_000, 5_000, 10 * 60_000);
}

function recoveryBatchLimit(): number {
  const legacyFinalOnly = process.env.PROMETHEUS_TURN_FINAL_RECOVERY_BATCH;
  if (process.env.PROMETHEUS_TURN_RECOVERY_BATCH == null && legacyFinalOnly != null) {
    const parsed = Number(legacyFinalOnly);
    if (Number.isFinite(parsed)) return Math.max(1, Math.min(10_000, Math.floor(parsed)));
  }
  return envInteger('PROMETHEUS_TURN_RECOVERY_BATCH', 100, 1, 10_000);
}

function armTurnRecovery(): void {
  if (shuttingDown || recoveryTimer || !store) return;
  const delay = recoveryIntervalMs();
  recoveryScheduledFor = Date.now() + delay;
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    recoveryScheduledFor = 0;
    try {
      runTurnRecoveryNow();
    } catch (error: any) {
      console.warn(`[TurnRecovery] Lease/final-state reconciliation failed: ${String(error?.message || error).slice(0, 1_000)}`);
    } finally {
      armTurnRecovery();
    }
  }, delay);
  recoveryTimer.unref?.();
}

/**
 * Reconcile expired leases plus finals that have no outbox intent. This does
 * not claim or redispatch queued/interrupted work and does not deliver to
 * external channels.
 */
export function runTurnRecoveryNow(): ReconcileFinalizedTurnJobsResult {
  if (shuttingDown) throw new Error('Durable turn journal is shutting down.');
  if (recoveryRunning) {
    if (lastFinalRecovery) return lastFinalRecovery;
    throw new Error('Durable lease/final-state recovery is already running.');
  }
  recoveryRunning = true;
  lastRecoveryStartedAt = Date.now();
  lastRecoveryError = '';
  try {
    const activeStore = getTurnJobStore();
    lastStaleRecovery = activeStore.reconcileStaleLeases(lastRecoveryStartedAt, recoveryBatchLimit());
    const result = activeStore.reconcileFinalizedJobs({
      at: lastRecoveryStartedAt,
      limit: recoveryBatchLimit(),
    });
    lastFinalRecovery = result;
    recoveredFinalsTotal += result.recovered;
    return result;
  } catch (error: any) {
    lastRecoveryError = String(error?.message || error || 'Unknown recovery failure').slice(0, 2_000);
    throw error;
  } finally {
    lastRecoveryCompletedAt = Date.now();
    recoveryRunning = false;
  }
}

export function getTurnJobStorePath(): string {
  return path.join(getConfig().getConfigDir(), 'runtime', 'turn-jobs.sqlite');
}

export function getTurnJobStore(): SqliteTurnJobStore {
  if (shuttingDown) throw new Error('Durable turn journal is shutting down.');
  const nextPath = getTurnJobStorePath();
  if (!store || storePath !== nextPath) {
    try { store?.close(); } catch {}
    store = new SqliteTurnJobStore(nextPath, {
      defaultLeaseMs: 45_000,
      // Runtime owns reconciliation so startup/health can report its result.
      reconcileOnOpen: false,
    });
    storePath = nextPath;
    openedAt = Date.now();
    lastStaleRecovery = store.reconcileStaleLeases(openedAt, recoveryBatchLimit());
    lastFinalRecovery = store.reconcileFinalizedJobs({ at: openedAt, limit: recoveryBatchLimit() });
    recoveredFinalsTotal += lastFinalRecovery.recovered;
    lastRecoveryStartedAt = openedAt;
    lastRecoveryCompletedAt = Date.now();
    lastRecoveryError = '';
    armTurnRecovery();
  }
  return store;
}

export function getTurnJobRuntimeStatus(): Record<string, unknown> {
  try {
    const activeStore = getTurnJobStore();
    const queued = activeStore.listJobs({ states: ['queued', 'checkpointed', 'interrupted'], limit: 1_000 });
    const active = activeStore.listJobs({ states: ['leased', 'running'], limit: 1_000 });
    const waiting = activeStore.listJobs({ states: ['waiting_approval', 'waiting_user', 'needs_review'], limit: 1_000 });
    return {
      isolation: 'durable-turn-journal',
      path: storePath,
      openedAt,
      queued: queued.length,
      active: active.length,
      waiting: waiting.length,
      recovery: {
        mode: 'lease-and-final-state-only',
        scheduled: Boolean(recoveryTimer),
        scheduledFor: recoveryScheduledFor || undefined,
        running: recoveryRunning,
        intervalMs: recoveryIntervalMs(),
        batchLimit: recoveryBatchLimit(),
        lastRunStartedAt: lastRecoveryStartedAt || undefined,
        lastRunCompletedAt: lastRecoveryCompletedAt || undefined,
        lastRecovered: lastFinalRecovery?.recovered || 0,
        recoveredTotal: recoveredFinalsTotal,
        remainingRecoverable: lastFinalRecovery?.remainingRecoverable || 0,
        deferredWithDeliveries: lastFinalRecovery?.deferredWithDeliveries || 0,
        staleJobsReconciled: lastStaleRecovery?.jobs.length || 0,
        staleJobsRemaining: lastStaleRecovery?.jobsRemaining || 0,
        staleDeliveriesReset: lastStaleRecovery?.deliveriesReset || 0,
        staleDeliveriesRemaining: lastStaleRecovery?.deliveriesRemaining || 0,
        orphanResourcesRemoved: lastStaleRecovery?.orphanResourceLeasesRemoved || 0,
        orphanResourcesRemaining: lastStaleRecovery?.orphanResourceLeasesRemaining || 0,
        lastError: lastRecoveryError || undefined,
        turnRedispatch: false,
        channelRedelivery: false,
      },
      activeJobs: active.slice(0, 20).map((job) => ({
        id: job.id,
        sessionId: job.sessionId,
        kind: job.kind,
        state: job.state,
        attempt: job.attempt,
        workerPid: job.workerPid,
        lastHeartbeatAt: job.lastHeartbeatAt,
      })),
    };
  } catch (error: any) {
    return {
      isolation: 'durable-turn-journal',
      state: 'unavailable',
      error: String(error?.message || error || 'unknown error').slice(0, 500),
    };
  }
}

export function shutdownTurnJobRuntime(): void {
  shuttingDown = true;
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  recoveryScheduledFor = 0;
  const active = store;
  store = null;
  storePath = '';
  openedAt = 0;
  try { active?.checkpointWal(); } catch {}
  try { active?.close(); } catch {}
}
