import fs from 'fs';
import path from 'path';

export type GatewaySupervisorState =
  | 'healthy'
  | 'busy_progressing'
  | 'degraded_progressing'
  | 'waiting'
  | 'stalled'
  | 'exited'
  | 'identity_mismatch';

export type GatewaySupervisorAction = 'none' | 'wait' | 'restart' | 'relaunch';

export interface GatewayRuntimeStatusSnapshot {
  pid?: number;
  timestamp?: number;
  reason?: string;
  modelBusy?: boolean;
  modelBusySince?: number;
  modelBusyAgeMs?: number;
  heartbeatDriftMs?: number;
  maxHeartbeatDriftMs?: number;
  lastHeartbeatDriftAt?: number;
  lastHeartbeatDriftMs?: number;
  lastRestartableHeartbeatDriftAt?: number;
  lastRestartableHeartbeatDriftMs?: number;
  memory?: {
    rss?: number;
    heapTotal?: number;
    heapUsed?: number;
    external?: number;
    arrayBuffers?: number;
  };
}

export interface GatewayProgressLeaseSnapshot {
  version?: number;
  pid?: number;
  processStartedAt?: number;
  leaseId?: string;
  runtimeId?: string;
  kind?: string;
  state?: 'active' | 'idle' | string;
  phase?: string;
  activeToolName?: string;
  progressSeq?: number;
  startedAt?: number;
  lastProgressAt?: number;
  lastCheckpointAt?: number;
  expiresAt?: number;
  updatedAt?: number;
}

export interface GatewaySupervisorObservation {
  now: number;
  healthOk: boolean;
  childPid?: number;
  childExited: boolean;
  portOwnerPids: number[];
  consecutiveFailures: number;
  failureLimit: number;
  restartEnabled: boolean;
  heartbeatFreshMs: number;
  legacyBusyGraceMs: number;
  runtimeStatus: GatewayRuntimeStatusSnapshot | null;
  progressLease: GatewayProgressLeaseSnapshot | null;
}

export interface GatewaySupervisorDecision {
  state: GatewaySupervisorState;
  action: GatewaySupervisorAction;
  reasonCode: string;
  resetFailures: boolean;
  heartbeatAgeMs: number | null;
  progressAgeMs: number | null;
  checkpointAgeMs: number | null;
  leaseExpiresInMs: number | null;
  pidAgreement: boolean;
}

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ageMs(now: number, value: unknown): number | null {
  const n = finitePositive(value);
  return n === null ? null : Math.max(0, now - n);
}

function pidMatches(pid: unknown, childPid: number | undefined): boolean {
  const value = finitePositive(pid);
  return value === null || !childPid || value === childPid;
}

/**
 * Pure supervisor policy. A failed HTTP probe is only one signal: a kill is
 * allowed after repeated failures, stale heartbeat/progress, and PID agreement.
 */
export function classifyGatewaySupervisorObservation(
  observation: GatewaySupervisorObservation,
): GatewaySupervisorDecision {
  const {
    now,
    childPid,
    childExited,
    portOwnerPids,
    runtimeStatus,
    progressLease,
  } = observation;
  const heartbeatAgeMs = ageMs(now, runtimeStatus?.timestamp);
  const progressAgeMs = ageMs(now, progressLease?.lastProgressAt ?? progressLease?.updatedAt);
  const checkpointAgeMs = ageMs(now, progressLease?.lastCheckpointAt);
  const expiresAt = finitePositive(progressLease?.expiresAt);
  const leaseExpiresInMs = expiresAt === null ? null : expiresAt - now;

  const childOwnsPort = !!childPid && portOwnerPids.includes(childPid);
  const statusPid = finitePositive(runtimeStatus?.pid);
  const statusPidMatches = pidMatches(runtimeStatus?.pid, childPid);
  const leasePidMatches = pidMatches(progressLease?.pid, childPid);
  const statusIsRelevant = heartbeatAgeMs !== null && heartbeatAgeMs <= observation.heartbeatFreshMs;
  const leaseIsRelevant = progressLease?.state === 'active' && expiresAt !== null && expiresAt > now;
  const childIdentityConfirmed = childOwnsPort || (statusPid !== null && statusPidMatches);
  const pidAgreement = childIdentityConfirmed
    && (!statusIsRelevant || statusPidMatches)
    && (!leaseIsRelevant || leasePidMatches);

  if (childExited || !childPid) {
    return { state: 'exited', action: 'relaunch', reasonCode: 'child_exited', resetFailures: true,
      heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement };
  }

  // A successful application probe needs no recovery action. Expensive PID
  // ownership inspection is deliberately reserved for failed probes.
  if (observation.healthOk) {
    return { state: 'healthy', action: 'none', reasonCode: 'health_probe_ok', resetFailures: true,
      heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement };
  }

  // A live listener owned by another PID, or status/lease from another process,
  // is an identity problem. Never kill the supervised child based on its data.
  if ((portOwnerPids.length > 0 && !portOwnerPids.includes(childPid))
    || (statusIsRelevant && !statusPidMatches)
    || (leaseIsRelevant && !leasePidMatches)) {
    return { state: 'identity_mismatch', action: 'wait', reasonCode: 'pid_identity_mismatch', resetFailures: false,
      heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement: false };
  }

  if (!childIdentityConfirmed) {
    return { state: 'identity_mismatch', action: 'wait', reasonCode: 'pid_identity_unconfirmed', resetFailures: false,
      heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement: false };
  }

  const leaseFresh = leaseIsRelevant && leasePidMatches;
  if (leaseFresh) {
    return { state: 'busy_progressing', action: 'wait', reasonCode: 'health_timeout_but_progress_fresh', resetFailures: true,
      heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement };
  }

  const heartbeatFresh = heartbeatAgeMs !== null && heartbeatAgeMs <= observation.heartbeatFreshMs;
  if (heartbeatFresh) {
    return { state: 'degraded_progressing', action: 'wait', reasonCode: 'health_timeout_but_heartbeat_fresh', resetFailures: true,
      heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement };
  }

  // Compatibility for gateways that have not yet emitted a progress lease.
  // Heartbeat staleness is included so this fixed grace cannot grant immunity.
  if (!progressLease && runtimeStatus?.modelBusy) {
    const busyAtHeartbeat = Math.max(0, Number(runtimeStatus.modelBusyAgeMs) || 0);
    const busyFromStart = ageMs(now, runtimeStatus.modelBusySince) || 0;
    const effectiveBusyAge = Math.max(busyFromStart, busyAtHeartbeat + Math.max(0, heartbeatAgeMs || 0));
    if (effectiveBusyAge < observation.legacyBusyGraceMs) {
      return { state: 'busy_progressing', action: 'wait', reasonCode: 'legacy_busy_grace_active', resetFailures: true,
        heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement };
    }
  }

  if (observation.consecutiveFailures < observation.failureLimit) {
    return { state: 'waiting', action: 'wait', reasonCode: 'health_failure_threshold_pending', resetFailures: false,
      heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement };
  }

  if (!observation.restartEnabled) {
    return { state: 'stalled', action: 'wait', reasonCode: 'confirmed_stall_restart_disabled', resetFailures: true,
      heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement };
  }

  return { state: 'stalled', action: 'restart', reasonCode: 'confirmed_stall_no_fresh_progress', resetFailures: true,
    heartbeatAgeMs, progressAgeMs, checkpointAgeMs, leaseExpiresInMs, pidAgreement };
}

export function readGatewayProgressLease(configDir: string): GatewayProgressLeaseSnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir, 'gateway-progress-lease.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as GatewayProgressLeaseSnapshot : null;
  } catch {
    return null;
  }
}

export interface GatewaySupervisorEvidence {
  timestamp: string;
  supervisorPid: number;
  childPid?: number;
  portOwnerPids: number[];
  probe: { healthy: boolean; durationMs: number; outcome: string; statusCode?: number };
  consecutiveFailures: number;
  state: GatewaySupervisorState;
  action: GatewaySupervisorAction;
  reasonCode: string;
  heartbeatAgeMs: number | null;
  progressAgeMs: number | null;
  checkpointAgeMs: number | null;
  leaseExpiresInMs: number | null;
  runtime?: {
    pid?: number;
    modelBusy?: boolean;
    heartbeatDriftMs?: number;
    lastHeartbeatDriftMs?: number;
    memory?: {
      rss?: number;
      heapTotal?: number;
      heapUsed?: number;
      external?: number;
      arrayBuffers?: number;
    };
  };
  lease?: {
    pid?: number;
    state?: string;
    fresh?: boolean;
    kind?: string;
    phase?: string;
    activeToolName?: string;
    progressSeq?: number;
  };
}

function boundedLabel(value: unknown, max = 96): string | undefined {
  const text = String(value || '').replace(/[\r\n\t]/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

export function buildGatewaySupervisorEvidence(args: {
  now: number;
  supervisorPid: number;
  childPid?: number;
  portOwnerPids: number[];
  probe: { healthy: boolean; durationMs: number; outcome: string; statusCode?: number };
  consecutiveFailures: number;
  decision: GatewaySupervisorDecision;
  runtimeStatus: GatewayRuntimeStatusSnapshot | null;
  progressLease: GatewayProgressLeaseSnapshot | null;
}): GatewaySupervisorEvidence {
  return {
    timestamp: new Date(args.now).toISOString(),
    supervisorPid: args.supervisorPid,
    childPid: args.childPid,
    portOwnerPids: args.portOwnerPids.slice(0, 8),
    probe: {
      healthy: args.probe.healthy,
      durationMs: Math.max(0, Math.round(args.probe.durationMs)),
      outcome: boundedLabel(args.probe.outcome, 48) || 'unknown',
      statusCode: args.probe.statusCode,
    },
    consecutiveFailures: Math.max(0, args.consecutiveFailures),
    state: args.decision.state,
    action: args.decision.action,
    reasonCode: args.decision.reasonCode,
    heartbeatAgeMs: args.decision.heartbeatAgeMs,
    progressAgeMs: args.decision.progressAgeMs,
    checkpointAgeMs: args.decision.checkpointAgeMs,
    leaseExpiresInMs: args.decision.leaseExpiresInMs,
    runtime: args.runtimeStatus ? {
      pid: finitePositive(args.runtimeStatus.pid) || undefined,
      modelBusy: args.runtimeStatus.modelBusy === true,
      heartbeatDriftMs: Number(args.runtimeStatus.heartbeatDriftMs) || 0,
      lastHeartbeatDriftMs: Number(args.runtimeStatus.lastHeartbeatDriftMs) || 0,
      memory: args.runtimeStatus.memory ? {
        rss: Number(args.runtimeStatus.memory.rss) || 0,
        heapTotal: Number(args.runtimeStatus.memory.heapTotal) || 0,
        heapUsed: Number(args.runtimeStatus.memory.heapUsed) || 0,
        external: Number(args.runtimeStatus.memory.external) || 0,
        arrayBuffers: Number(args.runtimeStatus.memory.arrayBuffers) || 0,
      } : undefined,
    } : undefined,
    lease: args.progressLease ? {
      pid: finitePositive(args.progressLease.pid) || undefined,
      state: boundedLabel(args.progressLease.state, 24),
      fresh: args.progressLease.state === 'active'
        && finitePositive(args.progressLease.expiresAt) !== null
        && Number(args.progressLease.expiresAt) > args.now,
      kind: boundedLabel(args.progressLease.kind, 48),
      phase: boundedLabel(args.progressLease.phase, 64),
      // Tool name is safe diagnostic metadata; arguments/results are never logged.
      activeToolName: boundedLabel(args.progressLease.activeToolName, 96),
      progressSeq: Number.isFinite(Number(args.progressLease.progressSeq))
        ? Math.max(0, Math.floor(Number(args.progressLease.progressSeq)))
        : undefined,
    } : undefined,
  };
}

/** Bounded append-only decision log: 2 MiB active file plus two rotations. */
export function appendGatewaySupervisorEvidence(configDir: string, evidence: GatewaySupervisorEvidence): void {
  try {
    const logDir = path.join(configDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const target = path.join(logDir, 'gateway-supervisor-events.ndjson');
    const maxBytes = 2 * 1024 * 1024;
    try {
      if (fs.statSync(target).size >= maxBytes) {
        const older = `${target}.2`;
        const previous = `${target}.1`;
        try { fs.rmSync(older, { force: true }); } catch {}
        try { fs.renameSync(previous, older); } catch {}
        fs.renameSync(target, previous);
      }
    } catch {}
    fs.appendFileSync(target, `${JSON.stringify(evidence)}\n`, 'utf8');
  } catch {
    // Supervisor evidence is best effort and must never take down supervision.
  }
}
