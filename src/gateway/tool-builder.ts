// src/gateway/tool-builder.ts
// Tool definitions and execution utilities — extracted from server-v2.ts (Step 13.1, Phase 3).
// Exports: BuildToolsDeps, buildTools(), ToolResult, TaskControlResponse, ScheduleJobAction,
//          normalizeScheduleJobAction, summarizeCronJob, normalizeDeliveryChannel,
//          normalizeToolArgs, parseJsonLike, toStringRecord, parseLooseMap

import { getConfig } from '../config/config';
import { getBrowserToolDefinitions } from './browser-tools';
import { getDesktopToolDefinitions } from './desktop-tools';
import { registerAgentBuilderTools } from './agents-runtime/agent-builder-integration';
import { getFileWebMemoryTools } from './tools/defs/file-web-memory';
import { getAgentTeamScheduleTools } from './tools/defs/agent-team-schedule';
import { getCisSystemTools } from './tools/defs/cis-system';
import { getCreativeToolDefs } from './tools/defs/creative-tools';
import { getCompositeDefs, getCompositeManagementTools, loadComposites } from './tools/composite-tools';
import { ensurePrometheusExtensionRuntimeLoaded } from '../extensions/legacy-connector-adapter';
import { getExtensionRuntimeRegistry } from '../extensions/runtime-registry';
import { getPublicBuildAllowedCategories, isToolHiddenInPublicBuild } from '../runtime/distribution.js';

export interface BuildToolsDeps {
  getMCPManager: () => any;
}

// ─── Tool Category System ─────────────────────────────────────────────────────
// Tools split into: core (always injected) + on-demand categories.
// Categories are activated per-session via request_tool_category tool.

export const ALL_TOOL_CATEGORIES = [
  'browser_automation',
  'desktop_automation',
  'agents_and_teams',
  'prometheus_source_read',
  'prometheus_source_write',
  'workspace_write',
  'advanced_memory',
  'media_assets',
  'automations',
  'external_apps',
  'integration_admin',
  'social_intelligence',
  'proposal_admin',
  'mcp_server_tools',
  'composite_tools',
  'creative_basic',
  'creative_image',
  'creative_video',
  'creative_hyperframes',
  'creative_quality',
  'skills',
  'model_management',
  'business',
] as const;
export type ToolCategory = typeof ALL_TOOL_CATEGORIES[number];
type InternalToolCategory = ToolCategory;

export function buildConnectorStatus(): string {
  ensurePrometheusExtensionRuntimeLoaded();
  return getExtensionRuntimeRegistry().buildConnectorStatus();
}

export function getRuntimeToolCategories(): ToolCategory[] {
  return getPublicBuildAllowedCategories(ALL_TOOL_CATEGORIES) as ToolCategory[];
}

const TOOL_CATEGORY_ALIASES: Record<string, ToolCategory> = {
  browser: 'browser_automation',
  browser_automation: 'browser_automation',
  desktop: 'desktop_automation',
  desktop_automation: 'desktop_automation',
  team_ops: 'agents_and_teams',
  teams: 'agents_and_teams',
  agents: 'agents_and_teams',
  agents_and_teams: 'agents_and_teams',
  source_read: 'prometheus_source_read',
  prometheus_source_read: 'prometheus_source_read',
  source_write: 'prometheus_source_write',
  prometheus_source_write: 'prometheus_source_write',
  file_ops: 'workspace_write',
  files: 'workspace_write',
  workspace_write: 'workspace_write',
  shell: 'workspace_write',
  commands: 'workspace_write',
  run_commands: 'workspace_write',
  memory: 'advanced_memory',
  advanced_memory: 'advanced_memory',
  media: 'media_assets',
  media_assets: 'media_assets',
  schedule: 'automations',
  scheduling: 'automations',
  automations: 'automations',
  connectors: 'external_apps',
  external_apps: 'external_apps',
  integrations: 'integration_admin',
  integration_admin: 'integration_admin',
  social_intelligence: 'social_intelligence',
  proposal_admin: 'proposal_admin',
  mcp: 'mcp_server_tools',
  mcp_server_tools: 'mcp_server_tools',
  composites: 'composite_tools',
  composite_tools: 'composite_tools',
  creative_mode: 'creative_basic',
  creative: 'creative_basic',
  creative_basic: 'creative_basic',
  creative_image: 'creative_image',
  image_mode: 'creative_image',
  creative_video: 'creative_video',
  video_mode: 'creative_video',
  creative_hyperframes: 'creative_hyperframes',
  hyperframes: 'creative_hyperframes',
  creative_quality: 'creative_quality',
  creative_qa: 'creative_quality',
  media_quality: 'creative_quality',
  skill_authoring: 'skills',
  skills: 'skills',
  model_management: 'model_management',
  agent_models: 'model_management',
  models: 'model_management',
  business: 'business',
  entities: 'business',
};

export function normalizeToolCategory(raw: unknown): ToolCategory | null {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  const normalized = TOOL_CATEGORY_ALIASES[key];
  if (!normalized) return null;
  return getRuntimeToolCategories().includes(normalized) ? normalized : null;
}

// Explicit name lists for non-prefix categories
const TEAM_OPS_TOOL_NAMES = new Set([
  'agent_ops',
  'agent_chat_ops',
  'team_ops_wrapper',
  'team_collab_ops',
  'spawn_subagent',
  'agent_list', 'agent_info', 'agent_update', 'delete_agent',
  'message_subagent', 'agent_message_send', 'agent_turn_request',
  'agent_reply_wait', 'agent_thread_watch',
  'talk_to_subagent', 'talk_to_manager', 'talk_to_teammate',
  'request_context', 'request_manager_help',
  'update_my_status', 'update_team_goal', 'share_artifact', 'team_manage',
  'dispatch_to_agent', 'dispatch_team_agent', 'request_team_member_turn', 'get_agent_result',
  'post_to_team_chat', 'message_main_agent', 'reply_to_team',
  'manage_team_goal', 'manage_team_context_ref',
  // ask_team_coordinator intentionally excluded — it's a core tool (always available)
  'deploy_analysis_team',
]);

// schedule_job is core so cron/heartbeat/subagent sessions can reschedule and
// manage jobs without needing category activation. Natural-language/friendly
// schedule parsing is handled inside schedule_job; parse_schedule_pattern is
// intentionally not exposed as a model-facing helper.
// background_ops is core. Legacy background_* leaves remain executable but are
// hidden from the normal model-facing schema surface.

const SOURCE_WRITE_TOOL_NAMES = new Set([
    'dev_source_edit',
	  'apply_dev_source_patchset',
	  'find_replace_source', 'replace_lines_source', 'insert_after_source',
	  'delete_lines_source', 'write_source', 'delete_source',
	  'find_replace_webui_source', 'replace_lines_webui_source', 'insert_after_webui_source',
	  'delete_lines_webui_source', 'write_webui_source', 'delete_webui_source',
	  'find_replace_prom', 'replace_lines_prom', 'insert_after_prom',
	  'delete_lines_prom', 'write_prom_file', 'delete_prom_file',
	  'prom_apply_dev_changes',
	]);

const DEV_SOURCE_APPROVAL_TOOL_NAMES = new Set([
  'request_dev_source_edit',
  'update_dev_source_edit',
  'await_dev_source_edit_approval',
]);

const DEV_ONLY_SOURCE_READ_TOOL_NAMES = new Set([
  'dev_source_read',
  'read_dev_sources',
  'read_source', 'list_source', 'grep_source', 'source_stats', 'src_stats', 'validate_source',
  'read_webui_source', 'list_webui_source', 'grep_webui_source', 'webui_source_stats', 'webui_stats', 'validate_webui_source',
  'list_prom', 'prom_file_stats', 'validate_prom_file', 'read_prom_file', 'grep_prom',
  'source_stats_batch',
]);

const SOURCE_READ_FILE_HELPER_TOOL_NAMES = new Set([
  'search_files',
  'read_files_batch',
  'file_tree',
]);

const FILE_OPS_TOOL_NAMES = new Set([
  'workspace_read',
  'workspace_edit',
  'workspace_run',
  'workspace_git',
  'workspace_safety',
  'workspace_code_nav',
  'read_file',
  'list_files',
  'list_directory',
  'grep_file',
  'grep_files',
  'file_stats',
  'validate_file',
  'mkdir',
  'present_file',
  'apply_workspace_patchset',
  'clone_repo',
  'search_files',
  'read_files_batch',
  'file_tree',
  'create_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'delete_file',
  'write_file',
  'rename_file',
  'copy_file',
  'move_file',
  'copy_directory',
  'move_directory',
  'path_exists',
  'show_diff',
  'preview_patch',
  'apply_patch',
  'format_changed_files',
  'revert_last_tool_change',
  'revert_own_patch',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'git_commit',
  'git_push',
  'open_pr',
  'run_tests',
  'run_linter',
  'run_formatter',
  'run_typecheck',
  'start_dev_server',
  'stop_process',
  'read_process_output',
  'snapshot_workspace',
  'restore_snapshot',
  'scan_secrets',
  'scan_large_files',
  'operation_plan',
  'code_outline',
  'get_symbols',
  'go_to_definition',
  'find_references',
]);

const COMMAND_RUNNER_TOOL_NAMES = new Set([
  'terminal',
  'run_command',
  'start_process',
  'process_status',
  'process_log',
  'process_wait',
  'process_kill',
  'process_submit',
]);

const MEMORY_TOOL_NAMES = new Set([
  'memory_browse',
  'memory_read_record',
  'memory_search_project',
  'memory_search_timeline',
  'memory_get_related',
  'memory_graph_snapshot',
  'memory_index_refresh',
  'memory_provider_status',
  'memory_embedding_status',
  'memory_embedding_backfill',
  'memory_debug_search',
  'memory_consolidate',
  'memory_review_claims',
  'memory_accept_claim',
  'memory_reject_claim',
  'memory_supersede_record',
]);

const MEDIA_TOOL_NAMES = new Set([
  'download_url',
  'download_media',
  'analyze_image',
  'analyze_video',
]);

const MEDIA_QUALITY_TOOL_NAMES = new Set([
  'image_check_contrast',
  'image_check_text_overflow',
  'image_detect_empty_regions',
  'image_get_bounds_summary',
  'image_get_element_at_point',
  'image_get_overlaps',
  'video_render_contact_sheet',
  'video_render_frame',
  'video_check_audio_sync',
  'video_check_caption_timing',
]);

const CREATIVE_VIDEO_QA_TOOL_NAMES = new Set([
  'video_analyze_frame',
  'video_analyze_timeline',
  'video_check_keyframes',
  'video_extract_clip_frames',
  'video_analyze_imported_video',
]);

const HYPERFRAMES_TOOL_NAMES = new Set([
  'hyperframes_browse_catalog',
  'hyperframes_insert_clip',
  'hyperframes_apply_patch',
  'hyperframes_set_text',
  'hyperframes_set_color',
  'hyperframes_set_timing',
  'hyperframes_set_variable',
  'hyperframes_set_asset',
  'hyperframes_add_animation',
  'hyperframes_lint',
  'hyperframes_qa',
  'hyperframes_materialize',
  'hyperframes_export',
]);

const AUTOMATION_TOOL_NAMES = new Set([
  'schedule_job_detail',
  'schedule_job_history',
  'schedule_job_log_search',
  'schedule_job_outputs',
  'schedule_job_patch',
  'schedule_job_stuck_control',
  // Advanced automation management/diagnostics (schedule_job, automation_dashboard,
  // and timer remain core; only execution-level scheduling stays always-on).
  'task_control',
  'run_task_now',
  'internal_watch',
]);

// Skill authoring/packaging/maintenance — only skill_list and skill_read stay core.
const SKILL_AUTHORING_TOOL_NAMES = new Set([
  'skill_ops',
  'skill_create',
  'skill_create_bundle',
  'skill_import_bundle',
  'skill_export_bundle',
  'skill_update_from_source',
  'skill_manifest_write',
  'skill_resource_list',
  'skill_resource_read',
  'skill_resource_write',
  'skill_resource_delete',
  'skill_inspect',
  'skill_audit_all',
  'skill_repair_metadata',
  'skill_update_metadata',
]);

// Agent fleet / model template administration — switch_model and
// set_current_model remain core for everyday model switching.
const MODEL_MANAGEMENT_TOOL_NAMES = new Set([
  'get_agent_models',
  'set_agent_model',
  'list_agent_model_templates',
  'save_agent_model_template',
  'update_agent_model_template',
  'apply_agent_model_template',
  'select_agent_model_template',
  'delete_agent_model_template',
]);

// Business entity lifecycle administration — business_context_mode stays core.
const BUSINESS_TOOL_NAMES = new Set([
  'list_entities',
  'read_entity',
  'write_entity',
  'append_entity_event',
]);

const EXTERNAL_APP_WRAPPER_TOOL_NAMES = new Set([
  'x_search_ops',
  'x_posts',
  'x_users',
  'x_lists',
  'x_dm',
  'x_admin',
  'vercel_ops',
]);

const CORE_CREATIVE_CONTROL_TOOL_NAMES = new Set([
  'get_creative_mode',
  'switch_creative_mode',
]);

const CREATIVE_QUALITY_TOOL_NAMES = new Set([
  'creative_quality_ops',
  ...MEDIA_QUALITY_TOOL_NAMES,
  ...CREATIVE_VIDEO_QA_TOOL_NAMES,
  'creative_quality_report',
  'creative_validate_layout',
  'creative_validate_composition_layers',
  'creative_preflight_overlay',
  'creative_sample_composite_frames',
  'creative_frame_trace',
  'creative_frame_diff',
  'creative_analyze_generated_video',
  'creative_compare_shots',
  'creative_select_best_take',
  'creative_retry_shot_until_pass',
  'creative_lint_html_motion_clip',
  'creative_measure_text',
  'creative_text_fit_report',
  'creative_composition_lint',
]);

const CREATIVE_HYPERFRAMES_TOOL_NAMES = new Set([
  'creative_hyperframes_ops',
  ...HYPERFRAMES_TOOL_NAMES,
  'creative_list_hyperframes_components',
  'creative_import_hyperframes_component',
  'creative_sync_hyperframes_catalog',
  'creative_apply_hyperframes_component',
  'creative_overlay_hyperframes_on_video',
  'creative_list_html_motion_templates',
  'creative_apply_html_motion_template',
  'creative_create_html_motion_clip',
  'creative_save_html_motion_template',
  'creative_save_html_motion_block',
  'creative_promote_scene_to_template',
  'creative_list_html_motion_blocks',
  'creative_render_html_motion_block',
  'creative_read_html_motion_clip',
  'creative_patch_html_motion_clip',
  'creative_restore_html_motion_revision',
  'creative_render_html_motion_snapshot',
  'creative_export_html_motion_clip',
]);

function getCreativeToolCategory(name: string): ToolCategory {
  if (CORE_CREATIVE_CONTROL_TOOL_NAMES.has(name)) return 'creative_basic';
  if (CREATIVE_QUALITY_TOOL_NAMES.has(name)) return 'creative_quality';
  if (CREATIVE_HYPERFRAMES_TOOL_NAMES.has(name)) return 'creative_hyperframes';
  if (name.startsWith('hyperframes_')) return 'creative_hyperframes';
  if (name.startsWith('image_') || name.startsWith('video_')) return 'creative_quality';

  const n = name.toLowerCase();
  if (
    /\b(video|shot|sequence|clip|composition|audio|voiceover|caption|transcribe|rough_cut|stitch|timeline|motion|music|sound|continuity)\b/.test(n)
    || /video|shot|sequence|clip|composition|audio|voiceover|caption|transcribe|rough_cut|stitch|timeline|motion|music|sound|continuity/.test(n)
  ) {
    return 'creative_video';
  }
  if (
    /\b(image|asset|layer|icon|ascii|generation)\b/.test(n)
    || /image|asset|layer|icon|ascii|generation/.test(n)
  ) {
    return 'creative_image';
  }
  return 'creative_basic';
}

const SCHEMA_HIDDEN_COMPAT_TOOL_NAMES = new Set([
  'web_search_single',
  'web_search_multi',
  'web_fetch_batch',
  'generate_image',
  'generate_video',
  'prom_repo_push',
  'prom_repo_pull',
  'prom_repo_sync',
  'background_spawn',
  'background_status',
  'background_progress',
  'background_wait',
  'background_join',
  'complete_plan_step',
  'step_complete',
  'bg_plan_declare',
  'bg_plan_advance',
  'skill_inspect',
  'skill_resource_list',
  'skill_resource_read',
  'skill_resource_write',
  'skill_resource_delete',
  'skill_update_metadata',
  'skill_manifest_write',
  'skill_import_bundle',
  'skill_export_bundle',
  'skill_update_from_source',
  'skill_create',
  'skill_create_bundle',
  'skill_audit_all',
  'skill_repair_metadata',
  'delivery_send_screenshot',
  'send_telegram',
  'browser_send_to_telegram',
  'browser_doctor',
  'browser_set_profile_target',
  'browser_open',
  'browser_snapshot',
  'browser_list_tabs',
  'browser_select_tab',
  'browser_new_tab',
  'browser_close_tab',
  'browser_click',
  'browser_fill',
  'browser_upload_file',
  'browser_press_key',
  'browser_key',
  'browser_type',
  'browser_wait',
  'browser_click_and_download',
  'browser_scroll',
  'browser_scroll_collect',
  'browser_drag',
  'browser_scroll_collect_v2',
  'browser_close',
  'browser_get_focused_item',
  'browser_get_page_text',
  'browser_vision_screenshot',
  'browser_vision_click',
  'browser_vision_type',
  'browser_run_js',
  'browser_intercept_network',
  'inspect_console',
  'run_accessibility_check',
  'browser_smoke_test',
  'browser_element_watch',
  'browser_snapshot_delta',
  'browser_extract_structured',
  'browser_teach_verify',
  'desktop_doctor',
  'desktop_screenshot',
  'desktop_get_monitors',
  'desktop_find_window',
  'desktop_focus_window',
  'desktop_window_control',
  'desktop_window_screenshot',
  'desktop_click',
  'desktop_drag',
  'desktop_wait',
  'desktop_type',
  'desktop_press_key',
  'desktop_get_clipboard',
  'desktop_set_clipboard',
  'desktop_list_installed_apps',
  'desktop_find_installed_app',
  'desktop_launch_app',
  'desktop_close_app',
  'desktop_get_process_list',
  'desktop_wait_for_change',
  'desktop_diff_screenshot',
  'desktop_background_status',
  'desktop_background_prepare_sandbox',
  'desktop_background_command',
  'desktop_get_window_text',
  'desktop_scroll',
  'desktop_type_raw',
  'desktop_send_to_telegram',
  'desktop_get_accessibility_tree',
  'desktop_pixel_watch',
  'desktop_record_macro',
  'desktop_stop_macro',
  'desktop_replay_macro',
  'desktop_list_macros',
  'desktop_list_apps',
  'desktop_list_windows',
  'desktop_get_window_state',
  'desktop_window_click',
  'desktop_window_type',
  'desktop_window_press_key',
  'desktop_window_scroll',
  'desktop_window_drag',
  'connector_vercel_domains',
  'connector_vercel_env',
  'connector_vercel_get_deployment',
  'connector_vercel_list_deployments',
  'connector_vercel_list_projects',
  'connector_vercel_list_teams',
  'connector_vercel_redeploy',
  'connector_vercel_status',
  'x_api_add_list_member',
  'x_api_block_user',
  'x_api_create_bookmark',
  'x_api_create_list',
  'x_api_create_post',
  'x_api_delete_bookmark',
  'x_api_delete_list',
  'x_api_delete_post',
  'x_api_follow_list',
  'x_api_follow_user',
  'x_api_get_bookmarks',
  'x_api_get_dm_events',
  'x_api_get_followers',
  'x_api_get_following',
  'x_api_get_liked_posts',
  'x_api_get_liking_users',
  'x_api_get_list',
  'x_api_get_list_posts',
  'x_api_get_owned_lists',
  'x_api_get_personalized_trends',
  'x_api_get_post',
  'x_api_get_posts',
  'x_api_get_reposted_by',
  'x_api_get_reposts_of_me',
  'x_api_get_space',
  'x_api_get_trends',
  'x_api_get_usage',
  'x_api_get_user',
  'x_api_get_user_by_username',
  'x_api_get_user_mentions',
  'x_api_get_user_posts',
  'x_api_like_post',
  'x_api_me',
  'x_api_mute_user',
  'x_api_pin_list',
  'x_api_remove_list_member',
  'x_api_repost',
  'x_api_request',
  'x_api_search_all',
  'x_api_search_recent',
  'x_api_search_spaces',
  'x_api_send_dm',
  'x_api_unblock_user',
  'x_api_unfollow_list',
  'x_api_unfollow_user',
  'x_api_unlike_post',
  'x_api_unmute_user',
  'x_api_unpin_list',
  'x_api_unrepost',
  'x_api_update_list',
  'x_search',
  'xai_live_search',
  'agent_info',
  'agent_list',
  'agent_message_send',
  'agent_reply_wait',
  'agent_thread_watch',
  'agent_turn_request',
  'agent_update',
  'delete_agent',
  'deploy_analysis_team',
  'dispatch_team_agent',
  'dispatch_to_agent',
  'get_agent_result',
  'manage_team_context_ref',
  'manage_team_goal',
  'message_main_agent',
  'message_subagent',
  'post_to_team_chat',
  'reply_to_team',
  'request_context',
  'request_manager_help',
  'request_team_member_turn',
  'share_artifact',
  'spawn_subagent',
  'talk_to_manager',
  'talk_to_subagent',
  'talk_to_teammate',
  'team_manage',
  'update_my_status',
  'update_team_goal',
  'creative_add_effect',
  'creative_add_element',
  'creative_add_mask',
  'creative_apply_animation',
  'creative_apply_brand_kit',
  'creative_apply_ops',
  'creative_apply_style',
  'creative_apply_template',
  'creative_arrange',
  'creative_chain_scene',
  'creative_checkpoint',
  'creative_create_library_pack',
  'creative_create_project',
  'creative_create_storyboard',
  'creative_delete_element',
  'creative_element_inventory',
  'creative_export',
  'creative_export_trace',
  'creative_get_state',
  'creative_history_status',
  'creative_list_library_packs',
  'creative_list_references',
  'creative_project_history',
  'creative_purge_scene',
  'creative_redo',
  'creative_reset_scene',
  'creative_save_scene',
  'creative_search_animations',
  'creative_select_element',
  'creative_set_blend_mode',
  'creative_set_canvas',
  'creative_storyboard_history',
  'creative_toggle_library_pack',
  'creative_undo',
  'creative_update_element',
  'get_creative_mode',
  'switch_creative_mode',
  'creative_add_asset',
  'creative_analyze_asset',
  'creative_extract_layers',
  'creative_extract_layers_for_generation',
  'creative_fit_asset',
  'creative_generate_asset',
  'creative_generation_history',
  'creative_import_asset',
  'creative_normalize_layer_specs',
  'creative_register_generation',
  'creative_render_ascii_asset',
  'creative_search_assets',
  'creative_search_icons',
  'creative_add_audio_track',
  'creative_add_generated_clip_to_composition',
  'creative_add_music_bed',
  'creative_add_sound_effects',
  'creative_apply_motion_template',
  'creative_attach_audio_from_file',
  'creative_attach_audio_from_url',
  'creative_auto_assemble_rough_cut',
  'creative_composite_video_layers',
  'creative_composition_add_clip',
  'creative_composition_add_track',
  'creative_composition_delete_clip',
  'creative_composition_get',
  'creative_composition_move_clip',
  'creative_composition_render',
  'creative_composition_save',
  'creative_composition_select_clip',
  'creative_composition_set_transition',
  'creative_composition_split_at',
  'creative_composition_trim_clip',
  'creative_download_audio',
  'creative_extract_audio_from_video',
  'creative_extract_video_frame',
  'creative_extract_video_frames',
  'creative_generate_image_shot',
  'creative_generate_motion_graphics_layer',
  'creative_generate_motion_variants',
  'creative_generate_sequence',
  'creative_generate_video_shot',
  'creative_generate_voiceover',
  'creative_import_audio',
  'creative_list_motion_templates',
  'creative_mix_audio_tracks',
  'creative_pick_continuity_frame',
  'creative_preview_motion_template',
  'creative_refine_video_shot',
  'creative_render_generated_sequence',
  'creative_render_snapshot',
  'creative_stitch_clips',
  'creative_sync_captions_to_audio',
  'creative_timeline',
  'creative_transcribe_audio',
  'creative_trim_clip',
  'creative_wrap_video_as_html_motion_clip',
  'creative_write_shot_prompt',
  'creative_apply_html_motion_template',
  'creative_apply_hyperframes_component',
  'creative_create_html_motion_clip',
  'creative_export_html_motion_clip',
  'creative_import_hyperframes_component',
  'creative_list_html_motion_blocks',
  'creative_list_html_motion_templates',
  'creative_list_hyperframes_components',
  'creative_overlay_hyperframes_on_video',
  'creative_patch_html_motion_clip',
  'creative_promote_scene_to_template',
  'creative_read_html_motion_clip',
  'creative_render_html_motion_block',
  'creative_render_html_motion_snapshot',
  'creative_restore_html_motion_revision',
  'creative_save_html_motion_block',
  'creative_save_html_motion_template',
  'creative_sync_hyperframes_catalog',
  'hyperframes_add_animation',
  'hyperframes_apply_patch',
  'hyperframes_browse_catalog',
  'hyperframes_export',
  'hyperframes_insert_clip',
  'hyperframes_lint',
  'hyperframes_materialize',
  'hyperframes_qa',
  'hyperframes_set_asset',
  'hyperframes_set_color',
  'hyperframes_set_text',
  'hyperframes_set_timing',
  'hyperframes_set_variable',
  'creative_analyze_generated_video',
  'creative_compare_shots',
  'creative_composition_lint',
  'creative_frame_diff',
  'creative_frame_trace',
  'creative_lint_html_motion_clip',
  'creative_measure_text',
  'creative_preflight_overlay',
  'creative_quality_report',
  'creative_retry_shot_until_pass',
  'creative_sample_composite_frames',
  'creative_select_best_take',
  'creative_text_fit_report',
  'creative_validate_composition_layers',
  'creative_validate_layout',
  'image_check_contrast',
  'image_check_text_overflow',
  'image_detect_empty_regions',
  'image_get_bounds_summary',
  'image_get_element_at_point',
  'image_get_overlaps',
  'video_analyze_frame',
  'video_analyze_imported_video',
  'video_analyze_timeline',
  'video_check_audio_sync',
  'video_check_caption_timing',
  'video_check_keyframes',
  'video_extract_clip_frames',
  'video_render_contact_sheet',
  'video_render_frame',
  'show_agent_work',
  'show_product_carousel',
  'show_sources',
  'show_market',
  'show_stocks',
  'show_weather',
  'show_comparison',
  'show_chart',
  'show_run_result',
  'show_prediction_market',
  'show_map',
  'run_command',
  'start_process',
  'process_status',
  'process_log',
  'process_wait',
  'process_kill',
  'process_submit',
  'terminal',
  'read_file',
  'list_files',
  'list_directory',
  'grep_file',
  'grep_files',
  'file_stats',
  'mkdir',
  'present_file',
  'apply_workspace_patchset',
  'create_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'delete_file',
  'write_file',
  'rename_file',
  'copy_file',
  'move_file',
  'copy_directory',
  'move_directory',
  'path_exists',
  'show_diff',
  'preview_patch',
  'apply_patch',
  'format_changed_files',
  'revert_last_tool_change',
  'revert_own_patch',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'git_commit',
  'git_push',
  'open_pr',
  'run_tests',
  'run_linter',
  'run_formatter',
  'run_typecheck',
  'start_dev_server',
  'read_process_output',
  'stop_process',
  'snapshot_workspace',
  'restore_snapshot',
  'scan_secrets',
  'scan_large_files',
  'operation_plan',
  'code_outline',
  'get_symbols',
  'go_to_definition',
  'find_references',
  'read_dev_sources',
  'read_source',
  'list_source',
  'grep_source',
  'source_stats',
  'src_stats',
  'validate_source',
  'read_webui_source',
  'list_webui_source',
  'grep_webui_source',
  'webui_source_stats',
  'webui_stats',
  'validate_webui_source',
  'list_prom',
  'prom_file_stats',
  'validate_prom_file',
  'read_prom_file',
  'grep_prom',
  'source_stats_batch',
  'apply_dev_source_patchset',
  'find_replace_source',
  'replace_lines_source',
  'insert_after_source',
  'delete_lines_source',
  'write_source',
  'delete_source',
  'find_replace_webui_source',
  'replace_lines_webui_source',
  'insert_after_webui_source',
  'delete_lines_webui_source',
  'write_webui_source',
  'delete_webui_source',
  'find_replace_prom',
  'replace_lines_prom',
  'insert_after_prom',
  'delete_lines_prom',
  'write_prom_file',
  'delete_prom_file',
  'prom_apply_dev_changes',
]);

const INTEGRATION_ADMIN_TOOL_NAMES = new Set([
  'mcp_server_manage', 'webhook_manage', 'integration_quick_setup',
]);

const SOCIAL_INTELLIGENCE_TOOL_NAMES = new Set(['social_intel']);

const PROPOSAL_ADMIN_TOOL_NAMES = new Set(['edit_proposal']);

const COMPOSITE_MANAGEMENT_TOOL_NAMES = new Set([
  'create_composite',
  'get_composite',
  'edit_composite',
  'delete_composite',
  'list_composites',
]);

function isSavedCompositeToolName(name: string): boolean {
  try {
    return loadComposites().has(name);
  } catch {
    return false;
  }
}

export function getToolCategory(name: string): InternalToolCategory | null {
  // Keep these always available as core runtime tools.
  if (name === 'browser_send_to_telegram') return null;
  if (name === 'delivery_send' || name === 'delivery_send_screenshot') return null;
  if (name === 'connector_list') return null; // core tool — always available
  if (name === 'generate_image' || name === 'generate_video') return null;
  if (name === 'chat_with_subagent') return null; // core direct-chat tool for standalone subagents
  if (name === 'agent_run_ops') return null; // core run/recovery bridge for subagent autopilot
  if (CORE_CREATIVE_CONTROL_TOOL_NAMES.has(name)) return getCreativeToolCategory(name);
  if (name === 'save_site_shortcut') return 'browser_automation';
  if (name === 'inspect_console' || name === 'run_accessibility_check' || name === 'browser_smoke_test') return 'browser_automation';
  if (name.startsWith('browser_')) return 'browser_automation';
  if (name.startsWith('desktop_')) return 'desktop_automation';
  if (EXTERNAL_APP_WRAPPER_TOOL_NAMES.has(name)) return 'external_apps';
  if (name.startsWith('connector_')) return 'external_apps';
  if (name.startsWith('x_api_')) return 'external_apps';
  if (name.startsWith('mcp__')) return 'mcp_server_tools';
  if (name.startsWith('vercel_')) return 'integration_admin';
  if (TEAM_OPS_TOOL_NAMES.has(name)) return 'agents_and_teams';
  if (DEV_SOURCE_APPROVAL_TOOL_NAMES.has(name)) return 'prometheus_source_read';
  if (DEV_ONLY_SOURCE_READ_TOOL_NAMES.has(name)) return 'prometheus_source_read';
  if (SOURCE_WRITE_TOOL_NAMES.has(name)) return 'prometheus_source_write';
  if (COMMAND_RUNNER_TOOL_NAMES.has(name)) return 'workspace_write';
  if (FILE_OPS_TOOL_NAMES.has(name)) return 'workspace_write';
  if (MEMORY_TOOL_NAMES.has(name)) return 'advanced_memory';
  if (MEDIA_TOOL_NAMES.has(name)) return 'media_assets';
  if (CREATIVE_VIDEO_QA_TOOL_NAMES.has(name)) return getCreativeToolCategory(name);
  if (HYPERFRAMES_TOOL_NAMES.has(name)) return getCreativeToolCategory(name);
  if (MEDIA_QUALITY_TOOL_NAMES.has(name)) return getCreativeToolCategory(name);
  if (AUTOMATION_TOOL_NAMES.has(name)) return 'automations';
  if (name.startsWith('skill_') && name !== 'skill_list' && name !== 'skill_read') return 'skills';
  if (SKILL_AUTHORING_TOOL_NAMES.has(name)) return 'skills';
  if (MODEL_MANAGEMENT_TOOL_NAMES.has(name)) return 'model_management';
  if (BUSINESS_TOOL_NAMES.has(name)) return 'business';
  if (name.startsWith('creative_')) return getCreativeToolCategory(name);
  if (INTEGRATION_ADMIN_TOOL_NAMES.has(name)) return 'integration_admin';
  if (SOCIAL_INTELLIGENCE_TOOL_NAMES.has(name)) return 'social_intelligence';
  if (PROPOSAL_ADMIN_TOOL_NAMES.has(name)) return 'proposal_admin';
  if (COMPOSITE_MANAGEMENT_TOOL_NAMES.has(name) || isSavedCompositeToolName(name)) return 'composite_tools';
  return null; // null = core tool, always included
}

const TOOL_BUILD_CACHE_TTL_MS = 30_000;
const TOOL_BUILD_CACHE_MAX_ENTRIES = 64;
const INCLUDE_DIRECT_CONNECTOR_TOOL_SCHEMAS =
  String(process.env.PROMETHEUS_DIRECT_CONNECTOR_TOOL_SCHEMAS || '').trim() === '1';
const DYNAMIC_TOOL_SURFACE_CATEGORIES = new Set<string>([
  'mcp_server_tools',
  'composite_tools',
]);
const toolBuildCache = new Map<string, { at: number; tools: any[] }>();

function stableCategoryKey(categories: Set<string>): string {
  return Array.from(categories).sort().join(',');
}

function trimToolBuildCache(): void {
  while (toolBuildCache.size > TOOL_BUILD_CACHE_MAX_ENTRIES) {
    const firstKey = toolBuildCache.keys().next().value;
    if (!firstKey) return;
    toolBuildCache.delete(firstKey);
  }
}

export function buildTools(deps: BuildToolsDeps, activatedCategories?: Set<string>) {
  const { getMCPManager } = deps;
  const configSnapshot = getConfig().getConfig() as any;
  const isPublicBuild = getPublicBuildAllowedCategories(['prometheus_source_write'] as const).length === 0;
  const normalizedActiveCategories = new Set<string>();
  if (activatedCategories !== undefined) {
    for (const category of activatedCategories) {
      const normalized = normalizeToolCategory(category);
      if (normalized) normalizedActiveCategories.add(normalized);
    }
  }
  const categoryIsActive = (category: ToolCategory): boolean => (
    activatedCategories === undefined || normalizedActiveCategories.has(category)
  );
  const cacheable = activatedCategories !== undefined
    && !Array.from(DYNAMIC_TOOL_SURFACE_CATEGORIES).some((category) => normalizedActiveCategories.has(category));
  const subagentMode = configSnapshot.orchestration?.subagent_mode === true;
  const agentBuilderEnabled = configSnapshot?.agent_builder?.enabled === true;
  const cacheKey = cacheable
    ? [
      `public:${isPublicBuild ? '1' : '0'}`,
      `subagent:${subagentMode ? '1' : '0'}`,
      `agentBuilder:${agentBuilderEnabled ? '1' : '0'}`,
      `cats:${stableCategoryKey(normalizedActiveCategories)}`,
    ].join('|')
    : '';
  if (cacheKey) {
    const cached = toolBuildCache.get(cacheKey);
    if (cached && Date.now() - cached.at <= TOOL_BUILD_CACHE_TTL_MS) return cached.tools.slice();
    if (cached) toolBuildCache.delete(cacheKey);
  }
  const creativeCategoryActive = categoryIsActive('creative_basic')
    || categoryIsActive('creative_image')
    || categoryIsActive('creative_video')
    || categoryIsActive('creative_hyperframes')
    || categoryIsActive('creative_quality');

  const toolDefs = [
    // ── File, Web, and Memory tools ──────────────────────────────────────────
    ...getFileWebMemoryTools(),
    {
      type: 'function',
      function: {
        name: 'delivery_send',
        description:
          'Unified delivery/presentation wrapper. action="send" sends a message, file, or image through an origin-aware delivery channel; action="screenshot" captures/reuses a screenshot and delivers it; action="present_file" presents a local file as an inline assistant artifact and optionally delivers it. Prefer target="origin" unless the user explicitly names a destination.',
        parameters: {
          type: 'object', required: [],
          properties: {
            action: { type: 'string', enum: ['send', 'screenshot', 'present_file'], description: 'Default send. Use present_file to show a local file with the assistant message.' },
            text: { type: 'string', description: 'Text message to deliver.' },
            message: { type: 'string', description: 'Alias for text.' },
            target: { type: 'string', enum: ['origin', 'telegram', 'mobile', 'web', 'discord', 'whatsapp', 'terminal', 'all'], description: 'Destination. Default origin.' },
            attachmentPath: { type: 'string', description: 'Optional workspace-relative or absolute file path to deliver.' },
            attachmentPaths: { type: 'array', items: { type: 'string' }, description: 'Optional batch of workspace-relative or absolute file paths to deliver/present together.' },
            path: { type: 'string', description: 'File path for action="present_file", or screenshot source=file.' },
            paths: { type: 'array', items: { type: 'string' }, description: 'Batch of file paths for action="present_file".' },
            files: { type: 'array', items: { type: 'string' }, description: 'Alias for paths/attachmentPaths when sending or presenting multiple files.' },
            filename: { type: 'string', description: 'Alias for path/attachmentPath.' },
            imageBase64: { type: 'string', description: 'Optional base64 image payload to deliver.' },
            mimeType: { type: 'string', description: 'Mime type for imageBase64 or attachment, e.g. image/png.' },
            caption: { type: 'string', description: 'Caption for images/files. Defaults to text.' },
            source: { type: 'string', enum: ['desktop_new', 'desktop_last', 'browser_new', 'browser_last', 'file'], description: 'Screenshot source for action="screenshot". Default desktop_new.' },
            title: { type: 'string', description: 'Optional display title for presented files.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delivery_send_screenshot',
        description:
          'Capture or reuse a desktop/browser screenshot and deliver it through the origin-aware delivery router. Prefer target="origin" unless the user explicitly names a destination. Using mobile/Telegram as the origin does not mean desktop capture is unavailable; Prometheus still captures from the local computer.',
        parameters: {
          type: 'object', required: [],
          properties: {
            source: { type: 'string', enum: ['desktop_new', 'desktop_last', 'browser_new', 'browser_last', 'file'], description: 'Screenshot source. Default desktop_new.' },
            target: { type: 'string', enum: ['origin', 'telegram', 'mobile', 'web', 'discord', 'whatsapp', 'terminal', 'all'], description: 'Destination. Default origin.' },
            caption: { type: 'string', description: 'Caption for the screenshot.' },
            path: { type: 'string', description: 'Required when source=file. Workspace-relative or absolute image path.' },
          },
        },
      },
    },
    // ── Telegram proactive push (works from any session) ───────────────────
    {
      type: 'function',
      function: {
        name: 'send_telegram',
        description:
          'Proactively send a message or screenshot to the user\'s Telegram. ' +
          'Works from ANY session — web UI, background task, cron job. ' +
          'Use to notify the user of task completion, errors, or to share a desktop screenshot. ' +
          'For screenshots: call desktop_screenshot first, then send_telegram with screenshot:true.',
        parameters: {
          type: 'object', required: [],
          properties: {
            text: { type: 'string', description: 'Text message to send. Also used as caption when screenshot:true.' },
            screenshot: { type: 'boolean', description: 'If true, sends the last captured desktop screenshot as a photo. Requires desktop_screenshot to have been called first.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'terminal',
        description: 'Unified terminal/process tool. action=run runs a bounded captured command; start creates a supervised background process; status/log/wait/kill/submit manage process runIds. Default permissions ask before outside-workspace paths; Lite permissions allow full-computer terminal access except hard-blocked dangerous commands.',
        parameters: {
          type: 'object', required: [],
          properties: {
            action: { type: 'string', enum: ['run', 'start', 'status', 'log', 'wait', 'kill', 'submit'], description: 'Default run; mode=background also means start.' },
            command: { type: 'string', description: 'Command to run.' },
            cwd: { type: 'string', description: 'Optional working directory relative to the active workspace, or an absolute computer path. Outside-workspace paths require approval in default permissions and run directly in Lite permissions.' },
            mode: { type: 'string', enum: ['auto', 'foreground', 'background'], description: 'Legacy alias: background maps to action=start.' },
            shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'], description: 'Shell to use.' },
            pty: { type: 'boolean', description: 'Use a pseudo-terminal for interactive CLIs/auth/REPLs.' },
            timeoutMs: { type: 'number', description: 'Foreground timeout in milliseconds.' },
            noOutputTimeoutMs: { type: 'number', description: 'Kill if no output arrives within this many milliseconds.' },
            title: { type: 'string', description: 'Optional human-readable title for UI command cards.' },
            stdin: { type: 'boolean', description: 'Keep stdin open for interactive processes.' },
            runId: { type: 'string', description: 'Process runId for status/log/wait/kill/submit.' },
            limit: { type: 'number', description: 'Max process records for status.' },
            maxChars: { type: 'number', description: 'Max log characters for log.' },
            data: { type: 'string', description: 'Text to send for submit.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run shell commands or open apps. Dev CLI commands (git, npm, node, python, etc.) run CAPTURED by default — output is returned inline, no new window. Pass visible:true only if the user explicitly needs to see a terminal window. For GUI apps (notepad, code, explorer) a visible window opens automatically. NEVER use for Chrome/Edge — use browser_open instead. **GIT BEST PRACTICES FOR PROMETHEUS**: (1) For submodule (workspace/xposemarket-site), ALWAYS use full path: `git -C workspace/xposemarket-site status` NOT `cd xposemarket-site` which fails with "path not found". (2) Use `git -C <path>` pattern for reliable automation. (3) Initialize submodules: `git submodule update --init --recursive`.',
        parameters: {
          type: 'object', required: ['command'],
          properties: {
            command: { type: 'string', description: 'Examples: "notepad", "git init", "npm install", "npm run build", "git push origin main", "code D:\\project", "git -C workspace/xposemarket-site status", "git status". **CRITICAL FOR GIT**: (1) Submodule at workspace/xposemarket-site — NEVER use `cd xposemarket-site` alone. Use `git -C workspace/xposemarket-site status` instead. (2) Do NOT use "chrome" or "msedge" — use browser_open instead.' },
            cwd: { type: 'string', description: 'Optional working directory relative to the active workspace, or an absolute computer path. Outside-workspace paths require approval in default permissions and run directly in Lite permissions. Use this for repo folders with spaces, e.g. "Prometheus Website/prometheus-site".' },
            shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'], description: 'Shell to use. On Windows, use powershell for PowerShell-native commands.' },
            pty: { type: 'boolean', description: 'Use a pseudo-terminal for interactive CLIs/auth flows/REPLs.' },
            timeoutMs: { type: 'number', description: 'Timeout in milliseconds. Default 120000.' },
            visible: { type: 'boolean', description: 'If true, opens a visible terminal window instead of capturing output. Default: false (captured).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'start_process',
        description: 'Start a long-running command as a supervised Prometheus process. Use this for dev servers, watchers, interactive CLIs, long builds, renders, or commands the user may want to inspect/kill later. Returns a runId; use process_status/process_log/process_wait/process_kill/process_submit to manage it.',
        parameters: {
          type: 'object',
          required: ['command'],
          properties: {
            command: { type: 'string', description: 'Command to start, e.g. "npm run dev" or "python server.py".' },
            cwd: { type: 'string', description: 'Optional working directory relative to active workspace, or absolute path inside allowed paths.' },
            shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'], description: 'Shell to use. Default auto.' },
            pty: { type: 'boolean', description: 'Use a pseudo-terminal for interactive CLIs/auth flows/REPLs.' },
            title: { type: 'string', description: 'Optional human-readable title for UI command cards.' },
            stdin: { type: 'boolean', description: 'If true, keep stdin open so process_submit can answer prompts.' },
            noOutputTimeoutMs: { type: 'number', description: 'Optional no-output timeout in milliseconds.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_status',
        description: 'Inspect supervised command runs. Pass runId for one process, or omit it to list recent process cards.',
        parameters: {
          type: 'object',
          properties: {
            runId: { type: 'string', description: 'Optional run id.' },
            limit: { type: 'number', description: 'Optional max runs to list.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_log',
        description: 'Read stdout/stderr logs for a supervised process run.',
        parameters: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string', description: 'Process run id.' },
            maxChars: { type: 'number', description: 'Optional max characters to return.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_wait',
        description: 'Wait for a running supervised process to exit and return its captured output.',
        parameters: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string', description: 'Process run id.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_kill',
        description: 'Kill a running supervised process by runId.',
        parameters: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string', description: 'Process run id.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'process_submit',
        description: 'Send one line of stdin to a running supervised process. Use for prompts in interactive CLIs started with start_process({stdin:true}).',
        parameters: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string', description: 'Process run id.' },
            data: { type: 'string', description: 'Text to send before Enter.' },
          },
        },
      },
    },
    // Browser/desktop schemas are large and category-only. Avoid constructing
    // them for normal chat/background turns where they will be filtered out.
    ...(categoryIsActive('browser_automation') ? getBrowserToolDefinitions() : []),
    ...(categoryIsActive('desktop_automation') ? getDesktopToolDefinitions() : []),
    // ── Sub-agent tools ── shown based on subagent_mode toggle ────────────────────────────────────
    ...(() => {
      if (subagentMode) {
        return [{
          type: 'function' as const,
          function: {
            name: 'subagent_spawn',
            description:
              'Spawn a child agent in an isolated session to handle a parallel subtask. ' +
              'Use only when the current task must wait for the child result before it can continue. ' +
              'For ASAP, urgent, time-sensitive, or independent parallel work, use background_ops(action:"spawn") instead so the current task can continue without waiting. ' +
              'Do NOT call this recursively from inside a child task.',
            parameters: {
              type: 'object',
              required: ['task_title', 'task_prompt'],
              properties: {
                task_title:      { type: 'string', description: 'Short title for the sub-agent task' },
                task_prompt:     { type: 'string', description: 'Full instruction for the sub-agent (be precise)' },
                context_snippet: { type: 'string', description: 'Relevant context pre-extracted for the sub-agent (file contents, URLs, etc.)' },
                expected_output: { type: 'string', description: 'What the sub-agent should return when done' },
                profile: {
                  type: 'string',
                  enum: ['file_editor', 'researcher', 'shell_runner', 'reader_only'],
                  description: 'Tool access profile: file_editor=read/write files, researcher=read+web, shell_runner=run_command, reader_only=read only',
                },
              },
            },
          },
        }];
      }
      return [];
    })(),
    // ── Agent, Team, and Schedule tools ──────────────────────────────────────
    ...getAgentTeamScheduleTools(),
    // ── CIS, System, and Self-improvement tools ───────────────────────────────
    ...getCisSystemTools(),
    // ── Creative editor tools ─────────────────────────────────────────────────
    ...(creativeCategoryActive ? getCreativeToolDefs() : []),
    // ── Agent Builder Integration Tools (only when enabled in config) ─────────
  ] as any[];

  if (agentBuilderEnabled) {
    registerAgentBuilderTools(toolDefs);
  }

  // ── connector_list: always-available connector discovery tool ─────────────
  toolDefs.push({
    type: 'function',
    function: {
      name: 'connector_list',
      description:
        'List all available connectors (Gmail, GitHub, Slack, Notion, Google Drive, Reddit, HubSpot, Salesforce, Stripe, Google Analytics, Obsidian, X/Twitter, xAI/Grok when configured) and their connection status. ' +
        'Shows which connectors are connected and what tools are available for each. ' +
        'Use this before activating the external_apps category to check what\'s available.',
      parameters: { type: 'object', required: [], properties: {} },
    },
  });
  toolDefs.push(
    {
      type: 'function',
      function: {
        name: 'x_search_ops',
        description: 'Unified X/xAI search wrapper. Delegates to X API search/trends/space tools or xAI live/X search tools.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['x_search', 'live_search', 'search_recent', 'search_all', 'search_spaces', 'get_trends', 'get_personalized_trends', 'get_space'] },
            query: { type: 'string' },
            q: { type: 'string' },
            space_id: { type: 'string' },
            id: { type: 'string' },
            max_results: { type: 'number' },
            max_search_results: { type: 'number' },
            since_id: { type: 'string' },
            until_id: { type: 'string' },
            next_token: { type: 'string' },
            pagination_token: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'x_posts',
        description: 'Unified X post/bookmark/like/repost wrapper. Mutating actions still use the existing X connector handlers and policy.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['get_post', 'get_posts', 'create_post', 'delete_post', 'create_bookmark', 'delete_bookmark', 'get_bookmarks', 'like', 'unlike', 'get_liked_posts', 'get_liking_users', 'repost', 'unrepost', 'get_reposted_by', 'get_reposts_of_me'] },
            id: { type: 'string' },
            post_id: { type: 'string' },
            tweet_id: { type: 'string' },
            ids: { type: 'array', items: { type: 'string' } },
            text: { type: 'string' },
            reply_to_post_id: { type: 'string' },
            quote_post_id: { type: 'string' },
            max_results: { type: 'number' },
            pagination_token: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'x_users',
        description: 'Unified X user/profile/social graph wrapper.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['me', 'get_user', 'get_user_by_username', 'get_user_posts', 'get_user_mentions', 'get_followers', 'get_following', 'follow', 'unfollow', 'mute', 'unmute', 'block', 'unblock'] },
            id: { type: 'string' },
            user_id: { type: 'string' },
            username: { type: 'string' },
            handle: { type: 'string' },
            max_results: { type: 'number' },
            pagination_token: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'x_lists',
        description: 'Unified X list wrapper for list reads, membership, follows, pins, and list mutations.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['get_list', 'get_owned_lists', 'get_list_posts', 'create_list', 'update_list', 'delete_list', 'add_member', 'remove_member', 'follow_list', 'unfollow_list', 'pin_list', 'unpin_list'] },
            id: { type: 'string' },
            list_id: { type: 'string' },
            user_id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            private: { type: 'boolean' },
            max_results: { type: 'number' },
            pagination_token: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'x_dm',
        description: 'Unified X direct-message wrapper.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['send', 'get_events'] },
            participant_id: { type: 'string' },
            conversation_id: { type: 'string' },
            text: { type: 'string' },
            max_results: { type: 'number' },
            pagination_token: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'x_admin',
        description: 'Unified X API admin/escape-hatch wrapper for usage and raw API requests.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['request', 'get_usage'] },
            method: { type: 'string' },
            path: { type: 'string' },
            params: { type: 'object' },
            body: { type: 'object' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'vercel_ops',
        description: 'Unified Vercel connector wrapper for status, teams, projects, deployments, redeploy, env, and domains.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['status', 'list_teams', 'list_projects', 'list_deployments', 'get_deployment', 'redeploy', 'env', 'domains'] },
            team_id: { type: 'string' },
            project_id: { type: 'string' },
            project_name: { type: 'string' },
            deployment_id: { type: 'string' },
            domain: { type: 'string' },
            key: { type: 'string' },
            value: { type: 'string' },
            target: { type: 'string' },
            action_type: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      },
    },
  );

  // ── Dynamic tools (connectors, MCP, composites) ───────────────────────────
  // These are appended AFTER the deterministic core tools above. Their source
  // order is not guaranteed stable across turns (server reconnects, composite
  // edits, Map iteration), and for OpenAI/xAI automatic prefix caching the tool
  // list is part of the cached prefix — any reorder silently breaks the cache.
  // We collect them separately and sort by name so the serialized prefix is
  // byte-stable turn-to-turn. Core tools keep their deliberate code order.
  const dynamicToolDefs: any[] = [];

  // Connector, MCP, and composite tools can require status probes or filesystem
  // scans. Avoid touching those dynamic systems unless their category is in the
  // current tool surface; connector_list remains core for discovery.
  if (categoryIsActive('external_apps') && INCLUDE_DIRECT_CONNECTOR_TOOL_SCHEMAS) {
    try {
      ensurePrometheusExtensionRuntimeLoaded();
      dynamicToolDefs.push(...getExtensionRuntimeRegistry().listConnectedConnectorToolDefinitions());
    } catch { /* connector defs may not load in all build targets */ }
  }

  if (categoryIsActive('mcp_server_tools')) {
    try {
      const mcpTools = getMCPManager().getAllTools();
      for (const t of mcpTools) {
        const prefixedName = `mcp__${t.serverId}__${t.name}`;
        dynamicToolDefs.push({
          type: 'function',
          function: {
            name: prefixedName,
            description: `[MCP:${t.serverName}] ${t.description}`,
            parameters: t.inputSchema ?? { type: 'object', properties: {}, required: [] },
          },
        });
      }
    } catch { /* MCP not ready yet — skip silently */ }
  }

  if (categoryIsActive('composite_tools')) {
    try {
      dynamicToolDefs.push(...getCompositeDefs());
      dynamicToolDefs.push(...getCompositeManagementTools());
    } catch { /* composites dir may not exist yet — skip silently */ }
  }

  dynamicToolDefs.sort((a, b) =>
    String(a?.function?.name || '').localeCompare(String(b?.function?.name || '')),
  );
  toolDefs.push(...dynamicToolDefs);

  // In public builds, hide every tool the execution layer hard-blocks
  // (isToolHiddenInPublicBuild in subagent-executor) — not just the source-read
  // names. Otherwise the model is shown source-write / self-update / restart tool
  // defs it can never execute, wasting context and inviting failed calls.
  const runtimeToolDefs = isPublicBuild
    ? toolDefs.filter((t: any) => !isToolHiddenInPublicBuild(String(t?.function?.name || '')))
    : toolDefs;
  const visibleToolDefs = runtimeToolDefs.filter((t: any) => !SCHEMA_HIDDEN_COMPAT_TOOL_NAMES.has(String(t?.function?.name || '')));

  // ── Filter to core + activated categories ──────────────────────────────────
  // When activatedCategories is provided, only return core tools + those in active categories.
  if (activatedCategories !== undefined) {
    const filteredTools = visibleToolDefs.filter((t: any) => {
      const name = String(t?.function?.name || '');
      const cat = getToolCategory(name);
      if (SOURCE_READ_FILE_HELPER_TOOL_NAMES.has(name) && normalizedActiveCategories.has('prometheus_source_read')) {
        return true;
      }
      return cat === null || normalizedActiveCategories.has(cat);
    });
    if (cacheKey) {
      toolBuildCache.set(cacheKey, { at: Date.now(), tools: filteredTools });
      trimToolBuildCache();
    }
    return filteredTools.slice();
  }

  return visibleToolDefs;
}

// ─── Tool Execution Helpers ────────────────────────────────────────────────────

export interface ToolResult {
  name: string;
  args: any;
  result: string;
  error: boolean;
  extra?: any;
  data?: any;
  artifacts?: any[];
}

export interface TaskControlResponse {
  success: boolean;
  action: string;
  code?: string;
  message?: string;
  scope?: string;
  task?: Record<string, any> | null;
  tasks?: Array<Record<string, any>>;
  scheduled_jobs?: Array<Record<string, any>>;
  candidates?: Array<Record<string, any>>;
}

export type ScheduleJobAction =
  | 'list'
  | 'create'
  | 'update'
  | 'pause'
  | 'resume'
  | 'delete'
  | 'run_now';

export function normalizeScheduleJobAction(raw: any): ScheduleJobAction | null {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'run-now') return 'run_now';
  if (['list', 'create', 'update', 'pause', 'resume', 'delete', 'run_now'].includes(v)) {
    return v as ScheduleJobAction;
  }
  return null;
}

export function summarizeCronJob(job: any): Record<string, any> {
  return {
    id: String(job?.id || ''),
    name: String(job?.name || ''),
    type: String(job?.type || 'recurring'),
    status: String(job?.status || 'scheduled'),
    enabled: job?.enabled !== false,
    schedule: job?.schedule || null,
    runAt: job?.runAt || null,
    tz: job?.tz || null,
    nextRun: job?.nextRun || null,
    lastRun: job?.lastRun || null,
    lastResult: job?.lastResult || null,
    sessionTarget: job?.sessionTarget || 'isolated',
    subagent_id: job?.subagent_id || null,
    team_id: job?.team_id || null,
    scheduleOwnerSubagent: job?.subagent_id || null,
    assignmentTarget: job?.assignmentTarget || null,
    deliverToMainChannel: job?.deliverToMainChannel === true,
    model: job?.model || null,
    skillIds: Array.isArray(job?.skillIds) ? job.skillIds : [],
    context_refs: Array.isArray(job?.context_refs) ? job.context_refs : [],
  };
}

export function normalizeDeliveryChannel(raw: any): 'web' | 'telegram' | 'discord' | 'whatsapp' {
  const v = String(raw || 'web').trim().toLowerCase();
  if (v === 'telegram' || v === 'discord' || v === 'whatsapp') return v;
  return 'web';
}

export function normalizeToolArgs(rawArgs: any): any {
  if (rawArgs == null) return {};
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof rawArgs === 'object') return rawArgs;
  return {};
}

export function normalizeToolArgsForTool(toolName: string, rawArgs: any): any {
  const normalized = normalizeToolArgs(rawArgs);
  if (toolName !== 'request_tool_category' || normalized?.category) return normalized;

  const categories = getRuntimeToolCategories();
  const readCategory = (value: unknown): string => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const direct = normalizeToolCategory(raw);
    if (direct && categories.includes(direct)) return direct;
    const match = raw.match(/\b(browser_automation|desktop_automation|agents_and_teams|prometheus_source_read|prometheus_source_write|workspace_write|advanced_memory|media_assets|creative_quality|media_quality|automations|external_apps|integration_admin|social_intelligence|proposal_admin|mcp_server_tools|composite_tools|creative_basic|creative_image|creative_video|creative_hyperframes|creative_mode|browser|desktop|team_ops|source_read|source_write|file_ops|memory|media|integrations|connectors|mcp|composites|creative|image_mode|video_mode|hyperframes|creative_qa)\b/);
    const matched = match ? normalizeToolCategory(match[1]) : null;
    return matched && categories.includes(matched) ? matched : '';
  };

  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    const category = readCategory((rawArgs as any).category || (rawArgs as any).name || (rawArgs as any).tool || (rawArgs as any).value);
    return category ? { ...normalized, category } : normalized;
  }

  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    let parsed: unknown = null;
    try { parsed = JSON.parse(trimmed); } catch { /* tolerate shorthand provider output */ }
    const category = readCategory(parsed || trimmed.replace(/^['"]|['"]$/g, ''));
    return category ? { ...normalized, category } : normalized;
  }

  return normalized;
}

export function parseJsonLike(raw: any): any {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function toStringRecord(raw: any): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[String(k)] = String(v);
  return out;
}

export function parseLooseMap(raw: any): Record<string, string> {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return toStringRecord(raw);
  if (typeof raw !== 'string') return {};
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}
