import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'workspace', 'skills');
const read = (id) => fs.readFileSync(path.join(root, id, 'SKILL.md'), 'utf8');

const creator = read('skill-creator');
assert.match(creator, /skill_candidate_submit/);
assert.match(creator, /Brain Curator is the sole automatic writer/);
assert.match(creator, /Assistant summaries, praise, completion claims, tool count/i);
assert.match(creator, /Do not[\s\S]*after every successful workflow/i);

const repair = read('self-repair-protocol');
assert.match(repair, /automation_dashboard/);
assert.match(repair, /workspace\/audit/);
assert.match(repair, /Never retry a write, message, purchase, deletion/i);
assert.doesNotMatch(repair, /src-edit-proposal-rigor|Telegram|source patch/i);
for (const unsafe of [
  /env\s*\|\s*grep/i,
  /git reset --hard/i,
  /\/workspace\/skills\/_state\.json/i,
]) assert.doesNotMatch(repair, unsafe);
const devEscalation = fs.readFileSync(path.join(root, 'self-repair-protocol', 'references', 'dev-escalation.md'), 'utf8');
assert.match(devEscalation, /src-edit-proposal-rigor/);

const pptx = read('pptx-writer');
assert.match(pptx, /fail-?closed/i);
assert.match(pptx, /test-backends\.ps1/);
assert.match(pptx, /Do not assume a fixed drive path/i);
assert.doesNotMatch(pptx, /D:\\Prometheus/i);

console.log('Phase 3 batch 3 skill contract tests passed.');
