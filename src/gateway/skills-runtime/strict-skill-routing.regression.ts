/**
 * Strict v2 triggerPolicy regression: validator fail-closed, Boolean evaluator
 * polarities, package parse retention, and manager automatic-vs-discovery
 * selection. Run: npm run test:strict-skill-routing
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  evaluateSkillPromptSignals,
  evaluateSkillTriggerPolicy,
  loadSkillPackage,
  validateSkillTriggerPolicy,
} from './skill-package';
import { rankSkillMatches } from './skills-manager';
import { selectSkillSlugsFromSkills } from '../../config/soul-loader';

const failures: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`not ok - ${name}`, err);
  }
}

type Validation = ReturnType<typeof validateSkillTriggerPolicy>;
const admits = (v: Validation, text: string) => evaluateSkillTriggerPolicy(v, text).admitted;

const portrait = validateSkillTriggerPolicy({
  version: 2,
  rules: [{ allOf: ['render', 'portrait'], anyOf: ['photo', 'painting'], noneOf: ['audit'] }],
});

check('v2 rule: allOf AND, anyOf OR, noneOf excludes (both polarities)', () => {
  assert.equal(admits(portrait, 'render a portrait photo'), true);
  assert.equal(admits(portrait, 'portrait photo'), false);
  assert.equal(admits(portrait, 'render portrait'), false);
  assert.equal(admits(portrait, 'audit render portrait photo'), false);
});

check('v2 policy: rules are OR across complete rules', () => {
  const v = validateSkillTriggerPolicy({
    version: 2,
    rules: [{ allOf: ['make', 'poster'] }, { allOf: ['draft', 'flyer'] }],
  });
  assert.equal(admits(v, 'draft a flyer'), true);
  assert.equal(admits(v, 'make a flyer'), false);
});

check('short domain tokens match only at token boundaries', () => {
  const ai = validateSkillTriggerPolicy({ version: 2, rules: [{ allOf: ['ai', 'video'] }] });
  assert.equal(admits(ai, 'make an AI video'), true);
  assert.equal(admits(ai, 'painting video'), false);
  assert.equal(admits(ai, 'aim video'), false);
});

check('malformed or unsupported v2 policies fail closed with errors', () => {
  const cases: unknown[] = [
    { version: 2, rules: [] },
    { version: 2, rules: [{ anyOf: ['photo'] }] },
    { version: 2, rules: [{ allOf: [] }] },
    { version: 2, rules: [{ allOf: ['draw'], anyOf: [] }] },
    { version: 2, rules: [{ allOf: ['draw'], noneOf: [42] }] },
    { version: 2, rules: [{ noneOf: ['audit'] }] },
    { version: 3, rules: [{ allOf: ['draw'] }] },
    { version: 2, mode: 'auto' },
    { version: 2, mode: 'explicit', rules: [{ allOf: ['draw'] }] },
    { version: 2, mode: 'bogus', rules: [{ allOf: ['draw'] }] },
    { version: 2, rules: [{ allOf: ['draw'], typo: ['x'] }] },
    'not-an-object',
  ];
  for (const raw of cases) {
    const v = validateSkillTriggerPolicy(raw);
    const label = JSON.stringify(raw);
    assert.equal(v.present, true, label);
    assert.equal(v.policy, undefined, label);
    assert.ok(v.errors.length > 0, label);
    assert.equal(evaluateSkillTriggerPolicy(v, 'draw').admitted, false, label);
    assert.equal(evaluateSkillTriggerPolicy(v, 'draw').invalid, true, label);
  }
});

check('explicit mode is discovery-only and never admits automatically', () => {
  const v = validateSkillTriggerPolicy({ version: 2, mode: 'explicit' });
  assert.equal(v.policy?.mode, 'explicit');
  const match = evaluateSkillTriggerPolicy(v, 'draw a picture');
  assert.equal(match.admitted, false);
  assert.equal(match.discoveryOnly, true);
});

check('null triggerPolicy is present-invalid (fail-closed), not absent', () => {
  const v = validateSkillTriggerPolicy(null);
  assert.equal(v.present, true);
  assert.equal(v.policy, undefined);
  assert.ok(v.errors.length > 0);
  assert.equal(evaluateSkillTriggerPolicy(v, 'anything at all').admitted, false);
});

check('explicit policy normalizes without rules and revalidates after JSON roundtrip', () => {
  const first = validateSkillTriggerPolicy({ version: 2, mode: 'explicit' });
  assert.ok(first.policy);
  assert.equal('rules' in first.policy!, false);
  const second = validateSkillTriggerPolicy(JSON.parse(JSON.stringify(first.policy)));
  assert.deepEqual(second.errors, []);
  assert.equal(second.policy?.mode, 'explicit');
  assert.equal(evaluateSkillTriggerPolicy(second, 'draw a picture').discoveryOnly, true);
});

check('auto policy normalized output revalidates to the identical policy', () => {
  const first = validateSkillTriggerPolicy({ version: 2, rules: [{ allOf: ['render', 'portrait'], anyOf: ['photo'], noneOf: ['audit'] }] });
  const second = validateSkillTriggerPolicy(JSON.parse(JSON.stringify(first.policy)));
  assert.deepEqual(second.errors, []);
  assert.deepEqual(second.policy, first.policy);
});

check('unknown x- extension key is accepted and not carried into the normalized policy', () => {
  const v = validateSkillTriggerPolicy({ version: 2, rules: [{ allOf: ['render', 'portrait'] }], 'x-owner': 'lane' });
  assert.deepEqual(v.errors, []);
  assert.equal(admits(v, 'render portrait'), true);
  assert.equal('x-owner' in (v.policy as object), false);
});

check('manifest triggerPolicy null is retained present-invalid through package parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-skill-null-'));
  fs.writeFileSync(path.join(dir, 'skill.json'), JSON.stringify({
    id: 'null-policy-test',
    name: 'Null Policy Test',
    description: 'Fixture skill whose triggerPolicy is explicit null for routing tests.',
    entrypoint: 'SKILL.md',
    triggers: ['make poster'],
    triggerPolicy: null,
  }));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: null-policy-test\n---\n# Null\n');
  const pkg = loadSkillPackage(dir, 'null-policy-test');
  assert.ok(pkg, 'package should load');
  assert.equal(pkg!.triggerPolicy?.present, true);
  assert.equal(pkg!.triggerPolicy?.policy, undefined);
  assert.ok((pkg!.triggerPolicy?.errors.length || 0) > 0);
});

check('absent triggerPolicy keeps v1 weighted semantics', () => {
  assert.equal(validateSkillTriggerPolicy(undefined).present, false);
  const signals = { phrases: ['make poster'], allOf: [], anyOf: [], noneOf: [], minScore: 4 };
  assert.equal(evaluateSkillPromptSignals(signals, 'please make poster').matched, true);
});

check('loadSkillPackage retains invalid raw triggerPolicy presence fail-closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-skill-'));
  fs.writeFileSync(path.join(dir, 'skill.json'), JSON.stringify({
    id: 'poster-test',
    name: 'Poster Test',
    description: 'Fixture skill that draws posters for routing tests only.',
    entrypoint: 'SKILL.md',
    triggers: ['make poster'],
    triggerPolicy: { version: 2, rules: [] },
  }));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: poster-test\n---\n# Poster\n');
  const pkg = loadSkillPackage(dir, 'poster-test');
  assert.ok(pkg, 'package should load');
  assert.equal(pkg!.triggerPolicy?.present, true);
  assert.equal(pkg!.triggerPolicy?.policy, undefined);
  assert.ok((pkg!.triggerPolicy?.errors.length || 0) > 0);
});

function fixtureSkill(id: string, raw: unknown, extra: Record<string, unknown> = {}): any {
  return {
    id,
    slug: id,
    name: id,
    kind: 'simple',
    version: '1.0.0',
    description: 'Fixture skill for strict routing regression tests only.',
    emoji: '',
    triggers: [],
    categories: [],
    requiredTools: [],
    permissions: {},
    resources: [],
    status: 'ready',
    lifecycle: 'active',
    health: { state: 'ready' },
    eligibility: { status: 'ready' },
    executionEnabled: true,
    implicitInvocation: true,
    triggerPolicy: validateSkillTriggerPolicy(raw),
    ...extra,
  };
}

check('manager ranker: failed v2 policy blocks legacy trigger and name mention, discovery stays broad', () => {
  // Policy the poster queries cannot satisfy: legacy trigger "make poster" alone must not admit.
  const poster = fixtureSkill('poster-art', { version: 2, rules: [{ allOf: ['poster', 'flyer'] }] }, {
    triggers: ['make poster'],
  });
  const portraitSkill = fixtureSkill('portrait-render', { version: 2, rules: [{ allOf: ['render', 'portrait'], anyOf: ['photo'] }] });
  const ids = (matches: Array<{ id: string }>) => matches.map((m) => m.id);

  assert.deepEqual(ids(rankSkillMatches([poster, portraitSkill], 'make poster', { limit: 8 })), []);
  assert.deepEqual(ids(rankSkillMatches([poster, portraitSkill], 'audit poster-art triggers', { limit: 8 })), []);
  assert.deepEqual(ids(rankSkillMatches([poster, portraitSkill], 'render a portrait photo', { limit: 8 })), ['portrait-render']);
  assert.ok(ids(rankSkillMatches([poster], 'make poster', { discovery: true, limit: 8 })).includes('poster-art'));
});

check('manager ranker: explicit-mode skill is excluded from automatic routing', () => {
  const explicitOnly = fixtureSkill('manual-only', { version: 2, mode: 'explicit' }, { triggers: ['draw picture'] });
  assert.deepEqual(rankSkillMatches([explicitOnly], 'draw picture', { limit: 8 }).map((m) => m.id), []);
  assert.ok(rankSkillMatches([explicitOnly], 'draw picture', { discovery: true, limit: 8 }).length >= 1);
});

function soulSkill(slug: string, raw: unknown, promptSignals?: unknown): any {
  return {
    slug,
    name: slug,
    description: 'Fixture skill for strict routing regression tests only.',
    content: 'Instructions.',
    triggers: [],
    promptSignals,
    triggerPolicy: validateSkillTriggerPolicy(raw),
    templates: [],
  };
}

check('v2 admission is authoritative over impossible v1 signals on manager and soul paths', () => {
  const impossibleV1 = { phrases: ['zzz never said'], allOf: [], anyOf: [], noneOf: [], minScore: 100 };
  const raw = { version: 2, rules: [{ allOf: ['render', 'portrait'] }] };
  const skill = fixtureSkill('v2-over-v1', raw, { promptSignals: impossibleV1 });
  const matches = rankSkillMatches([skill], 'render a portrait', { limit: 8 });
  assert.deepEqual(matches.map((m) => m.id), ['v2-over-v1']);
  assert.ok(matches[0].score >= 25);
  assert.ok(matches[0].promptSignalEvidence.some((e) => e.startsWith('triggerPolicy')));
  assert.deepEqual(selectSkillSlugsFromSkills([soulSkill('v2-over-v1', raw, impossibleV1)], 'render a portrait', 2), ['v2-over-v1']);
});

check('v2-only candidate (no legacy triggers or v1 signals) is admitted on both paths', () => {
  const raw = { version: 2, rules: [{ allOf: ['portrait'], anyOf: ['photo'] }] };
  const skill = fixtureSkill('v2-only', raw);
  assert.deepEqual(rankSkillMatches([skill], 'draw a portrait photo', { limit: 8 }).map((m) => m.id), ['v2-only']);
  assert.deepEqual(selectSkillSlugsFromSkills([soulSkill('v2-only', raw)], 'draw a portrait photo', 2), ['v2-only']);
  assert.deepEqual(rankSkillMatches([skill], 'portrait', { limit: 8 }).map((m) => m.id), []);
  assert.deepEqual(selectSkillSlugsFromSkills([soulSkill('v2-only', raw)], 'portrait', 2), []);
});

check('noneOf exclusion and name mention cannot admit on either path', () => {
  const raw = { version: 2, rules: [{ allOf: ['portrait'], noneOf: ['audit'] }] };
  const skill = fixtureSkill('v2-excl', raw, { triggers: ['make poster'] });
  assert.deepEqual(rankSkillMatches([skill], 'audit portrait v2-excl', { limit: 8 }).map((m) => m.id), []);
  assert.deepEqual(selectSkillSlugsFromSkills([soulSkill('v2-excl', raw)], 'audit portrait v2-excl', 2), []);
});

check('explicit-only reverse state: explicit is non-automatic, updated auto policy admits', () => {
  const explicit = fixtureSkill('reverse-state', { version: 2, mode: 'explicit' });
  assert.deepEqual(rankSkillMatches([explicit], 'draw a portrait', { limit: 8 }).map((m) => m.id), []);
  assert.deepEqual(selectSkillSlugsFromSkills([soulSkill('reverse-state', { version: 2, mode: 'explicit' })], 'draw a portrait', 2), []);
  const raw = { version: 2, mode: 'auto', rules: [{ allOf: ['draw', 'portrait'] }] };
  assert.deepEqual(validateSkillTriggerPolicy(raw).errors, []);
  const auto = fixtureSkill('reverse-state', raw);
  assert.deepEqual(rankSkillMatches([auto], 'draw a portrait', { limit: 8 }).map((m) => m.id), ['reverse-state']);
  assert.deepEqual(selectSkillSlugsFromSkills([soulSkill('reverse-state', raw)], 'draw a portrait', 2), ['reverse-state']);
});

if (failures.length) {
  console.error(`strict skill routing: ${failures.length} failed`);
  process.exit(1);
}
console.log('strict skill routing: all passed');
