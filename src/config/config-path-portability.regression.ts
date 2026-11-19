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
          // The shipped defaults mix OS roots; a foreign one must never turn into the workspace.
          blocked_paths: ['/etc', '/System', 'C:\\Windows', '/usr', '/bin'],
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
    const blocked = config.tools.permissions.files.blocked_paths as string[];
    const inside = (rootPath: string, candidate: string) => {
      const rel = path.relative(path.resolve(rootPath), path.resolve(candidate));
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };
    assert.ok(!blocked.some((entry) => inside(entry, workspace)), `workspace must never be blocked (blocked: ${blocked.join(', ')})`);
    if (process.platform !== 'win32') assert.ok(!blocked.some((entry) => /^[A-Za-z]:/.test(entry) || entry.includes('C:\\')), 'foreign Windows roots are dropped');
    else assert.ok(blocked.some((entry) => entry.toLowerCase() === 'c:\\windows'), 'Windows keeps its own system root blocked');

    manager.ensureDirectories();
    assert.ok(fs.statSync(workspace).isDirectory());
    console.log('config path portability regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
