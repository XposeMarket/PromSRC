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
  'memory', 'memory_read', 'memory_read_record', 'memory_search',
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
  // Conversation control: these only talk to the user in this chat, track the
  // visible plan, or load tool schemas. Any real action they lead to (a tool
  // loaded by request_tool_category, a tool reached through tool_call) is
  // gated on its own name when it runs.
  'ask_prometheus_questions', 'await_prometheus_question_response',
  'declare_plan', 'complete_plan_step', 'step_complete', 'bg_plan_declare', 'bg_plan_advance',
  'request_tool_category', 'tool_search', 'tool_describe', 'tool_result_read',
  'switch_model', 'request_browser_login',
  // Native UI cards rendered in the chat. Some builders enrich with an image
  // download or a configured search key; card builders already run before the
  // generic gate, so this classification only keeps the audit trail honest.
  'show_ui_card', 'show_sources', 'show_product_carousel', 'show_agent_work',
  'show_market', 'show_stocks', 'show_weather', 'show_comparison', 'show_chart',
  'show_run_result', 'show_prediction_market', 'show_map',
  // Reading progress/results of work that was already approved to start.
  'background_wait', 'background_progress', 'background_status', 'get_agent_result',
  'get_agent_models', 'schedule_job_history',
  'schedule_job_detail', 'schedule_job_log_search',
  'list_entities', 'read_entity', 'list_composites', 'brain_activity_read',
  'brain_context_search', 'memory_review_claims',
  // Prometheus source reads (siblings of read_source/list_source above).
  'read_webui_source', 'grep_source', 'grep_webui_source', 'list_webui_source',
  'read_dev_sources', 'read_prom_file', 'grep_prom', 'list_prom', 'source_stats_batch',
  'validate_source', 'validate_webui_source', 'scan_secrets', 'scan_large_files',
  'operation_plan', 'tool_benchmark_summary',
  // Browser reads and UI state (tab focus, scroll position). Clicking, typing
  // and running page scripts stay in EXTERNAL_WRITE_TOOLS below. browser_open,
  // browser_new_tab, browser_scroll_collect* and inspect_console are
  // argument-aware in resolveToolCapabilityMetadata.
  'browser_select_tab', 'browser_list_tabs', 'browser_scroll', 'browser_wait', 'browser_doctor',
  // Shows the user an approval card and waits. The action it is asking about
  // is still gated on its own name and needs the approval id it returns.
  'request_final_action_approval',
  // Reads that were falling through to the unknown tier (2026-11 tool audit).
  // creative_list_html_motion_templates is not here: it creates the session's creative folder.
  'get_composite', 'run_accessibility_check', 'get_creative_mode', 'creative_model_status',
  'creative_list_motion_templates', 'creative_measure_text',
]);

const LOCAL_WRITE_TOOLS = new Set([
  'write', 'write_file', 'create_file', 'edit', 'replace_lines', 'insert_after',
  'find_replace', 'rename', 'rename_file', 'copy', 'copy_file', 'copy_directory',
  'move_file', 'move_directory', 'mkdir', 'append', 'apply_patch',
  'apply_workspace_patchset', 'write_note', 'memory_write', 'persona_update', 'schedule_memory',
  'snapshot_workspace', 'format_changed_files', 'clone_repo', 'download_url',
  'download_media', 'video_social_cut', 'generate_image', 'generate_video', 'media_generate', 'chatgpt_sandbox', 'video_compose', 'write_proposal', 'memory', 'upload_image',
  'skill_import_bundle', 'skill_manifest_write', 'skill_update_metadata',
  'skill_create_bundle', 'skill_resource_write', 'skill_export_bundle',
  'skill_update_from_source', 'skill_curator', 'skill_create',
  'update_schedule_memory', 'talk_to_manager', 'manage_team_goal',
  'manage_team_context_ref', 'desktop_focus_window', 'desktop_wait',
  'desktop_set_clipboard', 'desktop_launch_app', 'desktop_close_app',
  'desktop_wait_for_change', 'desktop_diff_screenshot',
  'desktop_background_prepare_sandbox', 'desktop_record_macro', 'desktop_stop_macro',
  'trigger_ops',
  // Local state changes: still approval-gated on Default permissions, but
  // with an honest "changes something on this computer" label instead of the
  // unknown-tool fallback.
  'append_file', 'git_commit', 'timer', 'business_context_mode', 'update_heartbeat',
  'set_current_model', 'background_spawn', 'background_follow_up', 'background_steer', 'spawn_subagent',
  'browser_close', 'browser_close_tab',
  // Local Prometheus state that was falling through to the unknown tier
  // (2026-11 tool audit). Still approval-gated on Default permissions.
  'dispatch_team_agent', 'message_main_agent', 'browser_set_profile_target',
  'memory_accept_claim', 'memory_reject_claim', 'memory_supersede_record', 'memory_consolidate',
  'write_entity', 'append_entity_event', 'set_agent_model',
  'edit_proposal', 'create_composite', 'edit_composite', 'skill_candidate_submit',
  'schedule_job_stuck_control',
]);

const DESTRUCTIVE_TOOLS = new Set([
  'delete', 'delete_file', 'delete_lines', 'restore_snapshot', 'revert_last_tool_change',
  'revert_own_patch', 'process_kill', 'stop_process', 'self_update',
  'skill_resource_delete', 'deploy_analysis_team', 'schedule_job', 'gateway_restart',
  'delete_agent_model_template', 'delete_composite',
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
  'desktop_input', 'desktop_background',
  // Can reach Telegram/Discord/other channels or act inside logged-in pages.
  'delivery_send', 'browser_run_js', 'browser_type', 'browser_drag',
  'browser_vision_click', 'browser_vision_type',
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

interface ActionToolCapabilities {
  /** The ONE argument the handler reads its action from. Default: action. */
  key?: string;
  /** Action used when none is given, only where the tool documents one. */
  defaultAction?: string;
  read?: readonly string[];
  write?: readonly string[];
  destructive?: readonly string[];
}

/**
 * Multi-action Prometheus control tools, classified per action.
 *
 * These were unclassified, so listing tasks or reading another chat sat in the
 * same fail-closed tier as deleting one (3% of real calls in the 2026-11 tool
 * audit, 90% of them reads). Only the listed read actions are read-only.
 * Listed write actions keep an approval on Default permissions, with an honest
 * label. A missing or unlisted action still fails closed, so a new action is
 * gated until someone classifies it here. task_control resolve_approval is
 * left out on purpose: resolving an approval is never a quiet action.
 *
 * Rules this table must keep (each was a review finding):
 * - `key` is the argument the HANDLER reads, never an alias the wrapper accepts.
 * - An action that is supplied but is not a plain string fails closed. Handlers
 *   do String(args.action), so ["apply"] would run as apply.
 * - "read" means the handler persists nothing. A list or wait that refreshes
 *   stored state (internal_watch list, thread supervision_wait) is a write.
 */
const ACTION_TOOL_CAPABILITIES: Readonly<Record<string, ActionToolCapabilities>> = Object.freeze({
  prometheus_thread_ops: {
    read: ['list', 'find', 'search', 'read', 'status', 'supervisions', 'list_projects'],
    // supervision_wait leases the pending review and updates its counters.
    write: ['supervision_wait', 'create', 'create_and_ping', 'create_and_forget', 'create_and_supervise', 'create_many', 'send', 'steer',
      'interrupt', 'rename', 'pin', 'unpin', 'reopen', 'open', 'unsettle', 'follow', 'unfollow', 'review_decision',
      'revise_supervision', 'pause_supervision', 'resume_supervision', 'create_project', 'move_to_project', 'remove_from_project'],
  },
  task_control: {
    read: ['list', 'latest', 'get', 'list_approvals'],
    write: ['steer', 'message', 'resume', 'rerun', 'continue', 'pause'],
    destructive: ['cancel', 'delete'],
  },
  agent_run_ops: {
    read: ['list', 'get'],
    write: ['steer', 'recover', 'resume', 'rerun', 'pause', 'benchmark_disposable'],
    destructive: ['cancel'],
  },
  // list refreshes and persists each active watch's observation, so it is not a read.
  internal_watch: { write: ['list', 'create', 'cancel'] },
  schedule_job_patch: { defaultAction: 'preview', read: ['preview'], destructive: ['apply'] },
  prometheus_request_ops: { read: ['list', 'find', 'read', 'status', 'recovery_candidates'], write: ['recover'] },
  prometheus_audit_ops: {
    read: ['recent_sessions', 'search', 'session_timeline', 'recovery_candidates', 'recovery_brief', 'read_artifact',
      'skill_routing_evidence', 'skill_routing_stats', 'context_receipts', 'context_receipt_settings'],
    write: ['context_receipt_review', 'context_receipt_configure'],
  },
  team_manage: { read: ['list'] },
  team_escalation: { key: 'escalation_action', read: ['list'], write: ['dismiss', 'escalate_to_user', 'answered'] },
  browser_intercept_network: { read: ['read'], write: ['start', 'stop', 'clear'] },
  connection_ops: { read: ['discover', 'status', 'list', 'list_connections'], destructive: ['disconnect'] },
  mcp_server_manage: { read: ['list', 'status', 'list_tools', 'oauth_status'] },
  secure_access: { read: ['status', 'list'] },
  webhook_manage: { read: ['get'] },
  integration_quick_setup: { read: ['list_presets'] },
});

function resolveActionToolCapabilities(name: string, args?: Record<string, any>): ToolCapabilityMetadata | undefined {
  if (!Object.prototype.hasOwnProperty.call(ACTION_TOOL_CAPABILITIES, name)) return undefined;
  const spec = ACTION_TOOL_CAPABILITIES[name];
  const supplied = args?.[spec.key || 'action'];
  let action: string;
  if (supplied === undefined || supplied === null || supplied === '') {
    action = spec.defaultAction || '';
  } else if (typeof supplied === 'string') {
    action = supplied.trim().toLowerCase();
  } else {
    return undefined; // supplied but not a string: the handler would stringify it
  }
  if (!action) return undefined;
  if (spec.read?.includes(action)) return READ_ONLY;
  if (spec.destructive?.includes(action)) return DESTRUCTIVE;
  if (spec.write?.includes(action)) return LOCAL_WRITE;
  return undefined;
}

const CONNECTOR_READ_OPERATION_TOKENS = new Set([
  'list', 'get', 'read', 'search', 'query', 'status', 'check', 'fetch', 'retrieve',
  'find', 'describe', 'inspect', 'show', 'preview', 'report', 'realtime', 'profile',
  'history', 'comments', 'labels', 'balance', 'properties', 'domains', 'prepare', 'events', 'logs',
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
    const { ensurePrometheusExtensionRuntimeLoaded } = require('../extensions/extension-bootstrap.js');
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
  // Raw provider API escape hatches: read-only only for an explicit safe
  // method; a missing or mutating method fails toward the write gate.
  // connector_gdrive_api_request is a GET-only read tool with its own declaration.
  if (name === 'x_api_request' || (/^connector_[a-z0-9]+_api_request$/.test(name) && name !== 'connector_gdrive_api_request')) {
    const method = String(args?.method || '').trim().toUpperCase();
    if (method === 'GET' || method === 'HEAD') return CREDENTIAL_READ_ONLY;
    return EXTERNAL_WRITE;
  }
  // Generative video projects: reads are local; set_key stores a credential;
  // generate/generate_anchor spend money with an external provider.
  if (name === 'video_project') {
    const action = String(args?.action || '').trim().toLowerCase();
    if (['help', 'list', 'get', 'models', 'providers', 'estimate', 'jobs', 'wait', 'frame', 'templates', 'music_beds', 'run_cost', 'cast_list', 'brand_list', 'presets'].includes(action)) return READ_ONLY;
    // Money-spending actions still enforce the project cost gate (auto-approve limit + cap) server-side.
    if (['generate', 'generate_anchor', 'set_key', 'storyboard', 'voiceover', 'qa', 'hooks', 'upgrade', 'run', 'quickstart', 'recast', 'lipsync', 'talking_photo', 'draw_to_video', 'upscale', 'foley', 'faceless', 'batch_variants'].includes(action)) return EXTERNAL_WRITE;
    if (action === 'delete' || action === 'cast_delete' || action === 'brand_delete') return DESTRUCTIVE;
    return LOCAL_WRITE;
  }
  // Games mode: reads are local; generate_assets/reroll_asset spend money (server cost gate still applies).
  if (name === 'game_project') {
    const action = String(args?.action || '').trim().toLowerCase();
    if (['help', 'list', 'get', 'questions', 'estimate', 'play_url'].includes(action)) return READ_ONLY;
    if (action === 'generate_assets' || action === 'reroll_asset') return EXTERNAL_WRITE;
    if (action === 'delete') return DESTRUCTIVE;
    return LOCAL_WRITE;
  }
  // Saved model-provider accounts: list reads config; remove deletes an
  // account and its credentials, so it is destructive (approval-gated).
  if (name === 'provider_accounts') {
    const action = String(args?.action || '').trim().toLowerCase();
    if (action === 'list') return READ_ONLY;
    if (action === 'remove') return args?.dry_run === true ? READ_ONLY : DESTRUCTIVE;
    return LOCAL_WRITE;
  }
  // Authenticated-user lookup: reads the credential's own profile only.
  if (name === 'x_api_me') return CREDENTIAL_READ_ONLY;
  // Plugin import: reads are local scans; install/uninstall write skills, MCP
  // config and plugin files; approving hooks enables shell execution.
  if (name === 'plugin_ops') {
    const action = String(args?.action || '').trim().toLowerCase();
    if (['scan', 'inspect', 'list', 'marketplace', 'catalog'].includes(action)) return READ_ONLY;
    // Turning on imported hooks or MCP servers runs third-party code: always an approval card.
    if (action === 'approve_hooks' || action === 'activate_mcp') return COMMAND;
    if (action === 'uninstall') return DESTRUCTIVE;
    return LOCAL_WRITE;
  }
  // Navigation is a read only for plain web URLs. javascript:, data:, file: and
  // custom schemes can run page code or reach local resources: gate them like
  // browser_run_js. A bare host (no scheme) is opened as https.
  if (name === 'browser_open' || name === 'browser_new_tab') {
    const url = String(args?.url ?? '').trim();
    if (!url && name === 'browser_new_tab') return READ_ONLY;
    if (!url) return UNKNOWN_FAIL_CLOSED;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
    return !scheme || scheme === 'http' || scheme === 'https' ? READ_ONLY : EXTERNAL_WRITE;
  }
  // Extraction is a read; saving a named extraction schema writes site knowledge.
  if (name === 'browser_scroll_collect' || name === 'browser_scroll_collect_v2') {
    // Any non-empty save alias at any depth counts: the handler coerces values
    // with String(...), so numbers/booleans/objects would still save.
    const SAVE_KEYS = new Set(['save_as', 'remember_as', 'saveas', 'rememberas']);
    const hasSave = (value: any, depth = 0): boolean => {
      if (!value || typeof value !== 'object' || depth > 6) return false;
      for (const [key, inner] of Object.entries(value)) {
        if (SAVE_KEYS.has(key.toLowerCase()) && inner !== undefined && inner !== null && String(inner).trim() !== '') return true;
        if (hasSave(inner, depth + 1)) return true;
      }
      return false;
    };
    let wantsSave = true;
    try { wantsSave = hasSave(args); } catch { wantsSave = true; }
    return wantsSave ? LOCAL_WRITE : READ_ONLY;
  }
  // Reading console logs is a read; clearing them mutates diagnostics.
  if (name === 'inspect_console') {
    // Mirrors browser/diagnostics.ts: only 'clear' mutates; every other action reads.
    return String(args?.action || 'read').trim().toLowerCase() === 'clear' ? LOCAL_WRITE : READ_ONLY;
  }
  // Schedule outputs: get/check read; set changes the job contract.
  if (name === 'schedule_job_outputs') {
    const action = String(args?.action || 'get').trim().toLowerCase();
    return action === 'get' || action === 'check' || action === 'list' ? READ_ONLY : LOCAL_WRITE;
  }
  const actionCapabilities = resolveActionToolCapabilities(name, args);
  if (actionCapabilities) return actionCapabilities;
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
