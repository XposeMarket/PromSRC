/**
 * Skill authoring fidelity: agent-supplied metadata must survive creation, and
 * structured prompt signals must not be able to route on generic single words.
 *
 * Both defects were observed live: skill_ops create returned empty categories
 * and requiredTools after they were explicitly passed, and an anyOf list of
 * ["file","code","check","build","update"] with minScore 1 outranked every
 * purpose-built skill on "check the build output for errors".
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { validateSkillPromptSignals, evaluateSkillPromptSignals } from './skill-package.js';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}: ${(error as Error).message}`);
  }
}

console.log('skill-authoring-fidelity regression');

check('anyOf rejects generic single-word terms', () => {
  const result = validateSkillPromptSignals({
    anyOf: ['file', 'code', 'check', 'build', 'update'],
    minScore: 1,
  });
  assert.deepStrictEqual(result.signals?.anyOf ?? [], [], 'every generic term should be dropped');
  assert.ok(
    result.rejected.some(r => r.reason === 'anyOf_generic_or_short_single_word'),
    'rejection reason must be reported',
  );
});

check('anyOf rejects short single-word terms', () => {
  const result = validateSkillPromptSignals({ anyOf: ['vpk', 'tai'] });
  assert.deepStrictEqual(result.signals?.anyOf ?? [], [], 'sub-5-character single words are dropped');
});

check('anyOf keeps distinctive single words and all multiword terms', () => {
  const result = validateSkillPromptSignals({
    anyOf: ['vitashell', 'install vpk', 'promoter'],
  });
  const anyOf = result.signals?.anyOf ?? [];
  assert.ok(anyOf.includes('vitashell'), 'distinctive long single word survives');
  assert.ok(anyOf.includes('install vpk'), 'multiword term survives');
  assert.ok(anyOf.includes('promoter'), 'distinctive term survives');
});

check('generic anyOf list can no longer match an unrelated build request', () => {
  const result = validateSkillPromptSignals({
    anyOf: ['file', 'code', 'check', 'build', 'update'],
    minScore: 1,
  });
  // With every term dropped and no other signal present, there is nothing to
  // configure, so the skill cannot route structurally.
  const evaluation = evaluateSkillPromptSignals(result.signals, 'check the build output for errors');
  assert.strictEqual(evaluation.matched, false, 'generic-only signals must not match');
});

check('phrases and allOf still route normally', () => {
  const result = validateSkillPromptSignals({
    phrases: ['install the vpk on the vita'],
    allOf: [['vita', 'install']],
    noneOf: ['vitamin'],
    minScore: 4,
  });
  assert.ok(result.signals, 'signals should be configured');
  const hit = evaluateSkillPromptSignals(result.signals, 'install the vpk on the vita and launch it');
  assert.strictEqual(hit.matched, true, 'exact phrase must match');
  const miss = evaluateSkillPromptSignals(result.signals, 'what vitamin should I take');
  assert.strictEqual(miss.matched, false, 'noneOf must exclude');
});

check('createSkill accepts categories and requiredTools in its signature', () => {
  // Structural guard: the manager previously hardcoded [] and had no such
  // fields, so a passed value was silently discarded.
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'gateway', 'skills-runtime', 'skills-manager.ts'),
    'utf-8',
  );
  const signature = source.slice(source.indexOf('createSkill(data: {'));
  const head = signature.slice(0, signature.indexOf('}): Skill'));
  assert.ok(head.includes('categories?: string[]'), 'categories must be part of the createSkill input');
  assert.ok(head.includes('requiredTools?: string[]'), 'requiredTools must be part of the createSkill input');
  assert.ok(!/categories: \[\],/.test(source), 'categories must no longer be hardcoded to []');
  assert.ok(!/requiredTools: \[\],/.test(source), 'requiredTools must no longer be hardcoded to []');
});

if (failures) {
  console.error(`skill-authoring-fidelity regression FAILED (${failures})`);
  process.exit(1);
}
console.log('skill-authoring-fidelity regression passed');
