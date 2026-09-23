// A turn that spans gateway restarts runs as several runtimes (original, then
// one recovery runtime per restart). Each segment records a working-context
// packet. They used to be keyed on the per-segment runtime id, so a turn that
// survived two restarts produced three packets and evicted unrelated context
// from the 5-entry bounded list, and the model lost track of what it had done
// before the restart (for example, that it had itself triggered the restart).
//
// Recovery now keys every segment on the ROOT turn id so segments merge into a
// single packet. This test pins both halves: the storage merge behaviour and
// the wiring in the recovery path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-turnctx-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;

async function main() {
  const session = await import('./session') as any;
  const registry = await import('./live-runtime-registry') as any;
  const { recordWorkingContextPacket, getWorkingContextPackets, getSession } = session;
  const { stripInheritedRecoveryMarks } = registry;

  const sid = 'turnctx_root_test';
  getSession(sid);

  // Four unrelated earlier turns already in the bounded list.
  for (let i = 1; i <= 4; i += 1) {
    recordWorkingContextPacket(sid, {
      turnId: `older_turn_${i}`,
      status: 'completed',
      request: `older request ${i}`,
      completedActions: [`older action ${i}`],
      continueFromHere: `older ${i}`,
    });
  }

  // Chained recovery: rootTurnId must survive the inherited-mark strip so a
  // second restart keeps pointing at the same root.
  const rootId = 'root_runtime_aaa';
  const firstRecovery = { ...stripInheritedRecoveryMarks({ recovery: 'chat_checkpointed', recoveredAt: 1 }), rootTurnId: rootId };
  const secondRecoveryInput = { ...firstRecovery, recovery: 'chat_checkpointed', recoveredAt: 2, restartEpoch: 3 };
  const stripped = stripInheritedRecoveryMarks(secondRecoveryInput);
  assert.equal(stripped.rootTurnId, rootId, 'rootTurnId must survive stripInheritedRecoveryMarks across chained restarts');
  assert.equal(stripped.recovery, undefined, 'inherited recovery marker must be stripped');
  assert.equal(stripped.recoveredAt, undefined, 'inherited recoveredAt must be stripped');

  // Three segments of the same turn: original + two restart recoveries.
  const segments = [
    { status: 'aborted', action: 'merged PR #398', abortReason: 'Gateway restart interrupted the active turn (gateway_restart); this was not a user cancellation.' },
    { status: 'aborted', action: 'pulled main and regenerated bundle', abortReason: 'Gateway restart interrupted the active turn (gateway_restart); this was not a user cancellation.' },
    { status: 'completed', action: 'verified fix on merged main', abortReason: undefined },
  ];
  for (const seg of segments) {
    recordWorkingContextPacket(sid, {
      turnId: rootId,
      status: seg.status,
      request: 'merge, pull and restart',
      completedActions: [seg.action],
      abortReason: seg.abortReason,
      continueFromHere: `after ${seg.action}`,
    });
  }

  const packets = getWorkingContextPackets(sid);
  const rootPackets = packets.filter((p: any) => p.turnId === rootId);
  assert.equal(rootPackets.length, 1, `restart segments must merge into one packet (got ${rootPackets.length})`);
  const merged = rootPackets[0];
  for (const seg of segments) {
    assert.ok(
      merged.completedActions.some((a: string) => a.includes(seg.action)),
      `merged packet must keep pre-restart action "${seg.action}"`,
    );
  }
  assert.equal(merged.status, 'completed', 'final segment status wins');
  const olderKept = packets.filter((p: any) => String(p.turnId).startsWith('older_turn_')).length;
  assert.equal(olderKept, 4, `restart segments must not evict unrelated turn context (kept ${olderKept}/4)`);

  // Wiring: the recovery path must derive the root id and pass it through.
  const router = fs.readFileSync(path.join(__dirname, 'routes', 'chat.router.ts'), 'utf8');
  assert.match(router, /recoveryData\.rootTurnId\s*\|\|\s*runtime\.id/, 'recovery must reuse an inherited rootTurnId or seed it from the interrupted runtime');
  assert.match(router, /rootTurnId:\s*rootTurnContextId/, 'recovery runtime must persist rootTurnId for the next restart');
  assert.match(router, /turnContextId:\s*rootTurnContextId/, 'recovery turn must record packets under the root turn id');
  const keyed = router.match(/turnId:\s*String\(flags\?\.turnContextId\s*\|\|\s*flags\?\.runtimeId/g) || [];
  assert.ok(keyed.length >= 2, `both abort and completion packets must prefer turnContextId (found ${keyed.length})`);

  // Unplanned drops (supervisor crash / watchdog kill) go through the same
  // retriggerInterruptedMainChat path, so they inherit root-turn keying. The
  // first lone crash retry must be fast; repeats and backlogs stay slow.
  const recovery = await import('./runtime-recovery') as any;
  const { isFirstLoneCrashRetry } = recovery;
  assert.equal(isFirstLoneCrashRetry({ kind: 'main_chat', recoveryData: {} }, 1), true, 'first lone crash retry takes the fast lane');
  assert.equal(isFirstLoneCrashRetry({ kind: 'main_chat', recoveryData: { restartRecoveryAttempts: 1 } }, 1), false, 'repeat crash attempts keep the cool-down');
  assert.equal(isFirstLoneCrashRetry({ kind: 'main_chat', recoveryData: {} }, 3), false, 'multi-turn backlog keeps the cool-down');
  assert.equal(isFirstLoneCrashRetry({ kind: 'main_chat_goal', recoveryData: {} }, 1), false, 'goals keep their dedicated runner');
  const server = fs.readFileSync(path.join(__dirname, 'server-v2.ts'), 'utf8');
  assert.match(server, /isFirstLoneCrashRetry\(runtime, recoveryQueue\.length\)/, 'deferred crash queue must use the fast first retry');

  console.log('restart-turn-context-root regression: ok');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
