import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-brain-scheduled-chat-'));
  const workspace = path.join(root, 'workspace');
  const previousDataDir = process.env.PROMETHEUS_DATA_DIR;
  const previousWorkspaceDir = process.env.PROMETHEUS_WORKSPACE_DIR;
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;

  try {
    const { BrainRunner, createBrainHandleChatAdapter } = await import('./brain-runner');
    const forwardedChatArgs: any[][] = [];

    const bridge = createBrainHandleChatAdapter(async (...args: any[]) => {
      forwardedChatArgs.push(args);

      return { type: 'chat', text: '', toolResults: [] };
    });
    const runner = new BrainRunner({
      workspacePath: workspace,
      broadcast: () => undefined,
      handleChat: bridge,
    });
    const date = '2026-09-03';
    const windowEnd = new Date('2026-09-03T12:00:00.000Z');
    const windowStart = new Date(windowEnd.getTime() - 6 * 60 * 60 * 1000);

    // Invoke the same scheduled runner methods used by the 15-minute ticker.
    // The fake router intentionally returns no artifacts: this test is about
    // the BrainRunner -> adapter -> handleChat runtime contract, not provider
    // output or artifact verification.
    await (runner as any)._runThought(windowStart, windowEnd, '2099-01-01', 1, { allowForeground: true });
    await (runner as any)._runDream(date, 0, { allowForeground: true });
    await (runner as any)._runDreamCleanup(date, { allowForeground: true });

    assert.equal(forwardedChatArgs.length, 3, 'Thought, Dream, and Dream cleanup must each reach handleChat');
    const [thought, dream, cleanup] = forwardedChatArgs;
    assert.equal(thought[7], 'cron');
    const { getLocalDateStr, getWindowLabel, getThoughtArtifactKey } = await import('./brain-state');
    assert.equal(thought[1], `brain_thought_${getLocalDateStr(windowStart)}_${getWindowLabel(windowStart)}`, 'session date and name must use the same local window start even when caller date differs');
    assert.equal(getThoughtArtifactKey(windowStart).file, `thoughts/${getLocalDateStr(windowStart)}/${getWindowLabel(windowStart)}-thought.md`);
    const previousTZ = process.env.TZ;
    for (const tz of ['America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      const instant = new Date('2026-10-11T01:30:00Z');
      const key = getThoughtArtifactKey(instant);
      assert.equal(key.date, getLocalDateStr(instant));
      assert.equal(key.label, getWindowLabel(instant));
      assert.equal(key.file, `thoughts/${key.date}/${key.label}-thought.md`);
    }
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
    assert.ok(dream[8].includes('skill_curator'), 'Dream must expose the curator action tool');
    assert.ok(cleanup[8].includes('skill_curator'), 'cleanup must expose the curator action tool');
    const { buildTools } = await import('../tool-builder');
    const surface = buildTools({ getMCPManager: () => null, skipDynamicExtensionTools: true }, new Set(['skills']), { allowNativeWorkspaceTools: true });
    const curatorTool = surface.find((tool: any) => tool.function?.name === 'skill_curator');
    assert.ok(curatorTool, 'skills category must actually build a model-visible curator tool, not just allowlist it');
    assert.ok(curatorTool.function.parameters.properties.action.enum.includes('restore'));
    assert.equal(dream[7], 'cron');
    assert.equal(cleanup[7], 'cron');
    assert.equal(thought[13]?.brainThoughtRuntime, true, 'Thought must opt into the Brain thought runtime');
    assert.equal(thought[13]?.allowNativeWorkspaceTools, true, 'Thought must receive native workspace tools');
    assert.equal(dream[13]?.brainThoughtRuntime, undefined, 'Dream must not use the Thought-only runtime flag');
    assert.equal(dream[13]?.allowNativeWorkspaceTools, true, 'Dream must receive native workspace tools');
    assert.equal(cleanup[13]?.brainThoughtRuntime, undefined, 'Dream cleanup must not use the Thought-only runtime flag');
    assert.equal(cleanup[13]?.allowNativeWorkspaceTools, true, 'Dream cleanup must receive native workspace tools');
    for (const [name, args] of [['Thought', thought], ['Dream', dream], ['Dream cleanup', cleanup]] as const) {
      assert.ok(String(args[13]?.runtimeId || '').trim(), `${name} must forward its registered runtime id`);
    }
    assert.deepEqual(dream[13]?.brainRunBudget, {}, 'Dream must opt into the hard shared run budget');
    assert.deepEqual(cleanup[13]?.brainRunBudget, {}, 'Dream cleanup must opt into the hard shared run budget');
    assert.equal(new Set([thought[13]?.runtimeId, dream[13]?.runtimeId, cleanup[13]?.runtimeId]).size, 3, 'scheduled runs must not share runtime ids');

    runner.stop('regression_complete');
    console.log('brain scheduled chat integration regression: ok');
  } finally {
    // Transcript writes are asynchronous; let them settle before removing fixtures.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (previousDataDir === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataDir;
    if (previousWorkspaceDir === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR;
    else process.env.PROMETHEUS_WORKSPACE_DIR = previousWorkspaceDir;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
