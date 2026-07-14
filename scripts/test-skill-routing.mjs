import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PROMETHEUS_SKILL_ROUTING_MODE = 'legacy';

const { SkillsManager, rankSkillMatches } = await import('../dist/gateway/skills-runtime/skills-manager.js');
const { executeSkillRead } = await import('../dist/tools/skills.js');
const { submitSkillGardenerCandidate } = await import('../dist/gateway/brain/skill-episodes.js');
const { runSkillCurator, listSkillCuratorSuggestions, getSkillCuratorStatus } = await import('../dist/gateway/skills-runtime/skill-curator.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-skill-routing-'));
const skillsRoot = path.join(root, 'skills');

function writeSkill(id, manifest) {
  const dir = path.join(skillsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  const { instructions, resourceFiles, ...manifestFields } = manifest;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), instructions || `# ${manifest.name}\n\nFollow this focused workflow.\n`);
  for (const [relPath, content] of Object.entries(resourceFiles || {})) {
    const target = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(path.join(dir, 'skill.json'), `${JSON.stringify({
    schemaVersion: 'prometheus-skill-bundle-v1',
    id,
    entrypoint: 'SKILL.md',
    version: '1.0.0',
    categories: [],
    requiredTools: [],
    permissions: {},
    resources: [],
    ...manifestFields,
  }, null, 2)}\n`);
}

try {
  writeSkill('coding-debugger', {
    name: 'Coding Debugger',
    description: 'Use this skill when debugging TypeScript authentication APIs and backend build failures.',
    categories: ['coding', 'debugging'],
    triggers: ['fix typescript authentication bug', 'debug backend build failure'],
  });
  writeSkill('hyperframes-style', {
    name: 'HyperFrames Style',
    description: 'Use this manually for HyperFrames visual style direction and animated promo aesthetics.',
    categories: ['creative', 'video', 'style'],
    implicitInvocation: false,
    triggers: ['fix typescript authentication bug', 'hyperframes visual style'],
  });
  writeSkill('gmail-replies', {
    name: 'Gmail Replies',
    description: 'Use this skill when reading or replying to Gmail email messages.',
    categories: ['email'],
    triggers: ['reply gmail email', 'read gmail inbox'],
  });
  writeSkill('scheduler-operations', {
    name: 'Scheduler Operations',
    description: 'Use this skill when diagnosing scheduled jobs, cron runs, and stuck background automation.',
    categories: ['scheduling'],
    triggers: ['scheduled job stuck', 'debug cron run'],
  });
  writeSkill('generic-noise', {
    name: 'Generic Noise',
    description: 'A deliberately broad fixture.',
    categories: ['workflow'],
    triggers: ['code', 'help', 'workflow'],
  });
  writeSkill('trigger-cap-fixture', {
    name: 'Trigger Cap Fixture',
    description: 'Use this skill only for deterministic trigger cap testing.',
    categories: ['testing'],
    triggers: Array.from({ length: 16 }, (_, index) => `specific routing fixture ${index + 1}`),
  });
  writeSkill('three', {
    name: 'Three.js',
    description: 'Use explicitly for general Three.js scene implementation.',
    categories: ['creative', 'coding'],
    implicitInvocation: false,
    triggers: ['build a Three.js scene'],
  });
  writeSkill('threejs-mobile-webgl', {
    name: 'Three.js Mobile WebGL',
    description: 'Debug Three.js and WebGL failures specific to iPhone, iPad, or mobile Safari.',
    categories: ['creative', 'coding'],
    triggers: ['debug Three.js on iPhone', 'fix mobile WebGL sprites'],
  });
  writeSkill('src-edit-proposal-rigor', {
    name: 'Source Edit Proposal Rigor',
    description: 'Use this skill when fixing Prometheus source code and verifying changes in the live UI.',
    categories: ['coding'],
    requiredTools: ['workspace_read', 'workspace_edit', 'browser_automation'],
    triggers: ['fix a bug in Prometheus', 'Prometheus source code', 'live UI verification'],
  });
  writeSkill('chatgpt-desktop-restart', {
    name: 'ChatGPT Desktop Restart',
    description: 'Use this skill to restart or reopen the ChatGPT desktop application.',
    categories: ['desktop'],
    triggers: ['restart ChatGPT desktop'],
  });
  writeSkill('ghostwriter', {
    name: 'Ghostwriter',
    description: 'Use this skill to draft social posts without publishing them.',
    categories: ['writing', 'social'],
    triggers: ['draft an X post', 'write social copy'],
  });
  writeSkill('x-post-fetch', {
    name: 'X Post Fetch and Media',
    description: 'Use this browser skill to fetch a public X post and inspect media.',
    categories: ['social', 'browser'],
    requiredTools: ['browser'],
    triggers: ['fetch X post', 'analyze X media'],
  });
  writeSkill('bundle-completeness', {
    name: 'Bundle Completeness',
    description: 'Fixture proving that a bundle read returns the complete entrypoint and complete resource index.',
    triggers: ['verify bundle completeness'],
    instructions: '# Bundle Completeness\n\nENTRYPOINT-BEGIN\nEvery entrypoint instruction must survive.\nENTRYPOINT-END\n',
    resources: [
      { path: 'references/one.md', type: 'doc', description: 'First reference' },
      { path: 'templates/two.txt', type: 'template', description: 'Second template' },
    ],
    resourceFiles: {
      'references/one.md': 'RESOURCE-ONE-CONTENT',
      'templates/two.txt': 'RESOURCE-TWO-CONTENT',
    },
  });

  const manager = new SkillsManager(skillsRoot);
  assert.equal(manager.get('generic-noise').triggers.length, 0, 'generic single-word triggers must not activate');
  assert.equal(manager.get('trigger-cap-fixture').triggers.length, 12, 'active triggers must be capped at 12');
  assert.equal(manager.get('hyperframes-style').implicitInvocation, false);

  const codingPrompt = 'Fix a TypeScript authentication bug in the API and run the backend build.';
  const codingMatches = rankSkillMatches(manager.getAll(), codingPrompt, { limit: 8 });
  assert.equal(codingMatches[0]?.id, 'coding-debugger');
  assert.equal(codingMatches[0]?.confidence, 'high');
  assert(!codingMatches.some((match) => match.id === 'hyperframes-style'));
  assert(!codingMatches.some((match) => match.id === 'gmail-replies'));
  const codingContext = manager.buildTurnContext(codingPrompt);
  assert(codingContext.includes('[RELEVANT_SKILL] — one high-confidence read'));
  assert(codingContext.includes('- coding-debugger'));
  assert(!codingContext.includes('- hyperframes-style'));
  assert(!codingContext.includes('- gmail-replies'));
  assert.equal((codingContext.match(/\[RELEVANT_SKILL\]/g) || []).length, 1);
  assert(!codingContext.includes('MUST skill_read EACH'));
  process.env.PROMETHEUS_SKILL_ROUTING_MODE = 'shadow';
  const shadowCodingContext = manager.buildTurnContext(codingPrompt, { sessionId: 'shadow-routing-test' });
  assert.equal(shadowCodingContext, codingContext, 'shadow mode must preserve exact legacy prompt output');
  process.env.PROMETHEUS_SKILL_ROUTING_MODE = 'active';
  const activeCodingContext = manager.buildTurnContext(codingPrompt, { sessionId: 'active-routing-test' });
  assert(activeCodingContext.includes('[MATCHING_SKILLS]'));
  assert(activeCodingContext.includes('skill_read'));
  assert(!activeCodingContext.includes('Follow this focused workflow.'), 'matching must not auto-inject the skill entrypoint');
  process.env.PROMETHEUS_SKILL_ROUTING_MODE = 'legacy';

  const bundleRead = await executeSkillRead({ id: 'bundle-completeness' }, manager);
  assert.equal(bundleRead.success, true);
  assert(bundleRead.stdout.includes('ENTRYPOINT-BEGIN'));
  assert(bundleRead.stdout.includes('ENTRYPOINT-END'));
  assert(bundleRead.stdout.includes('references/one.md'));
  assert(bundleRead.stdout.includes('templates/two.txt'));
  assert(!bundleRead.stdout.includes('RESOURCE-ONE-CONTENT'), 'bundle resources stay progressive instead of polluting the entrypoint read');

  const genericContext = manager.buildTurnContext('Please help with this code task.');
  assert(!genericContext.includes('- generic-noise'));
  assert(!genericContext.includes('[RELEVANT_SKILL]'));

  const explicitStyle = rankSkillMatches(manager.getAll(), 'Use HyperFrames Style for this animated promo.', { limit: 3 });
  assert.equal(explicitStyle[0]?.id, 'hyperframes-style', 'explicitly named explicit-only skills must remain available');
  assert.equal(explicitStyle[0]?.confidence, 'high');

  const ordinaryThree = rankSkillMatches(manager.getAll(), 'Give me three options for the email subject.', { limit: 8 });
  assert(!ordinaryThree.some((match) => match.id === 'three'), 'ordinary uses of “three” must not explicitly invoke the Three.js skill');
  const mobileThree = rankSkillMatches(manager.getAll(), 'Use Three.js Mobile WebGL to debug these missing iPhone sprites.', { limit: 3 });
  assert.equal(mobileThree[0]?.id, 'threejs-mobile-webgl', 'the longest exact skill-name match must outrank a contained shorter name');

  const scheduled = rankSkillMatches(manager.getAll(), 'Check why the scheduled job is stuck.', { limit: 5 });
  assert.equal(scheduled[0]?.id, 'scheduler-operations');
  assert(!scheduled.some((match) => match.id === 'gmail-replies'));

  const sourceMatches = rankSkillMatches(manager.getAll(), 'I need help fixing a bug in the Prometheus desktop app source code and verifying it in the live UI.', { limit: 8 });
  assert.equal(sourceMatches[0]?.id, 'src-edit-proposal-rigor');
  assert(sourceMatches.findIndex((match) => match.id === 'chatgpt-desktop-restart') < 0 || sourceMatches.findIndex((match) => match.id === 'chatgpt-desktop-restart') > 0);

  const draftMatches = rankSkillMatches(manager.getAll(), 'Draft an X post about a new AI desktop app. Do not browse or publish it.', { limit: 8 });
  assert.equal(draftMatches[0]?.id, 'ghostwriter');
  assert(!draftMatches.some((match) => match.id === 'x-post-fetch'));

  const readySkill = manager.get('coding-debugger');
  const quarantined = { ...readySkill, id: 'quarantined-copy', executionEnabled: false, eligibility: { ...readySkill.eligibility, status: 'quarantined' } };
  assert(!rankSkillMatches([quarantined], codingPrompt).length, 'unavailable skills must be omitted by default');

  const coding = manager.get('coding-debugger');
  const nextTriggers = [...coding.triggers, 'checkout latency regression'];
  assert.throws(() => manager.writeManifestOverlay('coding-debugger', { ...coding.manifest, triggers: nextTriggers }), /positive and negative prompt evaluations/);
  const updated = manager.writeManifestOverlay('coding-debugger', { ...coding.manifest, triggers: nextTriggers }, {
    appliedBy: 'routing-test',
    reason: 'exercise deterministic trigger evaluation',
    triggerPositivePrompts: ['Diagnose the checkout latency regression in the TypeScript API.'],
    triggerNegativePrompts: ['Render a HyperFrames product promo video.'],
  });
  assert(updated.triggers.includes('checkout latency regression'));

  submitSkillGardenerCandidate({
    workspacePath: root,
    sessionId: 'good-trigger-candidate',
    type: 'add_trigger',
    skillId: 'coding-debugger',
    proposedTrigger: 'authentication token refresh failure',
    triggerPositivePrompts: ['Debug the authentication token refresh failure in TypeScript.'],
    triggerNegativePrompts: ['Render a HyperFrames launch video.', 'Reply to the Gmail client email.'],
    reason: 'Validated discovery gap for authentication token refresh failures.',
    suggestedAction: 'Evaluate one precise authentication failure trigger.',
    evidence: ['Brain/skill-episodes/good-trigger.jsonl'],
  });
  submitSkillGardenerCandidate({
    workspacePath: root,
    sessionId: 'bad-trigger-candidate',
    type: 'add_trigger',
    skillId: 'coding-debugger',
    proposedTrigger: 'code',
    triggerPositivePrompts: ['Help with code.'],
    triggerNegativePrompts: ['Render video code examples.'],
    reason: 'Deliberately generic trigger fixture.',
    suggestedAction: 'Reject this generic trigger.',
    evidence: ['Brain/skill-episodes/bad-trigger.jsonl'],
  });
  runSkillCurator({ workspacePath: root, skillsManager: manager, mode: 'pending' });
  const triggerSuggestions = listSkillCuratorSuggestions(root).filter((item) => item.lessonType === 'trigger_patch');
  assert(triggerSuggestions.some((item) => item.status === 'pending' && item.triggerEvaluation?.passed));
  assert(triggerSuggestions.some((item) => item.status === 'rejected' && item.triggerEvaluation?.passed === false));
  const compactStatus = getSkillCuratorStatus(root, { limit: 1 });
  assert.equal(compactStatus.recent.length, 1, 'curator status must honor its compact default page contract');
  assert.equal(compactStatus.includeContent, false);
  assert(!('suggestedAction' in compactStatus.recent[0]), 'compact status must not leak full suggestion content');
  assert.equal(typeof compactStatus.nextCursor, 'number');

  console.log('Skill routing regression tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
