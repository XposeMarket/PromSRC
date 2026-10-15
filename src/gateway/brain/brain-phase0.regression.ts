import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-brain-phase0-'));
  const previousData = process.env.PROMETHEUS_DATA_DIR;
  const previousWorkspace = process.env.PROMETHEUS_WORKSPACE_DIR;
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
  let runner: any;
  try {
    const { loadLatestState, saveLatestState, getBrainDir } = await import('./brain-state');
    const { BrainRunner } = await import('./brain-runner');
    const fresh = loadLatestState();
    assert.equal(fresh.thoughtEnabled, false);
    assert.equal(fresh.dreamEnabled, false);
    assert.equal(fresh.cleanupEnabled, false);
    const latestPath = path.join(getBrainDir(), 'state', 'latest.json');
    fs.mkdirSync(path.dirname(latestPath), { recursive: true });
    fs.writeFileSync(latestPath, JSON.stringify({ thoughtEnabled: true, dreamEnabled: true, lastThoughtAt: '2026-10-10T12:00:00.000Z', thoughtModel: 'openai/gpt-4o' }));
    const migrated = loadLatestState();
    assert.equal(migrated.thoughtEnabled, false);
    assert.equal(migrated.dreamEnabled, false);
    assert.equal(migrated.cleanupEnabled, false);
    assert.equal(migrated.optInVersion, 1);
    assert.equal(migrated.lastThoughtAt, '2026-10-10T12:00:00.000Z');
    assert.equal(migrated.thoughtModel, 'openai/gpt-4o');
    assert.equal(JSON.parse(fs.readFileSync(latestPath, 'utf8')).optInVersion, 1);
    let calls = 0;
    runner = new BrainRunner({ workspacePath: process.env.PROMETHEUS_WORKSPACE_DIR!, broadcast: () => {}, handleChat: async () => { calls++; throw new Error('disabled provider call'); } });
    runner.start();
    assert.equal(runner.ticker, null, 'disabled Brain must not schedule ticks');
    runner._getPendingDreamDate = () => { throw new Error('disabled eligibility/context assembly'); };
    await runner._tick();
    assert.equal(calls, 0);
    // Restore the eligibility helper before explicitly enabling the scheduler.
    delete runner._getPendingDreamDate;
    runner.setConfig({ thoughtEnabled: true });
    assert.equal(loadLatestState().thoughtEnabled, true);
    assert.equal(loadLatestState().dreamEnabled, false);
    assert.ok(runner.ticker);
    runner.setConfig({ thoughtEnabled: false, cleanupEnabled: true });
    assert.equal(loadLatestState().cleanupEnabled, true);
    runner.setConfig({ cleanupEnabled: false });
    assert.equal(runner.ticker, null);
    saveLatestState({ ...loadLatestState(), dreamEnabled: true, optInVersion: 1 });
    assert.equal(loadLatestState().dreamEnabled, true, 'marked opt-in survives reload');
    // Prompt regression exercises the actual prompt helper separately; guard its
    // source here as well so capsule/carry-forward reintroduction is obvious.
    const promptSource = fs.readFileSync(path.join(process.cwd(), 'src/gateway/prompt-context.ts'), 'utf8');
    assert.doesNotMatch(promptSource, /buildBrainCapsuleContext\s*\(/);
    assert.doesNotMatch(promptSource, /readCarryForwardForPrompt\s*\(/);
    assert.doesNotMatch(promptSource, /readBootBrainActivity\s*\(workspacePath\)/);
    const { processIntradayNotes, processIntradayNotesForPrompt } = await import('../prompt-context');
    const legacyCarry = '<!-- BRAIN_CARRY_FORWARD_START -->\nlegacy carry-forward\n<!-- BRAIN_CARRY_FORWARD_END -->';
    const liveNote = '### [TASK] 2026-10-14T16:00:00.000Z #n_live (info)\nPreserve this live note.';
    const compactNotes = processIntradayNotes(`${legacyCarry}\n\n${liveNote}`);
    const promptNotes = processIntradayNotesForPrompt(process.env.PROMETHEUS_WORKSPACE_DIR!, `${legacyCarry}\n\n${liveNote}`);
    for (const notes of [compactNotes, promptNotes]) {
      assert.doesNotMatch(notes, /BRAIN_CARRY_FORWARD|legacy carry-forward/i);
      assert.match(notes, /Preserve this live note/);
    }
    console.log('Brain Phase 0 regression: defaults, migration, scheduler, opt-in, no prompt injection, and legacy carry strip PASS');
  } finally {
    runner?.stop();
    if (previousData === undefined) delete process.env.PROMETHEUS_DATA_DIR; else process.env.PROMETHEUS_DATA_DIR = previousData;
    if (previousWorkspace === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR; else process.env.PROMETHEUS_WORKSPACE_DIR = previousWorkspace;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
