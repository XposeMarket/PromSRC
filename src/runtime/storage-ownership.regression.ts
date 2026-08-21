import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSkillLockFile, resolveSkillsRoot } from '../skills/store.js';
import { resolveUserPluginsDir } from '../extensions/loader.js';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
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
    const canonicalLock = resolveSkillLockFile();

    assert.equal(canonicalSkills, path.join(root, 'workspace', 'skills'));
    assert.equal(canonicalPlugins, path.join(root, 'runtime', 'plugins'));
    assert.equal(canonicalLock, path.join(root, 'runtime', 'config', '.clawhub', 'lock.json'));
    assert.notEqual(path.dirname(canonicalSkills), path.dirname(canonicalPlugins));
    assert.ok(fs.statSync(canonicalSkills).isDirectory());

    delete process.env.PROMETHEUS_STORAGE_LAYOUT;

    const legacySkills = resolveSkillsRoot();
    const legacyPlugins = resolveUserPluginsDir();
    assert.equal(legacySkills, path.join(root, '.prometheus', 'skills'));
    assert.equal(legacyPlugins, path.join(root, '.prometheus', 'user-plugins'));

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
