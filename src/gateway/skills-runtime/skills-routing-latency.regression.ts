import assert from 'assert/strict';
import { rankSkillMatches, type Skill } from './skills-manager';
const skill = { id: 'latency-probe', name: 'Latency Probe', description: '', triggers: ['measure response'], categories: [], requiredTools: [], lifecycle: 'active', executionEnabled: true, implicitInvocation: true, status: 'ready', health: { state: 'ready' }, eligibility: { status: 'ready' }, instructions: '' } as unknown as Skill;
const rank = (text: string) => rankSkillMatches([skill], text, { includeExplicitOnly: true });
const NativeRegExp = globalThis.RegExp;
let selectors = 0;
globalThis.RegExp = new Proxy(NativeRegExp, {
  construct(target, args, newTarget) {
    if (String(args[0]).includes('skill:')) selectors++;
    return Reflect.construct(target, args, newTarget);
  },
});
try {
  for (const text of ['measure response', 'unrelated request', 'Latency Probe']) rank(text);
} finally { globalThis.RegExp = NativeRegExp; }
assert.equal(selectors, 0, 'marker-free routing must not construct explicit-selector regexes');
for (const text of ['$latency-probe', 'use $LATENCY-PROBE!', 'skill:latency-probe,', 'use SKILL:latency-probe.']) {
  assert.equal(rank(text)[0]?.skill.id, skill.id, text);
  assert.equal(rank(text)[0]?.score >= 240, true, text);
}
for (const text of ['x$latency-probe', '$latency-probe-extra', 'xskill:latency-probe', 'skill:latency-probe-extra']) {
  assert(!rank(text).some(match => match.score >= 240), text);
}
assert.equal(rank('Latency Probe')[0]?.skill.id, skill.id);
assert.equal(rank('measure response')[0]?.skill.id, skill.id);
skill.name = 'Changed Unique Label';
assert.equal(rank('Changed Unique Label')[0]?.skill.id, skill.id);
console.log('PASS skill routing latency: zero marker-free selector constructions, explicit boundaries/case, plain names/triggers, mutable names');
