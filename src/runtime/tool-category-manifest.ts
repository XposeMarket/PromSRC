import fs from 'fs';
import path from 'path';
import { getPublicBuildAllowedCategories } from './distribution';

/**
 * Canonical ownership registry for runtime tool categories.
 *
 * This module is deliberately model-invisible. It owns category identity,
 * aliases, menu copy, activation hints and policy identifiers. Detailed
 * per-tool mechanics remain owned by each tool schema; cross-tool workflows
 * remain owned by the category policy identified here.
 */
export const TOOL_CATEGORY_IDS = [
  'browser_automation', 'desktop_automation', 'agents_and_teams',
  'prometheus_source_read', 'prometheus_source_write', 'workspace_write',
  'advanced_memory', 'media_assets', 'automations', 'external_apps',
  'integration_admin', 'social_intelligence', 'proposal_admin',
  'mcp_server_tools', 'composite_tools', 'creative_basic', 'creative_image',
  'creative_video', 'creative_hyperframes', 'creative_quality', 'skills',
  'model_management', 'business',
] as const;

// Preserve the current model-facing menu order independently of internal ID
// declaration order so registry adoption cannot perturb prompt-cache prefixes.
export const TOOL_CATEGORY_MENU_ORDER: readonly ToolCategoryId[] = [
  'browser_automation', 'desktop_automation', 'agents_and_teams', 'workspace_write',
  'prometheus_source_read', 'prometheus_source_write', 'advanced_memory', 'media_assets',
  'creative_quality', 'automations', 'integration_admin', 'external_apps',
  'social_intelligence', 'proposal_admin', 'mcp_server_tools', 'composite_tools',
  'creative_basic', 'creative_image', 'creative_video', 'creative_hyperframes',
  'skills', 'model_management', 'business',
];

export type ToolCategoryId = typeof TOOL_CATEGORY_IDS[number];
export type ToolInstructionOwner = 'core_runtime' | 'tool_schema' | 'category_policy' | 'executor' | 'result_wrapper';

export interface ToolCategoryManifestEntry {
  id: ToolCategoryId;
  aliases: readonly string[];
  menuLabel: string;
  activationHint: string;
  policyIds: readonly string[];
  instructionOwner: 'category_policy';
}

const entry = (
  id: ToolCategoryId,
  aliases: string[],
  menuLabel: string,
  activationHint: string,
  policyIds: string[] = [`tools.category.${id}`],
): ToolCategoryManifestEntry => ({ id, aliases, menuLabel, activationHint, policyIds, instructionOwner: 'category_policy' });

export const TOOL_CATEGORY_MANIFEST: Readonly<Record<ToolCategoryId, ToolCategoryManifestEntry>> = Object.freeze({
  browser_automation: entry('browser_automation', ['browser'], 'browser_session/observe/act/extract wrappers', 'browser or web UI interaction'),
  desktop_automation: entry('desktop_automation', ['desktop'], 'desktop_screen/apps/window/input/macro/background wrappers', 'desktop or native application interaction'),
  agents_and_teams: entry('agents_and_teams', ['team_ops', 'teams', 'agents'], 'agent_ops/chat_ops/team wrappers', 'agent or team administration and dispatch'),
  prometheus_source_read: entry('prometheus_source_read', ['source_read'], 'dev_source_read for Prometheus src/, web-ui/, and allowlisted root files', 'Prometheus source inspection'),
  prometheus_source_write: entry('prometheus_source_write', ['source_write'], 'dev_source_edit for approved Prometheus src/web-ui edits', 'approved Prometheus source changes'),
  workspace_write: entry('workspace_write', ['file_ops', 'files', 'shell', 'commands', 'run_commands'], 'unified workspace read/edit/run/git/safety/code-nav wrappers', 'workspace changes or command execution'),
  advanced_memory: entry('advanced_memory', ['memory'], 'memory graph, timeline, related records, project search, index refresh', 'advanced memory operations'),
  media_assets: entry('media_assets', ['media'], 'download/analyze images, video, audio, remote assets', 'media download or analysis'),
  automations: entry('automations', ['schedule', 'scheduling'], 'schedule detail/history/outputs/patch/stuck control/dashboard', 'advanced automation management'),
  external_apps: entry('external_apps', ['connectors'], 'connected app wrappers: X/xAI, Vercel, and other connected tools', 'connected application use'),
  integration_admin: entry('integration_admin', ['integrations'], 'MCP server setup, webhooks, integration quick setup', 'integration administration'),
  social_intelligence: entry('social_intelligence', [], 'social profile analysis and recommendations', 'social intelligence analysis'),
  proposal_admin: entry('proposal_admin', [], 'edit pending proposals before approval', 'pending proposal administration'),
  mcp_server_tools: entry('mcp_server_tools', ['mcp'], 'dynamic mcp__server__tool functions from connected servers', 'connected MCP server tools'),
  composite_tools: entry('composite_tools', ['composites'], 'saved multi-step tools and composite management', 'saved composite tools'),
  creative_basic: entry('creative_basic', ['creative_mode', 'creative'], 'creative_project + creative_scene wrappers', 'basic Creative editing'),
  creative_image: entry('creative_image', ['image_mode'], 'creative_image_ops wrapper', 'Creative image work'),
  creative_video: entry('creative_video', ['video_mode'], 'creative_video_ops wrapper', 'Creative video work'),
  creative_hyperframes: entry('creative_hyperframes', ['hyperframes'], 'creative_hyperframes_ops wrapper', 'HyperFrames work'),
  creative_quality: entry('creative_quality', ['creative_qa', 'media_quality'], 'creative_quality_ops QA wrapper', 'creative quality assurance'),
  skills: entry('skills', ['skill_authoring'], 'skill_ops wrapper for authoring, packaging, import/export, resource maintenance, inspection, and metadata audits', 'skill authoring or maintenance'),
  model_management: entry('model_management', ['agent_models', 'models'], 'agent fleet model administration and templates', 'agent model administration'),
  business: entry('business', ['entities'], 'structured business entity lifecycle administration', 'business entity administration'),
});

const CATEGORY_ALIAS_INDEX: Readonly<Record<string, ToolCategoryId>> = Object.freeze(
  Object.fromEntries(TOOL_CATEGORY_IDS.flatMap((id) => [id, ...TOOL_CATEGORY_MANIFEST[id].aliases].map((alias) => [alias, id]))) as Record<string, ToolCategoryId>,
);

export function getRuntimeToolCategoryIds(): ToolCategoryId[] {
  return getPublicBuildAllowedCategories(TOOL_CATEGORY_IDS) as ToolCategoryId[];
}

export function normalizeManifestToolCategory(raw: unknown): ToolCategoryId | null {
  const category = CATEGORY_ALIAS_INDEX[String(raw || '').trim().toLowerCase()];
  return category && getRuntimeToolCategoryIds().includes(category) ? category : null;
}

const names = (value: string) => new Set(value.split(/\s+/).filter(Boolean));
const CORE_OVERRIDES = names('browser_send_to_telegram delivery_send delivery_send_screenshot connector_list generate_image generate_video chat_with_subagent agent_run_ops');
const TEAM = names('agent_ops agent_chat_ops team_ops_wrapper team_collab_ops spawn_subagent agent_list agent_info agent_update delete_agent message_subagent agent_message_send agent_turn_request agent_reply_wait agent_thread_watch talk_to_subagent talk_to_manager talk_to_teammate request_context request_manager_help update_my_status update_team_goal share_artifact team_manage dispatch_to_agent dispatch_team_agent request_team_member_turn get_agent_result post_to_team_chat message_main_agent reply_to_team manage_team_goal manage_team_context_ref deploy_analysis_team');
const SOURCE_READ = names('dev_source_read request_dev_source_edit update_dev_source_edit await_dev_source_edit_approval read_dev_sources read_source list_source grep_source source_stats src_stats read_webui_source list_webui_source grep_webui_source webui_source_stats webui_stats list_prom prom_file_stats read_prom_file grep_prom source_stats_batch');
const SOURCE_WRITE = names('dev_source_edit apply_dev_source_patchset find_replace_source replace_lines_source insert_after_source delete_lines_source write_source delete_source find_replace_webui_source replace_lines_webui_source insert_after_webui_source delete_lines_webui_source write_webui_source delete_webui_source find_replace_prom replace_lines_prom insert_after_prom delete_lines_prom write_prom_file delete_prom_file prom_apply_dev_changes');
const WORKSPACE = names('workspace_read workspace_edit workspace_run workspace_git workspace_safety workspace_code_nav validate_file read_file list_files list_directory grep_file grep_files file_stats mkdir present_file apply_workspace_patchset clone_repo search_files read_files_batch file_tree create_file replace_lines insert_after delete_lines find_replace delete_file write_file rename_file copy_file move_file copy_directory move_directory path_exists show_diff preview_patch apply_patch format_changed_files revert_last_tool_change revert_own_patch git_status git_diff git_log git_branch git_commit git_push open_pr run_tests run_linter run_formatter run_typecheck start_dev_server stop_process read_process_output snapshot_workspace restore_snapshot scan_secrets scan_large_files operation_plan code_outline get_symbols go_to_definition find_references terminal run_command start_process process_status process_log process_wait process_kill process_submit');
const MEMORY = names('memory_browse memory_read_record memory_search_project memory_search_timeline memory_get_related memory_graph_snapshot memory_index_refresh memory_provider_status memory_embedding_status memory_embedding_backfill memory_debug_search memory_consolidate memory_review_claims memory_accept_claim memory_reject_claim memory_supersede_record');
const MEDIA = names('download_url download_media analyze_image analyze_video');
const AUTOMATIONS = names('schedule_job_detail schedule_job_history schedule_job_log_search schedule_job_outputs schedule_job_patch schedule_job_stuck_control task_control run_task_now internal_watch');
const SKILLS = names('skill_create skill_create_bundle skill_import_bundle skill_export_bundle skill_update_from_source skill_manifest_write skill_resource_write skill_resource_delete skill_inspect');
const MODELS = names('get_agent_models set_agent_model list_agent_model_templates save_agent_model_template update_agent_model_template apply_agent_model_template select_agent_model_template delete_agent_model_template');
const BUSINESS = names('list_entities read_entity write_entity append_entity_event');
const INTEGRATION_ADMIN = names('connection_ops mcp_server_manage webhook_manage integration_quick_setup');
const EXTERNAL_APP_WRAPPERS = names('x_search_ops x_posts x_users x_lists x_dm x_admin vercel_ops');
const COMPOSITES = names('create_composite get_composite edit_composite delete_composite list_composites');
const CREATIVE_CORE = names('get_creative_mode switch_creative_mode');
const QUALITY = names('image_check_contrast image_check_text_overflow image_detect_empty_regions image_get_bounds_summary image_get_element_at_point image_get_overlaps video_render_contact_sheet video_render_frame video_check_audio_sync video_check_caption_timing video_analyze_frame video_analyze_timeline video_check_keyframes video_extract_clip_frames video_analyze_imported_video creative_quality_report creative_validate_layout creative_validate_composition_layers creative_preflight_overlay creative_sample_composite_frames creative_frame_trace creative_frame_diff creative_analyze_generated_video creative_compare_shots creative_select_best_take creative_retry_shot_until_pass creative_lint_html_motion_clip creative_measure_text creative_text_fit_report creative_composition_lint');
const HYPERFRAMES = names('hyperframes_browse_catalog hyperframes_insert_clip hyperframes_apply_patch hyperframes_set_text hyperframes_set_color hyperframes_set_timing hyperframes_set_variable hyperframes_set_asset hyperframes_add_animation hyperframes_lint hyperframes_qa hyperframes_materialize hyperframes_export creative_list_hyperframes_components creative_import_hyperframes_component creative_sync_hyperframes_catalog creative_apply_hyperframes_component creative_overlay_hyperframes_on_video creative_list_html_motion_templates creative_apply_html_motion_template creative_create_html_motion_clip creative_save_html_motion_template creative_save_html_motion_block creative_promote_scene_to_template creative_list_html_motion_blocks creative_render_html_motion_block creative_read_html_motion_clip creative_patch_html_motion_clip creative_restore_html_motion_revision creative_render_html_motion_snapshot creative_export_html_motion_clip');

function creativeCategory(name: string): ToolCategoryId {
  if (CREATIVE_CORE.has(name)) return 'creative_basic';
  if (name === 'creative_quality_ops' || QUALITY.has(name) || name.startsWith('image_') || name.startsWith('video_')) return 'creative_quality';
  if (name === 'creative_hyperframes_ops' || HYPERFRAMES.has(name) || name.startsWith('hyperframes_')) return 'creative_hyperframes';
  if (/video|shot|sequence|clip|composition|audio|voiceover|caption|transcribe|rough_cut|stitch|timeline|motion|music|sound|continuity/.test(name)) return 'creative_video';
  if (/image|asset|layer|icon|ascii|generation/.test(name)) return 'creative_image';
  return 'creative_basic';
}

export interface ToolInstructionMetadata {
  name: string;
  category: ToolCategoryId | null;
  additionalAvailability: ToolCategoryId[];
  instructionOwner: ToolInstructionOwner;
  policyIds: string[];
  untrustedOutput: boolean;
}

export function classifyToolFromManifest(nameInput: string, options: { isSavedComposite?: (name: string) => boolean } = {}): ToolCategoryId | null {
  const name = String(nameInput || '').trim();
  if (!name || CORE_OVERRIDES.has(name)) return null;
  if (CREATIVE_CORE.has(name)) return creativeCategory(name);
  if (name === 'save_site_shortcut' || name === 'inspect_console' || name === 'run_accessibility_check' || name === 'browser_smoke_test' || name.startsWith('browser_')) return 'browser_automation';
  if (name.startsWith('desktop_')) return 'desktop_automation';
  if (EXTERNAL_APP_WRAPPERS.has(name) || name.startsWith('connector_') || name.startsWith('x_api_')) return 'external_apps';
  if (name.startsWith('mcp__')) return 'mcp_server_tools';
  if (TEAM.has(name)) return 'agents_and_teams';
  if (SOURCE_READ.has(name)) return 'prometheus_source_read';
  if (SOURCE_WRITE.has(name)) return 'prometheus_source_write';
  if (WORKSPACE.has(name)) return 'workspace_write';
  if (MEMORY.has(name)) return 'advanced_memory';
  if (MEDIA.has(name)) return 'media_assets';
  if (QUALITY.has(name) || HYPERFRAMES.has(name)) return creativeCategory(name);
  if (AUTOMATIONS.has(name)) return 'automations';
  if ((name.startsWith('skill_') && name !== 'skill_list' && name !== 'skill_read') || SKILLS.has(name)) return 'skills';
  if (MODELS.has(name)) return 'model_management';
  if (BUSINESS.has(name)) return 'business';
  if (name.startsWith('creative_')) return creativeCategory(name);
  if (INTEGRATION_ADMIN.has(name)) return 'integration_admin';
  if (name === 'social_intel') return 'social_intelligence';
  if (name === 'edit_proposal') return 'proposal_admin';
  if (COMPOSITES.has(name) || options.isSavedComposite?.(name)) return 'composite_tools';
  return null;
}

export function getToolInstructionMetadata(name: string, options: { isSavedComposite?: (name: string) => boolean } = {}): ToolInstructionMetadata {
  const category = classifyToolFromManifest(name, options);
  const additionalAvailability: ToolCategoryId[] = ['search_files', 'read_files_batch', 'file_tree'].includes(name)
    ? ['prometheus_source_read']
    : [];
  return {
    name,
    category,
    additionalAvailability,
    instructionOwner: 'tool_schema',
    policyIds: category ? [...TOOL_CATEGORY_MANIFEST[category].policyIds] : [],
    untrustedOutput: /^(browser_|web_|mcp__|connector_|x_api_)/.test(name),
  };
}

export function isToolAvailableForManifestCategory(name: string, category: ToolCategoryId): boolean {
  const metadata = getToolInstructionMetadata(name);
  return metadata.category === category || metadata.additionalAvailability.includes(category);
}

export interface ToolCategoryParityReport {
  checked: number;
  mismatches: Array<{ name: string; authoritative: ToolCategoryId | null; shadow: ToolCategoryId | null }>;
  unownedCoreTools: string[];
}

export function compareToolCategoryClassifiers(
  toolNames: string[],
  authoritative: (name: string) => ToolCategoryId | null,
  options: { isSavedComposite?: (name: string) => boolean } = {},
): ToolCategoryParityReport {
  const unique = Array.from(new Set(toolNames.map((name) => String(name || '').trim()).filter(Boolean))).sort();
  const mismatches = unique.flatMap((name) => {
    const oldCategory = authoritative(name);
    const newCategory = classifyToolFromManifest(name, options);
    return oldCategory === newCategory ? [] : [{ name, authoritative: oldCategory, shadow: newCategory }];
  });
  return {
    checked: unique.length,
    mismatches,
    // "core" is an explicit owner, but listing uncategorized names makes drift
    // (such as newly registered Agent Builder tools) visible for review.
    unownedCoreTools: unique.filter((name) => authoritative(name) === null && classifyToolFromManifest(name, options) === null),
  };
}

const emittedParitySignatures = new Set<string>();
export function recordToolCategoryParity(report: ToolCategoryParityReport): void {
  const signature = JSON.stringify(report);
  if (emittedParitySignatures.has(signature)) return;
  emittedParitySignatures.add(signature);
  try {
    let configDir = path.join(process.cwd(), '.prometheus');
    try {
      const { getConfig } = require('../config/config') as typeof import('../config/config');
      configDir = getConfig().getConfigDir();
    } catch { /* import-safe fallback */ }
    fs.mkdirSync(configDir, { recursive: true });
    fs.promises.appendFile(path.join(configDir, 'tool-category-shadow.jsonl'), `${JSON.stringify({ version: 1, timestamp: new Date().toISOString(), ...report })}\n`, 'utf8').catch(() => undefined);
  } catch {
    // Shadow observability must never affect tool construction.
  }
}

const auditedToolSets = new Set<string>();
export function auditToolCategoryParity(
  toolNames: string[],
  authoritative: (name: string) => ToolCategoryId | null,
  options: { isSavedComposite?: (name: string) => boolean } = {},
): void {
  const normalizedNames = Array.from(new Set(toolNames.map((name) => String(name || '').trim()).filter(Boolean))).sort();
  const signature = normalizedNames.join('\u0000');
  if (auditedToolSets.has(signature)) return;
  auditedToolSets.add(signature);
  // Never put shadow classification or telemetry writes on the provider-facing
  // critical path. The authoritative builder has already finished its work.
  setImmediate(() => recordToolCategoryParity(compareToolCategoryClassifiers(normalizedNames, authoritative, options)));
}
