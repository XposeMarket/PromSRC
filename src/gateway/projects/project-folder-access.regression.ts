// Regression: linking a project to a folder outside the workspace needs an explicit,
// reversible grant. Agents (resolveAllowedProjectDirectory) never widen access.
// Runs against an isolated data dir; never touches a real Prometheus config.
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-folder-access-'));
process.env.PROMETHEUS_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_APP_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const store = require('./project-store') as typeof import('./project-store');
  const { getConfig } = require('../../config/config') as typeof import('../../config/config');
  assert.ok(path.resolve(getConfig().getConfigDir()).startsWith(path.resolve(root)), 'config must be isolated');

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-outside-repo-'));
  const inside = path.join(process.env.PROMETHEUS_WORKSPACE_DIR!, 'app');
  fs.mkdirSync(inside, { recursive: true });

  // Inside the workspace: allowed, nothing to grant or revoke.
  const inAccess = store.describeProjectFolderAccess(inside);
  assert.equal(inAccess.allowed, true);
  assert.equal(inAccess.revocable, false);

  // Outside: not allowed, grantable; linking is refused until granted.
  let access = store.describeProjectFolderAccess(outside);
  assert.equal(access.allowed, false);
  assert.equal(access.grantable, true);
  assert.throws(() => store.resolveAllowedProjectDirectory(outside), /Allow access/);

  // Grant, then link works; the grant is visible and revocable.
  store.grantProjectFolderAccess(outside);
  access = store.describeProjectFolderAccess(outside);
  assert.equal(access.allowed, true);
  assert.equal(access.revocable, true);
  assert.equal(store.resolveAllowedProjectDirectory(outside), path.resolve(outside));
  const project = store.createProject('Outside repo', store.resolveAllowedProjectDirectory(outside));
  assert.equal(path.resolve(project.workspacePath || ''), path.resolve(outside));
  // Granting twice doesn't duplicate the entry.
  store.grantProjectFolderAccess(outside);
  const entries = ((getConfig().getConfig() as any).tools.permissions.files.allowed_paths as string[])
    .filter((p) => path.resolve(p).toLowerCase() === path.resolve(outside).toLowerCase());
  assert.equal(entries.length, 1);

  // Revoke removes exactly that entry.
  access = store.revokeProjectFolderAccess(outside);
  assert.equal(access.allowed, false);
  assert.throws(() => store.resolveAllowedProjectDirectory(outside), /Allow access/);
  // The workspace itself can never be revoked here.
  assert.throws(() => store.revokeProjectFolderAccess(process.env.PROMETHEUS_WORKSPACE_DIR!), /allowed on its own/);

  // Refusals: drive/filesystem root, missing folder, relative path, blocked path.
  assert.throws(() => store.grantProjectFolderAccess(path.parse(outside).root), /whole drive/);
  assert.throws(() => store.grantProjectFolderAccess(path.join(outside, 'nope')), /not found/);
  assert.equal(store.describeProjectFolderAccess('relative/dir').grantable, false);
  const cfg = getConfig().getConfig() as any;
  getConfig().updateConfig({ tools: { ...cfg.tools, permissions: { ...cfg.tools.permissions, files: { ...cfg.tools.permissions.files, blocked_paths: [outside] } } } } as any);
  assert.throws(() => store.grantProjectFolderAccess(outside), /blocked/);
  const systemRoot = process.env.SystemRoot;
  if (process.platform === 'win32' && systemRoot) {
    assert.throws(() => store.grantProjectFolderAccess(path.join(systemRoot, 'System32')), /System folders/);
  }

  fs.rmSync(outside, { recursive: true, force: true });
  console.log('project-folder-access regression: ok');
})().catch((error) => { console.error(error); process.exit(1); });
