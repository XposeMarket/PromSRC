import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensurePublicWorkspaceScaffold } from './public-workspace.js';

function run(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-public-workspace-'));
  try {
    const existingUser = '# USER.md\n\nCustom user-owned content.\n';
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'USER.md'), existingUser, 'utf-8');

    ensurePublicWorkspaceScaffold(root);

    for (const file of ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'BOOTSTRAP.md']) {
      assert.ok(fs.statSync(path.join(root, file)).isFile(), `${file} should exist`);
    }
    assert.equal(fs.readFileSync(path.join(root, 'USER.md'), 'utf-8'), existingUser, 'existing USER.md must never be overwritten');

    for (const dir of ['memory', 'projects', 'generated', 'uploads', 'downloads', 'skills', path.join('.prometheus', 'subagents')]) {
      assert.ok(fs.statSync(path.join(root, dir)).isDirectory(), `${dir} should exist`);
    }

    // Runtime/feature-owned trees must be lazy rather than polluting every new workspace.
    for (const absent of ['audit', path.join('Brain', 'state'), 'cron', 'schedules', 'tasks', 'integrations']) {
      assert.equal(fs.existsSync(path.join(root, absent)), false, `${absent} should be created only by its owning feature`);
    }

    // The base scaffold should not manufacture durable facts that have not been learned yet.
    assert.equal(fs.existsSync(path.join(root, 'BUSINESS.md')), false);
    assert.equal(fs.existsSync(path.join(root, 'MEMORY.md')), false);
    assert.equal(fs.existsSync(path.join(root, 'HEARTBEAT.md')), false);

    const before = fs.readFileSync(path.join(root, 'SOUL.md'), 'utf-8');
    ensurePublicWorkspaceScaffold(root);
    assert.equal(fs.readFileSync(path.join(root, 'SOUL.md'), 'utf-8'), before, 're-running scaffold must be idempotent');

    console.log('public workspace regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
