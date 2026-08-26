import {
  isToolAvailableForManifestCategory,
  normalizeManifestToolCategory,
  type ToolCategoryId,
} from '../runtime/tool-category-manifest';

/**
 * Representative provider-facing tools used to prove that a category really
 * made it through the final tool surface.  These are intentionally small and
 * stable: the check is about provisioning, not about enumerating a category.
 */
export const TOOL_CATEGORY_REPRESENTATIVE_TOOLS: Readonly<Partial<Record<ToolCategoryId, readonly string[]>>> = Object.freeze({
  browser_automation: ['browser_session', 'browser_observe', 'browser_act'],
  desktop_automation: ['desktop_screen', 'desktop_apps', 'desktop_input'],
  agents_and_teams: ['agent_ops', 'agent_chat_ops'],
  prometheus_source_read: ['read_source', 'read_dev_sources'],
  prometheus_source_write: ['prom_apply_dev_changes'],
  workspace_write: ['workspace_edit', 'workspace_run', 'workspace_read'],
  advanced_memory: ['memory_search_project', 'memory_graph_snapshot'],
  media_assets: ['download_media', 'analyze_image'],
  media_generation: ['media_generate'],
  automations: ['schedule_job', 'task_control'],
  automation_scheduling: ['schedule_job'],
  automation_tasks: ['task_control'],
  automation_recovery: ['prometheus_request_ops'],
  automation_sessions: ['prometheus_thread_ops'],
  runtime_admin: ['diagnostic_packet'],
  external_apps: ['x_search_ops'],
  integration_admin: ['connection_ops'],
  social_intelligence: ['social_intel'],
  proposal_admin: ['write_proposal'],
  composite_tools: ['list_composites'],
  creative_basic: ['switch_creative_mode'],
  creative_image: ['creative_image_ops'],
  creative_video: ['creative_video_ops'],
  creative_hyperframes: ['creative_hyperframes_ops'],
  creative_quality: ['creative_quality_ops'],
  // Skill inspection is an action on the model-facing skill_ops wrapper, not
  // a standalone provider function. Verify the callable wrapper here; the
  // executor validates the action inside its arguments.
  skills: ['skill_ops'],
  model_management: ['get_agent_models'],
  business: ['list_entities'],
});

/**
 * Preserve session/turn category activation when a model switch creates a
 * turn-scoped tool-build override. The override is still useful for adding
 * model-specific requirements (currently browser vision), but it must not
 * silently replace categories the previous provider iteration activated.
 */
export function preserveActivatedToolCategoriesForTurnOverride(
  activeCategories: Iterable<string> | undefined,
  browserVisionModeActive: boolean,
): Set<string> {
  const categories = new Set<string>(activeCategories || []);
  if (browserVisionModeActive) {
    categories.add('browser_automation');
    categories.add('browser');
  }
  return categories;
}

export interface ToolCategorySurfaceVerification {
  category: string;
  ok: boolean;
  representativeTools: string[];
  missingTools: string[];
  actualCategoryTools: string[];
  unboundedCategoryTools: string[];
  providerCapped: boolean;
  filteredByRequest: boolean;
  reason: string;
}

function toolName(tool: any): string {
  return String(tool?.function?.name || tool?.name || '').trim();
}

function uniqueNames(tools: any[]): string[] {
  return Array.from(new Set((tools || []).map(toolName).filter(Boolean)));
}

function normalizeCategory(raw: unknown): ToolCategoryId | null {
  return normalizeManifestToolCategory(raw);
}

/**
 * Verify the surface that will actually be sent to the provider.
 *
 * `unboundedTools` is the surface immediately before provider caps and
 * request-scoped filtering. Keeping it optional lets callers explain whether
 * a missing representative was absent from the builder or removed later.
 */
export function verifyToolCategorySurface(
  rawCategory: unknown,
  providerTools: any[],
  options: {
    unboundedTools?: any[];
    requestFilterActive?: boolean;
  } = {},
): ToolCategorySurfaceVerification {
  const category = normalizeCategory(rawCategory) || String(rawCategory || '').trim();
  const providerNames = uniqueNames(providerTools);
  const unboundedNames = uniqueNames(options.unboundedTools || providerTools);
  const configuredRepresentatives = normalizeCategory(rawCategory)
    ? [...(TOOL_CATEGORY_REPRESENTATIVE_TOOLS[normalizeCategory(rawCategory) as ToolCategoryId] || [])]
    : [];
  const representativeTools = configuredRepresentatives.length > 0
    ? configuredRepresentatives
    : unboundedNames.filter((name) => isToolAvailableForManifestCategory(name, category as ToolCategoryId)).slice(0, 2);
  const missingTools = representativeTools.filter((name) => !providerNames.includes(name));
  const actualCategoryTools = providerNames.filter((name) => isToolAvailableForManifestCategory(name, category as ToolCategoryId));
  const unboundedCategoryTools = unboundedNames.filter((name) => isToolAvailableForManifestCategory(name, category as ToolCategoryId));
  const providerCapped = unboundedNames.length > providerNames.length;
  const filteredByRequest = options.requestFilterActive === true;
  const ok = representativeTools.length > 0 && missingTools.length === 0;

  let reason = 'provisioned';
  if (!representativeTools.length) {
    reason = 'no_expected_tools_available';
  } else if (missingTools.length > 0) {
    const removedAfterBuild = missingTools.every((name) => unboundedNames.includes(name));
    if (removedAfterBuild && filteredByRequest) reason = 'request_filter_removed_expected_tools';
    else if (removedAfterBuild && providerCapped) reason = 'provider_cap_removed_expected_tools';
    else reason = 'builder_surface_missing_expected_tools';
  }

  return {
    category,
    ok,
    representativeTools,
    missingTools,
    actualCategoryTools,
    unboundedCategoryTools,
    providerCapped,
    filteredByRequest,
    reason,
  };
}

export function formatToolCategoryProvisioningFailure(
  verification: ToolCategorySurfaceVerification,
): string {
  const missing = verification.missingTools.length > 0
    ? ` Missing: ${verification.missingTools.join(', ')}.`
    : '';
  return `Tool category "${verification.category}" failed to provision (${verification.reason}).${missing} The category was not made callable for this provider turn.`;
}
