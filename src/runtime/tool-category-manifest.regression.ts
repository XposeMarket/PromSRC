import assert from 'assert';
import {
  AUTOMATION_WORKFLOW_PACK_IDS,
  TOOL_CATEGORY_IDS,
  TOOL_CATEGORY_MANIFEST,
  TOOL_CATEGORY_MENU_ORDER,
  classifyToolFromManifest,
  compareToolCategoryClassifiers,
  getToolInstructionMetadata,
  isToolAvailableForManifestCategory,
  normalizeManifestToolCategory,
} from './tool-category-manifest';
import {
  filterPublicBuildToolDefs,
  isRetiredModelTool,
  isToolHiddenInPublicBuild,
} from './distribution';
import { rewriteRetiredToolPromptText } from './retired-tool-migrations';
import {
  getCanonicalToolCategory,
  getLegacyToolCategory,
  getToolCategory,
  getToolClassifierMode,
} from '../gateway/tool-builder';

function testRegistryCompleteness(): void {
  assert.equal(Object.keys(TOOL_CATEGORY_MANIFEST).length, TOOL_CATEGORY_IDS.length);
  const menuIds = new Set(TOOL_CATEGORY_MENU_ORDER);
  for (const id of TOOL_CATEGORY_IDS) {
    if ((AUTOMATION_WORKFLOW_PACK_IDS as readonly string[]).includes(id)) continue;
    assert.equal(menuIds.has(id), true, `top-level category missing from menu: ${id}`);
  }
  for (const id of menuIds) assert.equal((TOOL_CATEGORY_IDS as readonly string[]).includes(id), true, `unknown menu category: ${id}`);
  for (const id of TOOL_CATEGORY_IDS) {
    const item = TOOL_CATEGORY_MANIFEST[id];
    assert.equal(item.id, id);
    assert.equal(item.instructionOwner, 'category_policy');
    assert.ok(item.menuLabel.length > 0);
    assert.ok(item.activationHint.length > 0);
    assert.ok(item.policyIds.length > 0);
    assert.equal(normalizeManifestToolCategory(id), id);
    for (const alias of item.aliases) assert.equal(normalizeManifestToolCategory(alias), id);
  }
}

function testRepresentativeClassification(): void {
  const cases: Array<[string, string | null]> = [
    ['read_file', 'workspace_write'],
    ['browser_open', 'browser_automation'],
    ['desktop_screenshot', 'desktop_automation'],
    ['talk_to_manager', 'agents_and_teams'],
    ['team_ops_wrapper', 'agents_and_teams'],
    ['agent_ops', 'agents_and_teams'],
    ['read_source', 'prometheus_source_read'],
    ['write_source', 'prometheus_source_write'],
    ['memory_graph_snapshot', 'advanced_memory'],
    ['download_media', 'media_assets'],
    ['media_generate', 'media_generation'],
    ['schedule_job_history', 'automation_scheduling'],
    ['schedule_job', 'automation_scheduling'],
    ['automation_dashboard', 'automation_tasks'],
    ['diagnostic_packet', 'runtime_admin'],
    ['system_diagnostics', 'runtime_admin'],
    ['gateway_restart', 'runtime_admin'],
    ['connector_list', 'external_apps'],
    ['chat_with_subagent', 'agents_and_teams'],
    ['agent_run_ops', 'agents_and_teams'],
    // Kept classified for compatibility with persisted historical runs, but it
    // is retired from every new model-facing tool surface below.
    ['ask_team_coordinator', 'agents_and_teams'],
    ['write_proposal', 'proposal_admin'],
    ['video_compose', 'creative_video'],
    ['prometheus_audit_ops', 'automation_recovery'],
    ['prometheus_thread_ops', 'automation_sessions'],
    ['connector_gmail_search', 'external_apps'],
    ['x_search_ops', 'external_apps'],
    ['xai_live_search', null], // deprecated and no longer registered
    ['mcp__github__search', 'mcp_server_tools'],
    // Preserve the current classifier exactly in shadow mode. "storyboard"
    // is not yet one of its creative-video routing signals.
    ['creative_create_storyboard', 'creative_basic'],
    ['creative_generate_image_asset', 'creative_image'],
    ['creative_measure_text', 'creative_quality'],
    ['hyperframes_export', 'creative_hyperframes'],
    ['creative_hyperframes_ops', 'creative_hyperframes'],
    ['creative_quality_ops', 'creative_quality'],
    ['workspace_read', 'workspace_write'],
    ['dev_source_read', 'prometheus_source_read'],
    ['dev_source_edit', 'prometheus_source_write'],
    ['connection_ops', 'integration_admin'],
    ['skill_create', 'skills'],
    ['set_agent_model', 'model_management'],
    ['write_entity', 'business'],
    ['delivery_send', null],
  ];
  for (const [name, expected] of cases) {
    assert.equal(classifyToolFromManifest(name), expected, name);
    assert.equal(getLegacyToolCategory(name), expected, `legacy: ${name}`);
    assert.equal(getCanonicalToolCategory(name), expected, `canonical: ${name}`);
  }
}

function testRetiredCoordinatorMigration(): void {
  const previousPublic = process.env.PROMETHEUS_PUBLIC_BUILD;
  const previousDevTools = process.env.PROMETHEUS_DEV_TOOLS_VISIBLE;
  try {
    process.env.PROMETHEUS_PUBLIC_BUILD = '0';
    process.env.PROMETHEUS_DEV_TOOLS_VISIBLE = '1';
    assert.equal(isRetiredModelTool('ask_team_coordinator'), true);
    assert.equal(isToolHiddenInPublicBuild('ask_team_coordinator'), true, 'retired tool must stay hidden even in private/dev mode');

    const defs = filterPublicBuildToolDefs([
      { function: { name: 'ask_team_coordinator' } },
      { function: { name: 'team_ops_wrapper' } },
      { function: { name: 'agent_ops' } },
    ]);
    assert.deepEqual(defs.map((item) => item.function.name), ['team_ops_wrapper', 'agent_ops']);

    const legacyCategoryPolicy = [
      'TEAMS: activate agents_and_teams, then use ask_team_coordinator(goal, context?) for multi-agent team work. spawn_subagent() is for single standalone agent tasks.',
      'WHEN TO USE EACH:',
      '  → ask_team_coordinator: multiple agents needed, parallel workstreams, complex goal that benefits from roles',
      'TEAM OPS: Do NOT call granular team_manage directly from main chat. Use ask_team_coordinator for normal managed team work; use team_ops_wrapper/team_collab_ops only when you intentionally need lower-level managed-team operations.',
    ].join('\n');
    const legacyCorePolicy = [
      '[TEAMS & AGENTS] Agent/task routes — activate agents_and_teams, then pick the right one:',
      '  → ask_team_coordinator(goal) — managed multi-agent teams with roles.',
      'Do NOT call team_manage directly. reply_to_team(team_id, msg) is the only direct team call — use only when a coordinator is waiting on your reply.',
    ].join('\n');
    const rewritten = rewriteRetiredToolPromptText(`${legacyCategoryPolicy}\n\n${legacyCorePolicy}`);
    assert.equal(rewritten.includes('ask_team_coordinator'), true, 'replacement explains retirement explicitly');
    assert.equal(rewritten.includes('use ask_team_coordinator'), false, 'new prompt must never instruct use of retired coordinator');
    assert.equal(rewritten.includes('There is no meta-coordinator handoff.'), true);
    assert.equal(rewritten.includes('team_ops_wrapper(action:"manage"'), true);
    assert.equal(rewritten.includes('Prometheus itself chooses useful roles'), true);
  } finally {
    if (previousPublic === undefined) delete process.env.PROMETHEUS_PUBLIC_BUILD;
    else process.env.PROMETHEUS_PUBLIC_BUILD = previousPublic;
    if (previousDevTools === undefined) delete process.env.PROMETHEUS_DEV_TOOLS_VISIBLE;
    else process.env.PROMETHEUS_DEV_TOOLS_VISIBLE = previousDevTools;
  }
}

function testAuthorityAndRollbackModes(): void {
  const previous = process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE;
  try {
    delete process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE;
    assert.equal(getToolClassifierMode(), 'canonical');
    assert.equal(getToolCategory('browser_open'), 'browser_automation');
    process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE = 'legacy';
    assert.equal(getToolClassifierMode(), 'legacy');
    assert.equal(getToolCategory('browser_open'), 'browser_automation');
    process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE = 'shadow';
    assert.equal(getToolClassifierMode(), 'shadow');
    assert.equal(getToolCategory('browser_open'), 'browser_automation');
  } finally {
    if (previous === undefined) delete process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE;
    else process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE = previous;
  }
}

function testMetadataIsInternalOnly(): void {
  const metadata = getToolInstructionMetadata('browser_open');
  assert.equal(metadata.category, 'browser_automation');
  assert.equal(metadata.instructionOwner, 'tool_schema');
  assert.equal(metadata.untrustedOutput, true);
  assert.deepEqual(metadata.policyIds, ['tools.category.browser_automation']);
  assert.deepEqual(metadata.additionalAvailability, []);

  assert.equal(isToolAvailableForManifestCategory('search_files', 'workspace_write'), true);
  assert.equal(isToolAvailableForManifestCategory('search_files', 'prometheus_source_read'), true);
  assert.deepEqual(getToolInstructionMetadata('search_files').additionalAvailability, ['prometheus_source_read']);

  const providerTool = { type: 'function', function: { name: 'browser_open', description: 'Open a URL.', parameters: { type: 'object' } } };
  const before = JSON.stringify(providerTool);
  getToolInstructionMetadata(providerTool.function.name);
  assert.equal(JSON.stringify(providerTool), before, 'metadata lookup must not mutate provider schemas');
}

function testParityReport(): void {
  const authoritative = (name: string) => name === 'browser_open' ? 'browser_automation' as const : null;
  const report = compareToolCategoryClassifiers(['browser_open', 'schedule_job'], (name) => name === 'schedule_job' ? 'automation_scheduling' as const : authoritative(name));
  assert.equal(report.checked, 2);
  assert.deepEqual(report.mismatches, []);
  assert.deepEqual(report.unownedCoreTools, []);

  const disagreement = compareToolCategoryClassifiers(['browser_open'], () => null);
  assert.deepEqual(disagreement.mismatches, [{ name: 'browser_open', authoritative: null, shadow: 'browser_automation' }]);
}

testRegistryCompleteness();
testRepresentativeClassification();
testRetiredCoordinatorMigration();
testMetadataIsInternalOnly();
testParityReport();
testAuthorityAndRollbackModes();
console.log('tool category manifest regression checks passed');
