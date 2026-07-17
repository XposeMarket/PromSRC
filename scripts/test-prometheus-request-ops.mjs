import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-request-ops-'));
process.env.PROMETHEUS_DATA_DIR = path.join(fixture, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(fixture, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

const require = createRequire(import.meta.url);
const approvals = require('../dist/gateway/dev-source-approvals.js');
const coordinator = require('../dist/gateway/dev-edit-coordinator.js');
const requests = require('../dist/gateway/requests/request-ops.js');
const sessions = require('../dist/gateway/session.js');
const chatHelpers = require('../dist/gateway/chat/chat-helpers.js');

const ownerSessionId = `request_ops_owner_${Date.now()}`;
const targetSessionId = `${ownerSessionId}_target`;
const devEditId = `dev_edit_request_ops_${Date.now()}`;

try {
  assert.equal(chatHelpers.isContinuationCue('you got cutoff'), true);
  assert.equal(chatHelpers.isContinuationCue('pick up where you left off'), true);
  sessions.touchSession(ownerSessionId, { channel: 'web', title: 'Request inspector' });
  sessions.touchSession(targetSessionId, { channel: 'mobile', title: 'Interrupted dev edit' });
  sessions.flushSession(ownerSessionId);
  sessions.flushSession(targetSessionId);

  approvals.upsertDevSourceEditContinuation({
    id: devEditId,
    sessionId: targetSessionId,
    status: 'approved',
    completionNoteTag: 'dev_edit_complete',
    allowedFiles: [
      'src/gateway/example-touched.ts',
      'src/gateway/example-remaining.ts',
    ],
    plan: {
      userRequest: 'Finish the interrupted request tool fixture.',
      evidence: [],
      steps: ['Edit both approved files', 'Verify', 'Apply live'],
      verification: ['backend build'],
      expectedWorkflow: ['Resume the existing edit'],
      completionNoteTag: 'dev_edit_complete',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  coordinator.registerCoordinatedDevEdit({
    id: devEditId,
    sessionId: targetSessionId,
    files: [
      'src/gateway/example-touched.ts',
      'src/gateway/example-remaining.ts',
    ],
  });
  const claimed = coordinator.claimCoordinatedDevEditFile({
    id: devEditId,
    sessionId: targetSessionId,
    file: 'src/gateway/example-touched.ts',
  });
  assert.equal(claimed.allowed, true);

  const candidates = await requests.executePrometheusRequestOps(ownerSessionId, {
    action: 'recovery_candidates',
    kind: 'dev_source_edit',
    depth: 'full',
  });
  assert.equal(candidates.success, true);
  assert.equal(candidates.count, 1);
  assert.equal(candidates.requests[0].id, devEditId);
  assert.deepEqual(candidates.requests[0].touchedFiles, ['src/gateway/example-touched.ts']);
  assert.deepEqual(candidates.requests[0].remainingFiles, ['src/gateway/example-remaining.ts']);
  assert.equal(candidates.requests[0].appliedLive, false);
  assert.equal(candidates.requests[0].safeNextAction, 'reread_touched_files_then_resume_existing_request');

  const found = await requests.executePrometheusRequestOps(ownerSessionId, {
    action: 'find',
    query: 'example-remaining.ts',
    depth: 'full',
  });
  assert.equal(found.requests.some((record) => record.id === devEditId), true);

  const sameThreadRecovery = await requests.executePrometheusRequestOps(targetSessionId, {
    action: 'recover',
    request_id: devEditId,
    message: 'You got cut off.',
  });
  assert.equal(sameThreadRecovery.success, true);
  assert.equal(sameThreadRecovery.handoff, 'current_thread');
  assert.match(sameThreadRecovery.recoveryPrompt, new RegExp(devEditId));
  assert.match(sameThreadRecovery.recoveryPrompt, /reread every known touched file/i);
  assert.match(sameThreadRecovery.recoveryPrompt, /do not .*claim the changes are live/i);
  assert.doesNotMatch(sameThreadRecovery.recoveryPrompt, /changes are live and the gateway is healthy/i);
  assert.deepEqual(
    sessions.getSessionMutationScope(targetSessionId)?.allowedFiles,
    ['src/gateway/example-touched.ts', 'src/gateway/example-remaining.ts'],
    'recovery should restore the existing bounded source-edit scope',
  );

  const detachedCalls = [];
  const crossThreadRecovery = await requests.executePrometheusRequestOps(ownerSessionId, {
    action: 'recover',
    request_id: devEditId,
    message: 'Resume and finish the prior work.',
  }, {
    runInteractiveTurn: async (...args) => {
      detachedCalls.push(args);
      return { text: 'queued fixture recovery' };
    },
  });
  assert.equal(crossThreadRecovery.success, true);
  assert.equal(crossThreadRecovery.handoff, 'queued_original_owner');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(detachedCalls.length, 1);
  assert.equal(detachedCalls[0][1], targetSessionId);
  assert.match(String(detachedCalls[0][0]), new RegExp(devEditId));

  approvals.markDevSourceEditContinuationComplete({
    id: devEditId,
    tag: 'dev_edit_complete',
    note: 'fixture complete',
  });
  const completedRecovery = await requests.executePrometheusRequestOps(targetSessionId, {
    action: 'recover',
    request_id: devEditId,
  });
  assert.equal(completedRecovery.success, false);
  assert.equal(completedRecovery.recovered, false);
  assert.equal(completedRecovery.safeNextAction, 'none_complete');

  console.log('prometheus request ops regression: ok');
} finally {
  for (const sessionId of [ownerSessionId, targetSessionId]) {
    try { sessions.deleteSession(sessionId); } catch {}
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}
