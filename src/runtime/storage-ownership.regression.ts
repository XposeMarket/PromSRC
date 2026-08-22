import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSkillInstallStateFile, resolveSkillLockFile, resolveSkillsRoot } from '../skills/store.js';
import { resolveUserPluginsDir } from '../extensions/loader.js';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.txt',
]);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'release', 'release-public']);

function assertNoForeignSkillStoreNamespace(repoRoot: string): void {
  const forbidden = ['claw', 'hub'].join('');
  const stack = [repoRoot];
  const matches: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const file = path.join(current, entry.name);
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      if (text.toLowerCase().includes(forbidden)) matches.push(path.relative(repoRoot, file));
    }
  }

  assert.deepEqual(matches, [], `foreign skill-store namespace found in: ${matches.join(', ')}`);
}

function run(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-storage-ownership-'));
  const previous = {
    data: process.env.PROMETHEUS_DATA_DIR,
    runtime: process.env.PROMETHEUS_RUNTIME_DIR,
    workspace: process.env.PROMETHEUS_WORKSPACE_DIR,
    mode: process.env.PROMETHEUS_STORAGE_LAYOUT,
  };

  try {
    process.env.PROMETHEUS_DATA_DIR = root;
    process.env.PROMETHEUS_STORAGE_LAYOUT = 'canonical';
    delete process.env.PROMETHEUS_RUNTIME_DIR;
    delete process.env.PROMETHEUS_WORKSPACE_DIR;

    const canonicalSkills = resolveSkillsRoot();
    const canonicalPlugins = resolveUserPluginsDir();
    const canonicalInstallState = resolveSkillInstallStateFile();

    assert.equal(canonicalSkills, path.join(root, 'workspace', 'skills'));
    assert.equal(canonicalPlugins, path.join(root, 'runtime', 'plugins'));
    assert.equal(canonicalInstallState, path.join(root, 'runtime', 'config', 'skills', 'lock.json'));
    assert.equal(resolveSkillLockFile(), canonicalInstallState);
    assert.notEqual(path.dirname(canonicalSkills), path.dirname(canonicalPlugins));
    assert.ok(fs.statSync(canonicalSkills).isDirectory());

    delete process.env.PROMETHEUS_STORAGE_LAYOUT;

    const legacySkills = resolveSkillsRoot();
    const legacyPlugins = resolveUserPluginsDir();
    const legacyInstallState = resolveSkillInstallStateFile();
    assert.equal(legacySkills, path.join(root, '.prometheus', 'skills'));
    assert.equal(legacyPlugins, path.join(root, '.prometheus', 'user-plugins'));
    assert.equal(legacyInstallState, path.join(root, '.prometheus', 'skill-state', 'lock.json'));
    assert.equal(resolveSkillLockFile(), legacyInstallState);

    assertNoForeignSkillStoreNamespace(process.cwd());
    console.log('storage ownership regression passed');
  } finally {
    restoreEnv('PROMETHEUS_DATA_DIR', previous.data);
    restoreEnv('PROMETHEUS_RUNTIME_DIR', previous.runtime);
    restoreEnv('PROMETHEUS_WORKSPACE_DIR', previous.workspace);
    restoreEnv('PROMETHEUS_STORAGE_LAYOUT', previous.mode);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
