import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  SkillsManager,
  rankSkillMatches,
} = await import('../dist/gateway/skills-runtime/skills-manager.js');
const {
  evaluateSkillPromptSignals,
  loadSkillPackage,
} = await import('../dist/gateway/skills-runtime/skill-package.js');

const signals = {
  phrases: ['nothing happened', 'api not responding', 'frozen'],
  allOf: [['stuck', 'workflow'], ['debug', 'api']],
  anyOf: ['stuck', 'hung', 'debug', 'error'],
  noneOf: ['css stuck', 'sticky position', 'create a button'],
  minScore: 4,
};

function fixture(id, extra = {}) {
  return {
    id,
    name: id,
    description: 'A debugging workflow.',
    emoji: '',
    version: '1.0.0',
    kind: 'bundle',
    triggers: [],
    categories: ['debugging'],
    requiredTools: [],
    permissions: {},
    resources: [],
    status: 'ready',
    health: { state: 'ready' },
    eligibility: { status: 'ready' },
    safety: {},
    lifecycle: 'active',
    ownership: 'local',
    executionEnabled: true,
    implicitInvocation: true,
    instructions: '# Instructions',
    filePath: '',
    rootDir: '',
    entrypoint: 'SKILL.md',
    validation: { ok: true, warnings: [], errors: [] },
    manifest: {},
    manifestSource: 'native',
    ...extra,
  };
}

const structured = fixture('structured-debugger', { promptSignals: signals });
const legacy = fixture('legacy-debugger', { triggers: ['debug workflow'] });

const phrase = rankSkillMatches([structured], 'The API not responding', { includeExplicitOnly: true, limit: 3 })[0];
assert.equal(phrase?.id, 'structured-debugger');
assert.equal(phrase?.confidence, 'high');
assert(phrase.promptSignalEvidence.some((item) => item.includes('phrase: api not responding')));

const conjunction = rankSkillMatches([structured], 'The workflow is stuck', { includeExplicitOnly: true, limit: 3 })[0];
assert.equal(conjunction?.id, 'structured-debugger');
assert(conjunction.promptSignalEvidence.some((item) => item.includes('allOf: stuck + workflow')));

const minScoreNoise = rankSkillMatches([structured], 'debug', { includeExplicitOnly: true, limit: 3 });
assert.equal(minScoreNoise.length, 0, 'one anyOf term must not bypass minScore');

const allOfRoute = rankSkillMatches([structured], 'debug the api', { includeExplicitOnly: true, limit: 3 })[0];
assert.equal(allOfRoute?.id, 'structured-debugger');

for (const negative of ['css stuck', 'sticky position', 'create a button that is broken']) {
  assert.equal(
    rankSkillMatches([structured], negative, { includeExplicitOnly: true, limit: 3 }).length,
    0,
    `${negative} must be excluded by noneOf`,
  );
}

const evaluated = evaluateSkillPromptSignals(signals, 'check the logs for a debug api');
assert.equal(evaluated.matched, true);
assert(evaluated.matchedAllOf.length === 1);

const legacyMatch = rankSkillMatches([legacy], 'debug workflow', { includeExplicitOnly: true, limit: 3 })[0];
assert.equal(legacyMatch?.id, 'legacy-debugger', 'flat triggers must remain compatible');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-prompt-signals-'));
try {
  const skillDir = path.join(tempRoot, 'skills', 'frontmatter-signal');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: frontmatter-signal
description: A skill loaded from nested YAML prompt signals.
metadata:
  promptSignals:
    phrases:
      - "white screen"
    allOf:
      - [check, logs]
    anyOf:
      - frozen
    noneOf:
      - "sticky position"
    minScore: 4
---

# Frontmatter signal fixture

Instructions.
`, 'utf8');
  const loaded = loadSkillPackage(skillDir, 'frontmatter-signal');
  assert(loaded?.promptSignals, 'nested frontmatter prompt signals should load');
  assert.deepEqual(loaded.promptSignals.phrases, ['white screen']);
  assert.equal(loaded.promptSignals.minScore, 4);
  assert.equal(
    rankSkillMatches([fixture('frontmatter-signal', { promptSignals: loaded.promptSignals })], 'white screen', { includeExplicitOnly: true, limit: 3 })[0]?.id,
    'frontmatter-signal',
  );

  const manager = new SkillsManager(tempRoot);
  assert(manager.get('frontmatter-signal'));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const manager = new SkillsManager(path.resolve('workspace', 'skills'));
assert(manager.get('investigation-mode'), 'the canonical investigation skill must be installed');
assert.equal(manager.resolveRuntimeRouting('The API is not responding').candidates[0]?.id, 'investigation-mode');
assert.equal(manager.resolveRuntimeRouting('Why is css stuck?').candidates.some((item) => item.id === 'investigation-mode'), false);

const creator = manager.get('skill-creator');
assert(creator?.promptSignals, 'the skill creator must expose structured prompt signals');
assert.equal(creator?.implicitInvocation, false, 'the skill creator must remain explicit-only');
const creatorPositive = rankSkillMatches([creator], 'Please recreate the skill creator skill with the new routing system.', { includeExplicitOnly: true, limit: 3 })[0];
assert.equal(creatorPositive?.id, 'skill-creator');
assert(creatorPositive.promptSignalEvidence.some((item) => item.includes('phrase: skill creator')));
assert.equal(
  rankSkillMatches([creator], 'How do I use this skill to create a button?', { includeExplicitOnly: true, limit: 3 }).length,
  0,
  'skill execution/use requests must not route to the skill creator',
);

console.log('Prompt signal routing passed: phrases, allOf, anyOf/minScore, noneOf, legacy compatibility, nested YAML, resolver, and live catalog.');
