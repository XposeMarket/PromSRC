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
    await (runner as any)._runThought(windowStart, windowEnd, date, 1, { allowForeground: true });
    await (runner as any)._runDream(date, 0, { allowForeground: true });
    await (runner as any)._runDreamCleanup(date, { allowForeground: true });

    assert.equal(forwardedChatArgs.length, 3, 'Thought, Dream, and Dream cleanup must each reach handleChat');
    const [thought, dream, cleanup] = forwardedChatArgs;
    assert.equal(thought[7], 'cron');
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
    assert.equal(new Set([thought[13]?.runtimeId, dream[13]?.runtimeId, cleanup[13]?.runtimeId]).size, 3, 'scheduled runs must not share runtime ids');

    runner.stop('regression_complete');
    console.log('brain scheduled chat integration regression: ok');
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
