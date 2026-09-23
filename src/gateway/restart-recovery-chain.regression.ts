import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Live failure 2026-09-22 17:52: a main-chat turn was resumed after a restart,
// then interrupted by a SECOND restart. The resumed runtime had inherited
// `recovery: 'chat_checkpointed'` + `recoveredAt` from the runtime it replaced,
// so isRuntimeRecoverableAfterRestart() said "already handled" and shutdown
// deleted it (restart_skipped_completed). The post-restart reply was never
// produced; mobile showed the session preview but no message in the thread.
async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-restart-chain-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const runtimes = await import('./live-runtime-registry');

    // What the FIRST recovery left on the original runtime's recoveryData.
    const inherited = {
      message: 'All good on my end but how was the context return upon restart?',
      origin: { channel: 'mobile' },
      restartEpoch: 1790113192244,
      interruptReason: 'gateway_restart',
      recovery: 'chat_checkpointed',
      recoveredAt: 1790113201135,
      restartRecoveryAttempts: 1,
    };

    const stripped = runtimes.stripInheritedRecoveryMarks(inherited);
    assert.equal(stripped.message, inherited.message, 'the user request must survive');
    assert.deepEqual(stripped.origin, inherited.origin, 'origin must survive');
    assert.equal(stripped.restartRecoveryAttempts, 1, 'the attempt counter is the loop guard and must survive');
    for (const key of ['recovery', 'recoveredAt', 'restartEpoch', 'interruptReason']) {
      assert.equal(key in stripped, false, `${key} must not be inherited by the replacement runtime`);
    }

    // The replacement runtime, registered the way retriggerInterruptedMainChat does.
    const resumedId = runtimes.registerLiveRuntime({
      kind: 'main_chat',
      label: 'Main chat (restart recovery)',
      sessionId: 'restart_chain_session',
      recoveryPolicy: 'mark_interrupted',
      recoveryData: { ...stripped, recoveredFromRuntimeId: 'original', restartRecoveryAttempts: 2 },
    });
    runtimes.updateLiveRuntimeCheckpoint(resumedId, { event: 'tool_call', toolName: 'workspace_run' });

    const resumed = runtimes.listLiveRuntimes().find((r: any) => r.id === resumedId);
    assert.equal(runtimes.isRuntimeRecoverableAfterRestart(resumed as any), true,
      'a resumed turn that is still running must be recoverable');

    // Second restart hits the resumed turn mid-work.
    const interrupted = runtimes.markActiveRuntimesInterrupted('gateway_restart');
    assert.deepEqual(interrupted.map((r) => r.id), [resumedId],
      'the resumed turn must be interrupted for recovery, not deleted as completed');
    const durable = runtimes.listDurableRuntimes().find((r) => r.id === resumedId);
    assert.ok(durable, 'the resumed turn must stay in the durable ledger');
    assert.equal(durable?.status, 'interrupted');
    assert.equal(runtimes.listInterruptedRuntimes().some((r) => r.id === resumedId), true,
      'post-restart recovery must see the resumed turn');

    // Control: the raw inherited shape (pre-fix behaviour) is what got deleted.
    assert.equal(
      runtimes.isRuntimeRecoverableAfterRestart({ status: 'running', recoveryData: inherited } as any),
      false,
      'sanity: inherited recovery marks do make a runtime look already-handled',
    );

    // Wiring guard: the retrigger path must actually use the helper. Without
    // this, deleting the call in chat.router.ts would leave the test green.
    const routerSource = fs.readFileSync(path.join(__dirname, 'routes', 'chat.router.ts'), 'utf8');
    const retriggerStart = routerSource.indexOf('export function retriggerInterruptedMainChat(');
    assert.ok(retriggerStart >= 0, 'retriggerInterruptedMainChat must exist');
    const retriggerBody = routerSource.slice(retriggerStart, retriggerStart + 4000);
    assert.match(retriggerBody, /\.\.\.stripInheritedRecoveryMarks\(recoveryData\)/,
      'retriggerInterruptedMainChat must strip inherited recovery marks before registering the replacement runtime');
    assert.doesNotMatch(retriggerBody, /recoveryData:\s*\{\s*\.\.\.recoveryData,/,
      'retriggerInterruptedMainChat must not spread raw recoveryData into the replacement runtime');

    console.log('restart-recovery-chain regression: ok');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
