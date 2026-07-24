import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-dev-coordinator-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_APP_ROOT = root;
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
for (const file of ['shared.ts', 'a.ts', 'b.ts']) fs.writeFileSync(path.join(root, 'src', file), `export const ${file.replace('.ts', '')} = 1;\n`);

const coordinator = require('./dev-edit-coordinator') as typeof import('./dev-edit-coordinator');

try {
  const first = coordinator.registerCoordinatedDevEdit({
    id: 'first', sessionId: 'session-first', files: ['src/shared.ts', 'src/a.ts'],
  });
  const second = coordinator.registerCoordinatedDevEdit({
    id: 'second', sessionId: 'session-second', files: ['src/shared.ts', 'src/b.ts'],
  });
  assert.deepEqual(first.waitingFiles, []);
  assert.deepEqual(second.waitingFiles, ['src/shared.ts']);

  const firstVerified = coordinator.recordCoordinatedDevEditVerification({
    id: 'first', files: ['src/shared.ts', 'src/a.ts'], success: true, summary: 'first ok',
  });
  assert.equal(firstVerified?.edit.phase, 'verified_handoff');
  assert.deepEqual(firstVerified?.awakened.map((edit) => edit.id), ['second']);
  assert.deepEqual(coordinator.getCoordinatedDevEdit('second')?.waitingFiles, []);
  assert.ok(coordinator.getCoordinatedDevEdit('second')?.ownedFiles.includes('src/shared.ts'));

  const secondVerified = coordinator.recordCoordinatedDevEditVerification({
    id: 'second', files: ['src/shared.ts', 'src/b.ts'], success: true, summary: 'second ok',
  });
  assert.equal(secondVerified?.edit.phase, 'verified_handoff');
  const ready = coordinator.requestCoordinatedDevEditApply('first');
  assert.equal(ready.role, 'leader');
  assert.equal(ready.batch?.status, 'awaiting_approval');
  assert.deepEqual(ready.batch?.memberIds.sort(), ['first', 'second']);
  assert.ok(ready.batch && coordinator.beginCoordinatedDevApplyBatch(ready.batch.id));
  assert.ok(ready.batch && coordinator.markCoordinatedDevApplyBatch(ready.batch.id, 'not_live'));
  assert.equal(coordinator.getCoordinatedDevEdit('second')?.phase, 'verified_not_live');

  const later = coordinator.registerCoordinatedDevEdit({
    id: 'later', sessionId: 'session-later', files: ['src/shared.ts'],
  });
  assert.deepEqual(later.waitingFiles, []);
  assert.ok(later.ownedFiles.includes('src/shared.ts'));
  console.log('dev-edit coordinator regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
