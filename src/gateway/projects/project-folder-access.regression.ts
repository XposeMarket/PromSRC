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
  assert.equal(store.usableProjectFolder(project), project.workspacePath, 'an allowed link is usable');
  // Granting twice doesn't duplicate the entry.
  store.grantProjectFolderAccess(outside);
  const entries = ((getConfig().getConfig() as any).tools.permissions.files.allowed_paths as string[])
    .filter((p) => path.resolve(p).toLowerCase() === path.resolve(outside).toLowerCase());
  assert.equal(entries.length, 1);

  // Revoke removes exactly that entry.
  access = store.revokeProjectFolderAccess(outside);
  assert.equal(access.allowed, false);
  assert.throws(() => store.resolveAllowedProjectDirectory(outside), /Allow access/);
  // Removing access stops the link from being used; the link itself stays on the project.
  assert.equal(store.usableProjectFolder(project), '');
  assert.equal(path.resolve(store.getProject(project.id)!.workspacePath || ''), path.resolve(outside));
  // Access is decided on the real location: a link inside the workspace that points elsewhere is not allowed.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-elsewhere-'));
  const link = path.join(process.env.PROMETHEUS_WORKSPACE_DIR!, 'link-out');
  let linked = false;
  try { fs.symlinkSync(elsewhere, link, 'junction'); linked = true; } catch { /* links are unavailable on this machine */ }
  if (linked) {
    assert.equal(store.describeProjectFolderAccess(link).allowed, false, 'a link that leaves the workspace is not allowed');
    assert.throws(() => store.resolveAllowedProjectDirectory(link), /Allow access/);
    fs.rmSync(link, { recursive: true, force: true });
  }
  fs.rmSync(elsewhere, { recursive: true, force: true });
  // The workspace itself can never be revoked here.
  assert.throws(() => store.revokeProjectFolderAccess(process.env.PROMETHEUS_WORKSPACE_DIR!), /allowed on its own/);

  // Refusals: drive/filesystem root, missing folder, relative path, blocked path.
  assert.throws(() => store.grantProjectFolderAccess(path.parse(outside).root), /whole drive/);
  assert.throws(() => store.grantProjectFolderAccess(path.join(outside, 'nope')), /not found/);
  assert.equal(store.describeProjectFolderAccess('relative/dir').grantable, false);
  const cfg = getConfig().getConfig() as any;
  getConfig().updateConfig({ tools: { ...cfg.tools, permissions: { ...cfg.tools.permissions, files: { ...cfg.tools.permissions.files, blocked_paths: [outside, inside] } } } } as any);
  assert.throws(() => store.grantProjectFolderAccess(outside), /blocked/);
  assert.equal(store.describeProjectFolderAccess(inside).allowed, false, 'a blocked folder stays blocked inside an allowed one');
  // A grant reaches every chat and agent, so the user folder and Prometheus's own data are refused.
  assert.throws(() => store.grantProjectFolderAccess(os.homedir()), /whole user folder/);
  assert.throws(() => store.grantProjectFolderAccess(process.env.PROMETHEUS_DATA_DIR!), /own data folder/);
  const systemRoot = process.env.SystemRoot;
  if (process.platform === 'win32' && systemRoot) {
    assert.throws(() => store.grantProjectFolderAccess(path.join(systemRoot, 'System32')), /System folders/);
  }

  fs.rmSync(outside, { recursive: true, force: true });
  console.log('project-folder-access regression: ok');
})().catch((error) => { console.error(error); process.exit(1); });
