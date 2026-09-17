import assert from 'node:assert/strict';
import type { LiveRuntimeRegistration, LiveRuntimeSnapshot } from '../live-runtime-registry';
import {
  createExecutionEnvelope,
  decideExecutionReplay,
  nextExecutionAttempt,
  type ExecutionEnvelope,
} from './execution-contract';
import {
  RuntimeExecutionController,
  type RuntimeExecutionAdapter,
} from './execution-controller';

class InMemoryRuntimeAdapter implements RuntimeExecutionAdapter {
  private counter = 0;
  readonly runtimes = new Map<string, LiveRuntimeSnapshot>();
  readonly checkpoints: Array<{ runtimeId: string; checkpoint: Record<string, unknown> }> = [];
  readonly finished: string[] = [];

  register(registration: LiveRuntimeRegistration): string {
    const id = `runtime_${++this.counter}`;
    this.runtimes.set(id, {
      id,
      kind: registration.kind,
      label: registration.label,
      sessionId: registration.sessionId,
      taskId: registration.taskId,
      teamId: registration.teamId,
      agentId: registration.agentId,
      scheduleId: registration.scheduleId,
      source: registration.source,
      detail: registration.detail,
      clientRequestId: registration.clientRequestId,
      startedAt: Date.now(),
      abortable: true,
      status: 'running',
      recoveryPolicy: registration.recoveryPolicy,
      recoveryData: registration.recoveryData,
    });
    return id;
  }

  checkpoint(runtimeId: string, checkpoint: Record<string, unknown>): void {
    this.checkpoints.push({ runtimeId, checkpoint });
    const runtime = this.runtimes.get(runtimeId);
    if (runtime) runtime.checkpoint = { ...checkpoint };
  }

  finish(runtimeId: string): void {
    this.finished.push(runtimeId);
    const runtime = this.runtimes.get(runtimeId);
    if (runtime) runtime.status = 'completed';
  }

  abort(runtimeId: string, reason: string): { ok: boolean; error?: string } {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) return { ok: false, error: 'missing' };
    runtime.status = 'aborted';
    runtime.abortRequestedAt = Date.now();
    runtime.abortReason = reason;
    return { ok: true };
  }

  get(runtimeId: string): LiveRuntimeSnapshot | null {
    return this.runtimes.get(runtimeId) || null;
  }
}

function testReplaySafety(): void {
  const readOnly = createExecutionEnvelope({
    kind: 'background_task',
    label: 'read-only retry',
    recoveryPolicy: 'rerun',
    effectClass: 'read_only',
    now: 100,
  });
  assert.equal(decideExecutionReplay({ envelope: readOnly, checkpoint: { phase: 'running' } }).action, 'rerun');

  const mutation = createExecutionEnvelope({
    kind: 'background_task',
    label: 'unsafe mutation',
    recoveryPolicy: 'rerun',
    effectClass: 'mutating',
    now: 100,
  });
  assert.deepEqual(
    decideExecutionReplay({
      envelope: mutation,
      checkpoint: { phase: 'committing', effectClass: 'mutating', sideEffectCommitted: true },
    }),
    { action: 'manual', reason: 'rerun_requires_read_only_or_idempotent_execution' },
  );

  const idempotent = createExecutionEnvelope({
    kind: 'background_task',
    label: 'safe mutation',
    recoveryPolicy: 'rerun',
    effectClass: 'idempotent',
    idempotencyKey: 'github:delivery:123',
    now: 100,
  });
  assert.equal(
    decideExecutionReplay({
      envelope: idempotent,
      checkpoint: { phase: 'committing', effectClass: 'idempotent', sideEffectCommitted: true },
    }).action,
    'rerun',
  );
}

function testAttemptIdentity(): void {
  const first: ExecutionEnvelope = createExecutionEnvelope({
    executionId: 'exec_stable',
    kind: 'main_chat',
    label: 'stable identity',
    recoveryPolicy: 'resume',
    now: 100,
  });
  const second = nextExecutionAttempt(first, 'worker_crash', 200);
  assert.equal(second.executionId, first.executionId);
  assert.equal(second.attempt, 2);
  assert.equal(second.attemptId, 'exec_stable:attempt:2');
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.attemptStartedAt, 200);
}

function testDurableCompactionRecovery(): void {
  const adapter = new InMemoryRuntimeAdapter();
  const controller = new RuntimeExecutionController(adapter);
  const handle = controller.begin({
    kind: 'background_task',
    label: 'mutation crash boundary',
    recoveryPolicy: 'resume',
    effectClass: 'mutating',
  });
  controller.checkpoint(handle, {
    phase: 'committing',
    effectClass: 'mutating',
    sideEffectCommitted: true,
    message: 'External write returned success.',
  });

  const live = adapter.runtimes.get(handle.runtimeId)!;
  const checkpoint = live.checkpoint || {};
  // Mirror live-runtime-registry's durable checkpoint allowlist: custom live
  // keys disappear, while phase/detail survive.
  const compacted: LiveRuntimeSnapshot = {
    ...live,
    checkpoint: {
      event: checkpoint.event,
      phase: checkpoint.phase,
      message: checkpoint.message,
      toolName: checkpoint.toolName,
      detail: checkpoint.detail,
      updatedAt: checkpoint.updatedAt,
    },
  };
  assert.equal((compacted.checkpoint as any).effectClass, undefined);
  assert.deepEqual(
    controller.recoveryDecision(compacted),
    { action: 'manual', reason: 'mutating_checkpoint_without_idempotency_key' },
  );
}

async function testControllerLifecycle(): Promise<void> {
  const adapter = new InMemoryRuntimeAdapter();
  const controller = new RuntimeExecutionController(adapter);
  let observedExecutionId = '';

  const result = await controller.run({
    kind: 'scheduled_task',
    label: 'scheduled ownership regression',
    recoveryPolicy: 'rerun',
    effectClass: 'read_only',
    owner: {
      sessionId: 'auto_job_1',
      scheduleId: 'job_1',
      source: 'regression',
    },
  }, async (ctx) => {
    observedExecutionId = ctx.envelope.executionId;
    ctx.checkpoint({
      phase: 'waiting_tool',
      toolName: 'web_search',
      effectClass: 'read_only',
      message: 'Waiting for observation.',
      data: { query: 'bounded', ignoredNested: { secret: 'not persisted' } },
    });
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.ok(observedExecutionId);
  assert.equal(adapter.finished.length, 1);
  assert.equal(adapter.checkpoints[0]?.checkpoint.phase, 'prepared');
  assert.ok(adapter.checkpoints.some((entry) => entry.checkpoint.phase === 'waiting_tool'));
  assert.equal(adapter.checkpoints.at(-1)?.checkpoint.phase, 'completed');

  const runtime = adapter.runtimes.get('runtime_1');
  const storedEnvelope = (runtime?.recoveryData as any)?.executionEnvelope;
  assert.equal(storedEnvelope.executionId, observedExecutionId);
  assert.equal(storedEnvelope.owner.scheduleId, 'job_1');
}

async function testFailureFinalization(): Promise<void> {
  const adapter = new InMemoryRuntimeAdapter();
  const controller = new RuntimeExecutionController(adapter);
  await assert.rejects(
    controller.run({
      kind: 'background_agent',
      label: 'failure regression',
      recoveryPolicy: 'mark_interrupted',
      effectClass: 'unknown',
    }, async () => {
      throw new Error('synthetic failure');
    }),
    /synthetic failure/,
  );
  assert.ok(adapter.checkpoints.some((entry) => entry.checkpoint.phase === 'failed'));
  assert.equal(adapter.finished.length, 1);
}

async function main(): Promise<void> {
  testReplaySafety();
  testAttemptIdentity();
  testDurableCompactionRecovery();
  await testControllerLifecycle();
  await testFailureFinalization();
  console.log('execution-controller regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
