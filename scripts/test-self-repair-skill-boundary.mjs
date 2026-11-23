import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const repo = path.resolve(import.meta.dirname, '..');
const { SkillsManager } = await import('../dist/gateway/skills-runtime/skills-manager.js');
const { skillsCapabilityExecutor } = await import('../dist/gateway/agents-runtime/capabilities/skills-executor.js');
// skill_read through the live capability executor (the old src/tools/skills.ts copy is retired).
const executeSkillRead = async (args, skillsManager) => {
  const r = await skillsCapabilityExecutor.execute({ name: 'skill_read', args, workspacePath: '', deps: { skillsManager }, sessionId: 'self_repair_boundary_test' });
  return { success: !r.error, stdout: String(r.result || '') };
};
// Exercise private opt-in using synthetic data, not a maintainer's real file.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-skill-fixture-'));
try {
const skill = path.join(fixture, 'skills', 'self-repair-protocol');
fs.cpSync(path.join(repo, 'workspace', 'skills', 'self-repair-protocol'), skill, { recursive: true });
fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
fs.writeFileSync(path.join(skill, 'references', 'dev-escalation.md'), 'Synthetic development escalation fixture.');
const manifestFile = path.join(skill, 'skill.json');
const fixtureManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
fixtureManifest.resources.push({path:'references/dev-escalation.md', type:'doc', description:'Synthetic fixture'});
fs.writeFileSync(manifestFile, JSON.stringify(fixtureManifest));
const manager = new SkillsManager(fixture);
manager.scanSkills();

delete process.env.PROMETHEUS_PUBLIC_BUILD;
const dev = manager.readAutoLoadedResources('self-repair-protocol');
assert.equal(dev.length, 1);
assert.equal(dev[0].path, 'references/dev-escalation.md');
assert.match(dev[0].content, /Synthetic development escalation fixture/);
const devRead = await executeSkillRead({ id: 'self-repair-protocol' }, manager);
assert.equal(devRead.success, true);
assert.match(devRead.stdout || '', /Auto-loaded development resource/);

process.env.PROMETHEUS_PUBLIC_BUILD = '1';
assert.deepEqual(manager.readAutoLoadedResources('self-repair-protocol'), []);
delete process.env.PROMETHEUS_PUBLIC_BUILD;

} finally { fs.rmSync(fixture, {recursive:true, force:true}); }

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
