import fs from 'fs';
import path from 'path';

function normalizeFlag(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

const PUBLIC_BUILD_DISABLED_TOOL_NAMES = new Set([
  'dev_source_read',
  'dev_source_edit',
  'read_source',
  'read_dev_sources',
  'list_source',
  'source_stats',
  'src_stats',
  'validate_source',
  'read_webui_source',
  'list_webui_source',
  'webui_source_stats',
  'webui_stats',
  'validate_webui_source',
	  'grep_source',
	  'grep_webui_source',
	  'list_prom',
	  'prom_file_stats',
	  'validate_prom_file',
	  'read_prom_file',
	  'grep_prom',
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
	  'gateway_restart',
  'self_update',
  'request_dev_source_edit',
  'update_dev_source_edit',
  'await_dev_source_edit_approval',
  'apply_dev_source_patchset',
  'prom_apply_dev_changes',
  'prom_repo_ops',
  'prom_repo_push',
  'prom_repo_pull',
  'prom_repo_sync',
]);

const PUBLIC_BUILD_DISABLED_TOOL_CATEGORIES = new Set([
  'source_read',
  'prometheus_source_read',
  'source_write',
  'prometheus_source_write',
]);

// Prometheus can still carry its private self-development implementation while
// presenting itself as a workspace-oriented coding assistant. Keep this list
// separate from the public-build list: runtime diagnostics/restart remain
// useful operational tools, while direct source-edit/repo-sync tools are
// hidden from the normal model-facing surface by default.
const PROMETHEUS_DEV_TOOL_NAMES = new Set([
  'dev_source_read',
  'dev_source_edit',
  'read_source',
  'read_dev_sources',
  'list_source',
  'source_stats',
  'source_stats_batch',
  'src_stats',
  'validate_source',
  'read_webui_source',
  'list_webui_source',
  'grep_webui_source',
  'webui_source_stats',
  'webui_stats',
  'validate_webui_source',
  'grep_source',
  'list_prom',
  'prom_file_stats',
  'validate_prom_file',
  'read_prom_file',
  'grep_prom',
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
  'apply_dev_source_patchset',
  'prom_apply_dev_changes',
  'request_dev_source_edit',
  'update_dev_source_edit',
  'await_dev_source_edit_approval',
  'prom_repo_ops',
  'prom_repo_push',
  'prom_repo_pull',
  'prom_repo_sync',
  'self_update',
]);

const PROMETHEUS_DEV_TOOL_CATEGORIES = new Set([
  'source_read',
  'prometheus_source_read',
  'source_write',
  'prometheus_source_write',
]);

export function isPublicDistributionBuild(): boolean {
  const envFlag = normalizeFlag(process.env.PROMETHEUS_PUBLIC_BUILD);
  if (envFlag === '1' || envFlag === 'true' || envFlag === 'yes') return true;

  try {
    // Works in both src/ and dist/ output trees.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(path.join(resolvePrometheusRoot(), 'package.json'));
    return normalizeFlag(pkg?.prometheusBuild) === 'public';
  } catch {
    return false;
  }
}

export function resolvePrometheusRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export function getPublicWebUiRoot(): string {
  return path.join(resolvePrometheusRoot(), 'generated', 'public-web-ui');
}

export function hasPublicWebUiBuild(): boolean {
  const root = getPublicWebUiRoot();
  return fs.existsSync(path.join(root, 'index.html'));
}

export function isToolHiddenInPublicBuild(name: string): boolean {
  return isPublicDistributionBuild() && PUBLIC_BUILD_DISABLED_TOOL_NAMES.has(String(name || '').trim());
}

export function isToolCategoryHiddenInPublicBuild(category: string): boolean {
  return isPublicDistributionBuild() && PUBLIC_BUILD_DISABLED_TOOL_CATEGORIES.has(String(category || '').trim());
}

export function filterPublicBuildToolDefs<T extends { function?: { name?: string } }>(toolDefs: T[]): T[] {
  if (!isPublicDistributionBuild()) return toolDefs;
  return toolDefs.filter((toolDef) => !isToolHiddenInPublicBuild(String(toolDef?.function?.name || '')));
}

export function getPublicBuildAllowedCategories<T extends string>(categories: readonly T[]): T[] {
  if (!isPublicDistributionBuild()) return [...categories];
  return categories.filter((category) => !isToolCategoryHiddenInPublicBuild(String(category)));
}

/**
 * Direct Prometheus self-development tools stay implemented for rollback and
 * maintenance, but are not model-visible unless explicitly re-enabled.
 * Set PROMETHEUS_DEV_TOOLS_VISIBLE=1 (or true/yes/on) before starting the
 * gateway to restore the old private-build surface.
 */
export function arePrometheusDevToolsVisible(): boolean {
  const envFlag = normalizeFlag(process.env.PROMETHEUS_DEV_TOOLS_VISIBLE);
  return envFlag === '1' || envFlag === 'true' || envFlag === 'yes' || envFlag === 'on';
}

export function isPrometheusDevToolHidden(name: string): boolean {
  return !arePrometheusDevToolsVisible() && PROMETHEUS_DEV_TOOL_NAMES.has(String(name || '').trim());
}

export function isPrometheusDevToolCategoryHidden(category: string): boolean {
  return !arePrometheusDevToolsVisible() && PROMETHEUS_DEV_TOOL_CATEGORIES.has(String(category || '').trim().toLowerCase());
}

export function isToolCategoryHiddenForRuntime(category: string): boolean {
  return isToolCategoryHiddenInPublicBuild(category) || isPrometheusDevToolCategoryHidden(category);
}

export function getRuntimeAllowedCategories<T extends string>(categories: readonly T[]): T[] {
  return categories.filter((category) => !isToolCategoryHiddenForRuntime(String(category)));
}
