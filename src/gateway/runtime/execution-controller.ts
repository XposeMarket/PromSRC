import {
  abortLiveRuntime,
  finishLiveRuntime,
  getLiveRuntime,
  registerLiveRuntime,
  updateLiveRuntimeCheckpoint,
  type LiveRuntimeRegistration,
  type LiveRuntimeSnapshot,
} from '../live-runtime-registry';
import {
  createExecutionEnvelope,
  decideExecutionReplay,
  envelopeFromLiveRuntime,
  executionCorrelationFields,
  nextExecutionAttempt,
  type CreateExecutionEnvelopeInput,
  type ExecutionCheckpoint,
  type ExecutionEnvelope,
  type ExecutionPhase,
  type ExecutionReplayDecision,
} from './execution-contract';

export interface RuntimeExecutionAdapter {
  register(registration: LiveRuntimeRegistration): string;
  checkpoint(runtimeId: string, checkpoint: Record<string, unknown>): void;
  finish(runtimeId: string): void;
  abort(runtimeId: string, reason: string, source?: string): { ok: boolean; error?: string };
  get(runtimeId: string): LiveRuntimeSnapshot | null;
}

const defaultAdapter: RuntimeExecutionAdapter = {
  register: registerLiveRuntime,
  checkpoint: updateLiveRuntimeCheckpoint,
  finish: finishLiveRuntime,
  abort: (runtimeId, reason, source) => abortLiveRuntime(runtimeId, reason, { source }),
  get: getLiveRuntime,
};

export interface RuntimeExecutionHandle {
  runtimeId: string;
  envelope: ExecutionEnvelope;
  abortSignal: { aborted: boolean; reason?: string };
}

export interface BeginRuntimeExecutionInput extends CreateExecutionEnvelopeInput {
  abortSignal?: { aborted: boolean; reason?: string };
  onAbort?: () => void;
  deferTerminalCleanup?: boolean;
}

export interface RuntimeExecutionContext {
  runtimeId: string;
  envelope: ExecutionEnvelope;
  abortSignal: { aborted: boolean; reason?: string };
  correlation: Record<string, string | number | undefined>;
  checkpoint: (checkpoint: Omit<ExecutionCheckpoint, 'updatedAt'> & { updatedAt?: number }) => void;
}

function checkpointEvent(phase: ExecutionPhase): string {
  if (phase === 'completed') return 'done';
  if (phase === 'failed') return 'error';
  if (phase === 'cancelled') return 'error';
  if (phase === 'waiting_tool') return 'tool_call';
  if (phase === 'waiting_user') return 'waiting_user';
  return 'working';
}

function boundedData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data).slice(0, 24)) {
    const safeKey = String(key).slice(0, 80);
    if (typeof value === 'string') out[safeKey] = value.slice(0, 1_000);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[safeKey] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export class RuntimeExecutionController {
  constructor(private readonly adapter: RuntimeExecutionAdapter = defaultAdapter) {}

  begin(input: BeginRuntimeExecutionInput): RuntimeExecutionHandle {
    const envelope = createExecutionEnvelope(input);
    const abortSignal = input.abortSignal || { aborted: false };
    const runtimeId = this.adapter.register({
      kind: envelope.kind,
      label: envelope.label,
      detail: envelope.detail,
      sessionId: envelope.owner.sessionId,
      taskId: envelope.owner.taskId,
      teamId: envelope.owner.teamId,
      agentId: envelope.owner.agentId,
      scheduleId: envelope.owner.scheduleId,
      clientRequestId: envelope.owner.clientRequestId,
      source: envelope.owner.source,
      abortSignal,
      onAbort: input.onAbort,
      deferTerminalCleanup: input.deferTerminalCleanup,
      recoveryPolicy: envelope.recoveryPolicy,
      recoveryData: {
        executionEnvelope: envelope,
        executionContractVersion: envelope.version,
      },
    });
    this.checkpoint({ runtimeId, envelope, abortSignal }, {
      phase: 'prepared',
      message: 'Execution ownership established.',
    });
    return { runtimeId, envelope, abortSignal };
  }

  checkpoint(
    handle: RuntimeExecutionHandle,
    checkpoint: Omit<ExecutionCheckpoint, 'updatedAt'> & { updatedAt?: number },
  ): void {
    const normalized: ExecutionCheckpoint = {
      ...checkpoint,
      updatedAt: Number(checkpoint.updatedAt || Date.now()),
      data: boundedData(checkpoint.data),
    };
    this.adapter.checkpoint(handle.runtimeId, {
      event: checkpointEvent(normalized.phase),
      phase: normalized.phase,
      message: normalized.message,
      toolName: normalized.toolName,
      effectClass: normalized.effectClass || handle.envelope.effectClass,
      sideEffectCommitted: normalized.sideEffectCommitted,
      idempotencyKey: normalized.idempotencyKey || handle.envelope.idempotencyKey,
      executionId: handle.envelope.executionId,
      executionAttemptId: handle.envelope.attemptId,
      executionAttempt: handle.envelope.attempt,
      executionContractVersion: handle.envelope.version,
      updatedAt: normalized.updatedAt,
      data: normalized.data,
    });
  }

  finish(handle: RuntimeExecutionHandle): void {
    this.adapter.finish(handle.runtimeId);
  }

  cancel(handle: RuntimeExecutionHandle, reason = 'operator_abort', source = 'execution_controller'): { ok: boolean; error?: string } {
    handle.abortSignal.aborted = true;
    handle.abortSignal.reason = reason;
    this.checkpoint(handle, { phase: 'cancelled', message: reason });
    return this.adapter.abort(handle.runtimeId, reason, source);
  }

  recoveryDecision(runtime: LiveRuntimeSnapshot): ExecutionReplayDecision {
    const envelope = envelopeFromLiveRuntime(runtime);
    const checkpoint = runtime.checkpoint as Partial<ExecutionCheckpoint> | undefined;
    return decideExecutionReplay({ envelope, checkpoint, runtime });
  }

  nextAttempt(runtime: LiveRuntimeSnapshot, reason: string): ExecutionEnvelope {
    return nextExecutionAttempt(envelopeFromLiveRuntime(runtime), reason);
  }

  workerEnvelope(handle: RuntimeExecutionHandle): {
    execution: ExecutionEnvelope;
    correlation: Record<string, string | number | undefined>;
  } {
    return {
      execution: handle.envelope,
      correlation: executionCorrelationFields(handle.envelope),
    };
  }

  async run<TResult>(
    input: BeginRuntimeExecutionInput,
    execute: (ctx: RuntimeExecutionContext) => Promise<TResult>,
  ): Promise<TResult> {
    const handle = this.begin(input);
    const context: RuntimeExecutionContext = {
      runtimeId: handle.runtimeId,
      envelope: handle.envelope,
      abortSignal: handle.abortSignal,
      correlation: executionCorrelationFields(handle.envelope),
      checkpoint: (checkpoint) => this.checkpoint(handle, checkpoint),
    };
    try {
      this.checkpoint(handle, { phase: 'running', message: 'Execution started.' });
      const result = await execute(context);
      if (handle.abortSignal.aborted) {
        this.checkpoint(handle, {
          phase: 'cancelled',
          message: handle.abortSignal.reason || 'Execution aborted.',
        });
      } else {
        this.checkpoint(handle, { phase: 'completed', message: 'Execution completed.' });
      }
      return result;
    } catch (error: any) {
      this.checkpoint(handle, {
        phase: 'failed',
        message: String(error?.message || error || 'Execution failed.').slice(0, 1_000),
      });
      throw error;
    } finally {
      this.finish(handle);
    }
  }
}

export const runtimeExecutionController = new RuntimeExecutionController();
