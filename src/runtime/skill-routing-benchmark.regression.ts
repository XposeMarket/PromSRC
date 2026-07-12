import assert from 'assert';
import {
  buildActiveSkillRoutingContext,
  resolveSkillRuntimeRouting,
  type SkillRoutingSkill,
} from './skill-routing-resolver';
import { rankSkillMatches, type Skill } from '../gateway/skills-runtime/skills-manager';
import { SKILL_ROUTING_BENCHMARK_CASES } from './skill-routing-benchmark.fixtures';

function skill(id: string, name: string, trigger: string, description: string, implicitInvocation = true): Skill {
  return {
    id, name, description, implicitInvocation, instructions: `# ${name}\n\nCOMPLETE-${id}-INSTRUCTIONS\nFollow ${trigger} exactly.\nEND-${id}`,
    triggers: [trigger], categories: [], requiredTools: [], executionEnabled: true, status: 'ready',
    health: { state: 'ready' }, eligibility: { status: 'ready' }, lifecycle: 'active',
    ownership: 'local', kind: 'simple', emoji: '', version: '1.0.0', permissions: {}, resources: [],
    safety: {} as any, filePath: '', rootDir: '', entrypoint: 'SKILL.md', validation: {} as any,
    manifest: {} as any, manifestSource: 'native',
  } as unknown as Skill;
}

const skills: Skill[] = [
  skill('coding-debugger', 'Coding Debugger', 'debug typescript authentication failure', 'Debug TypeScript authentication failures.'),
  skill('faceless-video', 'Faceless Video', 'create faceless explainer video', 'Create a faceless explainer video.'),
  skill('gmail-replies', 'Gmail Replies', 'reply to gmail email', 'Read and reply to Gmail email.'),
  skill('excel-model', 'Excel Model', 'build excel financial model', 'Build an Excel financial model.'),
  skill('mobile-webgl', 'Mobile WebGL', 'fix mobile webgl sprites on iphone', 'Fix mobile WebGL sprites on iPhone.'),
  skill('scheduler-operations', 'Scheduler Operations', 'diagnose scheduled job stuck in cron', 'Diagnose stuck scheduled cron jobs.'),
  skill('browser-smoke', 'Browser Smoke', 'run browser desktop smoke validation', 'Run browser and desktop smoke validation.'),
  skill('market-research', 'Market Research', 'current competitor market research', 'Research current competitors and markets.'),
  skill('ghostwriter', 'Ghostwriter', 'draft social post without publishing', 'Draft social posts without publishing.'),
  skill('document-ingestion', 'Document Ingestion', 'ingest a directory of documents into embeddings', 'Ingest documents into embeddings.'),
  skill('three', 'Three.js', 'build a three js scene', 'Build general Three.js scenes.', false),
];

function resolve(message: string, forcedSkillIds?: string[]) {
  const ranked = rankSkillMatches(skills, message, { limit: 12 });
  return resolveSkillRuntimeRouting({ skills, rankedMatches: ranked, message, forcedSkillIds });
}

let exact = 0;
const failures: Array<{ id: string; expected: string[]; actual: string[]; discoveryExpected: boolean; discoveryActual: boolean }> = [];
for (const test of SKILL_ROUTING_BENCHMARK_CASES) {
  const report = resolve(test.message);
  const actual = report.selected.map((item) => item.id).sort();
  const expected = [...test.expectedSelected].sort();
  const discoveryExpected = test.discoveryRecommended === true;
  if (JSON.stringify(actual) === JSON.stringify(expected) && report.discoveryRecommended === discoveryExpected) exact += 1;
  else failures.push({ id: test.id, expected, actual, discoveryExpected, discoveryActual: report.discoveryRecommended });
}

const explicit = resolve('Use $coding-debugger and skill:gmail-replies for this combined request.');
assert.deepEqual(explicit.selected.map((item) => item.id).sort(), ['coding-debugger', 'gmail-replies']);
const explicitOnly = resolve('Use Three.js for this scene.');
assert.equal(explicitOnly.selected[0]?.id, 'three');
const definitional = resolve('What does market research mean?');
assert.equal(definitional.selected.length, 0);
assert.equal(definitional.advisory.length, 0);
const unrelatedForced = resolve('Say hello.', ['coding-debugger']);
assert.equal(unrelatedForced.selected.length, 0);
assert(unrelatedForced.excluded.some((item) => item.id === 'coding-debugger' && item.reason === 'user_selected_but_not_relevant'));
const relevantForced = resolve('debug typescript authentication failure in the backend', ['coding-debugger']);
assert.equal(relevantForced.selected[0]?.reason, 'user_selected_relevant');
const excludedExplicit = resolveSkillRuntimeRouting({
  skills,
  rankedMatches: rankSkillMatches(skills, 'Use $coding-debugger for this.', { limit: 12 }),
  message: 'Use $coding-debugger for this.',
  excludedSkillIds: ['coding-debugger'],
});
assert.equal(excludedExplicit.selected.length, 0);

const complete = resolve('debug typescript authentication failure in the backend');
const activeContext = buildActiveSkillRoutingContext({ report: complete, skills: skills as SkillRoutingSkill[] });
assert(activeContext.includes('COMPLETE-coding-debugger-INSTRUCTIONS'));
assert(activeContext.includes('END-coding-debugger'));
assert(!activeContext.includes('COMPLETE-gmail-replies-INSTRUCTIONS'));

const originalMode = process.env.PROMETHEUS_SKILL_ROUTING_MODE;
process.env.PROMETHEUS_SKILL_ROUTING_MODE = 'shadow';
const shadow = resolve('debug typescript authentication failure in the backend');
assert.equal(shadow.mode, 'shadow');
assert.equal(shadow.completeInstructionsInjected, false);
process.env.PROMETHEUS_SKILL_ROUTING_MODE = 'legacy';
const legacy = resolve('debug typescript authentication failure in the backend');
assert.equal(legacy.mode, 'legacy');
assert.equal(legacy.completeInstructionsInjected, false);
if (originalMode === undefined) delete process.env.PROMETHEUS_SKILL_ROUTING_MODE;
else process.env.PROMETHEUS_SKILL_ROUTING_MODE = originalMode;

assert(SKILL_ROUTING_BENCHMARK_CASES.length >= 500);
assert.equal(failures.length, 0, `skill routing failures: ${JSON.stringify(failures.slice(0, 20))}`);
console.log(JSON.stringify({
  cases: SKILL_ROUTING_BENCHMARK_CASES.length,
  exact,
  accuracy: exact / SKILL_ROUTING_BENCHMARK_CASES.length,
  sources: Object.fromEntries(['typed', 'voice', 'collision', 'discovery'].map((source) => [source, SKILL_ROUTING_BENCHMARK_CASES.filter((item) => item.source === source).length])),
  explicitMultiSkill: explicit.selected.map((item) => item.id),
  completeInstructionInjection: true,
  failureCount: failures.length,
}, null, 2));
