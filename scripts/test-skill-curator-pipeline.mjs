import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { recordSkillGardenerTurn, submitSkillGardenerCandidate } = await import('../dist/gateway/brain/skill-episodes.js');
const {
  applySkillCuratorSuggestion,
  rejectSkillCuratorSuggestion,
  runSkillCurator,
  listSkillCuratorSuggestions,
  getSkillCuratorStatus,
} = await import('../dist/gateway/skills-runtime/skill-curator.js');
const { SkillsManager } = await import('../dist/gateway/skills-runtime/skills-manager.js');

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-skill-curator-'));
  const skillsRoot = path.join(root, 'skills');
  const skillDir = path.join(skillsRoot, 'checkout-workflow');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: checkout-workflow',
    'description: Use this skill when auditing or repairing checkout analytics workflows.',
    'triggers: checkout analytics, checkout workflow',
    '---',
    '',
    '# Checkout workflow',
    'Inspect the current state, make the smallest change, and validate the result.',
    '',
  ].join('\n'));
  return { root, skillsRoot, manager: new SkillsManager(skillsRoot) };
}

function skillRead() {
  return { name: 'skill_read', args: { id: 'checkout-workflow' }, result: '# Checkout workflow', error: false };
}

function validation(error = false) {
  return {
    name: 'validate_checkout',
    args: {},
    result: error ? 'ERROR: checkout validation failed' : 'Validation passed',
    error,
  };
}

function readJsonlFiles(root, name) {
  const base = path.join(root, 'Brain');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const dirent of fs.readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (!dirent.isFile() || dirent.name !== name) continue;
    const filePath = path.join(dirent.parentPath || dirent.path, dirent.name);
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)) out.push(JSON.parse(line));
  }
  return out;
}

const workspaces = [];
try {
  {
    const ws = makeWorkspace();
    workspaces.push(ws.root);
    const result = recordSkillGardenerTurn({
      workspacePath: ws.root,
      sessionId: 'assistant-claims-success',
      executionMode: 'interactive',
      request: 'Inspect the checkout analytics panel.',
      finalResponse: 'Done. Great, perfect, and ready.',
      toolResults: [skillRead()],
    });
    assert.equal(result.candidates.length, 0, 'assistant-authored success language must not create actionable candidates');
    const episodes = readJsonlFiles(ws.root, 'episodes.jsonl');
    assert.equal(episodes.length, 1);
    assert(!episodes[0].outcomeHints.includes('completed_signal'));
    assert(!episodes[0].outcomeHints.includes('positive_signal'));
    assert(!episodes[0].userCorrectionHints.includes('explicit_reusable_instruction'));
  }

  {
    const ws = makeWorkspace();
    workspaces.push(ws.root);
    const first = recordSkillGardenerTurn({
      workspacePath: ws.root,
      sessionId: 'validated-first',
      executionMode: 'interactive',
      request: 'Audit the checkout analytics loading workflow and verify the empty state.',
      finalResponse: 'Done.',
      toolResults: [skillRead(), validation(false)],
    });
    assert.equal(first.candidates.length, 0, 'one validated session is not enough for a behavioral skill candidate');

    const second = recordSkillGardenerTurn({
      workspacePath: ws.root,
      sessionId: 'validated-second',
      executionMode: 'interactive',
      request: 'Audit the checkout analytics loading workflow and verify its empty state again.',
      finalResponse: 'Implemented and ready.',
      toolResults: [skillRead(), validation(false)],
    });
    const repeated = second.candidates.find((candidate) => candidate.type === 'add_resource_or_template');
    assert(repeated, 'a validated recurrence across distinct sessions should create a review candidate');
    assert(repeated.signalProvenance.includes('validation'));
    assert(repeated.signalProvenance.includes('repeated_session'));
    assert.deepEqual(repeated.corroboratingSessionIds, ['validated-first']);

    const failed = recordSkillGardenerTurn({
      workspacePath: ws.root,
      sessionId: 'failed-validation',
      executionMode: 'interactive',
      request: 'Audit the checkout analytics loading workflow.',
      finalResponse: 'Done anyway.',
      toolResults: [skillRead(), validation(true)],
    });
    assert(failed.candidates.some((candidate) => candidate.type === 'update_existing_skill'));
    assert(!failed.candidates.some((candidate) => candidate.type === 'add_resource_or_template'));
    const review = runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'dry-run' });
    assert(!review.suggestions.some((suggestion) => suggestion.lessonType === 'recovery'), 'one tool failure must not become a behavioral recovery suggestion');
  }

  {
    const ws = makeWorkspace();
    workspaces.push(ws.root);
    const explicit = recordSkillGardenerTurn({
      workspacePath: ws.root,
      sessionId: 'explicit-user-instruction',
      executionMode: 'interactive',
      request: 'From now on, remember to validate checkout analytics after changing the loader.',
      finalResponse: 'Sure, I will always remember that.',
      toolResults: [skillRead()],
    });
    const candidate = explicit.candidates.find((item) => item.type === 'add_resource_or_template');
    assert(candidate, 'an explicit user-authored reusable instruction should create a review candidate');
    assert(candidate.signalProvenance.includes('user_instruction'));
  }

  {
    const ws = makeWorkspace();
    workspaces.push(ws.root);
    const submitted = submitSkillGardenerCandidate({
      workspacePath: ws.root,
      sessionId: 'brain_dream_2099-01-01',
      executionMode: 'cron',
      type: 'create_new_skill_candidate',
      confidence: 'high',
      risk: 'high',
      reason: 'Validated checkout analytics work recurred without a focused skill.',
      suggestedAction: 'Review whether a focused checkout diagnostics skill is justified.',
      requestExcerpt: 'Audit checkout analytics diagnostics.',
      evidence: ['Brain/dreams/2099-01-01/dream.md'],
      submittedBy: 'brain_dream',
    });
    assert.equal(submitted.status, 'needs_review');

    const dryRun = runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'dry-run' });
    assert(dryRun.suggestions.some((item) => item.change.kind === 'review_only'));
    assert.equal(listSkillCuratorSuggestions(ws.root).length, 0, 'dry-run must not persist suggestions');

    const pending = runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'pending' });
    assert(pending.suggestions.some((item) => item.title === 'Review new skill candidate'));
    assert(listSkillCuratorSuggestions(ws.root).some((item) => item.status === 'pending'));

    const autoSafe = runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'auto-safe' });
    assert.equal(autoSafe.applied.length, 0, 'behavioral auto-apply must remain frozen');
    assert(!fs.existsSync(path.join(ws.skillsRoot, 'checkout-workflow', 'references')));
  }

  {
    const ws = makeWorkspace();
    workspaces.push(ws.root);
    submitSkillGardenerCandidate({
      workspacePath: ws.root,
      sessionId: 'canonical-resource-one',
      type: 'add_resource_or_template',
      skillId: 'checkout-workflow',
      confidence: 'high',
      risk: 'medium',
      reason: 'The user explicitly requested durable checkout validation behavior.',
      suggestedAction: 'Add a checkout validation checklist.',
      requestExcerpt: 'From now on remember to validate checkout analytics after loader changes.',
      evidence: ['Brain/skill-episodes/example-one.jsonl'],
      submittedBy: 'test',
    });
    runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'pending' });
    let suggestions = listSkillCuratorSuggestions(ws.root);
    const first = suggestions.find((item) => item.lessonType === 'workflow_recipe' && item.status === 'pending');
    assert(first);
    assert.equal(first.change.path, 'references/workflows/checkout-workflow.md');
    assert(!/\d{4}-\d{2}-\d{2}/.test(first.change.path));
    applySkillCuratorSuggestion(ws.root, ws.manager, first.id);

    submitSkillGardenerCandidate({
      workspacePath: ws.root,
      sessionId: 'canonical-resource-two',
      type: 'add_resource_or_template',
      skillId: 'checkout-workflow',
      confidence: 'high',
      risk: 'medium',
      reason: 'The user explicitly requested durable accessibility validation behavior.',
      suggestedAction: 'Add an accessibility validation step.',
      requestExcerpt: 'From now on remember to run accessibility validation after checkout UI changes.',
      evidence: ['Brain/skill-episodes/example-two.jsonl'],
      submittedBy: 'test',
    });
    runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'pending' });
    suggestions = listSkillCuratorSuggestions(ws.root);
    const second = suggestions.find((item) => item.lessonType === 'workflow_recipe' && item.status === 'pending');
    assert(second);
    assert.equal(second.change.path, 'references/workflows/checkout-workflow.md');
    applySkillCuratorSuggestion(ws.root, ws.manager, second.id);

    const canonical = fs.readFileSync(path.join(ws.skillsRoot, 'checkout-workflow', 'references', 'workflows', 'checkout-workflow.md'), 'utf8');
    assert(canonical.includes('checkout validation checklist'));
    assert(canonical.includes('accessibility validation step'));
    assert(!canonical.includes('Brain/skill-episodes'));
    assert(!canonical.includes('Captured:'));
    assert.equal(fs.readdirSync(path.join(ws.skillsRoot, 'checkout-workflow', 'references', 'workflows')).length, 1);

    const suppressedCandidate = {
      workspacePath: ws.root,
      sessionId: 'suppression-test',
      type: 'add_resource_or_template',
      skillId: 'checkout-workflow',
      confidence: 'high',
      risk: 'medium',
      reason: 'The user explicitly requested durable checkout retry behavior.',
      suggestedAction: 'Add a checkout retry checklist.',
      requestExcerpt: 'From now on remember to validate checkout retries.',
      evidence: ['Brain/skill-episodes/suppression.jsonl'],
      submittedBy: 'test',
    };
    submitSkillGardenerCandidate(suppressedCandidate);
    runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'pending' });
    suggestions = listSkillCuratorSuggestions(ws.root);
    const rejectable = suggestions.find((item) => item.status === 'pending' && item.learnedBehavior?.includes('checkout retry checklist'));
    assert(rejectable);
    rejectSkillCuratorSuggestion(ws.root, rejectable.id);
    submitSkillGardenerCandidate({ ...suppressedCandidate, sessionId: 'suppression-test-repeat' });
    runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'pending' });
    suggestions = listSkillCuratorSuggestions(ws.root);
    assert.equal(suggestions.find((item) => item.id === rejectable.id)?.status, 'rejected');

    const statePath = path.join(ws.root, 'Brain', 'skill-curator', 'suggestions.json');
    const old = {
      ...suggestions[0],
      id: 'expired_fixture',
      semanticKey: 'expired-fixture',
      status: 'pending',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-02-15T00:00:00.000Z',
    };
    fs.writeFileSync(statePath, `${JSON.stringify([...suggestions, old], null, 2)}\n`);
    runSkillCurator({ workspacePath: ws.root, skillsManager: ws.manager, mode: 'pending' });
    assert.equal(listSkillCuratorSuggestions(ws.root).find((item) => item.id === 'expired_fixture')?.status, 'expired');
    const compactStatus = getSkillCuratorStatus(ws.root);
    assert(compactStatus.recent.length <= 5, 'status must default to five compact rows');
    assert.equal(compactStatus.totalCount, listSkillCuratorSuggestions(ws.root).length);
    assert(!compactStatus.recent.some((item) => 'change' in item || 'evidence' in item), 'compact status must omit large suggestion bodies');
    const secondPage = getSkillCuratorStatus(ws.root, { limit: 1, cursor: 1 });
    assert.equal(secondPage.cursor, 1);
  }

  console.log('Skill curator pipeline regression tests passed.');
} finally {
  for (const root of workspaces) fs.rmSync(root, { recursive: true, force: true });
}
