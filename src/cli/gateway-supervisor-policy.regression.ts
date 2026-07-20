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
