import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { evaluateSkillTriggerPolicy, validateSkillTriggerPolicy, loadSkillPackage } from './skill-package';
import { rankSkillMatches } from './skills-manager';
import { rankSkillsForQuery } from '../agents-runtime/capabilities/skills-executor';
import { selectSkillSlugsFromSkills } from '../../config/soul-loader';

// Reviewed, natural-language requests; not generated from matching terms.
const root = path.resolve(__dirname, '../../..');
const fixturePath = path.join(__dirname, 'fixtures/strict-skill-catalog.json');
const document = JSON.parse(fs.readFileSync(fixturePath, 'utf8').replace(/^\uFEFF/, ''));
const rows: any[] = Array.isArray(document) ? document : document.rows;
assert.ok(Array.isArray(rows) && rows.length >= 206, 'all workspace and connector IDs represented');
assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'unique IDs');
let assertions = 0;
const failures: string[] = [];
for (const row of rows) {
  const validation = validateSkillTriggerPolicy(row.triggerPolicy);
  assert.ok(validation.present && !validation.errors.length, `${row.id}: ${validation.errors.join(', ')}`);
  assert.ok(row.positivePrompts.length && row.negativePrompts.length && row.rationale, `${row.id}: reviewed examples and rationale required`);
  const policyExplicit = row.triggerPolicy.mode === 'explicit';
  const skill: any = { id: row.id, name: row.id, description: '', instructions: '', categories: [], requiredTools: [], tags: [], triggers: [], manifest: { triggerPolicy: row.triggerPolicy }, triggerPolicy: validation, status: 'active', health: { state: 'healthy' }, eligibility: { status: 'ready' }, executionEnabled: true };
  const info: any = { slug: row.id, name: row.id, description: '', content: '', triggers: [], triggerPolicy: validation };
  for (const [prompts, expected] of [[row.positivePrompts, !policyExplicit], [row.negativePrompts, false]] as const) {
    for (const prompt of prompts) {
      const actual = evaluateSkillTriggerPolicy(validation, prompt).admitted;
      if (actual !== expected) failures.push(`${row.id}: evaluator expected=${expected}: ${prompt}`);
      const ranked = rankSkillMatches([skill], prompt).some(match => match.id === row.id);
      if (ranked !== expected) failures.push(`${row.id}: manager expected=${expected}: ${prompt}`);
      const selected = selectSkillSlugsFromSkills([info], prompt, 3).includes(row.id);
      if (selected !== expected) failures.push(`${row.id}: soul expected=${expected}: ${prompt}`);
      assertions += 3;
    }
  }
  if (!rankSkillsForQuery([skill], row.id).some(match => match.skill.id === row.id)) failures.push(`${row.id}: remains discoverable`);
  assertions++;
  const connector = row.id === 'connector-google-drive' ? 'google_drive' : row.id.replace(/^connector-/, '');
  const sourceDir = ['connector-github', 'connector-gmail', 'connector-google-drive'].includes(row.id)
    ? path.join(root, 'src/extensions/bundled/connectors', connector, 'skill')
    : path.join(root, 'workspace/skills', row.id);
  if (!row.localOnly) {
    const pkg = loadSkillPackage(sourceDir, row.id);
    assert.ok(pkg, `${row.id}: canonical package exists`);
    assert.deepEqual(pkg.triggerPolicy?.policy, validation.policy, `${row.id}: canonical parsed policy matches reviewed data`);
    assertions++;
  }
}
assert.deepEqual(failures, [], `${failures.length} catalog routing failures:\n${failures.slice(0,30).join('\n')}`);
console.log(`PASS strict catalog: ${rows.length} IDs, ${assertions} evaluator/manager/soul/discovery/package checks`);
