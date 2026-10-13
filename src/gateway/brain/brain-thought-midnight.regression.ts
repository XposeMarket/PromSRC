import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Regression: a Thought whose window starts before local midnight but finishes
// after it is stored under the previous local day. The eligibility check must
// still see it, otherwise a new Thought runs on every 15-minute tick overnight.
async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-brain-midnight-'));
  const prevData = process.env.PROMETHEUS_DATA_DIR;
  const prevWs = process.env.PROMETHEUS_WORKSPACE_DIR;
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
  try {
    const { BrainRunner } = await import('./brain-runner');
    const { getThoughtArtifactKey, getBrainDir } = await import('./brain-state');
    const runner = new BrainRunner({
      workspacePath: process.env.PROMETHEUS_WORKSPACE_DIR!,
      broadcast: () => undefined,
      handleChat: async () => ({ type: 'chat', text: '', toolResults: [] }) as any,
    }) as any;

    const windowStart = new Date(2099, 0, 1, 22, 30); // local 22:30 day 1
    const windowEnd = new Date(2099, 0, 2, 2, 30);    // local 02:30 day 2
    const completed = new Date(2099, 0, 2, 2, 35);
    const key = getThoughtArtifactKey(windowStart);
    const file = path.join(getBrainDir(), key.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# Thought\n', 'utf8');

    const state = {
      lastThoughtAt: completed.toISOString(),
      lastThoughtWindowEndAt: windowEnd.toISOString(),
      lastThoughtStatus: 'success',
      lastThoughtAttemptAt: completed.toISOString(),
    };
    // Avoid Dream-hour gating in the probe.
    runner._isDreamSoon = () => false;
    runner._isDreamEligible = () => false;

    const fifteenLater = new Date(completed.getTime() + 15 * 60 * 1000);
    assert.equal(runner._isThoughtEligible(fifteenLater, state), null,
      'cross-midnight Thought artifact must count; no re-run 15 minutes later');

    const sixLater = new Date(windowEnd.getTime() + 6 * 60 * 60 * 1000 + 60_000);
    const due = runner._isThoughtEligible(sixLater, state);
    assert.ok(due, 'next Thought is still due after the 6h interval');
    assert.equal(due.windowStart.toISOString(), windowEnd.toISOString(),
      'next window resumes from the prior coverage cursor, not now-6h');

    fs.rmSync(file);
    const missing = runner._isThoughtEligible(fifteenLater, state);
    assert.ok(missing, 'a genuinely missing artifact still triggers a fresh Thought');
    console.log('brain thought midnight regression: ok');
  } finally {
    if (prevData === undefined) delete process.env.PROMETHEUS_DATA_DIR; else process.env.PROMETHEUS_DATA_DIR = prevData;
    if (prevWs === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR; else process.env.PROMETHEUS_WORKSPACE_DIR = prevWs;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
