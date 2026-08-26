import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-auto-settle-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const configApi = await import('../config/config');
    const sessionApi = await import('./session');
    const taskApi = await import('./tasks/task-store');
    const runtimeApi = await import('./live-runtime-registry');
    const approvalApi = await import('./verification-flow');
    const questionApi = await import('./prometheus-questions');
    const supervisionApi = await import('./threads/thread-supervision');
    const settlementApi = await import('./session-settlement');
    const autoApi = await import('./auto-settle');

    const now = Date.UTC(2026, 7, 9, 12, 0, 0);
    assert.equal(autoApi.getAutoSettleSettings(now).afterDays, 0, 'new installs default to Never');

    for (const days of [7, 14, 30, 90]) {
      const preset = autoApi.resolveAutoSettleUpdate({ afterDays: days, activationMode: 'start_now' }, now);
      assert.equal(preset.settings.afterDays, days);
      assert.equal(preset.settings.afterMs, days * autoApi.DAY_MS);
      assert.equal(preset.settings.activationAt, now);
    }

    const customStart = autoApi.resolveAutoSettleUpdate({
      afterDays: 'custom',
      customDate: '2026-08-01',
      customDateOffsetMinutes: 0,
      activationMode: 'start_now',
    }, now);
    assert.equal(customStart.settings.customDate, '2026-08-01');
    assert.equal(customStart.settings.customCutoffAt, Date.UTC(2026, 7, 1));
    assert.equal(customStart.applyExisting, false);
    assert.equal(customStart.settings.activationAt, now);

    const customApply = autoApi.resolveAutoSettleUpdate({
      afterDays: 'custom',
      customDate: '2026-08-01',
      customDateOffsetMinutes: 0,
      activationMode: 'apply_existing',
    }, now);
    assert.equal(customApply.applyExisting, true);
    assert.equal(customApply.immediateCutoffAt, Date.UTC(2026, 7, 1));
    assert.equal(customApply.settings.activationAt, null);
    assert.equal(autoApi.customDateToCutoffAt('2026-08-01', 300), Date.UTC(2026, 7, 1, 5));
    assert.throws(() => autoApi.resolveAutoSettleUpdate({ afterDays: 'custom', customDate: '2026-08-09', customDateOffsetMinutes: 0 }, now));
    assert.throws(() => autoApi.resolveAutoSettleUpdate({ afterDays: 'custom', customDate: '2026-08-10', customDateOffsetMinutes: 0 }, now));

    configApi.getConfig().updateConfig({ session: { ...(configApi.getConfig().getConfig() as any).session, autoSettleAfterDays: 14, autoSettleAfterMs: 14 * autoApi.DAY_MS } } as any);
    assert.equal(autoApi.getAutoSettleSettings(now).afterDays, 14, 'policy persists through ConfigManager');
    configApi.getConfig().updateConfig({ session: { ...(configApi.getConfig().getConfig() as any).session, autoSettleAfterDays: 0, autoSettleAfterMs: 0 } } as any);

    const oldAt = now - 8 * autoApi.DAY_MS;
    const addOldSession = (id: string): void => {
      sessionApi.addMessage(id, { role: 'user', content: `keep-${id}`, timestamp: oldAt });
      sessionApi.addMessage(id, { role: 'assistant', content: `reply-${id}`, timestamp: oldAt + 1 });
      const session = sessionApi.getSession(id);
      session.lastActiveAt = oldAt;
      sessionApi.flushSession(id);
    };

    const targetId = 'regression_settle_target';
    addOldSession(targetId);
    const before = JSON.parse(fs.readFileSync(path.join(root, '.prometheus', 'sessions', `${targetId}.json`), 'utf-8'));
    const settings = { afterDays: 7, afterMs: 7 * autoApi.DAY_MS, customDate: null, customCutoffAt: null, activationAt: null, mode: 'preset' as const };
    const first = await autoApi.runAutoSettleSweep({ settingsOverride: settings, reason: 'regression', maxBatches: 1 });
    assert.equal(first.settled, 1);
    const after = JSON.parse(fs.readFileSync(path.join(root, '.prometheus', 'sessions', `${targetId}.json`), 'utf-8'));
    assert.deepEqual(after.history, before.history, 'auto-settle does not mutate content');
    assert.equal(after.settledAt > 0, true);
    const repeat = await autoApi.runAutoSettleSweep({ settingsOverride: settings, reason: 'regression_repeat', maxBatches: 1 });
    assert.equal(repeat.settled, 0, 'repeated sweeps are idempotent');
    settlementApi.unsettleSessionSafely(targetId);
    assert.equal(sessionApi.getSession(targetId).settledAt, undefined, 'manual unsettle remains available');

    // A bounded run reads one sentinel row beyond its work budget so it can
    // report truncation without offset-pagination races. The retry then
    // drains the remainder through the same durable settledAt transition.
    const pagedIds = Array.from({ length: 55 }, (_, index) => `regression_paging_${index}`);
    for (const id of pagedIds) addOldSession(id);
    const pageFirst = await autoApi.runAutoSettleSweep({ settingsOverride: settings, reason: 'pagination-first', maxBatches: 1 });
    assert.equal(pageFirst.scanned, 50);
    assert.equal(pageFirst.truncated, true);
    const pageSecond = await autoApi.runAutoSettleSweep({ settingsOverride: settings, reason: 'pagination-retry', maxBatches: 1 });
    assert.equal(pageSecond.truncated, false);
    assert.equal(pagedIds.filter((id) => sessionApi.getSession(id).settledAt).length, pagedIds.length);
    assert.equal(autoApi.getAutoSettleStatus().lastRun?.runId, pageSecond.runId, 'last-run summary survives the completed sweep');

    const pinnedId = 'regression_settle_pinned';
    addOldSession(pinnedId);
    sessionApi.setSessionPinned(pinnedId, true);
    const pinnedRun = await autoApi.runAutoSettleSweep({ settingsOverride: settings, reason: 'pinned', maxBatches: 1 });
    assert.equal(pinnedRun.skipped.pinned_chat > 0, true);
    assert.equal(sessionApi.getSession(pinnedId).settledAt, undefined);
    sessionApi.setSessionPinned(pinnedId, false);

    const runtimeId = runtimeApi.registerLiveRuntime({ kind: 'main_chat', label: 'auto-settle protected runtime', sessionId: targetId, source: 'regression' });
    const runtimeBlockers = settlementApi.getSessionSettlementBlockers(targetId, {
      automatic: true,
      runtimeRecords: runtimeApi.listLiveRuntimes(),
      cutoffAt: now,
      expectedLastActiveAt: oldAt,
    });
    assert.equal(runtimeBlockers.some((blocker) => blocker.code === 'active_runtime'), true);
    runtimeApi.finishLiveRuntime(runtimeId);

    const taskSession = 'regression_settle_task';
    addOldSession(taskSession);
    const task = taskApi.createTask({ title: 'protected task', prompt: 'keep', sessionId: taskSession, channel: 'web', plan: [] });
    const taskBlockers = settlementApi.getSessionSettlementBlockers(taskSession, { automatic: true, cutoffAt: now, expectedLastActiveAt: oldAt });
    assert.equal(taskBlockers.some((blocker) => blocker.code === 'active_task'), true);
    taskApi.updateTaskStatus(task.id, 'complete');

    const approvalSession = 'regression_settle_approval';
    addOldSession(approvalSession);
    approvalApi.getApprovalQueue().create({ sessionId: approvalSession, toolName: 'test_tool', toolArgs: {}, action: 'test approval', policyTier: 'commit', riskScore: 1, affectedSystems: [] });
    const approvalBlockers = settlementApi.getSessionSettlementBlockers(approvalSession, { automatic: true, cutoffAt: now, expectedLastActiveAt: oldAt });
    assert.equal(approvalBlockers.some((blocker) => blocker.code === 'pending_approval'), true);

    const questionSession = 'regression_settle_question';
    addOldSession(questionSession);
    const question = questionApi.createPrometheusQuestionPayload({ sessionId: questionSession, questions: [{ id: 'q', question: 'Continue?' }] });
    questionApi.getPrometheusQuestionQueue().create(question);
    const questionBlockers = settlementApi.getSessionSettlementBlockers(questionSession, { automatic: true, cutoffAt: now, expectedLastActiveAt: oldAt });
    assert.equal(questionBlockers.some((blocker) => blocker.code === 'pending_question'), true);

    const projectSession = 'regression_settle_project';
    addOldSession(projectSession);
    const projectBlockers = settlementApi.getSessionSettlementBlockers(projectSession, { automatic: true, cutoffAt: now, expectedLastActiveAt: oldAt, projectSessionIds: new Set([projectSession]) });
    assert.equal(projectBlockers.some((blocker) => blocker.code === 'project_session'), true);
    const scheduledBlockers = settlementApi.getSessionSettlementBlockers(projectSession, { automatic: true, cutoffAt: now, expectedLastActiveAt: oldAt, scheduledSessionIds: new Set([projectSession]) });
    assert.equal(scheduledBlockers.some((blocker) => blocker.code === 'scheduled_session'), true);

    const supervisionOwner = 'regression_settle_supervision_owner';
    const supervisionTarget = 'regression_settle_supervision_target';
    addOldSession(supervisionOwner);
    addOldSession(supervisionTarget);
    supervisionApi.createThreadSupervision({ ownerSessionId: supervisionOwner, targetSessionId: supervisionTarget, objective: 'protect' });
    const supervisionBlockers = settlementApi.getSessionSettlementBlockers(supervisionTarget, { automatic: true, cutoffAt: now, expectedLastActiveAt: oldAt });
    assert.equal(supervisionBlockers.some((blocker) => blocker.code === 'managed_thread'), true);

    // Activation baselines prevent old chats from being immediately eligible.
    const baselineId = 'regression_settle_activation_baseline';
    addOldSession(baselineId);
    const baselineSettings = { ...settings, activationAt: now };
    const baselineRun = await autoApi.runAutoSettleSweep({ settingsOverride: baselineSettings, reason: 'baseline', maxBatches: 1 });
    assert.equal(baselineRun.settled, 0);
    assert.equal(baselineRun.skipped.recent_activity || 0, 0);

    // Two callers share one in-flight run rather than racing session writes.
    const [runA, runB] = await Promise.all([
      autoApi.runAutoSettleSweep({ settingsOverride: settings, reason: 'concurrent-a', maxBatches: 1 }),
      autoApi.runAutoSettleSweep({ settingsOverride: settings, reason: 'concurrent-b', maxBatches: 1 }),
    ]);
    assert.equal(runA.runId, runB.runId);

    console.log('auto-settle regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
