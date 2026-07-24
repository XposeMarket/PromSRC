import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-task-session-index-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function main(): Promise<void> {
  try {
    const tasks = await import('./task-store');
    const before = tasks.getTaskSessionLookupRevision();
    const older = tasks.createTask({
      title: 'Older indexed task', prompt: 'older', sessionId: 'shared-session', channel: 'web', plan: [],
    });
    const newest = tasks.createTask({
      title: 'Newest indexed task', prompt: 'newest', sessionId: 'shared-session', channel: 'web', plan: [],
    });
    assert.ok(tasks.getTaskSessionLookupRevision() > before, 'task writes must invalidate session lookups');
    const found = tasks.findTaskBySessionId('shared-session');
    assert.equal(found?.id, newest.id, 'session lookup should preserve the previous newest-task behavior');
    assert.notEqual(found?.id, older.id);
    assert.equal(tasks.findTaskBySessionId('ordinary-session'), null);
    console.log('task session lookup regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main();
