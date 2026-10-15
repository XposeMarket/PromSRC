/**
 * Regression for the 2026-10-15 event-loop stalls: skill routing re-normalized
 * the whole user message once per trigger per skill. A ~12k-char paste across
 * ~200 skills froze the gateway for 9-12s and the stall watchdog restarted it.
 * Ranking must normalize the message once per pass and stay fast on long input,
 * while still routing on phrases that appear late in the message.
 */
import assert from 'assert';
import { performance } from 'perf_hooks';
import { rankSkillMatches, type Skill } from './skills-manager';
import { evaluateSkillPromptSignals } from './skill-package';
import { evaluatePromptSignals, exactPromptSignalMatch } from '../../runtime/prompt-signal-matcher';

function skill(i: number, triggers: string[], promptSignals?: any): Skill {
  const id = `perf-skill-${i}`;
  return {
    id, name: `Perf Skill ${i}`, description: `Synthetic routing skill number ${i} for load testing.`,
    implicitInvocation: true, instructions: `# ${id}`, triggers, categories: ['testing'], requiredTools: [],
    executionEnabled: true, status: 'ready', health: { state: 'ready' }, eligibility: { status: 'ready' },
    lifecycle: 'active', ownership: 'local', kind: 'simple', emoji: '', version: '1.0.0', permissions: {},
    resources: [], safety: {} as any, filePath: '', rootDir: '', entrypoint: 'SKILL.md', validation: {} as any,
    manifest: {} as any, manifestSource: 'native', promptSignals,
  } as unknown as Skill;
}

const WORDS = ['ledger', 'scheduler', 'durability', 'recovery', 'release', 'budget', 'gateway', 'process',
  'restart', 'migration', 'storage', 'review', 'architecture', 'connector', 'plugin', 'security'];
const skills: Skill[] = [];
for (let i = 0; i < 220; i++) {
  const w = (k: number) => WORDS[(i + k) % WORDS.length];
  skills.push(skill(i, [
    `${w(0)} ${w(3)} zq${i}`, `diagnose ${w(1)} ${w(5)} xk${i}`, `${w(2)}-${w(7)} audit pv${i}`,
    `fix ${w(4)} ${w(9)} mm${i}`, `check ${w(6)} ${w(11)} rr${i}`, `${w(8)} ${w(13)} plan tt${i}`,
  ], {
    phrases: [`${w(0)} ${w(2)} phrase${i}`, `${w(4)} ${w(6)} signal${i}`],
    allOf: [[`${w(1)}`, `group${i}`]], anyOf: [`${w(3)} ${w(5)} any${i}`], noneOf: [`never${i} ever`], minScore: 4,
  }));
}
// Target skill whose exact trigger only appears at the very end of the paste.
skills.push(skill(9999, ['torn ledger tail repair']));

const paragraph = 'PromSRC review: the ledger tolerates an incomplete final JSON record after a crash, '
  + 'the scheduler admission lease can be left empty, and the file budgets still allow old giant files. '
  + 'What I would change: recover the file before another append, define a crash-safe ownership protocol. ';
let longMessage = '';
while (longMessage.length < 14_000) longMessage += paragraph;
longMessage += ' Please do the torn ledger tail repair now.';

// Warm-up (module init, regex JIT) so the timing measures steady state.
rankSkillMatches(skills, 'warm up the router once', { limit: 12 });

const started = performance.now();
const ranked = rankSkillMatches(skills, longMessage, { limit: 12 });
const elapsedMs = performance.now() - started;
console.log(`rankSkillMatches: ${skills.length} skills x ${longMessage.length} chars in ${elapsedMs.toFixed(1)}ms`);
assert.ok(elapsedMs < 1500, `ranking a long paste must not stall the event loop (took ${elapsedMs.toFixed(0)}ms)`);
assert.equal(ranked[0]?.id, 'perf-skill-9999', 'a trigger at the tail of a long message must still route');

// Very large pastes (well past the routing cap) stay bounded and keep head+tail routing.
const huge = 'filler words about nothing in particular. '.repeat(6_000) + ' torn ledger tail repair';
const hugeStarted = performance.now();
const hugeRanked = rankSkillMatches(skills, huge, { limit: 4 });
const hugeMs = performance.now() - hugeStarted;
console.log(`rankSkillMatches: ${huge.length} chars in ${hugeMs.toFixed(1)}ms`);
assert.ok(hugeMs < 1500, `huge paste must stay bounded (took ${hugeMs.toFixed(0)}ms)`);
assert.equal(hugeRanked[0]?.id, 'perf-skill-9999', 'tail of a huge paste must still route');

// Prompt-signal evaluators: same long text across many skills must be cheap.
const signals = { phrases: ['crash safe ownership protocol'], allOf: [['ledger', 'append']], anyOf: ['file budgets'], noneOf: [], minScore: 4 };
const sigStarted = performance.now();
let matchedCount = 0;
for (let i = 0; i < 400; i++) {
  if (evaluateSkillPromptSignals(signals as any, longMessage).matched) matchedCount++;
  if (evaluatePromptSignals(signals, longMessage).matched) matchedCount++;
}
const sigMs = performance.now() - sigStarted;
console.log(`prompt signals: 800 evaluations in ${sigMs.toFixed(1)}ms`);
assert.equal(matchedCount, 800, 'signals must keep matching');
assert.ok(sigMs < 1500, `prompt signal evaluation must not re-normalize per term (took ${sigMs.toFixed(0)}ms)`);

// Semantics unchanged on the boundary rules.
assert.equal(exactPromptSignalMatch('ledger', 'the Ledger-tail'), true);
assert.equal(exactPromptSignalMatch('ledge', 'the ledger tail'), false);
assert.equal(exactPromptSignalMatch('', 'anything'), false);
assert.equal(rankSkillMatches(skills, 'unrelated chatter about lunch', { limit: 3 }).some(m => m.id === 'perf-skill-9999'), false);

console.log('skill matcher perf regression passed');
