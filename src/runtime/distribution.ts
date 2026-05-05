import fs from 'fs';
import path from 'path';

function normalizeFlag(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

const PUBLIC_BUILD_DISABLED_TOOL_NAMES = new Set([
  'read_source',
  'list_source',
  'source_stats',
  'src_stats',
  'read_webui_source',
  'list_webui_source',
  'webui_source_stats',
  'webui_stats',
	  'grep_source',
	  'grep_webui_source',
	  'list_prom',
	  'prom_file_stats',
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
  'propose_repair',
]);

const PUBLIC_BUILD_DISABLED_TOOL_CATEGORIES = new Set([
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
