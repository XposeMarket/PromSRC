import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-dev-edit-coordinator-'));
const testFile = '.tmp/dev-edit-coordinator-test.txt';
const testAbs = path.join(root, testFile);
fs.mkdirSync(path.dirname(testAbs), { recursive: true });
fs.writeFileSync(testAbs, 'baseline\n', 'utf8');
process.env.PROMETHEUS_DATA_DIR = stateDir;
process.env.PROMETHEUS_APP_ROOT = root;

const coordinator = await import('../dist/gateway/dev-edit-coordinator.js');

try {
  const a = coordinator.registerCoordinatedDevEdit({ id: 'edit_a', sessionId: 'session_a', files: [testFile] });
  const b = coordinator.registerCoordinatedDevEdit({ id: 'edit_b', sessionId: 'session_b', files: [testFile, 'src/gateway/boot.ts'] });
  assert.deepEqual(a.ownedFiles, [testFile]);
  assert.deepEqual(b.waitingFiles, [testFile]);
  assert.ok(b.ownedFiles.includes('src/gateway/boot.ts'));

  const blockedB = coordinator.claimCoordinatedDevEditFile({ id: 'edit_b', sessionId: 'session_b', file: testFile });
  assert.equal(blockedB.allowed, false);
  assert.equal(blockedB.ownerEditId, 'edit_a');

  assert.equal(coordinator.claimCoordinatedDevEditFile({ id: 'edit_a', sessionId: 'session_a', file: testFile }).allowed, true);
  coordinator.recordCoordinatedDevEditVerification({ id: 'edit_a', files: [testFile], success: true, summary: 'A verified' });
  const aReady = coordinator.requestCoordinatedDevEditApply('edit_a');
  assert.equal(aReady.role, 'waiting');
  assert.equal(aReady.awakened[0]?.id, 'edit_b');
  assert.ok(aReady.blockers.some((item) => item.id === 'edit_b'));

  const bUnlocked = await coordinator.waitForCoordinatedDevEditFiles('edit_b', 1000);
  assert.deepEqual(bUnlocked?.waitingFiles, []);
  assert.ok(bUnlocked?.inheritedFiles.includes(testFile));
  assert.equal(coordinator.claimCoordinatedDevEditFile({ id: 'edit_b', sessionId: 'session_b', file: testFile }).allowed, true);
  assert.equal(coordinator.claimCoordinatedDevEditFile({ id: 'edit_b', sessionId: 'session_b', file: 'src/gateway/boot.ts' }).allowed, true);
  coordinator.recordCoordinatedDevEditVerification({ id: 'edit_b', files: [testFile, 'src/gateway/boot.ts'], success: true, summary: 'B verified A plus B' });
  const bReady = coordinator.requestCoordinatedDevEditApply('edit_b');
  assert.equal(bReady.role, 'leader');
  assert.deepEqual(new Set(bReady.batch?.memberIds), new Set(['edit_a', 'edit_b']));
  assert.equal(bReady.batch?.status, 'applying');
  coordinator.markCoordinatedDevApplyBatch(bReady.batch.id, 'applied');
  coordinator.markCoordinatedDevEditComplete('edit_a');
  coordinator.markCoordinatedDevEditComplete('edit_b');

  coordinator.registerCoordinatedDevEdit({ id: 'edit_c', sessionId: 'session_c', files: ['src/gateway/lifecycle.ts'] });
  coordinator.registerCoordinatedDevEdit({ id: 'edit_d', sessionId: 'session_d', files: ['src/gateway/runtime-recovery.ts'] });
  coordinator.claimCoordinatedDevEditFile({ id: 'edit_c', sessionId: 'session_c', file: 'src/gateway/lifecycle.ts' });
  coordinator.claimCoordinatedDevEditFile({ id: 'edit_d', sessionId: 'session_d', file: 'src/gateway/runtime-recovery.ts' });
  coordinator.recordCoordinatedDevEditVerification({ id: 'edit_c', files: ['src/gateway/lifecycle.ts'], success: true });
  assert.equal(coordinator.requestCoordinatedDevEditApply('edit_c').role, 'waiting');
  coordinator.recordCoordinatedDevEditVerification({ id: 'edit_d', files: ['src/gateway/runtime-recovery.ts'], success: true });
  const disjointBatch = coordinator.requestCoordinatedDevEditApply('edit_d');
  assert.equal(disjointBatch.role, 'leader');
  assert.deepEqual(new Set(disjointBatch.batch?.memberIds), new Set(['edit_c', 'edit_d']));
  coordinator.markCoordinatedDevApplyBatch(disjointBatch.batch.id, 'applied');
  coordinator.markCoordinatedDevEditComplete('edit_c');
  coordinator.markCoordinatedDevEditComplete('edit_d');

  coordinator.registerCoordinatedDevEdit({ id: 'edit_e', sessionId: 'session_e', files: [testFile] });
  coordinator.claimCoordinatedDevEditFile({ id: 'edit_e', sessionId: 'session_e', file: testFile });
  coordinator.recordCoordinatedDevEditVerification({ id: 'edit_e', files: [testFile], success: true });
  coordinator.claimCoordinatedDevEditFile({ id: 'edit_e', sessionId: 'session_e', file: testFile });
  assert.throws(() => coordinator.requestCoordinatedDevEditApply('edit_e'), /must pass verify_only/);

  console.log('dev-edit coordinator concurrency contract: PASS');
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(testAbs, { force: true });
}
