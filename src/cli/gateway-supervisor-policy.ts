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
  processStartedAt?: number;
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
  maxProgressAgeMs?: number;
  expectedProcessStartedAt?: number;
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

export interface GatewaySupervisorEvidence {
  timestamp: string;
  supervisorPid: number;
  childPid?: number;
  childExit?: { code: number | null; signal: string | null };
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
    processStartedAt?: number;
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
    processStartedAt?: number;
    state?: string;
    fresh?: boolean;
    kind?: string;
    phase?: string;
    activeToolName?: string;
    progressSeq?: number;
  };
}

type SharedPolicyImplementation = {
  classifyGatewaySupervisorObservation: (
    observation: GatewaySupervisorObservation,
  ) => GatewaySupervisorDecision;
  readGatewayProgressLease: (configDir: string) => GatewayProgressLeaseSnapshot | null;
  buildGatewaySupervisorEvidence: (args: {
    now: number;
    supervisorPid: number;
    childPid?: number;
    childExit?: { code: number | null; signal: string | null };
    portOwnerPids: number[];
    probe: { healthy: boolean; durationMs: number; outcome: string; statusCode?: number };
    consecutiveFailures: number;
    decision: GatewaySupervisorDecision;
    runtimeStatus: GatewayRuntimeStatusSnapshot | null;
    progressLease: GatewayProgressLeaseSnapshot | null;
  }) => GatewaySupervisorEvidence;
  appendGatewaySupervisorEvidence: (configDir: string, evidence: GatewaySupervisorEvidence) => void;
};

const sharedPolicyRuntime = require('../../electron/gateway-supervisor-policy.js') as SharedPolicyImplementation;

export const classifyGatewaySupervisorObservation = sharedPolicyRuntime.classifyGatewaySupervisorObservation;
export const readGatewayProgressLease = sharedPolicyRuntime.readGatewayProgressLease;
export const buildGatewaySupervisorEvidence = sharedPolicyRuntime.buildGatewaySupervisorEvidence;
export const appendGatewaySupervisorEvidence = sharedPolicyRuntime.appendGatewaySupervisorEvidence;
