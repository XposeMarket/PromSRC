export interface ToolCapabilityMetadata {
  readOnly: boolean;
  localWrite: boolean;
  externalWrite: boolean;
  destructive: boolean;
  credentialUse: boolean;
  /** False means the tool was not explicitly classified and must fail closed. */
  known: boolean;
}

const READ_ONLY_TOOLS = new Set([
  'read', 'read_file', 'read_files_batch', 'list', 'list_files', 'list_directory',
  'stat', 'file_stats', 'path_exists', 'grep_file', 'grep_files', 'search_files',
  'file_tree', 'validate_file', 'validate_file_syntax', 'show_diff', 'preview_patch',
  'git_status', 'git_diff', 'git_log', 'git_branch', 'code_outline', 'get_symbols',
  'go_to_definition', 'find_references', 'time_now', 'agent_list', 'agent_info',
  'memory_browse', 'memory_read', 'memory_read_record', 'memory_search',
  'memory_search_project', 'memory_search_timeline', 'memory_get_related',
  'memory_graph_snapshot', 'memory_provider_status', 'memory_embedding_status',
  'web_search', 'web_search_single', 'web_search_multi', 'web_fetch', 'web_fetch_batch',
  'shopping_search_products', 'view_connections', 'process_status', 'process_log',
  'process_wait', 'read_process_output', 'desktop_doctor', 'desktop_screenshot',
  'desktop_get_monitors', 'desktop_window_screenshot', 'desktop_find_window',
  'desktop_get_clipboard', 'desktop_list_installed_apps', 'desktop_find_installed_app',
  'desktop_get_process_list', 'desktop_background_status', 'browser_snapshot',
  'browser_get_focused_item', 'browser_get_page_text', 'browser_snapshot_delta',
  'browser_get_url', 'browser_open', 'browser_back', 'browser_forward', 'browser_scroll', 'browser_wait',
  'browser_extract_structured', 'browser_element_watch', 'browser_vision_screenshot',
  'read_source', 'list_source', 'source_stats', 'webui_source_stats',
  'skill_list', 'skill_read', 'skill_resource_list', 'skill_resource_read',
  'skill_inspect', 'skill_scan', 'persona_read', 'get_team_logs', 'fetch_image',
  'analyze_image', 'analyze_video', 'desktop_get_window_text',
  'creative_get_state', 'creative_render_snapshot',
  'desktop_get_accessibility_tree', 'desktop_get_accessibility_state',
  'desktop_pixel_watch', 'desktop_list_macros', 'desktop_list_apps',
  'desktop_list_windows', 'desktop_get_window_state', 'desktop_locate_text',
  'connector_ga4_run_report', 'connector_ga4_realtime_users', 'connector_ga4_list_properties',
  'connector_gdrive_list_files', 'connector_gdrive_get_file', 'connector_gdrive_read_file',
  'connector_gdrive_search', 'connector_github_list_repos', 'connector_github_list_issues',
  'connector_github_list_prs', 'connector_github_search', 'connector_notion_search',
  'connector_notion_get_page', 'connector_notion_query_database',
  'connector_hubspot_list_contacts', 'connector_hubspot_get_contact',
  'connector_hubspot_search', 'connector_hubspot_list_deals',
  'connector_gmail_list_emails', 'connector_gmail_get_email', 'connector_gmail_prepare_email',
  'connector_gmail_get_profile', 'connector_gmail_list_labels',
  'connector_slack_list_channels', 'connector_slack_get_history', 'connector_slack_search',
  'connector_stripe_get_balance', 'connector_stripe_list_customers',
  'connector_stripe_list_charges', 'connector_stripe_list_products',
  'connector_reddit_get_posts', 'connector_reddit_search', 'connector_reddit_get_comments',
  'connector_salesforce_query', 'connector_salesforce_search', 'connector_salesforce_get_record',
  'connector_vercel_status', 'connector_vercel_list_teams', 'connector_vercel_list_projects',
  'connector_vercel_list_deployments', 'connector_vercel_get_deployment',
  'connector_obsidian_status',
]);

const CREDENTIAL_READ_ONLY_TOOLS = new Set([
  'connector_ga4_run_report', 'connector_ga4_realtime_users', 'connector_ga4_list_properties',
  'connector_gdrive_list_files', 'connector_gdrive_get_file', 'connector_gdrive_read_file',
  'connector_gdrive_search', 'connector_github_list_repos', 'connector_github_list_issues',
  'connector_github_list_prs', 'connector_github_search', 'connector_notion_search',
  'connector_notion_get_page', 'connector_notion_query_database',
  'connector_hubspot_list_contacts', 'connector_hubspot_get_contact',
  'connector_hubspot_search', 'connector_hubspot_list_deals',
  'connector_gmail_list_emails', 'connector_gmail_get_email', 'connector_gmail_prepare_email',
  'connector_gmail_get_profile', 'connector_gmail_list_labels',
  'connector_slack_list_channels', 'connector_slack_get_history', 'connector_slack_search',
  'connector_stripe_get_balance', 'connector_stripe_list_customers',
  'connector_stripe_list_charges', 'connector_stripe_list_products',
  'connector_reddit_get_posts', 'connector_reddit_search', 'connector_reddit_get_comments',
  'connector_salesforce_query', 'connector_salesforce_search', 'connector_salesforce_get_record',
  'connector_vercel_status', 'connector_vercel_list_teams', 'connector_vercel_list_projects',
  'connector_vercel_list_deployments', 'connector_vercel_get_deployment', 'connector_obsidian_status',
  'x_api_me', 'x_api_get_post', 'x_api_get_posts', 'x_api_search_recent', 'x_api_search_all',
  'x_api_get_bookmarks', 'x_api_get_liked_posts', 'x_api_get_liking_users',
  'x_api_get_reposted_by', 'x_api_get_reposts_of_me', 'x_api_get_user',
  'x_api_get_user_by_username', 'x_api_get_user_posts', 'x_api_get_user_mentions',
  'x_api_get_followers', 'x_api_get_following', 'x_api_get_list',
  'x_api_get_owned_lists', 'x_api_get_list_posts', 'x_api_search_spaces',
  'x_api_get_space', 'x_api_get_trends', 'x_api_get_personalized_trends',
  'x_api_get_dm_events', 'x_api_get_usage',
]);

const LOCAL_WRITE_TOOLS = new Set([
  'write', 'write_file', 'create_file', 'edit', 'replace_lines', 'insert_after',
  'find_replace', 'rename', 'rename_file', 'copy', 'copy_file', 'copy_directory',
  'move_file', 'move_directory', 'mkdir', 'append', 'apply_patch',
  'apply_workspace_patchset', 'work_context_execute', 'write_note', 'memory_write', 'memory_index_refresh',
  'memory_embedding_backfill', 'persona_update', 'schedule_memory',
  'snapshot_workspace', 'format_changed_files', 'clone_repo', 'download_url',
  'download_media', 'generate_image', 'generate_video', 'upload_image',
  'skill_import_bundle', 'skill_manifest_write', 'skill_update_metadata',
  'skill_create_bundle', 'skill_resource_write', 'skill_export_bundle',
  'skill_update_from_source', 'skill_curator', 'skill_create',
  'update_schedule_memory', 'talk_to_manager', 'manage_team_goal',
  'manage_team_context_ref', 'desktop_focus_window', 'desktop_wait',
  'desktop_set_clipboard', 'desktop_launch_app', 'desktop_close_app',
  'desktop_wait_for_change', 'desktop_diff_screenshot',
  'desktop_background_prepare_sandbox', 'desktop_record_macro', 'desktop_stop_macro',
  'creative_project', 'creative_scene', 'creative_image_ops', 'creative_video_ops',
  'creative_hyperframes_ops', 'creative_quality_ops',
]);

const DESTRUCTIVE_TOOLS = new Set([
  'delete', 'delete_file', 'delete_lines', 'restore_snapshot', 'revert_last_tool_change',
  'revert_own_patch', 'process_kill', 'stop_process', 'self_update',
  'skill_resource_delete', 'deploy_analysis_team', 'schedule_job',
]);

const COMMAND_TOOLS = new Set([
  'shell', 'terminal', 'run_command', 'run_command_supervised', 'start_process',
  'run_tests', 'run_linter', 'run_formatter', 'run_typecheck', 'start_dev_server',
  'process_submit', 'desktop_background_command',
]);

const EXTERNAL_WRITE_TOOLS = new Set([
  'gmail_send', 'slack_post', 'github_create', 'connector_github_create',
  'notion_update', 'hubspot_write', 'salesforce_write', 'stripe_write',
  'vercel_deploy', 'vercel_env', 'vercel_create', 'vercel_project', 'git_push',
  'open_pr', 'browser_click', 'browser_fill', 'browser_press', 'browser_press_key',
  'browser_submit', 'browser_upload_file', 'browser_click_and_download',
  'connector_github_create_issue', 'connector_github_create_repo',
  'connector_notion_create_page', 'connector_hubspot_create_contact',
  'connector_gmail_send_email', 'connector_slack_send_message',
  'connector_reddit_submit_post', 'connector_salesforce_create_record',
  'connector_vercel_redeploy', 'connector_vercel_env', 'connector_vercel_domains',
  'connector_obsidian_connect_vault', 'connector_obsidian_sync', 'connector_obsidian_writeback',
  'desktop_click', 'desktop_drag', 'desktop_scroll', 'desktop_type', 'desktop_type_raw',
  'desktop_press_key', 'desktop_window_control', 'desktop_accessibility_action',
  'desktop_replay_macro', 'desktop_click_text', 'desktop_window_click',
  'desktop_window_type', 'desktop_window_press_key', 'desktop_window_scroll',
  'desktop_window_drag', 'desktop_screen', 'desktop_apps', 'desktop_window',
  'desktop_input', 'desktop_macro', 'desktop_background',
  'x_api_delete_post', 'x_api_create_bookmark', 'x_api_delete_bookmark',
  'x_api_create_post', 'x_api_like_post', 'x_api_unlike_post', 'x_api_repost',
  'x_api_unrepost', 'x_api_follow_user', 'x_api_unfollow_user', 'x_api_mute_user',
  'x_api_unmute_user', 'x_api_block_user', 'x_api_unblock_user', 'x_api_create_list',
  'x_api_update_list', 'x_api_delete_list', 'x_api_add_list_member',
  'x_api_remove_list_member', 'x_api_follow_list', 'x_api_unfollow_list',
  'x_api_pin_list', 'x_api_unpin_list', 'x_api_send_dm',
]);

const READ_ONLY: ToolCapabilityMetadata = Object.freeze({
  readOnly: true, localWrite: false, externalWrite: false,
  destructive: false, credentialUse: false, known: true,
});
const LOCAL_WRITE: ToolCapabilityMetadata = Object.freeze({
  readOnly: false, localWrite: true, externalWrite: false,
  destructive: false, credentialUse: false, known: true,
});
const CREDENTIAL_READ_ONLY: ToolCapabilityMetadata = Object.freeze({
  readOnly: true, localWrite: false, externalWrite: false,
  destructive: false, credentialUse: true, known: true,
});
const DESTRUCTIVE: ToolCapabilityMetadata = Object.freeze({
  readOnly: false, localWrite: true, externalWrite: false,
  destructive: true, credentialUse: false, known: true,
});
const COMMAND: ToolCapabilityMetadata = Object.freeze({
  readOnly: false, localWrite: true, externalWrite: false,
  destructive: true, credentialUse: false, known: true,
});
const EXTERNAL_WRITE: ToolCapabilityMetadata = Object.freeze({
  readOnly: false, localWrite: false, externalWrite: true,
  destructive: false, credentialUse: true, known: true,
});
const UNKNOWN_FAIL_CLOSED: ToolCapabilityMetadata = Object.freeze({
  readOnly: false, localWrite: false, externalWrite: true,
  destructive: true, credentialUse: true, known: false,
});

export function resolveToolCapabilityMetadata(
  toolName: string,
  declared?: ToolCapabilityMetadata,
  args?: Record<string, any>,
): ToolCapabilityMetadata {
  if (declared) return { ...declared, known: declared.known !== false };
  const name = String(toolName || '').trim();
  if (name === 'work_context_execute') {
    const steps = Array.isArray(args?.steps) ? args.steps.slice(0, 8) : [];
    if (!steps.length) return UNKNOWN_FAIL_CLOSED;
    const nested = steps.map((step: any) => resolveToolCapabilityMetadata(String(step?.tool || ''), undefined, step?.args));
    return {
      readOnly: nested.every((item) => item.readOnly),
      localWrite: nested.some((item) => item.localWrite),
      externalWrite: nested.some((item) => item.externalWrite),
      destructive: nested.some((item) => item.destructive),
      credentialUse: nested.some((item) => item.credentialUse),
      known: nested.every((item) => item.known),
    };
  }
  if (name === 'x_api_request') {
    const method = String(args?.method || '').trim().toUpperCase();
    if (method === 'GET' || method === 'HEAD') return CREDENTIAL_READ_ONLY;
    return EXTERNAL_WRITE;
  }
  if (CREDENTIAL_READ_ONLY_TOOLS.has(name)) return CREDENTIAL_READ_ONLY;
  if (READ_ONLY_TOOLS.has(name)) return READ_ONLY;
  if (LOCAL_WRITE_TOOLS.has(name)) return LOCAL_WRITE;
  if (DESTRUCTIVE_TOOLS.has(name)) return DESTRUCTIVE;
  if (COMMAND_TOOLS.has(name)) return COMMAND;
  if (EXTERNAL_WRITE_TOOLS.has(name)) return EXTERNAL_WRITE;
  return UNKNOWN_FAIL_CLOSED;
}

export function capabilityPolicyTier(
  capabilities: ToolCapabilityMetadata,
): 'read' | 'propose' | 'commit' {
  if (!capabilities.known) return 'commit';
  if (capabilities.externalWrite || capabilities.destructive) return 'commit';
  if (capabilities.localWrite) return 'propose';
  return capabilities.readOnly ? 'read' : 'commit';
}
