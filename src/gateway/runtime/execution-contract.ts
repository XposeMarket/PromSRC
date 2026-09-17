import crypto from 'crypto';
import type { LiveRuntimeKind, LiveRuntimeSnapshot } from '../live-runtime-registry';

export const EXECUTION_CONTRACT_VERSION = 1 as const;
export const MAX_EXECUTION_LABEL_CHARS = 180;
export const MAX_EXECUTION_DETAIL_CHARS = 1_000;
export const MAX_EXECUTION_IDEMPOTENCY_KEY_CHARS = 240;

export type ExecutionRecoveryPolicy = 'resume' | 'rerun' | 'mark_interrupted' | 'do_not_resume';
export type ExecutionEffectClass = 'read_only' | 'idempotent' | 'mutating' | 'unknown';
export type ExecutionPhase =
  | 'prepared'
  | 'running'
  | 'waiting_tool'
  | 'waiting_user'
  | 'committing'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';

export interface ExecutionOwner {
  sessionId?: string;
  taskId?: string;
  teamId?: string;
  agentId?: string;
  scheduleId?: string;
  clientRequestId?: string;
  source?: string;
}

export interface ExecutionEnvelope {
  version: typeof EXECUTION_CONTRACT_VERSION;
  executionId: string;
  attemptId: string;
  attempt: number;
  kind: LiveRuntimeKind;
  label: string;
  detail?: string;
  owner: ExecutionOwner;
  recoveryPolicy: ExecutionRecoveryPolicy;
  effectClass: ExecutionEffectClass;
  idempotencyKey?: string;
  parentExecutionId?: string;
  createdAt: number;
  attemptStartedAt: number;
  recoveryReason?: string;
}

export interface ExecutionCheckpoint {
  phase: ExecutionPhase;
  message?: string;
  toolName?: string;
  effectClass?: ExecutionEffectClass;
  sideEffectCommitted?: boolean;
  idempotencyKey?: string;
  updatedAt: number;
  data?: Record<string, unknown>;
}

export type ExecutionReplayDecision =
  | { action: 'resume'; reason: string }
  | { action: 'rerun'; reason: string }
  | { action: 'manual'; reason: string }
  | { action: 'terminal'; reason: string };

export interface CreateExecutionEnvelopeInput {
  kind: LiveRuntimeKind;
  label: string;
  detail?: string;
  owner?: ExecutionOwner;
  recoveryPolicy?: ExecutionRecoveryPolicy;
  effectClass?: ExecutionEffectClass;
  idempotencyKey?: string;
  parentExecutionId?: string;
  executionId?: string;
  attempt?: number;
  now?: number;
}

function bounded(value: unknown, max: number): string | undefined {
  const text = String(value || '').replace(/\0/g, '').trim();
  return text ? text.slice(0, max) : undefined;
}

function boundedOwner(owner: ExecutionOwner | undefined): ExecutionOwner {
  return {
    sessionId: bounded(owner?.sessionId, 240),
    taskId: bounded(owner?.taskId, 240),
    teamId: bounded(owner?.teamId, 240),
    agentId: bounded(owner?.agentId, 240),
    scheduleId: bounded(owner?.scheduleId, 240),
    clientRequestId: bounded(owner?.clientRequestId, 240),
    source: bounded(owner?.source, 160),
  };
}

export function createExecutionEnvelope(input: CreateExecutionEnvelopeInput): ExecutionEnvelope {
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  const executionId = bounded(input.executionId, 240) || crypto.randomUUID();
  const attempt = Math.max(1, Math.floor(Number(input.attempt || 1)));
  const label = bounded(input.label, MAX_EXECUTION_LABEL_CHARS) || String(input.kind);
  const idempotencyKey = bounded(input.idempotencyKey, MAX_EXECUTION_IDEMPOTENCY_KEY_CHARS);
  return {
    version: EXECUTION_CONTRACT_VERSION,
    executionId,
    attemptId: `${executionId}:attempt:${attempt}`,
    attempt,
    kind: input.kind,
    label,
    detail: bounded(input.detail, MAX_EXECUTION_DETAIL_CHARS),
    owner: boundedOwner(input.owner),
    recoveryPolicy: input.recoveryPolicy || 'mark_interrupted',
    effectClass: input.effectClass || 'unknown',
    idempotencyKey,
    parentExecutionId: bounded(input.parentExecutionId, 240),
    createdAt: now,
    attemptStartedAt: now,
  };
}

export function nextExecutionAttempt(
  previous: ExecutionEnvelope,
  reason: string,
  now = Date.now(),
): ExecutionEnvelope {
  const attempt = previous.attempt + 1;
  return {
    ...previous,
    attempt,
    attemptId: `${previous.executionId}:attempt:${attempt}`,
    attemptStartedAt: now,
    recoveryReason: bounded(reason, 500),
  };
}

export function checkpointEffectClass(
  envelope: ExecutionEnvelope,
  checkpoint?: Partial<ExecutionCheckpoint> | null,
): ExecutionEffectClass {
  return checkpoint?.effectClass || envelope.effectClass || 'unknown';
}

export function decideExecutionReplay(params: {
  envelope: ExecutionEnvelope;
  checkpoint?: Partial<ExecutionCheckpoint> | null;
  runtime?: Pick<LiveRuntimeSnapshot, 'status' | 'checkpoint' | 'abortRequestedAt' | 'abortSource'> | null;
}): ExecutionReplayDecision {
  const { envelope, checkpoint, runtime } = params;
  const phase = checkpoint?.phase;
  if (phase === 'completed' || phase === 'cancelled' || phase === 'failed') {
    return { action: 'terminal', reason: `checkpoint_${phase}` };
  }
  if (runtime?.abortRequestedAt && runtime.abortSource !== 'main_chat_owner_watchdog') {
    return { action: 'terminal', reason: 'explicit_abort' };
  }
  if (envelope.recoveryPolicy === 'do_not_resume') {
    return { action: 'manual', reason: 'recovery_policy_do_not_resume' };
  }
  if (envelope.recoveryPolicy === 'mark_interrupted') {
    return { action: 'manual', reason: 'recovery_policy_mark_interrupted' };
  }

  const effectClass = checkpointEffectClass(envelope, checkpoint);
  const sideEffectCommitted = checkpoint?.sideEffectCommitted === true;
  const idempotencyKey = bounded(checkpoint?.idempotencyKey || envelope.idempotencyKey, MAX_EXECUTION_IDEMPOTENCY_KEY_CHARS);

  if (envelope.recoveryPolicy === 'resume') {
    if (sideEffectCommitted && effectClass === 'mutating' && !idempotencyKey) {
      return { action: 'manual', reason: 'mutating_checkpoint_without_idempotency_key' };
    }
    return { action: 'resume', reason: 'recovery_policy_resume' };
  }

  // Full reruns are only safe when the prior attempt is observational or the
  // caller supplied an idempotency key for a retry-safe action.
  if (effectClass === 'read_only') {
    return { action: 'rerun', reason: 'read_only_rerun' };
  }
  if (effectClass === 'idempotent' && idempotencyKey) {
    return { action: 'rerun', reason: 'idempotent_rerun' };
  }
  return { action: 'manual', reason: 'rerun_requires_read_only_or_idempotent_execution' };
}

export function executionCorrelationFields(envelope: ExecutionEnvelope): Record<string, string | number | undefined> {
  return {
    executionId: envelope.executionId,
    executionAttemptId: envelope.attemptId,
    executionAttempt: envelope.attempt,
    executionKind: envelope.kind,
    parentExecutionId: envelope.parentExecutionId,
    sessionId: envelope.owner.sessionId,
    taskId: envelope.owner.taskId,
    teamId: envelope.owner.teamId,
    agentId: envelope.owner.agentId,
    scheduleId: envelope.owner.scheduleId,
    clientRequestId: envelope.owner.clientRequestId,
  };
}

export function envelopeFromLiveRuntime(runtime: LiveRuntimeSnapshot): ExecutionEnvelope {
  const data = (runtime.recoveryData || {}) as Record<string, unknown>;
  const existing = data.executionEnvelope as ExecutionEnvelope | undefined;
  if (existing?.version === EXECUTION_CONTRACT_VERSION && existing.executionId) return existing;
  return createExecutionEnvelope({
    executionId: runtime.id,
    kind: runtime.kind,
    label: runtime.label,
    detail: runtime.detail,
    recoveryPolicy: runtime.recoveryPolicy,
    owner: {
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      teamId: runtime.teamId,
      agentId: runtime.agentId,
      scheduleId: runtime.scheduleId,
      clientRequestId: runtime.clientRequestId,
      source: runtime.source,
    },
    now: runtime.startedAt,
  });
}
