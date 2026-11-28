import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real config and agent store are never touched.
// Higher-priority storage variables are cleared first: an inherited runtime dir would
// otherwise select canonical storage and override PROMETHEUS_DATA_DIR.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-agent-identity-file-'));
delete process.env.PROMETHEUS_RUNTIME_DIR;
delete process.env.PROMETHEUS_APP_DATA_DIR;
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

const LEGACY_FILE = [
  '# Forge',
  '',
  'Builds things.',
  '',
  '## Agent Identity',
  'Name: Forge',
  '',
  '## Personality And Voice',
  'Archetype: operator',
  'Avoid:',
  '- Do not perform a theatrical character or use catchphrases.',
  '- Do not over-explain your personality to the user; let it show subtly in the work.',
  '- Do not perform a theatrical character or use catchphrases.',
  '- Do not over-explain your personality to the user; let it show subtly in the work.',
  '',
  '## Base Preset Role',
  '(not recorded)',
  '',
  '',
  '## Standalone Subagent Identity',
  'You are a standalone one-off subagent, not a member of a managed team.',
  'You use the standard Prometheus runtime policies.',
  '',
  '## Instructions',
  'Build the game. Timeout: we never time out on purpose. Max steps: as many as it takes.',
  '- Do not perform a theatrical character or use catchphrases.',
  '- Do not perform a theatrical character or use catchphrases.',
  '',
  '## Constraints (DO NOT VIOLATE)',
  '',
  '',
  '## Success Criteria',
  'The game runs.',
  '',
  '## Forbidden Tools',
  '(none)',
  '',
  '## Configuration',
  '- Max steps: 20',
  '- Timeout: 300000ms',
  '- Model override: anthropic/claude-opus-5-5',
  '',
  '---',
  '**Note:** Edit this file to modify the subagent. Changes take effect on next call.',
].join('\n');

async function main() {
  const { stripLegacyGeneratedAgentPromptLines, writeAgentPromptFile } = await import('../agents/agent-prompt-file');
  const { buildSubagentIdentityMemoryContext } = await import('../agents/subagent-prompt-context');
  const { buildAgentIdentity, renderIdentityPrompt, isGeneratedVoiceGuidance } = await import('../agents/identity-generator');
  const { getConfig } = await import('../config/config');
  const { SubagentManager } = await import('./agents-runtime/subagent-manager');

  const workspace = process.env.PROMETHEUS_WORKSPACE_DIR as string;
  assert.ok(path.resolve(getConfig().getWorkspacePath()).startsWith(path.resolve(root)), 'config resolves inside the temp root');

  // ---- 1. Read-time filter on a legacy generated file ----
  const cleaned = stripLegacyGeneratedAgentPromptLines(LEGACY_FILE);
  assert.ok(!cleaned.includes('one-off'), 'false standalone sentence is dropped');
  assert.ok(!/^## Configuration$/m.test(cleaned), 'generated Configuration block is dropped');
  assert.ok(!/^- Max steps: 20$/m.test(cleaned) && !/^- Timeout: 300000ms$/m.test(cleaned), 'unenforced limits are dropped');
  assert.ok(!cleaned.includes('Edit this file to modify'), 'user-facing edit note is dropped');
  assert.ok(!cleaned.includes('## Constraints (DO NOT VIOLATE)'), 'empty Constraints heading is dropped');
  assert.ok(!cleaned.includes('## Forbidden Tools') && !cleaned.includes('(none)'), 'empty Forbidden Tools section is dropped');
  assert.ok(!cleaned.includes('## Base Preset Role') && !cleaned.includes('(not recorded)'), 'placeholder preset section is dropped');
  const personality = cleaned.slice(cleaned.indexOf('## Personality And Voice'), cleaned.indexOf('## Standalone Subagent Identity'));
  assert.equal((personality.match(/Do not perform a theatrical character/g) || []).length, 1, 'repeated personality bullets collapse to one');

  // What must survive.
  assert.ok(cleaned.includes('You use the standard Prometheus runtime policies.'), 'the rest of the identity block is kept');
  assert.ok(cleaned.includes('Build the game. Timeout: we never time out on purpose. Max steps: as many as it takes.'), 'hand-written prose that mentions limits is kept');
  const instructions = cleaned.slice(cleaned.indexOf('## Instructions'), cleaned.indexOf('## Success Criteria'));
  assert.equal((instructions.match(/Do not perform a theatrical character/g) || []).length, 2, 'repeated bullets outside the personality section are kept');
  assert.ok(cleaned.includes('## Success Criteria\nThe game runs.'), 'real sections are kept');
  assert.ok(!/\n{3,}/.test(cleaned), 'no runs of blank lines are left behind');

  // ---- 2. Look-alikes a user wrote are never touched ----
  const handWritten = [
    '# Desk',
    '',
    '## Configuration',
    'Timeout: ask the owner before waiting longer than a day.',
    '- Max steps: unlimited',
    '',
    '## Notes',
    'A standalone one-off subagent, not a member of a managed team, wrote the first draft.',
    '',
    '---',
    'Footer the user added.',
  ].join('\n');
  assert.equal(stripLegacyGeneratedAgentPromptLines(handWritten), handWritten, 'a file with no exact generated lines is returned unchanged');
  assert.equal(stripLegacyGeneratedAgentPromptLines(''), '', 'empty input is returned unchanged');

  // A Configuration section someone edited or wrote is not the generated block.
  const partialConfig = '## Configuration\n- Timeout: 5000ms\n\nRetry once.\n';
  assert.equal(stripLegacyGeneratedAgentPromptLines(partialConfig), partialConfig, 'a partial Configuration section is kept whole');
  const extendedConfig = '## Configuration\n- Max steps: 20\n- Timeout: 300000ms\n- Model override: (use default)\n\nAlways retry once before reporting.\n';
  assert.equal(stripLegacyGeneratedAgentPromptLines(extendedConfig), extendedConfig, 'a generated block someone added to is kept whole');
  const fenced = [
    '## Instructions',
    'Older files looked like this:',
    '```',
    '## Configuration',
    '- Max steps: 20',
    '- Timeout: 300000ms',
    '- Model override: (use default)',
    '',
    'You are a standalone one-off subagent, not a member of a managed team.',
    '```',
    'Do not copy that.',
  ].join('\n');
  assert.equal(stripLegacyGeneratedAgentPromptLines(fenced), fenced, 'nothing inside a fenced block is touched');

  const constraintsWithBody = '## Constraints (DO NOT VIOLATE)\n\n- Never delete records.\n\n## Forbidden Tools\n- shell\n';
  assert.equal(stripLegacyGeneratedAgentPromptLines(constraintsWithBody), constraintsWithBody, 'sections with real content are kept');

  // ---- 3. The run-prompt path applies the filter and leaves the file on disk alone ----
  const legacyRoot = path.join(root, 'legacy-agent');
  fs.mkdirSync(legacyRoot, { recursive: true });
  writeAgentPromptFile(legacyRoot, LEGACY_FILE);
  const context = buildSubagentIdentityMemoryContext({ identityRoot: legacyRoot });
  assert.ok(!context.includes('one-off') && !context.includes('Max steps: 20'), 'run prompt carries no false claim or fake limit');
  assert.equal(fs.readFileSync(path.join(legacyRoot, 'AGENT.md'), 'utf-8'), LEGACY_FILE, 'the file on disk is not rewritten');

  // ---- 4. Identity refresh does not grow, and a stale generated name is replaced ----
  const first = buildAgentIdentity({ id: 'agent_a', explicitName: 'Tally', description: 'counts signups' });
  const second = buildAgentIdentity({ id: 'agent_a', explicitName: 'Tally', description: 'counts signups', identity: first });
  const third = buildAgentIdentity({ id: 'agent_a', explicitName: 'Tally', description: 'counts signups', identity: second });
  const quirksOf = (identity: { personality?: { quirks?: string[] } }) => identity.personality?.quirks || [];
  assert.deepEqual(third.personality?.avoid, first.personality?.avoid, 'avoid list is stable across refreshes');
  assert.ok((first.personality?.avoid || []).length > 0, 'avoid list is present');
  assert.equal(new Set(quirksOf(third)).size, quirksOf(third).length, 'quirks hold no duplicates after refreshes');
  assert.equal(quirksOf(third).length, quirksOf(second).length, 'quirks stop growing after the first refresh');

  const renamed = buildAgentIdentity({
    id: 'agent_a',
    explicitName: 'Tally',
    description: 'counts signups',
    identity: { ...first, displayName: 'Tally', voiceGuidelines: String(first.voiceGuidelines || '').replace('You are Tally', 'You are Kepler') },
  });
  assert.ok(String(first.voiceGuidelines || '').startsWith('You are Tally'), 'fixture starts from the generated default');
  assert.ok(isGeneratedVoiceGuidance(renamed.voiceGuidelines) && String(renamed.voiceGuidelines || '').startsWith('You are Tally'), 'generated voice guidance follows the current name');
  const custom = buildAgentIdentity({ id: 'agent_a', explicitName: 'Tally', identity: { ...first, voiceGuidelines: 'Write like a night-shift accountant.' } });
  assert.equal(custom.voiceGuidelines, 'Write like a night-shift accountant.', 'voice guidance a user wrote is preserved');

  const rendered = renderIdentityPrompt(first);
  assert.ok(rendered.split('\n').length <= 8, `generated personality renders in a few lines (got ${rendered.split('\n').length})`);
  assert.ok(!rendered.includes('## Voice Guidance'), 'generated default voice guidance is not rendered');
  assert.ok(renderIdentityPrompt(custom).includes('Write like a night-shift accountant.'), 'custom voice guidance is rendered');

  // ---- 5. A newly generated identity file ----
  const manager = new SubagentManager(workspace);
  const created = (manager as any).createSubagent('fixture_builder', {
    name: 'Fixture',
    description: 'Builds the fixture.',
    system_instructions: 'Build the fixture and prove it runs.',
    success_criteria: 'The fixture runs.',
    constraints: [],
    model: 'anthropic/claude-opus-5-5',
    reasoning_effort: 'high',
  });
  const agentFile = path.join(workspace, '.prometheus', 'subagents', 'fixture_builder', 'AGENT.md');
  const generated = fs.readFileSync(agentFile, 'utf-8');
  for (const banned of ['one-off', 'not a member of a managed team', 'Max steps', 'Timeout:', 'Model override', '(not recorded)', '(none)', 'Constraints (DO NOT VIOLATE)', 'Edit this file']) {
    assert.ok(!generated.includes(banned), `generated identity file does not contain "${banned}"`);
  }
  assert.ok(generated.includes('## Instructions\nBuild the fixture and prove it runs.'), 'instructions are written');
  assert.ok(generated.includes('## Success Criteria\nThe fixture runs.'), 'success criteria are written');
  assert.equal(stripLegacyGeneratedAgentPromptLines(generated), generated, 'a new file has nothing for the legacy filter to remove');
  assert.equal(created.max_steps, 20, 'max_steps is still stored');
  assert.equal(created.timeout_ms, 300_000, 'timeout_ms is still stored');

  manager.updateSubagent('fixture_builder', { constraints: ['Never publish without a PASS.'] });
  assert.ok(fs.readFileSync(agentFile, 'utf-8').includes('## Constraints (DO NOT VIOLATE)\n- Never publish without a PASS.'), 'constraints appear once there are some');

  // ---- 6. An update does not write an older saved model back over the one in the global config ----
  const cm = getConfig();
  const entry = (id: string) => (((cm.getConfig() as any).agents || []) as any[]).find((a) => a.id === id);
  const setGlobal = (id: string, patch: Record<string, any>) => {
    const agents = [...(((cm.getConfig() as any).agents || []) as any[])];
    const i = agents.findIndex((a) => a.id === id);
    assert.ok(i >= 0, `fixture agent ${id} is registered`);
    agents[i] = { ...agents[i], ...patch };
    cm.updateConfig({ agents } as any);
  };
  // Settings changes the model and effort in the global config only; the agent's own file keeps the old ones.
  setGlobal('fixture_builder', { model: 'openai_codex/gpt-6-astra', reasoning_effort: 'medium' });
  manager.updateSubagent('fixture_builder', { system_instructions: 'Build the fixture, then test it.' });
  assert.equal(entry('fixture_builder').model, 'openai_codex/gpt-6-astra', 'an unrelated update keeps the model chosen in the global config');
  assert.equal(entry('fixture_builder').reasoning_effort, 'medium', 'an unrelated update keeps the effort chosen in the global config');
  assert.equal((manager as any).loadSubagent('fixture_builder').model, 'openai_codex/gpt-6-astra', "the agent's own file is brought in line");

  // An explicit model or effort in the patch still wins, and an empty effort still clears it.
  manager.updateSubagent('fixture_builder', { model: 'anthropic/claude-haiku-5-5', reasoning_effort: 'low' });
  assert.equal(entry('fixture_builder').model, 'anthropic/claude-haiku-5-5', 'an explicit model in the patch wins');
  assert.equal(entry('fixture_builder').reasoning_effort, 'low', 'an explicit effort in the patch wins');
  manager.updateSubagent('fixture_builder', { reasoning_effort: '' });
  assert.ok(!entry('fixture_builder').reasoning_effort, 'an empty effort clears it');

  // Settings removes the field to mean "inherit". An unrelated update must not bring the
  // agent's own older value back, for the model or for the effort.
  manager.updateSubagent('fixture_builder', { model: 'anthropic/claude-opus-5-5', reasoning_effort: 'high' });
  const clearGlobal = (id: string, keys: string[]) => {
    const agents = [...(((cm.getConfig() as any).agents || []) as any[])];
    const i = agents.findIndex((a) => a.id === id);
    const copy = { ...agents[i] };
    for (const key of keys) delete copy[key];
    agents[i] = copy;
    cm.updateConfig({ agents } as any);
  };
  clearGlobal('fixture_builder', ['model', 'reasoning_effort']);
  assert.ok(!entry('fixture_builder').model && !entry('fixture_builder').reasoning_effort, 'fixture: Settings cleared both fields');
  manager.updateSubagent('fixture_builder', { success_criteria: 'The fixture runs twice.' });
  assert.ok(!entry('fixture_builder').model, 'a model cleared in Settings stays cleared after an unrelated update');
  assert.ok(!entry('fixture_builder').reasoning_effort, 'an effort cleared in Settings stays cleared after an unrelated update');
  assert.ok(!(manager as any).loadSubagent('fixture_builder').model, "the agent's own file no longer carries the cleared model");
  assert.ok(!(manager as any).loadSubagent('fixture_builder').reasoning_effort, "the agent's own file no longer carries the cleared effort");

  console.log('agent identity file regression passed');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  });
