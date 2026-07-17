import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromDist = (relativePath) => import(pathToFileURL(path.join(root, 'dist', relativePath)).href);

const loopIdentity = await fromDist('gateway/chat/tool-loop-identity.js');
const commonPrefix = { action: 'read_files', defaults: 'x'.repeat(260) };
assert.notEqual(
  loopIdentity.digestCanonicalToolArgs({ ...commonPrefix, files: [{ path: 'alpha/late-path.ts' }] }),
  loopIdentity.digestCanonicalToolArgs({ ...commonPrefix, files: [{ path: 'beta/late-path.ts' }] }),
  'arguments that differ after character 200 must have different loop identities',
);
assert.equal(
  loopIdentity.digestCanonicalToolArgs({ z: 1, nested: { b: false, a: 0 } }),
  loopIdentity.digestCanonicalToolArgs({ nested: { a: 0, b: false }, z: 1 }),
  'canonical loop identity must ignore object insertion order',
);
assert.notEqual(loopIdentity.digestCanonicalToolArgs({ enabled: false }), loopIdentity.digestCanonicalToolArgs({ enabled: true }));
assert.notEqual(loopIdentity.digestCanonicalToolArgs({ files: ['a', 'b', 'late-a'] }), loopIdentity.digestCanonicalToolArgs({ files: ['a', 'b', 'late-b'] }));

const browser = await fromDist('gateway/browser-tools.js');
assert.equal(browser.hasBrowserStructuredCollectionInput({}), false);
assert.equal(browser.hasBrowserStructuredCollectionInput({ schema_name: 'feed' }), true);
assert.equal(browser.hasBrowserStructuredCollectionInput({ item_root: 'post', fields: { title: { selector: 'h2' } } }), true);
assert.equal(browser.hasBrowserStructuredCollectionInput({ item_root: 'post' }), false);
const callerError = browser.resolveBrowserExtractionSchemaForUrl('https://example.com', {}, 'browser_scroll_collect_v2');
assert.match(callerError.error, /^browser_scroll_collect_v2 requires/);
const browserDefs = browser.getBrowserToolDefinitions();
const browserExtract = browserDefs.find((entry) => entry.function?.name === 'browser_extract')?.function;
assert.match(browserExtract.parameters.properties.action.description, /schema-free/);
assert.ok(browserExtract.parameters.properties.action.enum.includes('scroll_collect_structured'));
const browserSource = fs.readFileSync(path.join(root, 'src/gateway/browser-tools.ts'), 'utf8');
assert.match(browserSource, /\{ dir: direction, mult: multiplier \}/);
assert.doesNotMatch(browserSource, /\},\s*direction,\s*multiplier\s*\)/, 'page.evaluate must receive one serialized argument');

const cis = await fromDist('gateway/tools/defs/cis-system.js');
const skillOps = cis.getCisSystemTools().find((entry) => entry.function?.name === 'skill_ops')?.function;
const skillProps = skillOps.parameters.properties;
assert.equal(skillProps.triggerPositivePrompts.type, 'array');
assert.equal(skillProps.triggerPositivePrompts.items.type, 'string');
assert.equal(skillProps.triggerNegativePrompts.type, 'array');
assert.equal(skillProps.triggerNegativePrompts.items.type, 'string');
assert.equal(skillProps.repairs.items.properties.triggerPositivePrompts.type, 'array');

const skills = await fromDist('gateway/agents-runtime/capabilities/skills-executor.js');
const baseSkill = {
  id: 'example',
  name: 'Example',
  description: 'Use only when a request needs this focused example workflow and its exact checks.',
  triggers: ['focused example', 'example workflow', 'exact checks'],
  lifecycle: 'active',
  implicitInvocation: true,
};
assert.ok(!skills.scoreSkillMetadata(baseSkill).issues.includes('description_missing_usage_guidance'));
assert.ok(!skills.scoreSkillMetadata({ ...baseSkill, description: 'Use this skill when the focused example workflow is requested.' }).issues.includes('description_missing_usage_guidance'));
assert.ok(!skills.scoreSkillMetadata({ ...baseSkill, description: 'Use before changing a focused example integration.' }).issues.includes('description_missing_usage_guidance'));
assert.ok(!skills.scoreSkillMetadata({ ...baseSkill, description: 'Build and validate focused example integrations with bounded retries.' }).issues.includes('description_missing_usage_guidance'));
assert.ok(skills.scoreSkillMetadata({ ...baseSkill, description: 'A generic description of a workflow with enough words but no routing instruction.' }).issues.includes('description_missing_usage_guidance'));
const explicitAudit = skills.scoreSkillMetadata({ ...baseSkill, triggers: [], implicitInvocation: false });
assert.ok(!explicitAudit.issues.includes('no_triggers'));
assert.ok(explicitAudit.informational.includes('explicit_only_no_triggers'));

const skillsManagerModule = await fromDist('gateway/skills-runtime/skills-manager.js');
const liveManager = new skillsManagerModule.SkillsManager(path.join(root, 'workspace', 'skills'));
const liveCatalog = liveManager.getAll();
for (const prompt of [
  'Find the first customers for my new SaaS product.',
  'Research potential early adopters using public buying signals.',
  'Identify design partners for my B2B startup.',
  'Create an evidence-backed shortlist of beta user prospects.',
]) {
  const top = skillsManagerModule.rankSkillMatches(liveCatalog, prompt, { limit: 1 })[0];
  assert.equal(top?.id, 'first-customer-finder', `expected first-customer-finder for: ${prompt}`);
  assert.equal(top?.confidence, 'high', `expected high-confidence first-customer routing for: ${prompt}`);
}
for (const prompt of [
  'Build a landing page for my product.',
  'Find nearby plumbers for a local lead generation campaign.',
  'Write a customer support email about a refund.',
  'Audit my social media profile and suggest posts.',
]) {
  const match = skillsManagerModule.rankSkillMatches(liveCatalog, prompt, { limit: 8 })
    .find((entry) => entry.id === 'first-customer-finder');
  assert.ok(!match || match.confidence === 'low', `unexpected first-customer routing for: ${prompt}`);
}

let writes = 0;
let forwardedMetadata;
const managerSkill = { ...baseSkill, triggers: ['old focused example', 'old example workflow', 'old exact checks'] };
const manager = {
  scanSkills() {},
  getAll() { return [managerSkill]; },
  get(id) { return id === managerSkill.id ? managerSkill : null; },
  writeManifestOverlay(id, manifest, metadata) {
    writes += 1;
    forwardedMetadata = metadata;
    return { ...managerSkill, ...manifest, id };
  },
};
const executeRepair = (repair) => skills.skillsCapabilityExecutor.execute({
  name: 'skill_repair_metadata',
  args: { mode: 'apply', confirm: true, repairs: [repair] },
  workspacePath: root,
  sessionId: 'regression',
  deps: { skillsManager: manager },
});
const blockedRepair = await executeRepair({ id: 'example', triggers: ['new focused example', 'new example workflow', 'new exact checks'] });
assert.equal(blockedRepair.error, true);
assert.equal(writes, 0, 'missing trigger evaluations must fail before any repair write');
assert.match(blockedRepair.result, /triggerPositivePrompts/);
const validRepair = await executeRepair({
  id: 'example',
  triggers: ['new focused example', 'new example workflow', 'new exact checks'],
  triggerPositivePrompts: ['Use the new focused example workflow.'],
  triggerNegativePrompts: ['Create an unrelated browser animation.'],
});
assert.equal(validRepair.error, false);
assert.equal(writes, 1);
assert.deepEqual(forwardedMetadata.triggerPositivePrompts, ['Use the new focused example workflow.']);
assert.deepEqual(forwardedMetadata.triggerNegativePrompts, ['Create an unrelated browser animation.']);

const chatSource = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');
assert.match(chatSource, /const loopWarningThreshold = 5/);
assert.match(chatSource, /const loopCriticalThreshold = 8/);
assert.doesNotMatch(chatSource, /JSON\.stringify\(normalize\(args \|\| \{\}\)\)\.slice\(0, 200\)/);

console.log('PASS: Prometheus tool issue regressions');
