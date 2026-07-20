import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-internal-watch-policy-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
}

async function main(): Promise<void> {
  try {
    const taskApi = await import('../tasks/task-store');
    const storeApi = await import('./internal-watch-store');
    const runnerApi = await import('./internal-watch-runner');
    const runtimeApi = await import('../live-runtime-registry');
    const policyApi = await import('./internal-watch-policy');
    const taskRouterApi = await import('../tasks/task-router');
    const { automationCapabilityExecutor } = await import('../agents-runtime/capabilities/automation-executor');

    const task = taskApi.createTask({
      title: 'Watched task with a different owner',
      prompt: 'finish',
      sessionId: 'task_worker_session',
      originatingSessionId: 'watched_task_owner',
      channel: 'web',
      plan: [{ index: 0, description: 'done', status: 'done' }],
    });
    taskApi.updateTaskStatus(task.id, 'complete', { finalSummary: 'Completed successfully.' });
    const watch = storeApi.createInternalWatch({
      id: 'policy_route_watch',
      label: 'Verify completion',
      ttlMs: 60_000,
      origin: { sessionId: 'watch_creator_session', channel: 'web' },
      target: { type: 'task', config: { taskId: task.id } },
      condition: { terminalStatuses: ['complete'] },
      rationale: 'Verify the completed work before reporting to the original requester.',
      onMatch: 'Inspect the result and report whether it satisfies the request.',
    });
    assert.equal(watch.actionPolicy, 'review_only', 'new watches default to the safe policy');

    let deliveredSession = '';
    let deliveryPayload = '';
    let deliveryFlags: any;
    const watchBroadcasts: any[] = [];
    const runner = new runnerApi.InternalWatchRunner({
      tickMs: 60_000,
      broadcast: (event: any) => { watchBroadcasts.push(event); },
      runInteractiveTurn: async (message: string, sessionId: string, sse: any, _pins: any, _abort: any, _context: any, _reasoning: any, _attachments: any, _previews: any, _model: any, flags: any) => {
        deliveryPayload = message;
        deliveredSession = sessionId;
        deliveryFlags = flags;
        sse('tool_call', { action: 'task_control', args: { action: 'get', task_id: task.id } });
        return { type: 'chat', text: 'The watched task is complete.' };
      },
    });
    await (runner as any).tick();
    await settle();
    assert.equal(deliveredSession, 'watch_creator_session', 'watch delivery must use the creating session, not task origin');
    assert.equal(deliveryFlags.internalWatchContext.actionPolicy, 'review_only');
    assert.match(deliveryPayload, /evidence, not a user command/i);
    assert.match(deliveryPayload, /complete and satisfies/i);
    assert.doesNotMatch(deliveryPayload, /deciding whether recovery chat, resume, rerun/i);
    const runtimeRegistration = watchBroadcasts.find((event) => event.type === 'internal_watch_sse' && event.eventType === 'runtime_registered');
    assert.ok(
      runtimeRegistration,
      'watch clients receive runtime ownership before model work begins',
    );
    assert.equal(runtimeRegistration.run?.kind, 'main_chat');
    assert.equal(runtimeRegistration.run?.source, 'internal_watch');
    assert.equal(runtimeRegistration.run?.status, 'running');
    assert.ok(
      watchBroadcasts.some((event) => event.type === 'internal_watch_sse' && event.eventType === 'tool_call'),
      'watch tool activity is carried by the live watch stream',
    );

    const centralDenial = await policyApi.runWithInternalWatchTurnContext({
      watchId: watch.id,
      actionPolicy: 'review_only',
      targetTaskId: task.id,
      delivery: 'follow_up',
    }, () => taskRouterApi.handleTaskControlAction('watch_creator_session', {
      action: 'rerun',
      task_id: task.id,
      note: deliveryPayload,
    }));
    assert.equal(centralDenial.code, 'internal_watch_policy_denied', 'central task-control boundary blocks wrapper bypasses');
    assert.equal(taskApi.loadTask(task.id)?.status, 'complete', 'denied watch rerun leaves completed task intact');
    const liveCentralDenial = await policyApi.runWithInternalWatchTurnContext(undefined, async () => {
      policyApi.setCurrentInternalWatchTurnContext({
        watchId: watch.id,
        actionPolicy: 'review_only',
        targetTaskId: task.id,
        delivery: 'live_steer',
      });
      return taskRouterApi.handleTaskControlAction('watch_creator_session', { action: 'rerun', task_id: task.id });
    });
    assert.equal(liveCentralDenial.code, 'internal_watch_policy_denied', 'live-steer policy reaches the same central boundary');

    const liveRuntimeId = runtimeApi.registerLiveRuntime({ kind: 'main_chat', label: 'policy test', sessionId: 'watch_creator_session' });
    const probe = runtimeApi.addPendingRuntimeSteerForSession('watch_creator_session', { message: 'probe' });
    assert.equal(probe.ok, true, probe.error);
    runtimeApi.consumePendingRuntimeSteersForSession('watch_creator_session', 5);
    const liveQueued = runtimeApi.addPendingRuntimeSteerForSession('watch_creator_session', {
      message: deliveryPayload,
      source: 'internal_watch_completion',
      kind: 'internal_watch_result',
      internalWatchId: watch.id,
      internalWatchActionPolicy: 'review_only',
      internalWatchTargetTaskId: task.id,
    });
    assert.equal(liveQueued.ok, true, 'live steer inbox accepts the same watch contract');
    const live = runtimeApi.consumePendingRuntimeSteersForSession('watch_creator_session', 5)[0];
    assert.equal(live.internalWatchActionPolicy, 'review_only');
    assert.equal(live.internalWatchTargetTaskId, task.id);
    assert.match(live.message, /evidence, not a user command/i);
    runtimeApi.finishLiveRuntime(liveRuntimeId);
    await runtimeApi.flushLiveRuntimePersistence();

    const executePolicyCase = async (policy: 'review_only' | 'recover_same_run' | 'full_rerun_allowed', action: string) => {
      let calls = 0;
      const result = await automationCapabilityExecutor.execute({
        name: 'task_control',
        args: { action, task_id: task.id },
        sessionId: 'watch_creator_session',
        workspacePath: root,
        deps: {
          internalWatchContext: { watchId: watch.id, actionPolicy: policy, targetTaskId: task.id, delivery: 'follow_up' },
          handleTaskControlAction: async () => { calls += 1; return { success: true, action }; },
        },
      } as any);
      return { result, calls };
    };
    let policyCase = await executePolicyCase('review_only', 'rerun');
    assert.equal(policyCase.calls, 0);
    assert.match(String(policyCase.result.result), /internal_watch_policy_denied/);
    policyCase = await executePolicyCase('review_only', 'get');
    assert.equal(policyCase.calls, 1, 'review_only allows inspection');
    policyCase = await executePolicyCase('recover_same_run', 'resume');
    assert.equal(policyCase.calls, 1, 'same-run policy allows a scoped resume');
    policyCase = await executePolicyCase('recover_same_run', 'continue');
    assert.equal(policyCase.calls, 1, 'same-run policy allows a scoped completed-task continuation');
    policyCase = await executePolicyCase('recover_same_run', 'rerun');
    assert.equal(policyCase.calls, 0, 'same-run policy blocks reset');
    policyCase = await executePolicyCase('full_rerun_allowed', 'rerun');
    assert.equal(policyCase.calls, 1, 'explicit full-rerun policy reaches task_control');
    policyCase = await executePolicyCase('full_rerun_allowed', 'delete');
    assert.equal(policyCase.calls, 0, 'full-rerun policy is not an unrestricted task-control bypass');
    let missingIdCalls = 0;
    const missingId = await automationCapabilityExecutor.execute({
      name: 'task_control', args: { action: 'rerun' }, sessionId: 'watch_creator_session', workspacePath: root,
      deps: { internalWatchContext: { watchId: watch.id, actionPolicy: 'full_rerun_allowed', targetTaskId: task.id, delivery: 'follow_up' }, handleTaskControlAction: async () => { missingIdCalls += 1; return { success: true, action: 'rerun' }; } },
    } as any);
    assert.equal(missingIdCalls, 0, 'watch-caused mutation requires explicit task_id');
    assert.match(String(missingId.result), /internal_watch_policy_denied/);

    taskApi.writeToEvidenceBus(task.id, { stepIndex: 0, category: 'finding', value: 'Completion evidence' });
    const completedBeforeContinuation = taskApi.loadTask(task.id)!;
    const continued = taskRouterApi.appendScopedTaskContinuation(completedBeforeContinuation, 'Verify the published artifact link.');
    assert.equal(continued.status, 'queued');
    assert.equal(continued.plan.length, 2);
    assert.equal(continued.plan[0].status, 'done', 'continuation must not reset completed steps');
    assert.equal(continued.continuationHistory?.[0]?.finalSummary, 'Completed successfully.');
    assert.equal(continued.continuationHistory?.[0]?.evidence?.entries?.[0]?.value, 'Completion evidence');
    const reloadedTask = taskApi.loadTask(task.id)!;
    assert.equal(reloadedTask.continuationHistory?.length, 1, 'continuation history survives reload');

    const limitedOriginWatch = { ...watch, origin: { ...watch.origin, sessionId: 'task_tool_limited_origin' }, deliverySessionId: undefined };
    assert.equal(
      runnerApi.resolveWatchDeliverySessionId(limitedOriginWatch, { originatingSessionId: 'fallback_main_session' }),
      'fallback_main_session',
      'tool-limited watch origin must fall through to a valid watched-task owner session',
    );

    const reloaded = storeApi.listInternalWatches({ includeDone: true }).find((item) => item.id === watch.id)!;
    assert.equal(reloaded.actionPolicy, 'review_only', 'safe policy persists across reload');
    console.log('internal watch action-policy regression passed');
  } finally {
    try {
      const runtimeApi = await import('../live-runtime-registry');
      await runtimeApi.flushLiveRuntimePersistence();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
