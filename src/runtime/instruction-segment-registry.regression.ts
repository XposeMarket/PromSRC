import assert from 'assert';
import {
  INSTRUCTION_SEGMENT_BY_ID,
  INSTRUCTION_SEGMENT_REGISTRY,
  STAGE3_PILOT_CATEGORY_IDS,
  getInstructionResolverMode,
  resolveStage3PilotPolicyDecision,
  resolveInstructionSegmentsShadow,
} from './instruction-segment-registry';
import { buildToolsContext, CATEGORY_POLICIES } from '../gateway/prompt-context';

function withResolverMode<T>(mode: 'legacy' | 'shadow' | 'pilot', fn: () => T): T {
  const previous = process.env.PROMETHEUS_INSTRUCTION_RESOLVER_MODE;
  process.env.PROMETHEUS_INSTRUCTION_RESOLVER_MODE = mode;
  try {
    assert.equal(getInstructionResolverMode(), mode);
    return fn();
  } finally {
    if (previous === undefined) delete process.env.PROMETHEUS_INSTRUCTION_RESOLVER_MODE;
    else process.env.PROMETHEUS_INSTRUCTION_RESOLVER_MODE = previous;
  }
}

function testRegistryIntegrity(): void {
  const ids = INSTRUCTION_SEGMENT_REGISTRY.map((segment) => segment.id);
  assert.equal(new Set(ids).size, ids.length, 'instruction segment IDs must be unique');
  assert.ok(ids.length >= 100, 'Phase 6A census registry must cover the complete instruction surface');
  for (const segment of INSTRUCTION_SEGMENT_REGISTRY) {
    assert.ok(segment.order > 0, `${segment.id}: missing order`);
    assert.ok(segment.owner, `${segment.id}: missing owner`);
    assert.ok(segment.triggerClass, `${segment.id}: missing trigger class`);
    assert.ok(segment.estimatedTokens > 0, `${segment.id}: missing token estimate`);
    assert.ok(segment.source, `${segment.id}: missing source`);
  }
  const ordered = [...INSTRUCTION_SEGMENT_REGISTRY].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  assert.deepEqual(INSTRUCTION_SEGMENT_REGISTRY, ordered, 'registry order must be deterministic');
}

function testMainShadowResolution(): void {
  const report = resolveInstructionSegmentsShadow({
    runtimeRole: 'main',
    executionMode: 'interactive',
    provider: 'openai',
    capabilities: { vision: true },
    activeToolCategories: [],
    exposedToolCategories: [],
    actualSegmentIds: ['core.identity.main', 'model.capabilities', 'model.current', 'tools.menu.categories', 'persona.prometheus_soul', 'persona.user', 'persona.workspace_soul', 'memory.workspace'],
    toolNames: ['web_search', 'write_note'],
  });
  assert.equal(report.mode, 'pilot');
  assert.ok(report.selectedSegmentIds.includes('core.identity.main'));
  assert.ok(report.selectedSegmentIds.includes('core.visual_grounding.vision'));
  assert.ok(!report.selectedSegmentIds.includes('core.identity.worker'));
  assert.ok(!report.selectedSegmentIds.includes('tools.category.integration_admin'));
  assert.ok(report.estimatedSavedTokens > 0, 'broad current menu should show theoretical savings');
  assert.deepEqual(report.missingRequiredSegmentIds, []);
  assert.equal(report.stage3Pilot.enabled, true);
}

function testRoleAndCategoryTriggers(): void {
  const report = resolveInstructionSegmentsShadow({
    runtimeRole: 'team_subagent',
    executionMode: 'team_subagent',
    provider: 'anthropic',
    capabilities: { vision: false },
    activeToolCategories: ['integration_admin', 'business'],
    actualSegmentIds: ['core.identity.worker', 'mode.team_subagent', 'tools.menu.categories', 'caller.team_subagent'],
    toolNames: ['mcp_server_manage', 'list_entities'],
    callerContextPresent: true,
  });
  assert.ok(report.selectedSegmentIds.includes('core.identity.worker'));
  assert.ok(report.selectedSegmentIds.includes('mode.team_subagent'));
  assert.ok(report.selectedSegmentIds.includes('tools.category.integration_admin'));
  assert.ok(report.selectedSegmentIds.includes('tools.category.business'));
  assert.ok(!report.selectedSegmentIds.includes('tools.category.proposal_admin'));
  assert.equal(report.decisions.find((decision) => decision.id === 'tools.category.integration_admin')?.reason, 'active_category=integration_admin');
}

function testPilotRegistryCoverage(): void {
  const expected = STAGE3_PILOT_CATEGORY_IDS.map((category) => `tools.category.${category}`).sort();
  const actual = INSTRUCTION_SEGMENT_REGISTRY.filter((segment) => segment.stage3Pilot).map((segment) => segment.id).sort();
  assert.deepEqual(actual, expected);
  for (const id of actual) assert.equal(INSTRUCTION_SEGMENT_BY_ID[id]?.owner, 'category_policy');
}

function testStage3PilotAuthorityAndRollback(): void {
  const previous = process.env.PROMETHEUS_INSTRUCTION_RESOLVER_MODE;
  try {
    delete process.env.PROMETHEUS_INSTRUCTION_RESOLVER_MODE;
    assert.equal(getInstructionResolverMode(), 'pilot', 'Stage 3 pilot must be the default');
  } finally {
    if (previous !== undefined) process.env.PROMETHEUS_INSTRUCTION_RESOLVER_MODE = previous;
  }

  for (const category of STAGE3_PILOT_CATEGORY_IDS) {
    const active = new Set<string>([category]);
    const legacy = withResolverMode('legacy', () => buildToolsContext(active));
    const shadow = withResolverMode('shadow', () => buildToolsContext(active));
    const pilot = withResolverMode('pilot', () => buildToolsContext(active));
    assert.equal(pilot, legacy, `${category}: pilot must preserve exact legacy prompt text`);
    assert.equal(shadow, legacy, `${category}: shadow must preserve exact legacy prompt text`);
    assert.ok(pilot.includes(CATEGORY_POLICIES[category]), `${category}: active policy missing`);
    assert.deepEqual(resolveStage3PilotPolicyDecision(category, active), {
      pilotCategory: true,
      included: true,
      reason: `active_category=${category}`,
    });
  }

  const legacyReport = withResolverMode('legacy', () => resolveInstructionSegmentsShadow({ runtimeRole: 'main' }));
  const shadowReport = withResolverMode('shadow', () => resolveInstructionSegmentsShadow({ runtimeRole: 'main' }));
  const pilotReport = withResolverMode('pilot', () => resolveInstructionSegmentsShadow({ runtimeRole: 'main' }));
  assert.equal(legacyReport.mode, 'legacy');
  assert.equal(shadowReport.mode, 'shadow');
  assert.equal(pilotReport.mode, 'pilot');
  assert.equal(legacyReport.stage3Pilot.enabled, false);
  assert.equal(shadowReport.stage3Pilot.enabled, false);
  assert.equal(pilotReport.stage3Pilot.enabled, true);

  const inactive = new Set<string>();
  const emptyLegacy = withResolverMode('legacy', () => buildToolsContext(inactive));
  const emptyPilot = withResolverMode('pilot', () => buildToolsContext(inactive));
  assert.equal(emptyPilot, emptyLegacy, 'inactive pilot must preserve the exact base prompt');
  for (const category of STAGE3_PILOT_CATEGORY_IDS) {
    assert.ok(!emptyPilot.includes(CATEGORY_POLICIES[category]), `${category}: inactive policy leaked`);
    assert.equal(resolveStage3PilotPolicyDecision(category, inactive).included, false);
  }

  const allPilot = new Set<string>(STAGE3_PILOT_CATEGORY_IDS);
  const allLegacy = withResolverMode('legacy', () => buildToolsContext(allPilot));
  const allShadow = withResolverMode('shadow', () => buildToolsContext(allPilot));
  const allEnabled = withResolverMode('pilot', () => buildToolsContext(allPilot));
  assert.equal(allEnabled, allLegacy, 'combined pilot ordering must match legacy');
  assert.equal(allShadow, allLegacy, 'combined shadow ordering must match legacy');
}

function testRuntimeRoleMatrix(): void {
  const cases: Array<[string, string, string | null]> = [
    ['main', 'core.identity.main', null],
    ['local_primary', 'core.identity.main', null],
    ['direct_subagent', 'core.identity.worker', null],
    ['background_agent', 'core.identity.worker', 'mode.background_agent'],
    ['team_subagent', 'core.identity.worker', 'mode.team_subagent'],
    ['team_manager', 'core.identity.main', 'mode.team_manager'],
    ['background_task', 'core.identity.main', 'mode.background_task'],
    ['proposal_execution', 'core.identity.main', 'mode.proposal_execution'],
    ['cron', 'core.identity.main', 'mode.cron'],
    ['heartbeat', 'core.identity.main', 'mode.heartbeat'],
    ['voice_agent', 'core.identity.main', null],
  ];
  for (const [runtimeRole, identity, mode] of cases) {
    const report = resolveInstructionSegmentsShadow({ runtimeRole, capabilities: { vision: false } });
    assert.ok(report.selectedSegmentIds.includes(identity), `${runtimeRole}: identity`);
    if (mode) assert.ok(report.selectedSegmentIds.includes(mode), `${runtimeRole}: mode`);
    assert.deepEqual(report.missingRequiredSegmentIds, [], `${runtimeRole}: required segments`);
  }
  const compactor = resolveInstructionSegmentsShadow({ runtimeRole: 'context_compactor' });
  assert.ok(compactor.selectedSegmentIds.includes('compactor.system'));
  assert.ok(compactor.selectedSegmentIds.includes('compactor.user_contract'));
  assert.ok(!compactor.selectedSegmentIds.includes('core.identity.main'));
}

testRegistryIntegrity();
testMainShadowResolution();
testRoleAndCategoryTriggers();
testPilotRegistryCoverage();
testStage3PilotAuthorityAndRollback();
testRuntimeRoleMatrix();
console.log('instruction segment registry and shadow resolver regression checks passed');
