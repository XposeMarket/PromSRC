import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-config-path-'));
const dataRoot = path.join(root, 'data');
const configDir = path.join(dataRoot, '.prometheus');

async function run(): Promise<void> {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
    workspace: { path: 'portable-workspace' },
    skills: { directory: 'portable-skills' },
    memory: { path: 'portable-memory' },
    tools: {
      permissions: {
        files: {
          allowed_paths: ['additional-files'],
          blocked_paths: [],
        },
      },
    },
    }), 'utf8');

    process.env.PROMETHEUS_DATA_DIR = dataRoot;
    delete process.env.PROMETHEUS_WORKSPACE_DIR;
    const { getConfig } = await import('./config');
    const manager = getConfig();
    const config = manager.getConfig() as any;
    const workspace = path.join(configDir, 'portable-workspace');

    assert.equal(manager.getWorkspacePath(), workspace);
    // A data-root override intentionally owns skills/memory too; only the
    // workspace remains user-selectable when no workspace env override exists.
    assert.equal(config.skills.directory, path.join(configDir, 'skills'));
    assert.equal(config.memory.path, path.join(configDir, 'memory'));
    assert.ok(config.tools.permissions.files.allowed_paths.includes(workspace));
    assert.ok(config.tools.permissions.files.allowed_paths.includes(path.join(configDir, 'additional-files')));

    manager.ensureDirectories();
    assert.ok(fs.statSync(workspace).isDirectory());
    console.log('config path portability regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
