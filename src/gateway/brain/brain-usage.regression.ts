import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-brain-usage-'));
  const workspace = path.join(root, 'workspace');
  const previousDataDir = process.env.PROMETHEUS_DATA_DIR;
  const previousWorkspaceDir = process.env.PROMETHEUS_WORKSPACE_DIR;
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;

  try {
    const usage = await import('../../providers/model-usage');
    const brainUsage = await import('./brain-usage');
    usage.resetModelUsageIndexForTests();
    brainUsage.resetBrainUsageLedgerForTests();

    const sessionId = 'brain_thought_2099-12-31_23-30';
    const first = brainUsage.beginBrainJobUsage({
      job: 'thought',
      runId: 'thought-run-1',
      date: '2099-12-31',
      sessionId,
      startedAt: '2099-12-31T23:30:00.000Z',
    });
    usage.appendModelUsageEvent({
      provider: 'test-provider',
      model: 'test-model',
      callType: 'chat',
      sessionId,
      agentId: 'main',
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 5,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      totalTokens: 125,
      source: 'provider',
    });
    usage.appendModelUsageEvent({
      provider: 'test-provider',
      model: 'test-model',
      callType: 'chat',
      sessionId,
      agentId: 'main',
      inputTokens: 40,
      outputTokens: 10,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 50,
      source: 'estimated',
    });
    const firstRecord = brainUsage.finishBrainJobUsage(first, {
      outcome: 'success',
      completedAt: '2099-12-31T23:31:00.000Z',
    });

    assert.equal(firstRecord.calls, 2);
    assert.equal(firstRecord.providerReportedCalls, 1);
    assert.equal(firstRecord.estimatedCalls, 1);
    assert.equal(firstRecord.totalTokens, 175);
    assert.ok(firstRecord.totalCostMicros > 0, 'provider pricing should be carried into the Brain record');
    assert.equal(firstRecord.models.length, 1);
    assert.equal(firstRecord.models[0].provider, 'test-provider');
    assert.equal(firstRecord.costBasis, 'mixed');

    // A rerun uses the same stable session ID, so the second snapshot must only
    // include the new provider event rather than charging the first run again.
    const second = brainUsage.beginBrainJobUsage({
      job: 'thought',
      runId: 'thought-run-2',
      date: '2099-12-31',
      sessionId,
      startedAt: '2099-12-31T23:35:00.000Z',
    });
    usage.appendModelUsageEvent({
      provider: 'test-provider',
      model: 'test-model',
      callType: 'chat',
      sessionId,
      agentId: 'main',
      inputTokens: 7,
      outputTokens: 3,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 10,
      source: 'provider',
    });
    const secondRecord = brainUsage.finishBrainJobUsage(second, {
      outcome: 'failed',
      completedAt: '2099-12-31T23:36:00.000Z',
      error: 'artifact check failed',
    });
    assert.equal(secondRecord.calls, 1);
    assert.equal(secondRecord.totalTokens, 10);
    assert.equal(secondRecord.outcome, 'failed');

    const snapshot = brainUsage.getBrainUsageSnapshot({ limit: 10 });
    assert.equal(snapshot.records.length, 2);
    assert.equal(snapshot.summary.runs, 2);
    assert.equal(snapshot.summary.byJob.thought.runs, 2);
    assert.equal(snapshot.summary.byJob.thought.failedRuns, 1);
    assert.equal(snapshot.summary.byJob.thought.totalTokens, 185);
    assert.equal(snapshot.summary.byDate[0].date, '2099-12-31');

    console.log('brain usage regression passed');
  } finally {
    if (previousDataDir === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataDir;
    if (previousWorkspaceDir === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR;
    else process.env.PROMETHEUS_WORKSPACE_DIR = previousWorkspaceDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
