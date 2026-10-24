import assert from 'node:assert/strict';
import { seedBundledSkillsIntoDir } from './public-workspace.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hashJson,
  rollbackTriggerPolicyMigration,
  runTriggerPolicyMigration,
  validateBaseline,
} from './skill-trigger-migration.js';

const POLICY = { version: 2, mode: 'auto', rules: [{ allOf: ['render', 'portrait'], anyOf: ['photo'] }] };
const SHIPPED = { name: 'portrait-skill', description: 'Portrait rendering', version: '1.0.0' };

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-migration-'));
  const bundled = path.join(root, 'bundled');
  const skills = path.join(root, 'installed');
  fs.mkdirSync(path.join(bundled, 'portrait-skill'), { recursive: true });
  fs.writeFileSync(path.join(bundled, 'portrait-skill', 'skill.json'), JSON.stringify({ ...SHIPPED, triggerPolicy: POLICY }));
  fs.mkdirSync(path.join(skills, 'portrait-skill'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'portrait-skill', 'skill.json'), JSON.stringify(SHIPPED, null, 2));
  fs.writeFileSync(path.join(skills, 'portrait-skill', 'SKILL.md'), '# custom instructions\n');
  const baseline = { version: 1, skills: { 'portrait-skill': { priorManifestHash: hashJson(SHIPPED), triggerPolicy: POLICY } } };
  return { root, bundled, skills, baseline, backupRoot: path.join(root, 'backups') };
}

function readInstalled(skills: string) {
  return fs.readFileSync(path.join(skills, 'portrait-skill', 'skill.json'), 'utf-8');
}

function main(): void {
  // 1. Engine validator rejects a rule with no allOf (shape-only check let this through).
  const badRules = { version: 1, skills: { 'portrait-skill': { priorManifestHash: hashJson(SHIPPED), triggerPolicy: { version: 2, mode: 'auto', rules: [{}] } } } };
  assert.ok(validateBaseline(badRules), 'rules:[{}] must be rejected');
  assert.ok(validateBaseline({ version: 9, skills: {} }), 'unsupported baseline version must be rejected');
  assert.equal(validateBaseline({ version: 1, skills: {} }), null, 'empty baseline is valid');

  // 2. Malformed baseline: dry-run and apply both fail closed with zero writes.
  {
    const t = setup();
    const before = readInstalled(t.skills);
    const r = runTriggerPolicyMigration({ skillsDir: t.skills, bundledSkillsDir: t.bundled, baseline: badRules, apply: true, backupRoot: t.backupRoot });
    assert.ok(r.fatal, 'malformed baseline must be fatal');
    assert.equal(r.applied, false);
    assert.equal(readInstalled(t.skills), before, 'no writes on malformed baseline');
    assert.equal(fs.existsSync(t.backupRoot), false, 'no snapshot on malformed baseline');
  }

  // 3. Customized v1 overlay (triggers/promptSignals) is preserved, not superseded by native v2.
  for (const key of ['triggers', 'promptSignals', 'triggerPolicy']) {
    const t = setup();
    fs.mkdirSync(path.join(t.skills, '.manifests'), { recursive: true });
    const overlayPath = path.join(t.skills, '.manifests', 'portrait-skill.skill.json');
    const overlayBody = JSON.stringify({ [key]: key === 'triggers' ? ['custom'] : { mode: 'custom' } });
    fs.writeFileSync(overlayPath, overlayBody);
    const before = readInstalled(t.skills);
    const r = runTriggerPolicyMigration({ skillsDir: t.skills, bundledSkillsDir: t.bundled, baseline: t.baseline, apply: true, backupRoot: t.backupRoot });
    assert.equal(r.items[0].status, 'preserved-overlay', `overlay ${key} must preserve`);
    assert.equal(readInstalled(t.skills), before, `native manifest untouched for overlay ${key}`);
    assert.equal(fs.readFileSync(overlayPath, 'utf-8'), overlayBody, 'overlay byte-identical');
  }

  // 4. Dry-run default writes nothing; apply adds triggerPolicy and keeps SKILL.md byte-identical.
  const t = setup();
  const before = readInstalled(t.skills);
  const dry = runTriggerPolicyMigration({ skillsDir: t.skills, bundledSkillsDir: t.bundled, baseline: t.baseline, backupRoot: t.backupRoot });
  assert.equal(dry.applied, false);
  assert.equal(dry.items[0].status, 'add');
  assert.equal(readInstalled(t.skills), before, 'dry-run must not write');

  const applied = runTriggerPolicyMigration({ skillsDir: t.skills, bundledSkillsDir: t.bundled, baseline: t.baseline, apply: true, backupRoot: t.backupRoot, now: new Date('2026-10-24T00:00:00Z') });
  assert.equal(applied.applied, true);
  assert.ok(applied.snapshotDir && fs.existsSync(path.join(applied.snapshotDir, 'manifest.json')), 'snapshot written');
  const migrated = JSON.parse(readInstalled(t.skills));
  assert.deepEqual(migrated.triggerPolicy, POLICY);
  assert.equal(migrated.name, SHIPPED.name, 'existing fields preserved');
  assert.equal(fs.readFileSync(path.join(t.skills, 'portrait-skill', 'SKILL.md'), 'utf-8'), '# custom instructions\n');

  // 5. Repeated run is idempotent: status current, no new snapshot.
  const again = runTriggerPolicyMigration({ skillsDir: t.skills, bundledSkillsDir: t.bundled, baseline: t.baseline, apply: true, backupRoot: t.backupRoot });
  assert.equal(again.items[0].status, 'current');
  assert.equal(again.snapshotDir, undefined, 'no snapshot when nothing changes');

  // 6. Rollback restores exact prior bytes.
  rollbackTriggerPolicyMigration(applied.snapshotDir!);
  assert.equal(readInstalled(t.skills), before, 'rollback restores bytes');

  // 7. BOM-prefixed installed manifest parses and migrates.
  fs.writeFileSync(path.join(t.skills, 'portrait-skill', 'skill.json'), `\uFEFF${JSON.stringify(SHIPPED)}`);
  const bom = runTriggerPolicyMigration({ skillsDir: t.skills, bundledSkillsDir: t.bundled, baseline: t.baseline, apply: true, backupRoot: t.backupRoot });
  assert.equal(bom.items[0].status, 'add', 'BOM manifest must be read');

  // 8. Customized installed manifest (differs from shipped) is preserved and reported.
  fs.writeFileSync(path.join(t.skills, 'portrait-skill', 'skill.json'), JSON.stringify({ ...SHIPPED, description: 'edited' }));
  const custom = runTriggerPolicyMigration({ skillsDir: t.skills, bundledSkillsDir: t.bundled, baseline: t.baseline, apply: true, backupRoot: t.backupRoot });
  assert.equal(custom.items[0].status, 'manual');

  // 9. Malformed installed manifest: fail closed, no writes anywhere.
  fs.writeFileSync(path.join(t.skills, 'portrait-skill', 'skill.json'), '{not json');
  const mal = runTriggerPolicyMigration({ skillsDir: t.skills, bundledSkillsDir: t.bundled, baseline: t.baseline, apply: true, backupRoot: t.backupRoot });
  assert.ok(mal.fatal, 'malformed installed manifest must abort apply');
  assert.equal(fs.readFileSync(path.join(t.skills, 'portrait-skill', 'skill.json'), 'utf-8'), '{not json');

  seedUpgradeAndFreshSeed();

  console.log('skill trigger migration regression passed');
}

function seedUpgradeAndFreshSeed(): void {
  // Existing install: seeding skips the directory, but the trigger-only upgrade still adds triggerPolicy.
  const t = setup();
  const overlayPath = path.join(t.skills, '.manifests', 'portrait-skill.skill.json');
  fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
  const overlayBody = JSON.stringify({ description: 'user overlay' });
  fs.writeFileSync(overlayPath, overlayBody);
  seedBundledSkillsIntoDir(t.skills, t.bundled, t.baseline);
  assert.equal(JSON.parse(readInstalled(t.skills)).triggerPolicy?.version, 2, 'seed upgrade adds triggerPolicy');
  assert.equal(fs.readFileSync(overlayPath, 'utf-8'), overlayBody, 'seed never overwrites overlays');
  assert.equal(fs.readFileSync(path.join(t.skills, 'portrait-skill', 'SKILL.md'), 'utf-8'), '# custom instructions\n');

  // Fresh seed: empty target copies the bundled skill (already carrying the policy) and reports nothing to upgrade.
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-fresh-'));
  seedBundledSkillsIntoDir(fresh, t.bundled, t.baseline);
  assert.equal(fs.readFileSync(path.join(fresh, 'portrait-skill', 'skill.json'), 'utf-8'), fs.readFileSync(path.join(t.bundled, 'portrait-skill', 'skill.json'), 'utf-8'), 'fresh seed copies bundled bytes');
  const freshRun = runTriggerPolicyMigration({ skillsDir: fresh, bundledSkillsDir: t.bundled, baseline: t.baseline, backupRoot: t.backupRoot });
  assert.equal(freshRun.items[0].status, 'current', 'fresh seed is current, not re-migrated');

  // Missing bundled source: no crash, manifests reported as manual.
  const none = runTriggerPolicyMigration({ skillsDir: fresh, bundledSkillsDir: path.join(t.root, 'absent'), baseline: t.baseline });
  assert.equal(none.items[0].status, 'manual', 'missing bundled source is reported, not fatal');
}

function seedDefaultDerivesBaseline(): void {
  // Known unchanged install: pre-v2 manifest, bundle ships the v2 policy. Default call, NO baseline arg.
  const t = setup();
  seedBundledSkillsIntoDir(t.skills, t.bundled);
  const upgraded = JSON.parse(readInstalled(t.skills));
  assert.equal(upgraded.triggerPolicy?.version, 2, 'default seed derives baseline and upgrades unchanged manifest');
  assert.equal(upgraded.name, SHIPPED.name, 'other manifest fields preserved');

  // Customized installed manifest is NOT upgraded by the default path.
  const c = setup();
  const customized = { ...SHIPPED, description: 'user edited' };
  fs.writeFileSync(path.join(c.skills, 'portrait-skill', 'skill.json'), JSON.stringify(customized));
  seedBundledSkillsIntoDir(c.skills, c.bundled);
  assert.equal(JSON.parse(readInstalled(c.skills)).triggerPolicy, undefined, 'customized manifest is not upgraded');
}

seedDefaultDerivesBaseline();
main();
