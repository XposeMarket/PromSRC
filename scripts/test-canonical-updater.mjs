import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const updater = require('../dist/update/canonical-updater.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-canonical-updater-'));

try {
  const stateRoot = path.join(tempRoot, 'user-data');
  const configDir = path.join(stateRoot, '.prometheus');
  const externalRoot = path.join(tempRoot, 'configured-workspace');
  const importedSkillsRoot = path.join(tempRoot, 'imported-skills');
  const importedSkillsParent = path.dirname(importedSkillsRoot);
  const updateDir = path.join(configDir, 'updates');
  fs.mkdirSync(path.join(stateRoot, '.prometheus', 'vault'), { recursive: true });
  fs.mkdirSync(path.join(stateRoot, '.prometheus', 'skills', 'local-skill'), { recursive: true });
  fs.mkdirSync(path.join(stateRoot, 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(stateRoot, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(stateRoot, '.prometheus', 'updates'), { recursive: true });
  fs.mkdirSync(externalRoot, { recursive: true });
  fs.mkdirSync(path.join(importedSkillsRoot, 'imported-skill'), { recursive: true });
  fs.mkdirSync(path.join(importedSkillsParent, '.manifests'), { recursive: true });
  fs.mkdirSync(path.join(importedSkillsParent, 'skill-state'), { recursive: true });
  fs.writeFileSync(path.join(stateRoot, '.prometheus', 'vault', 'vault.enc'), 'test-only encrypted marker');
  fs.writeFileSync(path.join(stateRoot, '.prometheus', 'skills', 'local-skill', 'SKILL.md'), '# Local skill');
  fs.writeFileSync(path.join(stateRoot, 'workspace', 'README.md'), 'workspace marker');
  fs.writeFileSync(path.join(stateRoot, 'memory', 'MEMORY.md'), 'memory marker');
  fs.writeFileSync(path.join(stateRoot, '.prometheus', 'updates', 'must-not-copy.txt'), 'protocol marker');
  fs.writeFileSync(path.join(externalRoot, 'project.txt'), 'external marker');
  fs.writeFileSync(path.join(importedSkillsRoot, 'imported-skill', 'SKILL.md'), '# Imported skill');
  fs.writeFileSync(path.join(importedSkillsParent, '.manifests', 'imported-skill.source.json'), '{}');
  fs.writeFileSync(path.join(importedSkillsParent, 'skills_state.json'), '{"imported":true}');
  fs.writeFileSync(path.join(importedSkillsParent, 'skill-state', 'lock.json'), '{"skills":[]}');

  const releasePayload = path.join(tempRoot, 'Prometheus-Setup-test.exe');
  fs.writeFileSync(releasePayload, 'fixture release bytes');
  const releaseDigest = crypto.createHash('sha512').update(fs.readFileSync(releasePayload)).digest('base64');
  assert.equal(await updater.verifyFileSha512(releasePayload, releaseDigest), true);
  assert.equal(await updater.verifyFileSha512(releasePayload, Buffer.alloc(64, 8).toString('base64')), false);
  assert.equal(await updater.verifyFileSha512(releasePayload, '0'.repeat(128)), false);

  assert.equal(updater.isPackagedPublicUpdaterEnvironment({
    PROMETHEUS_ELECTRON_MANAGED: '1',
    PROMETHEUS_PUBLIC_BUILD: '1',
  }), true);
  assert.equal(updater.isPackagedPublicUpdaterEnvironment({}), false);

  const roots = updater.collectUserStateRoots(stateRoot, {
    workspace: { path: externalRoot },
    skills: { directory: importedSkillsRoot },
  });
  assert.ok(roots.some((root) => root.label === 'configured-workspace' && root.path === externalRoot));
  assert.ok(roots.some((root) => root.label === 'configured-skills' && root.path === importedSkillsRoot));
  assert.ok(roots.some((root) => root.path === path.join(stateRoot, '.prometheus', 'skills')));
  assert.ok(roots.some((root) => root.path === path.join(stateRoot, '.prometheus', 'sessions')));
  assert.ok(roots.some((root) => root.path === path.join(stateRoot, '.prometheus', 'browser-sessions.json')));

  assert.equal(updater.evaluateUpdatePreflight({}).ready, true);
  assert.deepEqual(
    updater.evaluateUpdatePreflight({ activeOperations: 1, pendingWrites: 2 }).reasons,
    ['active_operations', 'pending_writes'],
  );

  const digest = Buffer.alloc(64, 7).toString('base64');
  assert.equal(updater.validateReleaseInfo('1.0.13', {
    version: '1.0.14',
    files: [{
      url: 'https://github.com/XposeMarket/prometheus-releases/releases/download/v1.0.14/Prometheus-Setup.exe',
      sha512: digest,
    }],
  }).ok, true);
  assert.equal(updater.validateReleaseInfo('1.0.13', {
    version: '1.0.14',
    files: [{ url: 'javascript:alert(1)', sha512: digest }],
  }).ok, false);

  assert.equal(
    updater.sanitizeUpdateError(new Error('Authorization=Bearer super-secret token=abc123')),
    'Authorization=[redacted] token=[redacted]',
  );

  const check = updater.requestCanonicalUpdate(configDir, {
    action: 'check',
    source: 'test',
    env: { PROMETHEUS_ELECTRON_MANAGED: '1', PROMETHEUS_PUBLIC_BUILD: '1' },
  });
  assert.equal(check.ok, true);
  assert.equal(updater.consumeCanonicalUpdateRequest(configDir)?.requestId, check.request.requestId);

  const deniedApply = updater.requestCanonicalUpdate(configDir, {
    action: 'apply',
    source: 'test',
    env: { PROMETHEUS_ELECTRON_MANAGED: '1', PROMETHEUS_PUBLIC_BUILD: '1' },
  });
  assert.equal(deniedApply.ok, false);
  assert.equal(deniedApply.code, 'confirmation_required');

  const paths = updater.getUpdatePaths(configDir);
  const lock = updater.acquireUpdateLock(configDir, 'test');
  assert.ok(lock);
  assert.equal(updater.acquireUpdateLock(configDir, 'second'), null);
  lock.release();

  const backup = updater.createVersionedStateBackup({
    stateRoot,
    updateDir,
    backupsDir: paths.backupsDir,
    currentVersion: '1.0.13',
    targetVersion: '1.0.14',
    stateRoots: roots,
    encryptManifest: () => Buffer.from('fixture-safe-storage-ciphertext', 'utf8'),
    protectBackup: (backupDir) => fs.chmodSync(backupDir, 0o700),
  });
  assert.ok(fs.existsSync(path.join(backup.backupDir, 'manifest.enc')));
  assert.ok(fs.existsSync(path.join(backup.backupDir, 'state', 'workspace', 'README.md')));
  assert.ok(fs.existsSync(path.join(backup.backupDir, 'state', '.prometheus', 'skills', 'local-skill', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(backup.backupDir, 'external', '0-configured-workspace', 'project.txt')));
  assert.ok(fs.existsSync(path.join(backup.backupDir, 'external', '1-configured-skills', 'imported-skill', 'SKILL.md')));
  const manifestSidecar = backup.manifest.entries.find((entry) => entry.label === 'configured-skills-manifests');
  const skillStateSidecar = backup.manifest.entries.find((entry) => entry.label === 'configured-skills-state');
  const skillLockSidecar = backup.manifest.entries.find((entry) => entry.label === 'configured-skills-lock');
  assert.ok(manifestSidecar && fs.existsSync(path.join(backup.backupDir, manifestSidecar.backupPath, 'imported-skill.source.json')));
  assert.ok(skillStateSidecar && fs.existsSync(path.join(backup.backupDir, skillStateSidecar.backupPath)));
  assert.ok(skillLockSidecar && fs.existsSync(path.join(backup.backupDir, skillLockSidecar.backupPath, 'lock.json')));
  assert.equal(fs.existsSync(path.join(backup.backupDir, 'state', '.prometheus', 'updates', 'must-not-copy.txt')), false);
  assert.equal(backup.manifest.protection, 'encrypted-manifest');
  assert.equal(fs.readFileSync(path.join(backup.backupDir, 'manifest.enc'), 'utf8'), 'fixture-safe-storage-ciphertext');
  assert.equal(fs.readFileSync(path.join(stateRoot, '.prometheus', 'vault', 'vault.enc'), 'utf8'), 'test-only encrypted marker');
  assert.equal(fs.readFileSync(path.join(externalRoot, 'project.txt'), 'utf8'), 'external marker');

  const pending = { backupId: backup.backupId, backupDir: backup.backupDir, targetVersion: '1.0.14' };
  updater.writePendingValidation(configDir, pending);
  assert.deepEqual(updater.readPendingValidation(configDir), { schemaVersion: 1, ...pending, createdAt: updater.readPendingValidation(configDir).createdAt });

  console.log('Canonical updater contract checks passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
