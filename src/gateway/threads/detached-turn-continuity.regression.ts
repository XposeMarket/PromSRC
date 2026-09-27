import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-detached-continuity-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function main(): Promise<void> {
  try {
    const { readDurableDetachedTurns, saveDurableDetachedTurn, removeDurableDetachedTurn } = await import('./detached-turn-continuity');
    const turn = { ownerSessionId: 'owner', targetSessionId: 'peer', prompt: 'Perform requested work', queuedAt: Date.now(), steers: [], notifyOnComplete: true, notifyOnFailure: true };
    saveDurableDetachedTurn(turn);
    assert.deepEqual(readDurableDetachedTurns(), [turn], 'accepted queued turn survives a fresh disk read');
    saveDurableDetachedTurn({ ...turn, steers: ['Correction before start'] });
    assert.deepEqual(readDurableDetachedTurns()[0]?.steers, ['Correction before start'], 'pre-start correction is durable');
    removeDurableDetachedTurn(turn.targetSessionId, turn.queuedAt - 1);
    assert.equal(readDurableDetachedTurns().length, 1, 'an older completion cannot erase a newer queued turn');
    removeDurableDetachedTurn(turn.targetSessionId, turn.queuedAt);
    assert.deepEqual(readDurableDetachedTurns(), [], 'settled or cancelled turn is acknowledged');

    const peerOps = await import('./thread-ops');
    const launched: string[] = [];
    for (const targetSessionId of ['peer-one', 'peer-two']) {
      saveDurableDetachedTurn({ ...turn, targetSessionId, queuedAt: Date.now(), prompt: `Work in ${targetSessionId}` });
    }
    const count = peerOps.resumeDurableDetachedTurns({
      runInteractiveTurn: async (_prompt: string, sessionId: string) => {
        launched.push(sessionId);
        return { text: `Completed ${sessionId}` };
      },
    });
    assert.equal(count, 2, 'startup drains both queued peer sessions');
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(launched.sort(), ['peer-one', 'peer-two']);
    assert.deepEqual(readDurableDetachedTurns(), [], 'registered peer turns hand off their queue receipts');
    const { listLiveRuntimes } = await import('../live-runtime-registry');
    assert.equal(listLiveRuntimes().filter((item) => item.kind === 'main_chat'
      && (item.sessionId === 'peer-one' || item.sessionId === 'peer-two')).length, 0,
    'both peer execution owners finish without leaking runtime registrations');
    console.log('detached turn continuity regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
