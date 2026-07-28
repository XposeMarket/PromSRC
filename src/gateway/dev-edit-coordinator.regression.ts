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
const coordinationPath = path.join(root, '.prometheus', 'dev-edit-coordination.json');

function resetCoordination(): void {
  fs.mkdirSync(path.dirname(coordinationPath), { recursive: true });
  fs.writeFileSync(coordinationPath, JSON.stringify({ version: 1, revision: 0, edits: [], batches: [] }, null, 2));
}

function coordinationState(): any {
  return JSON.parse(fs.readFileSync(coordinationPath, 'utf-8'));
}

function writeCoordinationState(state: any): void {
  fs.writeFileSync(coordinationPath, JSON.stringify(state, null, 2));
}

function prepareVerifiedEdit(id: string, sessionId: string, file: string): void {
  coordinator.registerCoordinatedDevEdit({ id, sessionId, files: [file] });
  assert.equal(coordinator.claimCoordinatedDevEditFile({ id, sessionId, file }).allowed, true);
  assert.equal(coordinator.recordCoordinatedDevEditVerification({ id, files: [file], success: true, summary: `${id} ok` })?.edit.phase, 'verified_handoff');
}

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

  // A completed member from a persisted, awaiting batch must be removed before
  // it can block the remaining verified member from going live.
  resetCoordination();
  prepareVerifiedEdit('ready', 'session-ready', 'src/a.ts');
  const terminalBatchState = coordinationState();
  const readyPersisted = terminalBatchState.edits.find((edit: any) => edit.id === 'ready');
  readyPersisted.batchId = 'stuck-terminal-batch';
  terminalBatchState.edits.push({
    id: 'completed', sessionId: 'session-old', requestedFiles: ['src/b.ts'], ownedFiles: [], waitingFiles: [],
    touchedFiles: ['src/b.ts'], inheritedFiles: [], supersededVerifiedFiles: [], phase: 'complete',
    createdAt: Date.now() - 10_000, updatedAt: Date.now(), leaseExpiresAt: Date.now() + 60_000,
    batchId: 'stuck-terminal-batch',
  });
  terminalBatchState.batches = [{
    id: 'stuck-terminal-batch', memberIds: ['completed', 'ready'], memberSessionIds: ['session-old', 'session-ready'],
    files: [], createdAt: Date.now(), status: 'awaiting_members', leaderId: 'completed',
  }];
  writeCoordinationState(terminalBatchState);
  const terminalRecovered = coordinator.requestCoordinatedDevEditApply('ready');
  assert.equal(terminalRecovered.role, 'leader');
  assert.deepEqual(terminalRecovered.batch?.memberIds, ['ready']);
  assert.equal(terminalRecovered.batch?.status, 'awaiting_approval');

  // An expired owner must release its claimed file to the already-queued
  // successor instead of remaining a permanent file and batch blocker.
  resetCoordination();
  coordinator.registerCoordinatedDevEdit({ id: 'expired-owner', sessionId: 'session-owner', files: ['src/shared.ts'] });
  const queued = coordinator.registerCoordinatedDevEdit({ id: 'queued-successor', sessionId: 'session-successor', files: ['src/shared.ts'] });
  assert.deepEqual(queued.waitingFiles, ['src/shared.ts']);
  const expiredState = coordinationState();
  expiredState.edits.find((edit: any) => edit.id === 'expired-owner').leaseExpiresAt = Date.now() - 1;
  writeCoordinationState(expiredState);
  const released = coordinator.getCoordinatedDevEdit('queued-successor');
  assert.deepEqual(released?.waitingFiles, []);
  assert.ok(released?.ownedFiles.includes('src/shared.ts'));
  assert.equal(released?.phase, 'editing');

  // When a verified predecessor has handed off every touched file, an old open
  // batch must be retired and the successor must form the new deploy cohort.
  resetCoordination();
  coordinator.registerCoordinatedDevEdit({ id: 'predecessor', sessionId: 'session-predecessor', files: ['src/shared.ts'] });
  assert.equal(coordinator.claimCoordinatedDevEditFile({ id: 'predecessor', sessionId: 'session-predecessor', file: 'src/shared.ts' }).allowed, true);
  coordinator.registerCoordinatedDevEdit({ id: 'successor', sessionId: 'session-successor', files: ['src/shared.ts'] });
  assert.equal(coordinator.recordCoordinatedDevEditVerification({ id: 'predecessor', files: ['src/shared.ts'], success: true, summary: 'predecessor ok' })?.awakened[0]?.id, 'successor');
  assert.equal(coordinator.claimCoordinatedDevEditFile({ id: 'successor', sessionId: 'session-successor', file: 'src/shared.ts' }).allowed, true);
  assert.equal(coordinator.recordCoordinatedDevEditVerification({ id: 'successor', files: ['src/shared.ts'], success: true, summary: 'successor ok' })?.edit.phase, 'verified_handoff');
  const successorBatchState = coordinationState();
  successorBatchState.edits.find((edit: any) => edit.id === 'predecessor').batchId = 'superseded-batch';
  successorBatchState.batches = [{
    id: 'superseded-batch', memberIds: ['predecessor'], memberSessionIds: ['session-predecessor'],
    files: [], createdAt: Date.now(), status: 'awaiting_members', leaderId: 'predecessor',
  }];
  writeCoordinationState(successorBatchState);
  const successorRecovered = coordinator.requestCoordinatedDevEditApply('successor');
  assert.equal(successorRecovered.role, 'leader');
  assert.deepEqual(successorRecovered.batch?.memberIds, ['successor']);

  // An explicit runtime abort must immediately release the owner's files,
  // retain its evidence, and let the waiting successor continue without
  // waiting for a lease timeout.
  resetCoordination();
  coordinator.registerCoordinatedDevEdit({ id: 'aborted-owner', sessionId: 'session-aborted', files: ['src/shared.ts'] });
  const abortQueued = coordinator.registerCoordinatedDevEdit({ id: 'after-abort', sessionId: 'session-after-abort', files: ['src/shared.ts'] });
  assert.deepEqual(abortQueued.waitingFiles, ['src/shared.ts']);
  const abandoned = coordinator.abandonCoordinatedDevEditsForSession({
    sessionId: 'session-aborted', reason: 'user_aborted_runtime',
  });
  assert.equal(abandoned.length, 1);
  assert.equal(abandoned[0]?.phase, 'abandoned');
  assert.equal(abandoned[0]?.abandonReason, 'user_aborted_runtime');
  assert.deepEqual(coordinator.getCoordinatedDevEdit('after-abort')?.waitingFiles, []);
  assert.ok(coordinator.getCoordinatedDevEdit('after-abort')?.ownedFiles.includes('src/shared.ts'));
  console.log('dev-edit coordinator regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
