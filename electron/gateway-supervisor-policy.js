/**
 * Shared gateway supervision policy.
 *
 * This file is intentionally CommonJS so the Electron supervisor and the
 * compiled CLI supervisor execute the same decision code.  Keep this module
 * pure except for the small, best-effort evidence/lease helpers at the end.
 */

const fs = require('fs');
const path = require('path');

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ageMs(now, value) {
  const n = finitePositive(value);
  return n === null || n > now ? null : now - n;
}

function pidMatches(pid, childPid) {
  const value = finitePositive(pid);
  return value === null || !childPid || value === childPid;
}

function processStartedAtMatches(value, expectedProcessStartedAt) {
  const actual = finitePositive(value);
  const expected = finitePositive(expectedProcessStartedAt);
  return actual === null || expected === null || actual === expected;
}

/**
 * Pure supervisor policy. A failed HTTP probe is only one signal: a kill is
 * allowed after repeated failures, stale heartbeat/progress, and PID/generation
 * agreement.
 */
function classifyGatewaySupervisorObservation(observation) {
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
  const maxProgressAgeMs = finitePositive(observation.maxProgressAgeMs) || 120_000;

  const statusPid = finitePositive(runtimeStatus?.pid);
  const leasePid = finitePositive(progressLease?.pid);
  const childOwnsPort = !!childPid && portOwnerPids.includes(childPid);
  const statusIsRelevant = heartbeatAgeMs !== null && heartbeatAgeMs <= observation.heartbeatFreshMs;
  const progressIsFresh = progressAgeMs !== null && progressAgeMs <= maxProgressAgeMs;
  const leaseIsRelevant = progressLease?.state === 'active'
    && expiresAt !== null
    && expiresAt > now
    && progressIsFresh;
  const expectedProcessStartedAt = finitePositive(observation.expectedProcessStartedAt);
  const statusProcessGenerationConfirmed = processStartedAtMatches(
    runtimeStatus?.processStartedAt,
    observation.expectedProcessStartedAt,
  ) && (expectedProcessStartedAt === null || finitePositive(runtimeStatus?.processStartedAt) !== null);
  const leaseProcessGenerationConfirmed = processStartedAtMatches(
    progressLease?.processStartedAt,
    observation.expectedProcessStartedAt,
  ) && (expectedProcessStartedAt === null || finitePositive(progressLease?.processStartedAt) !== null);
  // In source development (and on Windows in particular), the Electron
  // child tracked by spawn() can be a tsx/launcher wrapper while the actual
  // Node runtime owns the listening socket. Heartbeat freshness is liveness,
  // not identity: a hung runtime is expected to stop refreshing its heartbeat.
  // A runtime PID may therefore remain the managed identity after its
  // heartbeat goes stale, but only when its launch generation still matches
  // the supervisor's expected generation and it currently owns the port. A
  // mismatched generation remains fail-closed and cannot authorize a kill.
  const runtimeOwnsPort = statusPid !== null
    && portOwnerPids.includes(statusPid)
    && statusProcessGenerationConfirmed;
  const managedRuntimeIdentity = runtimeOwnsPort || childOwnsPort;
  const statusPidMatchesChild = pidMatches(runtimeStatus?.pid, childPid);
  const statusIdentityMatches = statusPidMatchesChild || runtimeOwnsPort;
  const leasePidMatchesChild = pidMatches(progressLease?.pid, childPid);
  const leaseIdentityMatches = leasePidMatchesChild
    || (runtimeOwnsPort && leasePid !== null && leasePid === statusPid);
  const statusGenerationMatches = statusProcessGenerationConfirmed;
  const leaseGenerationMatches = leaseProcessGenerationConfirmed;
  const childIdentityConfirmed = managedRuntimeIdentity
    || (statusPid !== null && statusPidMatchesChild);
  const pidAgreement = childIdentityConfirmed
    && (!statusIsRelevant || (statusIdentityMatches && statusGenerationMatches))
    && (!leaseIsRelevant || (leaseIdentityMatches && leaseGenerationMatches))
    && (!statusIsRelevant || statusGenerationMatches)
    && (!leaseIsRelevant || leaseGenerationMatches);

  if (observation.healthOk) {
    return {
      state: 'healthy',
      action: 'none',
      reasonCode: 'health_probe_ok',
      resetFailures: true,
      heartbeatAgeMs,
      progressAgeMs,
      checkpointAgeMs,
      leaseExpiresInMs,
      pidAgreement,
    };
  }

  if (childExited || !childPid) {
    return {
      state: 'exited',
      action: 'relaunch',
      reasonCode: 'child_exited',
      resetFailures: true,
      heartbeatAgeMs,
      progressAgeMs,
      checkpointAgeMs,
      leaseExpiresInMs,
      pidAgreement,
    };
  }

  if (
    (portOwnerPids.length > 0 && !managedRuntimeIdentity)
    || (statusIsRelevant && !statusIdentityMatches)
    || (leaseIsRelevant && !leaseIdentityMatches)
    // A stale snapshot from a previous process is evidence only while it is
    // still fresh. Once its heartbeat/lease has expired, it must not keep the
    // supervisor in an identity-mismatch wait loop forever.
    || (statusIsRelevant && !statusGenerationMatches)
    || (leaseIsRelevant && !leaseGenerationMatches)
  ) {
    return {
      state: 'identity_mismatch',
      action: 'wait',
      reasonCode: 'pid_identity_mismatch',
      resetFailures: false,
      heartbeatAgeMs,
      progressAgeMs,
      checkpointAgeMs,
      leaseExpiresInMs,
      pidAgreement: false,
    };
  }

  if (!childIdentityConfirmed) {
    return {
      state: 'identity_mismatch',
      action: 'wait',
      reasonCode: 'pid_identity_unconfirmed',
      resetFailures: false,
      heartbeatAgeMs,
      progressAgeMs,
      checkpointAgeMs,
      leaseExpiresInMs,
      pidAgreement: false,
    };
  }

  const leaseFresh = leaseIsRelevant && leaseIdentityMatches;
  if (leaseFresh) {
    return {
      state: 'busy_progressing',
      action: 'wait',
      reasonCode: 'health_timeout_but_progress_fresh',
      resetFailures: true,
      heartbeatAgeMs,
      progressAgeMs,
      checkpointAgeMs,
      leaseExpiresInMs,
      pidAgreement,
    };
  }

  const heartbeatFresh = heartbeatAgeMs !== null && heartbeatAgeMs <= observation.heartbeatFreshMs;
  if (heartbeatFresh) {
    return {
      state: 'degraded_progressing',
      action: 'wait',
      reasonCode: 'health_timeout_but_heartbeat_fresh',
      resetFailures: true,
      heartbeatAgeMs,
      progressAgeMs,
      checkpointAgeMs,
      leaseExpiresInMs,
      pidAgreement,
    };
  }

  if (!progressLease && runtimeStatus?.modelBusy) {
    const busyAtHeartbeat = Math.max(0, Number(runtimeStatus.modelBusyAgeMs) || 0);
    const busyFromStart = ageMs(now, runtimeStatus.modelBusySince) || 0;
    const effectiveBusyAge = Math.max(
      busyFromStart,
      busyAtHeartbeat + Math.max(0, heartbeatAgeMs || 0),
    );
    if (effectiveBusyAge < observation.legacyBusyGraceMs) {
      return {
        state: 'busy_progressing',
        action: 'wait',
        reasonCode: 'legacy_busy_grace_active',
        resetFailures: true,
        heartbeatAgeMs,
        progressAgeMs,
        checkpointAgeMs,
        leaseExpiresInMs,
        pidAgreement,
      };
    }
  }

  if (observation.consecutiveFailures < observation.failureLimit) {
    return {
      state: 'waiting',
      action: 'wait',
      reasonCode: 'health_failure_threshold_pending',
      resetFailures: false,
      heartbeatAgeMs,
      progressAgeMs,
      checkpointAgeMs,
      leaseExpiresInMs,
      pidAgreement,
    };
  }

  if (!observation.restartEnabled) {
    return {
      state: 'stalled',
      action: 'wait',
      reasonCode: 'confirmed_stall_restart_disabled',
      resetFailures: true,
      heartbeatAgeMs,
      progressAgeMs,
      checkpointAgeMs,
      leaseExpiresInMs,
      pidAgreement,
    };
  }

  return {
    state: 'stalled',
    action: 'restart',
    reasonCode: 'confirmed_stall_no_fresh_progress',
    resetFailures: true,
    heartbeatAgeMs,
    progressAgeMs,
    checkpointAgeMs,
    leaseExpiresInMs,
    pidAgreement,
  };
}

function readGatewayProgressLease(configDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir, 'gateway-progress-lease.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function boundedLabel(value, max = 96) {
  const text = String(value || '').replace(/[\r\n\t]/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function buildGatewaySupervisorEvidence(args) {
  return {
    timestamp: new Date(args.now).toISOString(),
    supervisorPid: args.supervisorPid,
    childPid: args.childPid,
    childExit: args.childExit,
    portOwnerPids: Array.isArray(args.portOwnerPids) ? args.portOwnerPids.slice(0, 8) : [],
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
      processStartedAt: finitePositive(args.runtimeStatus.processStartedAt) || undefined,
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
      processStartedAt: finitePositive(args.progressLease.processStartedAt) || undefined,
      state: boundedLabel(args.progressLease.state, 24),
      fresh: args.progressLease.state === 'active'
        && finitePositive(args.progressLease.expiresAt) !== null
        && Number(args.progressLease.expiresAt) > args.now,
      kind: boundedLabel(args.progressLease.kind, 48),
      phase: boundedLabel(args.progressLease.phase, 64),
      activeToolName: boundedLabel(args.progressLease.activeToolName, 96),
      progressSeq: Number.isFinite(Number(args.progressLease.progressSeq))
        ? Math.max(0, Math.floor(Number(args.progressLease.progressSeq)))
        : undefined,
    } : undefined,
  };
}

function appendGatewaySupervisorEvidence(configDir, evidence) {
  try {
    const logDir = path.join(configDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const target = path.join(logDir, 'gateway-supervisor-events.ndjson');
    const maxBytes = 2 * 1024 * 1024;
    try {
      if (fs.statSync(target).size >= maxBytes) {
        const older = target + '.2';
        const previous = target + '.1';
        try { fs.rmSync(older, { force: true }); } catch {}
        try { fs.renameSync(previous, older); } catch {}
        fs.renameSync(target, previous);
      }
    } catch {}
    fs.appendFileSync(target, JSON.stringify(evidence) + '\n', 'utf8');
  } catch {
    // Evidence is best effort and must never take down supervision.
  }
}

module.exports = {
  classifyGatewaySupervisorObservation,
  readGatewayProgressLease,
  buildGatewaySupervisorEvidence,
  appendGatewaySupervisorEvidence,
};
