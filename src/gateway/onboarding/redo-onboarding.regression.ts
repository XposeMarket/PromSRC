import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function run(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-redo-onboarding-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  const oldWorkspace = process.env.PROMETHEUS_WORKSPACE_DIR;
  const oldData = process.env.PROMETHEUS_DATA_DIR;

  try {
    process.env.PROMETHEUS_WORKSPACE_DIR = workspace;
    process.env.PROMETHEUS_DATA_DIR = data;

    fs.mkdirSync(path.join(workspace, 'projects', 'important'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'Brain', 'dreams'), { recursive: true });
    fs.mkdirSync(path.join(data, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'USER.md'), '# USER.md\n\nDo not delete me.\n', 'utf-8');
    fs.writeFileSync(path.join(workspace, 'projects', 'important', 'work.txt'), 'project data\n', 'utf-8');
    fs.writeFileSync(path.join(workspace, 'Brain', 'dreams', 'dream.md'), 'dream data\n', 'utf-8');
    fs.writeFileSync(path.join(data, 'sessions', 'session.json'), '{"history":[]}\n', 'utf-8');

    const store = await import('./onboarding-store.js');
    store.markTutorialComplete('user');
    store.markMigrationComplete('user', null, true);
    store.markModelConnected('user', 'openai', 'gpt-test');
    store.startMeet('user', 'session');
    store.completeMeet('user');
    store.markMemorySeeded('user');
    assert.equal(store.nextStep(store.getRecord('user')), 'done');

    const { redoOnboarding } = await import('./redo-onboarding.js');
    const result = redoOnboarding('user');
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.errors, []);

    assert.equal(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8'), '# USER.md\n\nDo not delete me.\n');
    assert.equal(fs.readFileSync(path.join(workspace, 'projects', 'important', 'work.txt'), 'utf-8'), 'project data\n');
    assert.equal(fs.readFileSync(path.join(workspace, 'Brain', 'dreams', 'dream.md'), 'utf-8'), 'dream data\n');
    assert.equal(fs.readFileSync(path.join(data, 'sessions', 'session.json'), 'utf-8'), '{"history":[]}\n');
    assert.ok(fs.existsSync(path.join(workspace, 'BOOTSTRAP.md')), 'redo should restore missing bootstrap guide additively');

    const replayed = store.getRecord('user');
    assert.equal(store.nextStep(replayed), 'tutorial');
    assert.equal(replayed.model.firstConnectedAt !== null, true, 'model connection state should remain intact');

    console.log('redo onboarding regression passed');
  } finally {
    if (oldWorkspace === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR;
    else process.env.PROMETHEUS_WORKSPACE_DIR = oldWorkspace;
    if (oldData === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = oldData;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
