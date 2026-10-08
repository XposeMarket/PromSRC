// skill_list/skill_read used to call scanSkills() (a full reload of every skill,
// ~900 ms for ~200 skills) on every call. refreshSkillsIfChanged() must skip the
// reload when nothing changed, and must still pick up new, edited and deleted skills.
// The unchanged check is served by a recursive fs.watch dirty flag, so a
// mutation is visible once its watch event lands (well under one model round
// trip). settle() models the gap between two tool calls.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SkillsManager } from './skills-manager.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-skills-refresh-'));
const skillsDir = path.join(root, 'skills');
const write = (id: string, body: string) => {
  fs.mkdirSync(path.join(skillsDir, id), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, id, 'SKILL.md'), `---\nname: ${id}\ndescription: ${body}\n---\n\n# ${id}\n\n${body}\n`);
};
for (let i = 0; i < 25; i++) write(`skill-${i}`, `Test skill number ${i}`);

const settle = () => new Promise((r) => setTimeout(r, 150));

(async () => {
const sm = new SkillsManager(root);
assert.equal(sm.refreshSkillsIfChanged(), true, 'first call loads');
assert.equal(sm.getAll().length >= 25, true);

let calls = 0;
const original = sm.scanSkills.bind(sm);
(sm as any).scanSkills = (sig?: string) => { calls += 1; return original(sig); };

for (let i = 0; i < 5; i++) assert.equal(sm.refreshSkillsIfChanged(), false, 'unchanged tree must not reload');
assert.equal(calls, 0);

write('skill-new', 'Brand new skill');
await settle();
assert.equal(sm.refreshSkillsIfChanged(), true, 'new skill folder triggers reload');
assert(sm.get('skill-new'), 'new skill visible');

// In-place SKILL.md edit (folder mtime may not change on NTFS) with a different size.
fs.writeFileSync(path.join(skillsDir, 'skill-3', 'SKILL.md'), '---\nname: skill-3\ndescription: Edited description that is clearly longer than before\n---\n\n# skill-3\n');
await settle();
assert.equal(sm.refreshSkillsIfChanged(), true, 'edited SKILL.md triggers reload');
assert.match(String(sm.get('skill-3')?.description || ''), /Edited description/);

fs.rmSync(path.join(skillsDir, 'skill-7'), { recursive: true, force: true });
await settle();
assert.equal(sm.refreshSkillsIfChanged(), true, 'deleted skill triggers reload');
assert.equal(sm.get('skill-7'), undefined);

// Overlay manifest written under .manifests counts as a change.
fs.mkdirSync(path.join(skillsDir, '.manifests'), { recursive: true });
fs.writeFileSync(path.join(skillsDir, '.manifests', 'skill-1.skill.json'), JSON.stringify({ id: 'skill-1', description: 'Overlay description' }));
await settle();
assert.equal(sm.refreshSkillsIfChanged(), true, 'overlay triggers reload');

const t0 = performance.now();
for (let i = 0; i < 20; i++) sm.refreshSkillsIfChanged();
const perCall = (performance.now() - t0) / 20;
assert(perCall < 25, `unchanged check should be cheap, got ${perCall.toFixed(1)} ms`);

// With the watcher active, the unchanged path must not walk the tree at all.
if ((sm as any).treeWatcherActive) {
  let sigCalls = 0;
  const origSig = (sm as any).computeTreeSignature.bind(sm);
  (sm as any).computeTreeSignature = () => { sigCalls += 1; return origSig(); };
  for (let i = 0; i < 10; i++) sm.refreshSkillsIfChanged();
  assert.equal(sigCalls, 0, 'clean watched tree must skip the stat walk');
  write('skill-watch', 'Watch-detected skill');
  await settle();
  assert.equal(sm.refreshSkillsIfChanged(), true, 'watch event marks tree dirty');
  assert(sm.get('skill-watch'));
}

(sm as any).treeWatcher?.close?.();
fs.rmSync(root, { recursive: true, force: true });
console.log(`skills refresh cache regression: ok (unchanged check ${perCall.toFixed(3)} ms/call for 26 skills, watcher=${(sm as any).treeWatcherActive})`);
})().catch((err) => { console.error(err); process.exit(1); });
