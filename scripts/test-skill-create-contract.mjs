import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

const { SkillsManager } = await import('../dist/gateway/skills-runtime/skills-manager.js');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-skill-create-contract-'));
try {
  const manager = new SkillsManager(path.join(tempRoot, 'skills'));
  const skill = manager.createSkill({
    id: 'contract-created-skill',
    name: 'Contract Created Skill',
    description: 'A skill created by the manager contract regression.',
    triggers: ['contract created skill'],
    promptSignals: { phrases: ['contract created skill'], allOf: [['contract', 'created']], anyOf: ['skill'], minScore: 4 },
    triggerPositivePrompts: ['Use the contract created skill workflow.'],
    triggerNegativePrompts: ['Draft an unrelated lunch email.'],
    implicitInvocation: false,
    instructions: '# Contract Created Skill\n\nFollow the contract.\n',
  });

  const skillPath = path.join(skill.rootDir, 'SKILL.md');
  const raw = fs.readFileSync(skillPath, 'utf8');
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert(block, 'created skills must have a frontmatter block');
  assert.deepEqual(Object.keys(yaml.load(block[1])).sort(), ['description', 'name']);

  const manifest = JSON.parse(fs.readFileSync(path.join(skill.rootDir, 'skill.json'), 'utf8'));
  assert.deepEqual(manifest.triggers, ['contract created skill']);
  assert.deepEqual(manifest.promptSignals, { phrases: ['contract created skill'], allOf: [['contract', 'created']], anyOf: ['skill'], noneOf: [], minScore: 4 });
  assert.equal(manifest.implicitInvocation, false);
  assert.equal(manifest.permissions, undefined, 'createSkill must not invent permission metadata');
  assert.equal(skill.kind, 'bundle');
  assert.deepEqual(skill.triggers, ['contract created skill']);
  assert.equal(skill.implicitInvocation, false);

  const broadSkill = manager.createSkill({
    id: 'cinematic-style',
    name: 'Cinematic Style',
    description: 'A broad style skill with omitted invocation metadata.',
    instructions: '# Cinematic Style\n\nUse the existing style guidance.\n',
  });
  const broadManifest = JSON.parse(fs.readFileSync(path.join(broadSkill.rootDir, 'skill.json'), 'utf8'));
  assert.equal(broadManifest.implicitInvocation, undefined, 'omitted invocation metadata must stay omitted');
  assert.equal(broadSkill.implicitInvocation, false, 'the loader heuristic must keep broad style skills explicit-only');
  assert.deepEqual(broadSkill.permissions, {});
  assert.equal(broadManifest.permissions, undefined, 'omitted permissions must remain absent on disk');

  const ordinarySkill = manager.createSkill({
    id: 'ordinary-created-skill',
    name: 'Ordinary Created Skill',
    description: 'An ordinary skill with omitted invocation metadata.',
    instructions: '# Ordinary Created Skill\n\nUse the ordinary workflow.\n',
  });
  const ordinaryManifest = JSON.parse(fs.readFileSync(path.join(ordinarySkill.rootDir, 'skill.json'), 'utf8'));
  assert.equal(ordinaryManifest.implicitInvocation, undefined, 'ordinary omitted invocation metadata must stay omitted');
  assert.equal(ordinarySkill.implicitInvocation, true, 'ordinary skills must retain the normal implicit default');
  assert.deepEqual(ordinarySkill.permissions, {});
  assert.equal(ordinaryManifest.permissions, undefined);
  console.log('skill create frontmatter/manifest contract regression passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
