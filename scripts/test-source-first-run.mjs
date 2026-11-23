import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import policy from './public-skill-policy.js';
import { resolveSkillBundle } from '../electron/bundled-skills-path.js';
import { ensurePublicWorkspaceScaffold, seedBundledSkills } from '../src/config/public-workspace.ts';

const repo = path.resolve(import.meta.dirname, '..');
const bundle = resolveSkillBundle(false, repo, undefined);
assert.equal(bundle, path.join(repo, 'generated', 'bundled-skills'));
assert.equal(resolveSkillBundle(true, undefined, '/resources'), path.join('/resources', 'bundled-skills'));
const expected = policy.classifySourceSkills(path.join(repo, 'workspace', 'skills'));
const tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', 'workspace/skills'], {cwd: repo, encoding:'utf8'}).split('\0'));
for (const skill of expected) {
  const prefix = `workspace/skills/${skill.id}/`;
  if (![...tracked].some(file => file.startsWith(prefix))) continue;
  assert.equal(skill.visibility, 'public', `${skill.id}: private source directory tracked`);
  for (const rel of skill.excludedResources) assert(!tracked.has(prefix + rel), 'excluded resource tracked');
}
const ids = expected.filter(s => s.visibility === 'public').map(s => s.id).sort();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-first-run-'));
try {
  ensurePublicWorkspaceScaffold(temp);
  seedBundledSkills(temp, bundle);
  const skills = path.join(temp, 'skills');
  assert.deepEqual(fs.readdirSync(skills).filter(n => !n.startsWith('.')).sort(), ids);
  for (const id of ids) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(skills,id,'skill.json'))).visibility, 'public');
    assert.deepEqual(policy.scanSkillDirForLeaks(path.join(skills, id)), []);
  }
  const user = path.join(temp, 'USER.md');
  assert.match(fs.readFileSync(user,'utf8'), /^- Name:[ \t]*$/m);
  for (const dir of ['memory', 'projects']) assert.deepEqual(fs.readdirSync(path.join(temp,dir)), []);
  const custom = path.join(skills, 'git-workflow', 'SKILL.md');
  fs.writeFileSync(custom, 'locally edited'); fs.writeFileSync(user, 'existing profile');
  ensurePublicWorkspaceScaffold(temp); seedBundledSkills(temp, bundle);
  assert.equal(fs.readFileSync(custom,'utf8'), 'locally edited');
  assert.equal(fs.readFileSync(user,'utf8'), 'existing profile');
  console.log(`Fresh source startup: ${ids.length} public skills, blank profile, local edits preserved.`);
} finally { fs.rmSync(temp, {recursive:true, force:true}); }
