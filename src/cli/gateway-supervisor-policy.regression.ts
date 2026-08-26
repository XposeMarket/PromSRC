import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendGatewaySupervisorEvidence,
  buildGatewaySupervisorEvidence,
  classifyGatewaySupervisorObservation,
  type GatewaySupervisorObservation,
} from './gateway-supervisor-policy';

const now = 1_800_000_000_000;

function observation(overrides: Partial<GatewaySupervisorObservation> = {}): GatewaySupervisorObservation {
  return {
    now,
    healthOk: false,
    childPid: 1234,
    childExited: false,
    portOwnerPids: [1234],
    consecutiveFailures: 2,
    failureLimit: 2,
    restartEnabled: true,
    heartbeatFreshMs: 20_000,
    legacyBusyGraceMs: 45_000,
    runtimeStatus: { pid: 1234, timestamp: now - 60_000, modelBusy: false },
    progressLease: null,
    ...overrides,
  };
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    progressLease: {
      version: 1,
      pid: 1234,
      state: 'active',
      lastProgressAt: now - 1_000,
      lastCheckpointAt: now - 2_000,
      expiresAt: now + 89_000,
      progressSeq: 12,
    },
  }));
  assert.equal(decision.state, 'busy_progressing');
  assert.equal(decision.action, 'wait');
  assert.equal(decision.reasonCode, 'health_timeout_but_progress_fresh');
  assert.equal(decision.resetFailures, true);
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    progressLease: {
      version: 1,
      pid: 1234,
      state: 'active',
      lastProgressAt: now - 120_000,
      expiresAt: now - 30_000,
    },
  }));
  assert.equal(decision.state, 'stalled');
  assert.equal(decision.action, 'restart');
  assert.equal(decision.reasonCode, 'confirmed_stall_no_fresh_progress');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    maxProgressAgeMs: 30_000,
    progressLease: {
      version: 1,
      pid: 1234,
      state: 'active',
      lastProgressAt: now - 45_000,
      expiresAt: now + 45_000,
    },
  }));
  assert.equal(decision.state, 'stalled', 'a lease with stale meaningful progress must not grant indefinite immunity');
  assert.equal(decision.action, 'restart');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    progressLease: {
      version: 1,
      pid: 1234,
      state: 'active',
      lastProgressAt: now + 30_000,
      expiresAt: now + 90_000,
    },
  }));
  assert.equal(decision.state, 'stalled', 'future-dated progress must not grant restart immunity');
  assert.equal(decision.action, 'restart');
}

{
  const firstFailure = classifyGatewaySupervisorObservation(observation({ consecutiveFailures: 1 }));
  const secondFailure = classifyGatewaySupervisorObservation(observation({ consecutiveFailures: 2 }));
  assert.equal(firstFailure.state, 'waiting', 'one timeout must not kill the gateway');
  assert.equal(secondFailure.state, 'stalled', 'a true hang with stale progress must recover after the configured threshold');
  assert.equal(secondFailure.action, 'restart');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    portOwnerPids: [9999],
  }));
  assert.equal(decision.state, 'identity_mismatch');
  assert.equal(decision.action, 'wait');
}

{
  // Electron may track a tsx/launcher wrapper while the actual Node gateway
  // process owns the listening socket. A fresh runtime identity that owns the
  // port must be accepted during a failed probe (the fresh heartbeat still
  // grants the normal degraded grace period).
  const decision = classifyGatewaySupervisorObservation(observation({
    childPid: 20_228,
    portOwnerPids: [20_488],
    expectedProcessStartedAt: now - 10_000,
    runtimeStatus: {
      pid: 20_488,
      processStartedAt: now - 10_000,
      timestamp: now - 5_000,
    },
    progressLease: {
      version: 1,
      pid: 20_488,
      processStartedAt: now - 10_000,
      state: 'active',
      lastProgressAt: now - 180_000,
      expiresAt: now - 90_000,
    },
  }));
  assert.equal(decision.state, 'degraded_progressing', 'wrapper/runtime PID split must not become an identity mismatch');
  assert.equal(decision.action, 'wait');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    childPid: 20_228,
    portOwnerPids: [20_488],
    expectedProcessStartedAt: now - 10_000,
    runtimeStatus: {
      pid: 20_488,
      processStartedAt: now - 10_000,
      timestamp: now - 5_000,
    },
    progressLease: {
      version: 1,
      pid: 20_488,
      processStartedAt: now - 10_000,
      state: 'active',
      lastProgressAt: now - 1_000,
      expiresAt: now + 89_000,
    },
  }));
  assert.equal(decision.state, 'busy_progressing');
  assert.equal(decision.action, 'wait');
  assert.notEqual(decision.reasonCode, 'pid_identity_mismatch');
}

{
  // A matching generation remains identity evidence even after heartbeat and
  // progress go stale. The supervisor must reach the recovery threshold rather
  // than turning a hung wrapper/runtime split into a permanent mismatch wait.
  const decision = classifyGatewaySupervisorObservation(observation({
    childPid: 20_228,
    portOwnerPids: [20_488],
    expectedProcessStartedAt: now - 10_000,
    runtimeStatus: {
      pid: 20_488,
      processStartedAt: now - 10_000,
      timestamp: now - 60_000,
    },
    progressLease: {
      version: 1,
      pid: 20_488,
      processStartedAt: now - 10_000,
      state: 'active',
      lastProgressAt: now - 180_000,
      expiresAt: now - 90_000,
    },
  }));
  assert.equal(decision.state, 'stalled', 'matching generation plus current port ownership must remain recoverable after liveness expires');
  assert.equal(decision.action, 'restart');
  assert.equal(decision.reasonCode, 'confirmed_stall_no_fresh_progress');
}

{
  // A prior supervised child may leave a fresh-looking status/lease behind
  // while a later child owns the same port. A child-scoped generation must
  // reject that prior record even when its liveness timestamps look healthy.
  const previousChildGeneration = now - 20_000;
  const currentChildGeneration = now - 10_000;
  const decision = classifyGatewaySupervisorObservation(observation({
    childPid: 20_228,
    portOwnerPids: [20_488],
    expectedProcessStartedAt: currentChildGeneration,
    runtimeStatus: {
      pid: 20_488,
      processStartedAt: previousChildGeneration,
      timestamp: now - 1_000,
    },
    progressLease: {
      version: 1,
      pid: 20_488,
      processStartedAt: previousChildGeneration,
      state: 'active',
      lastProgressAt: now - 1_000,
      expiresAt: now + 89_000,
    },
  }));
  assert.equal(decision.state, 'identity_mismatch');
  assert.equal(decision.action, 'wait');
  assert.equal(decision.reasonCode, 'pid_identity_mismatch');
}

{
  // A reused/runtime PID from another launch generation remains fail-closed,
  // even when it currently owns the listening port.
  const decision = classifyGatewaySupervisorObservation(observation({
    childPid: 20_228,
    portOwnerPids: [20_488],
    expectedProcessStartedAt: now - 10_000,
    runtimeStatus: {
      pid: 20_488,
      processStartedAt: now - 20_000,
      timestamp: now - 60_000,
    },
    progressLease: {
      version: 1,
      pid: 20_488,
      processStartedAt: now - 20_000,
      state: 'active',
      lastProgressAt: now - 180_000,
      expiresAt: now - 90_000,
    },
  }));
  assert.equal(decision.state, 'identity_mismatch');
  assert.equal(decision.action, 'wait');
  assert.equal(decision.reasonCode, 'pid_identity_mismatch');
}

{
  // Missing launch-generation evidence must not authorize killing a port owner.
  const decision = classifyGatewaySupervisorObservation(observation({
    childPid: 20_228,
    portOwnerPids: [20_488],
    expectedProcessStartedAt: now - 10_000,
    runtimeStatus: {
      pid: 20_488,
      timestamp: now - 60_000,
    },
    progressLease: null,
  }));
  assert.equal(decision.state, 'identity_mismatch');
  assert.equal(decision.action, 'wait');
  assert.equal(decision.reasonCode, 'pid_identity_mismatch');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    // An expired lease from the previous process must not disable recovery.
    progressLease: {
      version: 1,
      pid: 9999,
      state: 'active',
      lastProgressAt: now - 180_000,
      expiresAt: now - 90_000,
    },
  }));
  assert.equal(decision.state, 'stalled');
  assert.equal(decision.action, 'restart');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    progressLease: {
      version: 1,
      pid: 9999,
      state: 'active',
      lastProgressAt: now - 1_000,
      expiresAt: now + 89_000,
    },
  }));
  assert.equal(decision.state, 'identity_mismatch');
  assert.equal(decision.action, 'wait');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    expectedProcessStartedAt: now - 10_000,
    runtimeStatus: {
      pid: 1234,
      processStartedAt: now - 20_000,
      timestamp: now - 2_000,
    },
  }));
  assert.equal(decision.state, 'identity_mismatch', 'a status snapshot from another process generation must not authorize a kill');
  assert.equal(decision.action, 'wait');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    expectedProcessStartedAt: now - 10_000,
    // This is an old status snapshot from a prior gateway generation. Its
    // heartbeat is already stale, so it must not block recovery forever.
    runtimeStatus: {
      pid: 1234,
      processStartedAt: now - 20_000,
      timestamp: now - 60_000,
    },
  }));
  assert.equal(decision.state, 'stalled', 'expired status identity must not create a permanent mismatch wait');
  assert.equal(decision.action, 'restart');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    portOwnerPids: [],
    runtimeStatus: null,
  }));
  assert.equal(decision.state, 'identity_mismatch');
  assert.equal(decision.reasonCode, 'pid_identity_unconfirmed');
  assert.equal(decision.action, 'wait');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    childPid: undefined,
    childExited: true,
    portOwnerPids: [],
  }));
  assert.equal(decision.state, 'exited');
  assert.equal(decision.action, 'relaunch');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    runtimeStatus: { pid: 1234, timestamp: now - 2_000, modelBusy: true },
  }));
  assert.equal(decision.state, 'degraded_progressing');
  assert.equal(decision.action, 'wait');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    healthOk: true,
    portOwnerPids: [],
    runtimeStatus: null,
  }));
  assert.equal(decision.state, 'healthy', 'healthy probes must not require a synchronous PID lookup');
  assert.equal(decision.action, 'none');
}

{
  const decision = classifyGatewaySupervisorObservation(observation({
    healthOk: true,
    childPid: undefined,
    childExited: true,
    portOwnerPids: [],
    runtimeStatus: null,
  }));
  assert.equal(decision.state, 'healthy', 'an existing healthy gateway must win over a dead child');
  assert.equal(decision.action, 'none');
}

{
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-supervisor-policy-'));
  try {
    const decision = classifyGatewaySupervisorObservation(observation({
      progressLease: {
        pid: 1234,
        state: 'active',
        activeToolName: 'safe_tool\nforged-record',
        lastProgressAt: now - 1_000,
        expiresAt: now + 89_000,
      },
    }));
    const evidence = buildGatewaySupervisorEvidence({
      now,
      supervisorPid: 77,
      childPid: 1234,
      childExit: { code: 42, signal: null },
      portOwnerPids: [1234],
      probe: { healthy: false, durationMs: 5001, outcome: 'timeout' },
      consecutiveFailures: 1,
      decision,
      runtimeStatus: {
        ...observation().runtimeStatus,
        memory: { rss: 600_000_000, heapTotal: 520_000_000, heapUsed: 485_000_000 },
      },
      progressLease: {
        pid: 1234,
        state: 'active',
        activeToolName: 'safe_tool\nforged-record',
        lastProgressAt: now - 1_000,
        expiresAt: now + 89_000,
      },
    });
    appendGatewaySupervisorEvidence(temp, evidence);
    const lines = fs.readFileSync(path.join(temp, 'logs', 'gateway-supervisor-events.ndjson'), 'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length, 1, 'sanitized evidence must remain one NDJSON record');
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.lease.activeToolName, 'safe_tool forged-record');
    assert.equal(parsed.reasonCode, 'health_timeout_but_progress_fresh');
    assert.equal(parsed.runtime.memory.heapUsed, 485_000_000);
    assert.deepEqual(parsed.childExit, { code: 42, signal: null });
    assert.equal('args' in parsed, false);
    assert.equal('result' in parsed, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

console.log('gateway-supervisor-policy regression passed');
