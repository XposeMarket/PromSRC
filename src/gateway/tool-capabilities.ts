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
  'memory', 'memory_browse', 'memory_read', 'memory_read_record', 'memory_search',
  'memory_search_project', 'memory_search_timeline', 'memory_get_related',
  'memory_graph_snapshot', 'memory_provider_status', 'memory_embedding_status',
  'web_search', 'web_search_single', 'web_search_multi', 'web_fetch', 'web_fetch_batch',
  'shopping_search_products', 'view_connections', 'process_status', 'process_log',
  'process_wait', 'read_process_output', 'desktop_doctor', 'desktop_screenshot',
  'desktop_get_monitors', 'desktop_window_screenshot', 'desktop_find_window',
  'desktop_get_clipboard', 'desktop_list_installed_apps', 'desktop_find_installed_app',
  'desktop_get_process_list', 'desktop_background_status', 'browser_snapshot',
  'browser_get_focused_item', 'browser_get_page_text', 'browser_snapshot_delta',
  'browser_extract_structured', 'browser_element_watch', 'browser_vision_screenshot',
  'read_source', 'list_source', 'source_stats', 'webui_source_stats',
  'skill_list', 'skill_read', 'skill_resource_list', 'skill_resource_read',
  'skill_inspect', 'skill_scan', 'persona_read', 'get_team_logs', 'fetch_image',
  'analyze_image', 'analyze_video', 'desktop_get_window_text',
  'desktop_get_accessibility_tree', 'desktop_get_accessibility_state',
  'desktop_pixel_watch', 'desktop_list_macros', 'desktop_list_apps',
  'desktop_list_windows', 'desktop_get_window_state', 'desktop_locate_text',
  'connector_list', 'automation_dashboard', 'diagnostic_packet', 'system_diagnostics',
]);

const LOCAL_WRITE_TOOLS = new Set([
  'write', 'write_file', 'create_file', 'edit', 'replace_lines', 'insert_after',
  'find_replace', 'rename', 'rename_file', 'copy', 'copy_file', 'copy_directory',
  'move_file', 'move_directory', 'mkdir', 'append', 'apply_patch',
  'apply_workspace_patchset', 'write_note', 'memory_write', 'memory_index_refresh',
  'memory_embedding_backfill', 'persona_update', 'schedule_memory',
  'snapshot_workspace', 'format_changed_files', 'clone_repo', 'download_url',
  'download_media', 'video_social_cut', 'generate_image', 'generate_video', 'media_generate', 'video_compose', 'write_proposal', 'memory', 'upload_image',
  'skill_import_bundle', 'skill_manifest_write', 'skill_update_metadata',
  'skill_create_bundle', 'skill_resource_write', 'skill_export_bundle',
  'skill_update_from_source', 'skill_curator', 'skill_create',
  'update_schedule_memory', 'talk_to_manager', 'manage_team_goal',
  'manage_team_context_ref', 'desktop_focus_window', 'desktop_wait',
  'desktop_set_clipboard', 'desktop_launch_app', 'desktop_close_app',
  'desktop_wait_for_change', 'desktop_diff_screenshot',
  'desktop_background_prepare_sandbox', 'desktop_record_macro', 'desktop_stop_macro',
]);

const DESTRUCTIVE_TOOLS = new Set([
  'delete', 'delete_file', 'delete_lines', 'restore_snapshot', 'revert_last_tool_change',
  'revert_own_patch', 'process_kill', 'stop_process', 'self_update',
  'skill_resource_delete', 'deploy_analysis_team', 'schedule_job', 'gateway_restart',
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
  'desktop_click', 'desktop_drag', 'desktop_scroll', 'desktop_type', 'desktop_type_raw',
  'desktop_press_key', 'desktop_window_control', 'desktop_accessibility_action',
  'desktop_replay_macro', 'desktop_click_text', 'desktop_window_click',
  'desktop_window_type', 'desktop_window_press_key', 'desktop_window_scroll',
  'desktop_window_drag', 'desktop_screen', 'desktop_apps', 'desktop_window',
  'desktop_input', 'desktop_macro', 'desktop_background',
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

const CONNECTOR_READ_OPERATION_TOKENS = new Set([
  'list', 'get', 'read', 'search', 'query', 'status', 'check', 'fetch', 'retrieve',
  'find', 'describe', 'inspect', 'show', 'preview', 'report', 'realtime', 'profile',
  'history', 'comments', 'labels', 'balance', 'properties', 'domains', 'prepare',
]);

const CONNECTOR_WRITE_OPERATION_TOKENS = new Set([
  'create', 'update', 'delete', 'remove', 'send', 'post', 'publish', 'submit', 'merge',
  'redeploy', 'deploy', 'write', 'writeback', 'sync', 'connect', 'disconnect', 'follow',
  'unfollow', 'block', 'unblock', 'mute', 'unmute', 'like', 'unlike', 'repost', 'unrepost',
  'pin', 'unpin', 'add', 'set', 'archive', 'move', 'rename', 'approve', 'reject', 'cancel',
  'env',
]);

/**
 * Classify connector tools from their declared/runtime identity and the
 * operation vocabulary in their name. This is deliberately provider-neutral:
 * a newly installed connector can participate without being added to a
 * Prometheus-owned allowlist. Ambiguous names remain fail-closed.
 */
export function inferConnectorToolCapabilities(
  toolName: string,
  args?: Record<string, any>,
): ToolCapabilityMetadata | undefined {
  const name = String(toolName || '').trim().toLowerCase();
  if (!name) return undefined;
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
  const isApiRequest = name.endsWith('_api_request') || (tokens.includes('api') && tokens.includes('request'));
  if (isApiRequest) {
    const method = String(args?.method || '').trim().toUpperCase();
    if (method === 'GET' || method === 'HEAD') return CREDENTIAL_READ_ONLY;
    if (method) return EXTERNAL_WRITE;
    // A connector-specific read-only API wrapper must declare that boundary
    // explicitly; a generic request without a method is not safe to assume.
    return undefined;
  }

  if (tokens.some((token) => CONNECTOR_WRITE_OPERATION_TOKENS.has(token))) return EXTERNAL_WRITE;
  if (tokens.some((token) => CONNECTOR_READ_OPERATION_TOKENS.has(token))) return CREDENTIAL_READ_ONLY;
  return undefined;
}

function resolveRegisteredConnectorToolCapabilities(
  toolName: string,
  args?: Record<string, any>,
): ToolCapabilityMetadata | undefined {
  try {
    // Lazy imports avoid a module cycle: the runtime registry itself imports
    // this policy module for connection-tool risk classification.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ensurePrometheusExtensionRuntimeLoaded } = require('../extensions/legacy-connector-adapter.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getExtensionRuntimeRegistry } = require('../extensions/runtime-registry.js');
    ensurePrometheusExtensionRuntimeLoaded();
    const registry = getExtensionRuntimeRegistry();
    const tool = registry.getTool(toolName);
    if (!tool) return undefined;
    if (tool.sideEffects) return { ...tool.sideEffects, known: tool.sideEffects.known !== false };
    const extension = registry.getExtension(tool.extensionId);
    const connectorBacked = Boolean(String(tool.connectorId || '').trim())
      || extension?.manifest?.kind === 'connector'
      || (extension?.contracts?.connectors || []).length > 0;
    if (!connectorBacked) return undefined;
    return inferConnectorToolCapabilities(toolName, args);
  } catch {
    return undefined;
  }
}

export function resolveToolCapabilityMetadata(
  toolName: string,
  declared?: ToolCapabilityMetadata,
  args?: Record<string, any>,
): ToolCapabilityMetadata {
  if (declared) return { ...declared, known: declared.known !== false };
  const name = String(toolName || '').trim();
  if (name === 'memory') {
    return String(args?.action || '').trim().toLowerCase() === 'write' ? LOCAL_WRITE : READ_ONLY;
  }
  if (name === 'x_api_request') {
    const method = String(args?.method || '').trim().toUpperCase();
    if (method === 'GET' || method === 'HEAD') return CREDENTIAL_READ_ONLY;
    return EXTERNAL_WRITE;
  }
  if (READ_ONLY_TOOLS.has(name)) return READ_ONLY;
  if (LOCAL_WRITE_TOOLS.has(name)) return LOCAL_WRITE;
  if (DESTRUCTIVE_TOOLS.has(name)) return DESTRUCTIVE;
  if (COMMAND_TOOLS.has(name)) return COMMAND;
  if (EXTERNAL_WRITE_TOOLS.has(name)) return EXTERNAL_WRITE;
  const registeredConnectorCapabilities = resolveRegisteredConnectorToolCapabilities(name, args);
  if (registeredConnectorCapabilities) return registeredConnectorCapabilities;
  // Only apply name-only connector inference to the explicit connector namespace.
  // Registered connector tools with provider-specific/custom names are handled
  // above from runtime ownership metadata. Unrelated future tools must not be
  // downgraded to read-only merely because their names contain "list" or "status".
  if (/^connector(?:_|$)/i.test(name)) {
    const inferredConnectorCapabilities = inferConnectorToolCapabilities(name, args);
    if (inferredConnectorCapabilities) return inferredConnectorCapabilities;
  }
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
