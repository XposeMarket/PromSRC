import assert from 'assert';
import {
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
  getCanonicalToolCategory,
  getLegacyToolCategory,
  getToolCategory,
  getToolClassifierMode,
} from '../gateway/tool-builder';

function testRegistryCompleteness(): void {
  assert.equal(Object.keys(TOOL_CATEGORY_MANIFEST).length, TOOL_CATEGORY_IDS.length);
  assert.deepEqual([...TOOL_CATEGORY_MENU_ORDER].sort(), [...TOOL_CATEGORY_IDS].sort());
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
    ['read_source', 'prometheus_source_read'],
    ['write_source', 'prometheus_source_write'],
    ['memory_graph_snapshot', 'advanced_memory'],
    ['download_media', 'media_assets'],
    ['schedule_job_history', 'automations'],
    ['connector_gmail_search', 'external_apps'],
    ['x_search_ops', 'external_apps'],
    ['xai_live_search', null],
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
    ['schedule_job', null],
  ];
  for (const [name, expected] of cases) {
    assert.equal(classifyToolFromManifest(name), expected, name);
    assert.equal(getLegacyToolCategory(name), expected, `legacy: ${name}`);
    assert.equal(getCanonicalToolCategory(name), expected, `canonical: ${name}`);
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
  const report = compareToolCategoryClassifiers(['browser_open', 'schedule_job'], authoritative);
  assert.equal(report.checked, 2);
  assert.deepEqual(report.mismatches, []);
  assert.deepEqual(report.unownedCoreTools, ['schedule_job']);

  const disagreement = compareToolCategoryClassifiers(['browser_open'], () => null);
  assert.deepEqual(disagreement.mismatches, [{ name: 'browser_open', authoritative: null, shadow: 'browser_automation' }]);
}

testRegistryCompleteness();
testRepresentativeClassification();
testMetadataIsInternalOnly();
testParityReport();
testAuthorityAndRollbackModes();
console.log('tool category manifest regression checks passed');
