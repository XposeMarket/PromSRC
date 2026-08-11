/**
 * Runtime selection for workspace editing tools.
 *
 * This is deliberately separate from terminal permission mode. The setting
 * chooses which editing surface the model sees; it does not grant or remove
 * filesystem, command, approval, or source-access permissions.
 */

export type WorkspaceToolMode = 'prometheus' | 'terminal-first';

export const DEFAULT_WORKSPACE_TOOL_MODE: WorkspaceToolMode = 'prometheus';

/**
 * Native Prometheus file/read/edit tools. Terminal/process, Git, code-nav, and
 * safety tools are kept out of this set so terminal-first mode can remain a
 * useful fallback for file work while preserving command policy and auditing.
 */
export const PROMETHEUS_FILE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'workspace_read',
  'workspace_edit',
  'list_files',
  'read_file',
  'file_stats',
  'grep_file',
  'search_files',
  'create_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'delete_file',
  'write_file',
  'rename_file',
  'mkdir',
  'read_files_batch',
  'apply_workspace_patchset',
  'file_tree',
  'list_directory',
  'validate_file',
  'grep_files',
  'show_diff',
  'preview_patch',
  'apply_patch',
  'format_changed_files',
  'revert_last_tool_change',
  'revert_own_patch',
  'copy_file',
  'move_file',
  'copy_directory',
  'move_directory',
  'path_exists',
]);

export function normalizeWorkspaceToolMode(value: unknown): WorkspaceToolMode {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  return normalized === 'terminal-first' || normalized === 'terminal' || normalized === 'shell'
    ? 'terminal-first'
    : DEFAULT_WORKSPACE_TOOL_MODE;
}

export function getWorkspaceToolMode(configOrTools: any): WorkspaceToolMode {
  const tools = configOrTools?.tools && typeof configOrTools.tools === 'object'
    ? configOrTools.tools
    : configOrTools;
  return normalizeWorkspaceToolMode(tools?.workspace_mode ?? tools?.workspaceMode);
}

export function isTerminalFirstWorkspaceMode(configOrTools: any): boolean {
  return getWorkspaceToolMode(configOrTools) === 'terminal-first';
}

export function isPrometheusFileToolName(name: unknown): boolean {
  return PROMETHEUS_FILE_TOOL_NAMES.has(String(name || '').trim());
}

export function filterToolDefinitionsForWorkspaceMode(
  toolDefs: any[],
  modeOrConfig: WorkspaceToolMode | any = DEFAULT_WORKSPACE_TOOL_MODE,
): any[] {
  const mode = typeof modeOrConfig === 'string'
    ? normalizeWorkspaceToolMode(modeOrConfig)
    : getWorkspaceToolMode(modeOrConfig);
  if (mode !== 'terminal-first') return toolDefs;
  return toolDefs.filter((tool: any) => !isPrometheusFileToolName(tool?.function?.name));
}
