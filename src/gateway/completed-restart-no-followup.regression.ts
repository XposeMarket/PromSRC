import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-completed-restart-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;
  try {
    const session = await import('./session');
    const lifecycle = await import('./lifecycle');
    const boot = await import('./boot');
    const recovery = await import('./runtime-recovery');
    const sid = 'completed_turn_before_restart';
    session.addMessage(sid, { role: 'user', content: 'Fix the mobile app', timestamp: Date.now() - 2000 });
    session.addMessage(sid, { role: 'assistant', content: 'Done and verified.', timestamp: Date.now() - 1000 });
    lifecycle.writeRestartContext({
      reason: 'manual',
      timestamp: Date.now(),
      previousSessionId: sid,
      summary: 'gateway restarted after the answer completed',
    });
    assert.deepEqual(recovery.listHotRestartMainChatRecoveries(), []);
    const result = await boot.runBootMd(root, async () => {
      throw new Error('completed turn must not trigger a BOOT model response');
    });
    assert.equal(result.status, 'ran');
    assert.deepEqual(session.getHistory(sid).map((message) => message.content), [
      'Fix the mobile app', 'Done and verified.',
    ], 'completed chat transcript must not gain a restart follow-up');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
