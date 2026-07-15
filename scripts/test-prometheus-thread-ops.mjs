import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-thread-ops-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(tempRoot, 'workspace');

const importDist = (relativePath) => import(pathToFileURL(path.join(root, 'dist', relativePath)).href);

try {
  const sessionApi = await importDist('gateway/session.js');
  const threadOps = await importDist('gateway/threads/thread-ops.js');
  const supervisionApi = await importDist('gateway/threads/thread-supervision.js');
  const toolDefs = await importDist('gateway/tools/defs/agent-team-schedule.js');

  const ownerId = 'prom_test_owner';
  sessionApi.touchSession(ownerId, { channel: 'web', title: 'Owner' });
  sessionApi.flushSession(ownerId);

  const created = await threadOps.executePrometheusThreadOps(ownerId, {
    action: 'create_many',
    follow: false,
    threads: [
      { title: 'First managed thread', prompt: '' },
      { title: 'Second managed thread', prompt: '' },
    ],
  }, {});
  assert.equal(created.count, 2);
  assert.notEqual(created.created[0].id, created.created[1].id);
  assert.equal(sessionApi.getSession(created.created[0].id).title, 'First managed thread');

  const targetId = created.created[0].id;
  const renamed = await threadOps.executePrometheusThreadOps(ownerId, {
    action: 'rename',
    session_id: targetId,
    title: 'Renamed managed thread',
  }, {});
  assert.equal(renamed.session.title, 'Renamed managed thread');

  const pinned = await threadOps.executePrometheusThreadOps(ownerId, {
    action: 'pin',
    session_id: targetId,
  }, {});
  assert.ok(pinned.session.pinnedAt > 0);

  const read = await threadOps.executePrometheusThreadOps(ownerId, {
    action: 'read',
    session_id: targetId,
  }, {});
  assert.equal(read.session.id, targetId);
  assert.equal(read.session.title, 'Renamed managed thread');

  let launchedPrompt = '';
  const followedCreate = await threadOps.executePrometheusThreadOps(ownerId, {
    action: 'create',
    title: 'Autonomous managed thread',
    prompt: 'Finish the isolated verification objective',
    follow: true,
  }, {
    runInteractiveTurn: async (prompt) => {
      launchedPrompt = prompt;
      return { type: 'chat', text: 'Goal accepted' };
    },
  });
  assert.match(launchedPrompt, /^\/goal Finish the isolated verification objective$/);
  assert.equal(followedCreate.session.follow, true);
  assert.equal(followedCreate.session.supervision.status, 'active');
  supervisionApi.cancelThreadSupervision(followedCreate.session.supervision.id);

  const supervision = supervisionApi.createThreadSupervision({
    ownerSessionId: ownerId,
    targetSessionId: targetId,
    targetTitle: 'Renamed managed thread',
    objective: 'Verify durable supervision',
  });
  assert.equal(supervision.status, 'active');
  assert.equal(supervisionApi.listThreadSupervisions({ ownerSessionId: ownerId, status: 'active' }).length, 1);
  assert.equal(supervisionApi.cancelThreadSupervision(supervision.id)?.status, 'cancelled');

  const threadTool = toolDefs.getAgentTeamScheduleTools()
    .find((tool) => tool?.function?.name === 'prometheus_thread_ops');
  assert.ok(threadTool, 'prometheus_thread_ops must be exposed to the model');
  assert.ok(threadTool.function.parameters.properties.action.enum.includes('create_many'));
  assert.ok(threadTool.function.parameters.properties.action.enum.includes('steer'));
  assert.ok(threadTool.function.parameters.properties.action.enum.includes('follow'));

  console.log('PASS: Prometheus peer-session create, metadata, inspection, supervision, and tool contracts');
} finally {
  const resolved = path.resolve(tempRoot);
  const tempBase = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${tempBase}${path.sep}`)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
