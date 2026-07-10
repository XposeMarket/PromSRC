import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-storage-boundaries-'));

try {
  const {
    StorageBoundaryError,
    assertSafeStorageId,
    resolveConfinedStoragePath,
  } = require('../dist/gateway/storage/storage-paths.js');

  for (const id of ['default', crypto.randomUUID(), 'telegram_-100123', 'task_abc-123']) {
    assert.equal(assertSafeStorageId(id), id);
  }
  for (const id of [
    '', '_index', '../config', '..\\config', 'a/b', 'a\\b', 'C:config',
    'C:\\config', '\\\\server\\share', '%2e%2e%2fconfig', '%252e%252e%255cconfig',
    'CON', 'nul', 'name.with.dot', 'has space', 'x'.repeat(129),
  ]) {
    assert.throws(() => assertSafeStorageId(id), StorageBoundaryError, `unsafe id accepted: ${id}`);
  }

  const confinedRoot = path.join(testRoot, 'confined');
  const outsideRoot = path.join(testRoot, 'outside');
  fs.mkdirSync(confinedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  const validPath = resolveConfinedStoragePath(confinedRoot, path.join('child', 'record.json'));
  assert.equal(validPath, path.join(confinedRoot, 'child', 'record.json'));
  assert.throws(() => resolveConfinedStoragePath(confinedRoot, '../outside/record.json'), StorageBoundaryError);
  assert.throws(() => resolveConfinedStoragePath(confinedRoot, path.join(outsideRoot, 'record.json')), StorageBoundaryError);

  const linkedDir = path.join(confinedRoot, 'linked');
  try {
    fs.symlinkSync(outsideRoot, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(
      () => resolveConfinedStoragePath(confinedRoot, path.join('linked', 'record.json')),
      StorageBoundaryError,
      'symlink/junction traversal must be rejected',
    );
  } catch (err) {
    if (err?.code !== 'EPERM' && err?.code !== 'EACCES') throw err;
    console.warn('Junction test skipped because this OS account cannot create one.');
  }

  const dataRoot = path.join(testRoot, 'data');
  const workspaceRoot = path.join(testRoot, 'workspace');
  process.env.PROMETHEUS_DATA_DIR = dataRoot;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspaceRoot;

  const sessionStore = require('../dist/gateway/session.js');
  const projectStore = require('../dist/gateway/projects/project-store.js');
  const taskStore = require('../dist/gateway/tasks/task-store.js');
  const voiceWorkgroupStore = require('../dist/gateway/voice/voice-workgroup-store.js');

  const configRoot = path.join(dataRoot, '.prometheus');
  fs.mkdirSync(configRoot, { recursive: true });
  const sentinelPath = path.join(configRoot, 'sentinel.json');
  fs.writeFileSync(sentinelPath, '{"sentinel":true}', 'utf8');

  assert.throws(() => sessionStore.getSession('../sentinel'), StorageBoundaryError);
  assert.throws(() => projectStore.getProject('../sentinel'), StorageBoundaryError);
  assert.throws(() => taskStore.loadTask('../sentinel'), StorageBoundaryError);
  assert.throws(() => taskStore.deleteTask('..\\sentinel'), StorageBoundaryError);
  assert.throws(() => voiceWorkgroupStore.loadVoiceWorkgroup('../sentinel'), StorageBoundaryError);
  assert.equal(fs.readFileSync(sentinelPath, 'utf8'), '{"sentinel":true}', 'traversal changed the sentinel');

  const project = projectStore.createProject('Membership test');
  const unrelatedSessionId = crypto.randomUUID();
  sessionStore.getSession(unrelatedSessionId);
  sessionStore.flushSession(unrelatedSessionId);
  assert.equal(sessionStore.sessionExists(unrelatedSessionId), true);
  assert.equal(
    projectStore.removeSessionFromProject(project.id, unrelatedSessionId),
    null,
    'a project must not delete a session it does not own',
  );
  assert.equal(sessionStore.sessionExists(unrelatedSessionId), true, 'unrelated session was deleted');

  assert.ok(projectStore.addSessionToProject(project.id, unrelatedSessionId));
  assert.ok(projectStore.removeSessionFromProject(project.id, unrelatedSessionId));
  assert.equal(sessionStore.sessionExists(unrelatedSessionId), false, 'owned session was not deleted');

  const knowledgeProject = projectStore.createProject('Knowledge confinement test');
  const outsideKnowledge = path.join(testRoot, 'outside-knowledge.txt');
  fs.writeFileSync(outsideKnowledge, 'must survive', 'utf8');
  const metadataPath = path.join(configRoot, 'projects', `${knowledgeProject.id}.json`);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  metadata.knowledge = [{
    id: 'kf_tampered',
    name: 'outside.txt',
    path: outsideKnowledge,
    relPath: '../../outside-knowledge.txt',
    sizeBytes: 12,
    tokens: 3,
    addedAt: Date.now(),
  }];
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  assert.equal(projectStore.getKnowledgeFileContent(knowledgeProject.id, 'kf_tampered'), null);
  assert.equal(projectStore.removeKnowledgeFile(knowledgeProject.id, 'kf_tampered'), false);
  assert.equal(fs.readFileSync(outsideKnowledge, 'utf8'), 'must survive', 'tampered knowledge metadata deleted an outside file');

  const validKnowledgePath = projectStore.getProjectKnowledgeFilePath(knowledgeProject.id, 'inside.txt');
  fs.writeFileSync(validKnowledgePath, 'inside project', 'utf8');
  const registered = projectStore.addKnowledgeFile(knowledgeProject.id, 'inside.txt', validKnowledgePath, 14);
  assert.ok(registered);
  assert.equal(projectStore.getKnowledgeFileContent(knowledgeProject.id, registered.id), 'inside project');

  const task = taskStore.createTask({
    title: 'Storage boundary test',
    prompt: 'Verify task storage confinement',
    sessionId: 'default',
    channel: 'web',
    plan: [],
  });
  assert.equal(taskStore.loadTask(task.id)?.id, task.id);
  assert.equal(taskStore.deleteTask(task.id), true);
  assert.equal(taskStore.loadTask(task.id), null);

  const workgroup = voiceWorkgroupStore.createVoiceWorkgroup({ parentSessionId: 'default' });
  const workgroupPath = path.join(configRoot, 'voice-workgroups', `${workgroup.id}.json`);
  const tamperedWorkgroup = JSON.parse(fs.readFileSync(workgroupPath, 'utf8'));
  tamperedWorkgroup.id = '../sentinel';
  fs.writeFileSync(workgroupPath, JSON.stringify(tamperedWorkgroup, null, 2), 'utf8');
  const loadedWorkgroup = voiceWorkgroupStore.loadVoiceWorkgroup(workgroup.id);
  assert.equal(loadedWorkgroup.id, workgroup.id, 'persisted metadata overrode the workgroup filename id');
  voiceWorkgroupStore.saveVoiceWorkgroup(loadedWorkgroup);
  assert.equal(fs.readFileSync(sentinelPath, 'utf8'), '{"sentinel":true}', 'tampered workgroup metadata changed the sentinel');

  console.log('Storage boundary tests passed.');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
