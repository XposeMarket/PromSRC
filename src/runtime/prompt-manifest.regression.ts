import assert from 'assert';
import { PROMPT_CACHE_MARKER } from '../providers/LLMProvider';
import {
  buildRuntimePromptManifest,
  resolveRuntimePromptRole,
  RUNTIME_PROMPT_MANIFEST_VERSION,
} from './prompt-manifest';

function testRoleMatrix(): void {
  const cases: Array<[string, string, string]> = [
    ['interactive', 'default', 'main'],
    ['interactive', 'local_llm', 'local_primary'],
    ['interactive', 'direct_subagent', 'direct_subagent'],
    ['interactive', 'voice_agent', 'voice_agent'],
    ['background_agent', 'default', 'background_agent'],
    ['team_subagent', 'default', 'team_subagent'],
    ['team_manager', 'default', 'team_manager'],
    ['background_task', 'default', 'background_task'],
    ['proposal_execution', 'default', 'proposal_execution'],
    ['cron', 'default', 'cron'],
    ['heartbeat', 'default', 'heartbeat'],
  ];
  for (const [executionMode, personalityProfile, expected] of cases) {
    assert.equal(resolveRuntimePromptRole({ executionMode, personalityProfile }), expected);
  }
  assert.equal(resolveRuntimePromptRole({ agentId: 'context_compactor' }), 'context_compactor');
}

function buildMainGolden() {
  const system = [
    'You are Prom, a local AI assistant running inside Prometheus.',
    '[MODEL_CAPABILITIES]\nprovider=openai\nmodel=gpt-test\nvision=true',
    '[CURRENT_MODEL]\nprovider=openai\nmodel=gpt-test',
    '[PROMETHEUS_SOUL]\ncore soul',
    '[USER]\nuser profile',
    '[SOUL]\nworkspace soul',
    '[MEMORY]\nworkspace memory',
    '[TOOLS]\ncore tools loaded',
    PROMPT_CACHE_MARKER,
    '[TODAY_NOTES — read-only context]\nlatest note',
    '[SKILLS]\nworkflow rule',
  ].join('\n\n');
  return buildRuntimePromptManifest({
    callType: 'chat',
    provider: 'openai',
    model: 'gpt-test',
    role: 'executor',
    sessionId: 'golden-main',
    agentId: 'main',
    timestamp: '2026-07-12T12:00:00.000Z',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: 'Inspect the current page.' },
    ],
    tools: [
      { type: 'function', function: { name: 'read_file', description: 'Read a file.', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'browser_open', description: 'Open a page.', parameters: { type: 'object' } } },
    ],
    context: {
      executionMode: 'interactive',
      personalityProfile: 'default',
      surface: 'chat',
      promptVariant: 'current_primary',
      activeToolCategories: ['browser_automation'],
      exposedToolCategories: ['browser_automation'],
      declaredSystemSegmentIds: ['core.base', 'personality.context'],
      callerContextPresent: false,
      capabilities: { vision: true, provider: 'openai', model: 'gpt-test' },
      skillRouting: {
        version: 2,
        mode: 'active',
        messageHash: 'fixture',
        candidates: [],
        excluded: [],
        discoveryRecommended: false,
        discoveryReason: '',
        autoInjectedInstructions: false,
        instructionsRequireSkillRead: true,
      },
    },
  });
}

function testMainGolden(): void {
  const manifest = buildMainGolden();
  assert.deepEqual({
    version: manifest.version,
    provider: manifest.provider,
    model: manifest.model,
    runtimeRole: manifest.runtimeRole,
    executionMode: manifest.executionMode,
    personalityProfile: manifest.personalityProfile,
    surface: manifest.surface,
    promptVariant: manifest.promptVariant,
    capabilities: manifest.capabilities,
    systemSegmentIds: manifest.systemSegmentIds,
    toolNames: manifest.toolSurface.names,
    activeCategories: manifest.toolSurface.activeCategories,
    exposedCategories: manifest.toolSurface.exposedCategories,
    messageCounts: {
      total: manifest.messageSurface.count,
      system: manifest.messageSurface.systemCount,
      user: manifest.messageSurface.userCount,
    },
    cacheMarkerPresent: manifest.systemMessages[0]?.cacheMarkerPresent,
  }, {
    version: RUNTIME_PROMPT_MANIFEST_VERSION,
    provider: 'openai',
    model: 'gpt-test',
    runtimeRole: 'main',
    executionMode: 'interactive',
    personalityProfile: 'default',
    surface: 'chat',
    promptVariant: 'current_primary',
    capabilities: { model: 'gpt-test', provider: 'openai', vision: true },
    systemSegmentIds: [
      'context.intraday',
      'core.base',
      'core.identity.main',
      'memory.workspace',
      'model.capabilities',
      'model.current',
      'persona.prometheus_soul',
      'persona.user',
      'persona.workspace_soul',
      'personality.context',
      'skills.general',
      'tools.menu.categories',
    ],
    toolNames: ['browser_open', 'read_file'],
    activeCategories: ['browser_automation'],
    exposedCategories: ['browser_automation'],
    messageCounts: { total: 2, system: 1, user: 1 },
    cacheMarkerPresent: true,
  });
  assert.ok((manifest.systemMessages[0]?.stablePrefixChars || 0) > 0);
  assert.ok(manifest.systemMessages[0]?.stablePrefixHash, 'manifest must expose a privacy-safe stable-prefix fingerprint');
  assert.ok((manifest.systemMessages[0]?.volatileTailChars || 0) > 0);
  assert.equal(manifest.instructionResolution.mode, 'pilot');
  assert.equal(manifest.instructionResolution.stage3Pilot.enabled, true);
  assert.ok(manifest.instructionResolution.selectedSegmentIds.includes('core.identity.main'));
  assert.deepEqual(manifest.instructionResolution.missingRequiredSegmentIds, []);
  assert.equal(manifest.stage4InstructionRouting.mode, 'active');
  assert.ok(manifest.stage4InstructionRouting.estimatedSavedTokens >= 0);
  assert.equal(manifest.skillRouting?.mode, 'active');
  assert.equal(manifest.skillRouting?.autoInjectedInstructions, false);
  assert.equal(manifest.skillRouting?.instructionsRequireSkillRead, true);
}

function testCachePrefixFingerprint(): void {
  const common = {
    callType: 'chat' as const,
    provider: 'openai_codex',
    model: 'gpt-5.6-terra',
    timestamp: '2026-07-12T12:00:00.000Z',
  };
  const first = buildRuntimePromptManifest({
    ...common,
    messages: [{ role: 'system', content: `stable policy${PROMPT_CACHE_MARKER}Current date: 09:00.` }],
  });
  const second = buildRuntimePromptManifest({
    ...common,
    messages: [{ role: 'system', content: `stable policy${PROMPT_CACHE_MARKER}Current date: 09:01.` }],
  });
  assert.equal(first.systemMessages[0]?.stablePrefixHash, second.systemMessages[0]?.stablePrefixHash);
  assert.notEqual(first.systemMessages[0]?.volatileTailHash, second.systemMessages[0]?.volatileTailHash);
  assert.notEqual(first.messageSurface.hash, second.messageSurface.hash);
}

function testWorkerAndProviderGolden(): void {
  const manifest = buildRuntimePromptManifest({
    callType: 'chat',
    provider: 'anthropic',
    model: 'claude-test',
    role: 'executor',
    sessionId: 'team_dispatch_example',
    agentId: 'researcher',
    timestamp: '2026-07-12T12:00:00.000Z',
    messages: [{
      role: 'system',
      content: [
        'EXECUTION MODE: Team subagent task.',
        'You are researcher, a distinct member of Research Team operating inside Prometheus. You are not Prom or the main chat.',
        '[PROMETHEUS_RUNTIME_CONTRACT]\nshared capability and execution contract',
        '[AGENT_MEMORY - PRIVATE TO THIS AGENT]\nagent memory',
        '[TOOLS]\ncore tools',
        '[TEAM DISPATCH — Research Team | agent: researcher]',
      ].join('\n\n'),
    }],
    tools: [{ type: 'function', function: { name: 'talk_to_manager', parameters: { type: 'object' } } }],
    context: {
      executionMode: 'team_subagent',
      personalityProfile: 'default',
      surface: 'team',
      activeToolCategories: ['agents_and_teams', 'agents_and_teams'],
      exposedToolCategories: ['agents_and_teams'],
      callerContextPresent: true,
      capabilities: { vision: false, provider: 'anthropic' },
    },
  });
  assert.equal(manifest.runtimeRole, 'team_subagent');
  assert.deepEqual(manifest.toolSurface.activeCategories, ['agents_and_teams']);
  assert.deepEqual(manifest.systemSegmentIds, [
    'caller.context',
    'caller.team_subagent',
    'core.identity.worker',
    'memory.agent',
    'mode.team_subagent',
    'runtime.prometheus_contract',
    'tools.menu.categories',
  ]);
}

function testGenerateAndPrivacyGolden(): void {
  const secretText = 'private prompt body that must not be persisted verbatim';
  const manifest = buildRuntimePromptManifest({
    callType: 'generate',
    provider: 'ollama',
    model: 'local-test',
    role: 'executor',
    agentId: 'local',
    timestamp: '2026-07-12T12:00:00.000Z',
    system: 'Local system contract.',
    prompt: secretText,
    context: {
      executionMode: 'interactive',
      personalityProfile: 'local_llm',
      surface: 'chat',
      capabilities: { vision: false },
    },
  });
  assert.equal(manifest.runtimeRole, 'local_primary');
  assert.equal(manifest.callType, 'generate');
  assert.equal(manifest.messageSurface.count, 2);
  assert.ok(!JSON.stringify(manifest).includes(secretText));
  const second = buildRuntimePromptManifest({
    callType: 'generate',
    provider: 'ollama',
    model: 'local-test',
    role: 'executor',
    agentId: 'local',
    timestamp: '2026-07-12T12:01:00.000Z',
    system: 'Local system contract.',
    prompt: secretText,
    context: {
      executionMode: 'interactive',
      personalityProfile: 'local_llm',
      surface: 'chat',
      capabilities: { vision: false },
    },
  });
  assert.equal(manifest.hash, second.hash, 'manifest hash must be stable across timestamps');
  const changed = buildRuntimePromptManifest({
    callType: 'generate',
    provider: 'ollama',
    model: 'local-test',
    role: 'executor',
    agentId: 'local',
    timestamp: '2026-07-12T12:02:00.000Z',
    system: 'Local system contract.',
    prompt: `${secretText} changed`,
    context: {
      executionMode: 'interactive',
      personalityProfile: 'local_llm',
      surface: 'chat',
      capabilities: { vision: false },
    },
  });
  assert.notEqual(manifest.hash, changed.hash, 'manifest hash must cover the complete message surface');
}

function testShadowResolutionDoesNotChangeProviderSurface(): void {
  const messages = [{ role: 'system', content: '[TOOLS]\nunchanged system' }, { role: 'user', content: 'unchanged user' }];
  const tools = [{ type: 'function', function: { name: 'mcp_server_manage', parameters: { type: 'object' } } }];
  const beforeMessages = JSON.stringify(messages);
  const beforeTools = JSON.stringify(tools);
  const inactive = buildRuntimePromptManifest({
    callType: 'chat', provider: 'openai', model: 'test', messages, tools,
    context: { executionMode: 'interactive', activeToolCategories: [] },
  });
  const active = buildRuntimePromptManifest({
    callType: 'chat', provider: 'openai', model: 'test', messages, tools,
    context: { executionMode: 'interactive', activeToolCategories: ['integration_admin'] },
  });
  assert.equal(JSON.stringify(messages), beforeMessages);
  assert.equal(JSON.stringify(tools), beforeTools);
  assert.equal(inactive.messageSurface.hash, active.messageSurface.hash);
  assert.equal(inactive.toolSurface.hash, active.toolSurface.hash);
  assert.equal(inactive.messageSurface.serializedChars, active.messageSurface.serializedChars);
  assert.equal(inactive.toolSurface.schemaChars, active.toolSurface.schemaChars);
  assert.ok(!inactive.instructionResolution.selectedSegmentIds.includes('tools.category.integration_admin'));
  assert.ok(active.instructionResolution.selectedSegmentIds.includes('tools.category.integration_admin'));
  assert.equal(active.instructionResolution.stage3Pilot.enabled, true);
  assert.ok(active.stage4InstructionRouting.decisions.some((decision) => decision.id === 'tools.business_context'));
}

function main(): void {
  testRoleMatrix();
  testMainGolden();
  testWorkerAndProviderGolden();
testGenerateAndPrivacyGolden();
testShadowResolutionDoesNotChangeProviderSurface();
testCachePrefixFingerprint();
  console.log('runtime prompt manifest regression checks passed');
}

main();
