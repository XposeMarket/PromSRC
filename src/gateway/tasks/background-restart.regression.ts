import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getConfig } from '../../config/config';
import { persistBackgroundSpawnReceipt } from './background-spawn-continuity';

async function child(mode: string, dir: string): Promise<void> {
  getConfig().getConfigDir = () => dir;
  const runner = await import('./task-runner');
  const now = Date.now();
  if (mode === 'write') {
    for (const [id, state, owner, result, error] of [
      ['done', 'completed', 'owner-A', 'finished result', ''],
      ['failed', 'failed', 'owner-A', '', 'original failure'],
      ['running', 'in_progress', 'owner-A', '', ''],
      ['cancelled', 'failed', 'owner-A', '', 'Aborted by operator.'],
      ['other', 'in_progress', 'owner-B', '', ''],
    ]) persistBackgroundSpawnReceipt({ id, state, spawnerSessionId: owner, startedAt: now, result, error, joinPolicy: 'best_effort_merge', timeoutMs: 1234, providerId: 'openai_codex', model: 'test-model' } as any);
    persistBackgroundSpawnReceipt({ id: 'safe', spawnerSessionId: 'owner-C', state: 'completed', startedAt: now, promptPreview: 'password=hunter2', result: `api_key=privatekey ${'x'.repeat(12000)}`, error: 'Bearer privatebearer' });
    // Hard termination: no shutdown hooks, no automatic resume callback.
    process.exit(73);
  }
  assert.equal(runner.backgroundStatus('done')?.result, 'finished result');
  assert.equal(runner.backgroundStatus('failed')?.error, 'original failure');
  assert.equal(runner.backgroundStatus('running')?.state, 'failed');
  assert.match(runner.backgroundStatus('running')?.error || '', /interrupt.*restart/i);
  assert.equal(runner.backgroundStatus('cancelled')?.error, 'Aborted by operator.');
  assert.equal(runner.backgroundStatus('done')?.model, 'test-model');
  assert.equal(runner.backgroundStatus('done')?.joinPolicy, 'best_effort_merge');
  assert.equal(runner.backgroundStatus('done')?.timeoutMs, 1234);
  const stored = fs.readFileSync(path.join(dir, 'background-spawn-continuity.json'), 'utf8');
  assert.doesNotMatch(stored, /hunter2|privatekey|privatebearer/);
  assert.ok((runner.backgroundStatus('safe')?.result?.length || 0) <= 8000);
  assert.equal(runner.backgroundStatus('done')?.backgroundSessionId, 'background_done');
  assert.equal(runner.backgroundStatus('done')?.stream?.active, false);
  assert.equal((runner.backgroundStatus as any)('other', 'owner-A'), null);
  assert.deepEqual((runner.listBackgroundStatuses as any)('owner-A').map((s: any) => s.id).sort(), ['cancelled', 'done', 'failed', 'running']);
  assert.equal((runner.backgroundAbort as any)('other', 'owner-A').ok, false);
  assert.equal(runner.backgroundStatus('other')?.spawnerSessionId, 'owner-B');
  assert.equal(runner.backgroundAbort('done').ok, false);
  assert.equal(runner.backgroundSteer('done', 'reopen').queued, false);
  assert.equal(await runner.backgroundJoin({ backgroundId: 'other', spawnerSessionId: 'owner-A' }), null);
  assert.equal((await runner.backgroundJoin({ backgroundId: 'done' }))?.result, 'finished result');
  assert.equal((await runner.backgroundJoin({ backgroundId: 'done' }))?.merged, false);
  (runner as any).reloadBackgroundRegistry();
  assert.equal(runner.backgroundStatus('cancelled')?.state, 'failed');
  assert.equal(runner.listActiveBackgroundIdsForSession('owner-A').length, 0);
  assert.equal((await runner.backgroundWait({ backgroundId: 'other', spawnerSessionId: 'owner-A', timeoutMs: 1 })).statuses.length, 0);
  if (mode !== 'live') return;
  const resolves: Array<(value: string) => void> = [];
  runner.setBackgroundAgentDeps({ handleChat: async () => new Promise<string>((resolve) => resolves.push(resolve)), broadcastWS: () => {} });
  const a = runner.backgroundSpawn({ prompt: 'mock A', spawnerSessionId: 'owner-A', providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol' });
  const b = runner.backgroundSpawn({ prompt: 'mock B', spawnerSessionId: 'owner-B', providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol' });
  for (let i = 0; resolves.length < 2 && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(resolves.length, 2);
  assert.equal(runner.backgroundAbort(b.id, 'owner-A').ok, false);
  assert.equal(runner.backgroundAbort(a.id, 'owner-A').ok, true);
  assert.equal(runner.backgroundStatus(b.id)?.state, 'in_progress', 'A abort must not cancel B');
  resolves.forEach((resolve) => resolve('mock complete'));
  await runner.backgroundJoin({ backgroundId: b.id });
  await runner.backgroundJoin({ backgroundId: a.id });
  assert.equal(runner.backgroundStatus(a.id)?.state, 'failed', 'late completion cannot reopen cancellation');
  assert.equal(runner.backgroundStatus(b.id)?.state, 'completed');
  assert.equal(runner.backgroundSteer(b.id, 'reopen').queued, false);
}

if (process.argv[2]) {
  child(process.argv[2], process.argv[3]).then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'background-restart-'));
  try {
    for (const [mode, expected] of [['write', 73], ['read', 0], ['read', 0], ['live', 0]] as const) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', __filename, mode, dir], { encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, expected, `${mode}: ${result.stdout}\n${result.stderr}`);
    }
    console.log('background restart hard-exit regression passed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
