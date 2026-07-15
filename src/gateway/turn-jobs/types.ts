/**
 * Durable, provider-neutral records for process-isolated turns.
 *
 * The gateway is the only live-turn writer to these records. Turn workers
 * receive job/blob references over IPC and must fence every mutation with their
 * current lease token; the dedicated retention child may only delete bounded
 * batches of old terminal jobs.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type TurnJobKind =
  | 'interactive'
  | 'main_chat_goal'
  | 'background_task'
  | 'background_agent'
  | 'proposal_execution'
  | 'scheduled_task'
  | 'cron'
  | 'team_manager'
  | 'team_subagent'
  | 'brain_thought'
  | 'brain_dream';

export type TurnJobState =
  | 'queued'
  | 'leased'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'checkpointed'
  | 'final_persisted'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'needs_review';

export type TurnEventSource = 'worker' | 'gateway' | 'recovery';

export interface TurnJob {
  id: string;
  sessionId: string;
  kind: TurnJobKind;
  taskId: string | null;
  goalId: string | null;
  goalTurnId: string | null;
  clientRequestId: string | null;
  requestFingerprint: string;
  payloadRef: string;
  actorContext: JsonObject | null;
  state: TurnJobState;
  priority: number;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseUntil: number | null;
  workerPid: number | null;
  lastHeartbeatAt: number | null;
  lastEventSeq: number;
  checkpointId: string | null;
  checkpointRef: string | null;
  finalRef: string | null;
  lastError: string | null;
  interruptionReason: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface EnqueueTurnJobInput {
  id?: string;
  sessionId: string;
  kind: TurnJobKind;
  payloadRef: string;
  requestFingerprint: string;
  clientRequestId?: string | null;
  taskId?: string | null;
  goalId?: string | null;
  goalTurnId?: string | null;
  actorContext?: JsonObject | null;
  priority?: number;
  maxAttempts?: number;
  createdAt?: number;
}

export interface EnqueueTurnJobResult {
  job: TurnJob;
  created: boolean;
}

export interface ClaimTurnJobOptions {
  leaseOwner: string;
  workerPid?: number | null;
  leaseMs?: number;
  now?: number;
  kinds?: readonly TurnJobKind[];
  sessionId?: string;
}

export interface ClaimSpecificTurnJobOptions {
  leaseOwner: string;
  workerPid?: number | null;
  leaseMs?: number;
  now?: number;
}

export interface TurnJobLease {
  job: TurnJob;
  token: string;
  leaseUntil: number;
}

export interface TurnEvent {
  jobId: string;
  seq: number;
  attempt: number;
  source: TurnEventSource;
  type: string;
  at: number;
  payload: JsonValue | null;
  payloadRef: string | null;
  dedupeKey: string | null;
}

export interface AppendTurnEventInput {
  type: string;
  payload?: JsonValue | null;
  payloadRef?: string | null;
  dedupeKey?: string | null;
  at?: number;
}

export interface TurnCheckpoint {
  id: string;
  jobId: string;
  attempt: number;
  eventSeq: number;
  phase: string;
  modelRound: number | null;
  continuationRef: string;
  continuationHash: string | null;
  toolEffectId: string | null;
  metadata: JsonObject | null;
  createdAt: number;
}

export interface SaveTurnCheckpointInput {
  id?: string;
  phase: string;
  modelRound?: number | null;
  continuationRef: string;
  continuationHash?: string | null;
  toolEffectId?: string | null;
  metadata?: JsonObject | null;
  at?: number;
}

export type ToolEffectReplayPolicy =
  | 'safe_retry'
  | 'verify_before_retry'
  | 'never_replay';

export type ToolEffectState =
  | 'prepared'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown';

export interface ToolEffectRecord {
  effectId: string;
  jobId: string;
  logicalSequence: number;
  toolCallId: string;
  toolName: string;
  argsHash: string;
  replayPolicy: ToolEffectReplayPolicy;
  state: ToolEffectState;
  attempt: number;
  executionCount: number;
  resultRef: string | null;
  error: string | null;
  preparedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
}

export interface PrepareToolEffectInput {
  effectId?: string;
  logicalSequence: number;
  toolCallId: string;
  toolName: string;
  argsHash: string;
  replayPolicy: ToolEffectReplayPolicy;
  at?: number;
}

export type BeginToolEffectDisposition =
  | 'execute'
  | 'reuse_result'
  | 'already_running'
  | 'needs_review';

export interface BeginToolEffectResult {
  effect: ToolEffectRecord;
  disposition: BeginToolEffectDisposition;
}

export type TurnDeliveryStatus = 'pending' | 'processing' | 'delivered' | 'failed';

export interface TurnDelivery {
  id: string;
  jobId: string;
  channel: string;
  destination: string | null;
  dedupeKey: string;
  status: TurnDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseUntil: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  deliveredAt: number | null;
}

export interface TurnDeliveryInput {
  id?: string;
  channel: string;
  destination?: string | null;
  dedupeKey: string;
  maxAttempts?: number;
}

export interface PersistTurnFinalInput {
  finalRef: string;
  payload?: JsonValue | null;
  payloadRef?: string | null;
  deliveries?: readonly TurnDeliveryInput[];
  at?: number;
}

export interface PersistTurnFinalResult {
  job: TurnJob;
  event: TurnEvent;
  deliveries: TurnDelivery[];
}

export interface ClaimTurnDeliveryOptions {
  leaseOwner: string;
  leaseMs?: number;
  now?: number;
  channels?: readonly string[];
}

export interface TurnDeliveryLease {
  delivery: TurnDelivery;
  token: string;
  leaseUntil: number;
}

export interface ResourceLease {
  resourceKey: string;
  jobId: string;
  leaseOwner: string;
  leaseToken: string;
  leaseUntil: number;
  acquiredAt: number;
  updatedAt: number;
}

export interface AcquireResourceLeaseInput {
  resourceKey: string;
  jobId: string;
  leaseToken: string;
  leaseOwner: string;
  leaseUntil: number;
  now?: number;
}

export interface ReconciledTurnJob {
  jobId: string;
  previousState: 'leased' | 'running';
  nextState: TurnJobState;
  uncertainEffectIds: string[];
}

export interface StaleLeaseReconciliation {
  jobs: ReconciledTurnJob[];
  jobsRemaining: number;
  deliveriesReset: number;
  deliveriesRemaining: number;
  orphanResourceLeasesRemoved: number;
  orphanResourceLeasesRemaining: number;
  limit: number;
}

export const CLAIMABLE_TURN_JOB_STATES: readonly TurnJobState[] = [
  'queued',
  'checkpointed',
  'interrupted',
] as const;

export const ACTIVE_TURN_JOB_STATES: readonly TurnJobState[] = [
  'leased',
  'running',
] as const;

export const TERMINAL_TURN_JOB_STATES: readonly TurnJobState[] = [
  'completed',
  'failed',
  'cancelled',
] as const;
