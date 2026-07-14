import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const { SkillsManager } = await import('../dist/gateway/skills-runtime/skills-manager.js');
const { executeSkillRead } = await import('../dist/tools/skills.js');
const manager = new SkillsManager(path.join(repo, 'workspace', 'skills'));
manager.scanSkills();

delete process.env.PROMETHEUS_PUBLIC_BUILD;
const dev = manager.readAutoLoadedResources('self-repair-protocol');
assert.equal(dev.length, 1);
assert.equal(dev[0].path, 'references/dev-escalation.md');
assert.match(dev[0].content, /src-edit-proposal-rigor/);
const devRead = await executeSkillRead({ id: 'self-repair-protocol' }, manager);
assert.equal(devRead.success, true);
assert.match(devRead.stdout || '', /Auto-loaded development resource/);

process.env.PROMETHEUS_PUBLIC_BUILD = '1';
assert.deepEqual(manager.readAutoLoadedResources('self-repair-protocol'), []);
delete process.env.PROMETHEUS_PUBLIC_BUILD;

const publicSkill = path.join(repo, 'generated', 'bundled-skills', 'self-repair-protocol');
if (fs.existsSync(publicSkill)) {
  assert.equal(fs.existsSync(path.join(publicSkill, 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(publicSkill, 'references', 'dev-escalation.md')), false);
  const publicText = fs.readFileSync(path.join(publicSkill, 'SKILL.md'), 'utf8');
  assert.doesNotMatch(publicText, /src-edit-proposal-rigor|request_dev_source_edit|Telegram|PromSRC/);
  const manifest = JSON.parse(fs.readFileSync(path.join(publicSkill, 'skill.json'), 'utf8'));
  assert.equal((manifest.resources || []).some((resource) => resource.path === 'references/dev-escalation.md'), false);
  process.env.PROMETHEUS_PUBLIC_BUILD = '1';
  const publicRoot = path.join(repo, 'generated', 'bundled-skills');
  const safetyDirs = ['.quarantine', '.proposals', '.archive', '.history'].map((name) => path.join(publicRoot, name));
  const existedBefore = new Map(safetyDirs.map((dir) => [dir, fs.existsSync(dir)]));
  try {
    const publicManager = new SkillsManager(publicRoot);
    publicManager.scanSkills();
    const publicRead = await executeSkillRead({ id: 'self-repair-protocol' }, publicManager);
    assert.equal(publicRead.success, true);
    assert.doesNotMatch(publicRead.stdout || '', /dev-escalation|src-edit-proposal-rigor|Auto-loaded development resource/);
  } finally {
    delete process.env.PROMETHEUS_PUBLIC_BUILD;
    for (const dir of safetyDirs) {
      if (!existedBefore.get(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log('Self-repair public/dev skill boundary regression passed.');
