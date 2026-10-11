import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-brain-budget-'));
  const previousDataDir = process.env.PROMETHEUS_DATA_DIR;
  const previousWorkspaceDir = process.env.PROMETHEUS_WORKSPACE_DIR;
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
  try {
    const { BrainRunner } = await import('./brain-runner');
    const budget = { maxModelCalls: 1, maxInputTokens: 10, modelCalls: 1, inputTokens: 10, hit: 'input_tokens' as const };
    const run = async (fresh: 'missing' | 'fresh' | 'stale') => {
      const runner = new BrainRunner({
        workspacePath: process.env.PROMETHEUS_WORKSPACE_DIR!,
        broadcast: () => undefined,
        handleChat: async (prompt: string, ...args: any[]) => {
          const match = prompt.match(/Brain[\\/]dreams[\\/][^\s`]+-dream\.md/);
          const out = match ? path.join(process.env.PROMETHEUS_WORKSPACE_DIR!, match[0].replace(/[\\/]/g, path.sep)) : '';
          if (fresh !== 'missing' && out) {
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, fresh === 'fresh' ? '# Fresh Dream\n' : '# Stale Dream\n', 'utf8');
            if (fresh === 'stale') fs.utimesSync(out, new Date(0), new Date(0));
          }
          return { type: 'chat', text: 'cut off', toolResults: [], brainRunBudget: budget } as any;
        },
      });
      await (runner as any)._runDream('2099-01-01', 0, { allowForeground: true });
      const dreamDir = path.join(process.env.PROMETHEUS_WORKSPACE_DIR!, 'Brain', 'dreams', '2099-01-01');
      if (!fs.existsSync(dreamDir)) return '';
      const files = fs.readdirSync(dreamDir);
      return fs.readFileSync(path.join(dreamDir, files.find((f) => f.endsWith('.md') && !f.includes('cleanup'))!), 'utf8');
    };
    assert.match(await run('missing'), /Brain run budget reached/, 'missing output is recovered with the cutoff note');
    assert.match(await run('fresh'), /## Run Budget/, 'fresh model artifact records cutoff');
    assert.doesNotMatch(await run('stale'), /## Run Budget/, 'stale artifact is not refreshed or promoted');
    console.log('brain runner budget artifact regression: ok');
  } finally {
    if (previousDataDir === undefined) delete process.env.PROMETHEUS_DATA_DIR; else process.env.PROMETHEUS_DATA_DIR = previousDataDir;
    if (previousWorkspaceDir === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR; else process.env.PROMETHEUS_WORKSPACE_DIR = previousWorkspaceDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
