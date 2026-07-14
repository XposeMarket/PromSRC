import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const { SkillsManager, rankSkillMatches } = await import('../dist/gateway/skills-runtime/skills-manager.js');

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const exceptions = new Set();
const hardBlocked = new Set();
const requiredExplicit = new Set([
  'brand-strategist', 'browse-sh-web-skills', 'context-pack-builder', 'css-animations',
  'day-trading-mnq-mgc', 'financial-analyst', 'hook-library', 'hr-recruiter',
  'mermaid-diagrams', 'operations-manager', 'polymarket-research', 'product-discovery',
  'prometheus-x-growth-operator', 'revenue-manager', 'social-intel', 'svg-diagrams',
  'tailwind', 'three', 'threejs-mobile-webgl', 'twitter-thread', 'typegpu', 'waapi',
  'animejs', 'chatgpt-desktop-restart', 'contribute-catalog', 'dev-debugging',
  'gsap', 'hyperframes-catalog-assets', 'hyperframes-cli', 'hyperframes-registry',
  'local-media-utilities', 'lottie', 'prometheus-ash-archive-style',
  'self-repair-protocol', 'skill-creator', 'windows-shell-playbook',
]);
const priorityEntrypoints = [
  'browser-automation-playbook', 'file-surgery', 'scheduler-operations-playbook',
  'x-browser-automation-playbook', 'professional-blog-posting-engine', 'local-lead-hunting',
  'task-lifecycle', 'exact-logo-brand-kit-workflow', 'web-design-skill',
  'desktop-automation-playbook',
];
const datePattern = /(?:19|20)\d{2}[-_](?:0[1-9]|1[0-2])[-_](?:0[1-9]|[12]\d|3[01])/;

function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.history') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else output.push(full);
  }
  return output;
}

function wordCount(value) {
  return (String(value).match(/[\p{L}\p{N}_-]+/gu) || []).length;
}

const manager = new SkillsManager(skillsRoot);
const catalog = manager.getAll();
const active = catalog.filter((skill) =>
  !['deprecated', 'archived'].includes(skill.lifecycle)
  && skill.executionEnabled !== false
  && skill.eligibility?.status === 'ready'
);
const migrated = active.filter((skill) => !exceptions.has(skill.id) && skill.ownership !== 'upstream-managed');

for (const id of exceptions) {
  const skill = manager.get(id);
  assert(skill, `missing phase-one exception ${id}`);
  assert(['blocked', 'partial'].includes(skill.health.state), `${id} must declare blocked or partial health`);
  assert(skill.health.reason, `${id} must expose a health reason`);
  assert(skill.health.lastVerified, `${id} must expose lastVerified`);
  assert.equal(skill.implicitInvocation, false, `${id} must be explicit-only`);
  assert.equal(manager.buildTurnContext('', { forcedSkillIds: [id] }).includes(`- ${id}`), !hardBlocked.has(id), `${id} manual selection does not match its health state`);
}

for (const skill of migrated) {
  assert.equal(skill.validation.errors.length, 0, `${skill.id} must load without validation errors`);
  assert(skill.triggers.length <= 12, `${skill.id} exceeds the 12-trigger cap`);
  assert(wordCount(fs.readFileSync(skill.filePath, 'utf8')) <= 750, `${skill.id} entrypoint remains over 750 words`);
  const raw = fs.readFileSync(skill.filePath, 'utf8');
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert(block, `${skill.id} is missing frontmatter`);
  const frontmatter = yaml.load(block[1]);
  assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name'], `${skill.id} frontmatter must contain only name and description`);
  assert.equal(String(frontmatter.name).trim().length > 0, true);
  assert.equal(String(frontmatter.description).trim().length > 0, true);
  for (const resource of skill.resources) {
    assert(fs.existsSync(path.join(skill.rootDir, resource.path)), `${skill.id} declares missing resource ${resource.path}`);
  }
  const dated = walk(skill.rootDir).filter((file) => datePattern.test(path.basename(file)));
  assert.equal(dated.length, 0, `${skill.id} still has dated resources: ${dated.join(', ')}`);
}

for (const id of requiredExplicit) {
  assert.equal(manager.get(id)?.implicitInvocation, false, `${id} must be explicit-only`);
}
for (const id of priorityEntrypoints) {
  const skill = manager.get(id);
  assert(skill, `missing priority skill ${id}`);
  assert(wordCount(fs.readFileSync(skill.filePath, 'utf8')) <= 750, `${id} entrypoint remains over 750 words`);
  assert(fs.existsSync(path.join(skill.rootDir, 'references', 'detailed-guide.md')), `${id} is missing its preserved detailed guide`);
}

const ownersByTrigger = new Map();
for (const skill of migrated) {
  for (const trigger of skill.triggers) {
    const key = trigger.toLowerCase();
    const owners = ownersByTrigger.get(key) || [];
    owners.push(skill.id);
    ownersByTrigger.set(key, owners);
  }
}
for (const [trigger, owners] of ownersByTrigger) {
  assert.equal(owners.length, 1, `exact trigger collision for “${trigger}”: ${owners.join(', ')}`);
}

for (const skill of migrated) {
  for (const trigger of skill.triggers) {
    const top = rankSkillMatches(migrated, trigger, { includeExplicitOnly: true, limit: 1 })[0];
    assert.equal(top?.id, skill.id, `${skill.id} does not win positive trigger “${trigger}” (got ${top?.id || 'none'})`);
    assert.equal(top?.confidence, 'high', `${skill.id} positive trigger “${trigger}” is not high confidence`);
  }
}

const negativePool = {
  coding: 'Fix a TypeScript authentication bug in the backend API and run tests.',
  email: 'Draft a concise email confirming our lunch meeting tomorrow.',
  creative: 'Create a watercolor landscape illustration with a gold frame.',
  social: 'Write a live X reply about today’s AI news.',
  documents: 'Summarize the attached Word contract into three bullets.',
  scheduling: 'Check whether the nightly scheduled job ran successfully.',
  business: 'Compare pricing strategy for three SaaS competitors.',
  desktop: 'Click the Save button in the native Windows application.',
};
const domainPatterns = {
  coding: /code|coding|typescript|javascript|frontend|api|database|git|shell|developer/,
  email: /email|gmail|outreach/,
  creative: /design|visual|image|video|animation|svg|mermaid|three|webgl|chart/,
  social: /twitter|\bx\b|social|post|thread/,
  documents: /document|docx|pdf|spreadsheet|xlsx|legal|meeting/,
  scheduling: /schedule|cron|background|task|agent|automation/,
  business: /sales|market|brand|revenue|financial|business|competitor|product|operation/,
  desktop: /desktop|windows|browser automation/,
};
for (const skill of migrated) {
  const metadata = `${skill.id} ${skill.name} ${skill.categories.join(' ')} ${skill.description}`.toLowerCase();
  const ownDomains = new Set(Object.entries(domainPatterns).filter(([, pattern]) => pattern.test(metadata)).map(([name]) => name));
  const negatives = Object.entries(negativePool).filter(([name]) => !ownDomains.has(name)).slice(0, 2);
  assert.equal(negatives.length, 2, `${skill.id} needs two negative prompt domains`);
  for (const [domain, prompt] of negatives) {
    const match = rankSkillMatches(active, prompt, { limit: 20 }).find((item) => item.id === skill.id);
    assert(!match || match.confidence === 'low', `${skill.id} incorrectly matches ${domain} negative prompt at ${match?.confidence}/${match?.score}`);
  }
}

const codingPrompt = 'Fix a TypeScript authentication bug and run the backend test suite.';
const codingMatches = rankSkillMatches(active, codingPrompt, { limit: 20 });
assert(!codingMatches.some((item) => /gmail|hyperframes|x-growth/.test(item.id)), 'coding prompt must not route to Gmail, HyperFrames, or X skills');
const codingContext = manager.buildTurnContext(codingPrompt);
assert((codingContext.match(/\[RELEVANT_SKILL\]/g) || []).length <= 1, 'at most one skill may be mandatory');
assert(!codingContext.includes('MUST skill_read EACH'));

const ordinaryThree = rankSkillMatches(active, 'Give me three options for the email subject.', { limit: 20 });
assert(!ordinaryThree.some((item) => item.id === 'three'), 'ordinary “three” must not invoke Three.js');
const mobileThree = rankSkillMatches(active, 'Use Three.js Mobile WebGL to debug these missing iPhone sprites.', { includeExplicitOnly: true, limit: 3 });
assert.equal(mobileThree[0]?.id, 'threejs-mobile-webgl');

for (const skill of catalog.filter((item) => ['deprecated', 'archived'].includes(item.lifecycle))) {
  const matches = rankSkillMatches(catalog, `Use skill:${skill.id} now.`, { includeExplicitOnly: true, limit: 20 });
  assert(!matches.some((item) => item.id === skill.id), `${skill.id} must be unroutable while ${skill.lifecycle}`);
}

console.log(`Live skill catalog regression passed: ${catalog.length} catalog entries, ${active.length} ready, ${migrated.length} migrated/tested, ${hardBlocked.size} blocked and ${exceptions.size - hardBlocked.size} partial exceptions.`);
