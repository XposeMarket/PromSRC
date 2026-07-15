import path from 'path';
import type { ToolEffectReplayPolicy } from './types.js';

const SAFE_RETRY_NAMES = new Set([
  'read_file', 'read_source', 'read_files_batch', 'list_files', 'list_directory',
  'read_dev_sources', 'read_webui_source', 'read_prom_file',
  'list_source', 'list_webui_source', 'list_prom',
  'search_files', 'search_source', 'memory_search', 'memory_get', 'memory_graph',
  'web_search', 'web_fetch', 'weather_lookup', 'market_lookup', 'stock_lookup',
  'task_status', 'task_list', 'agent_list', 'agent_inspect', 'team_list',
  'browser_snapshot', 'browser_get_state', 'desktop_screenshot', 'desktop_screen',
  'read_process_output', 'get_symbols', 'find_references', 'inspect_console',
  'get_agent_result', 'get_agent_models', 'list_agent_model_templates', 'get_team_logs',
  'get_composite', 'list_composites', 'get_creative_mode',
  'list_entities', 'read_entity', 'get_workflow_status', 'search_workflow_templates',
]);

const NEVER_REPLAY_NAMES = new Set([
  'complete_goal',
  'block_goal',
  'declare_plan',
  'bg_plan_declare',
  'bg_plan_advance',
  'complete_plan_step',
  'step_complete',
  'start_task',
  'subagent_spawn',
]);

const NEVER_REPLAY_PATTERN = /(?:send|post|publish|email|message|purchase|payment|checkout|submit|click|type|press|delete|remove|close|restart|shutdown|apply_dev|deploy|merge|push|create_account|oauth|approve)/i;
const WRITE_PATTERN = /(?:write|edit|patch|replace|append|create|delete|remove|move|rename|copy|mkdir|command|shell|terminal|git|install|build|format)/i;

const PATH_VALUE_KEYS = new Set([
  'path', 'file', 'filename', 'filepath', 'file_path',
  'old_path', 'new_path',
  'target', 'target_path',
  'source', 'source_path',
  'destination', 'destination_path', 'dest', 'dest_path',
  'input_path', 'input_file', 'output_path', 'output_file',
  'directory', 'dir', 'cwd', 'root', 'repo_path',
]);

const PATH_ARRAY_KEYS = new Set([
  'paths', 'files', 'filenames', 'targets', 'sources', 'destinations',
  'directories', 'input_paths', 'output_paths',
]);

const MAX_PATH_CANDIDATES = 128;
const MAX_PATH_TRAVERSAL_DEPTH = 12;
const MAX_PATH_TRAVERSAL_VALUES = 4_096;
const MAX_CONTAINER_ITEMS = 512;
const MAX_PATH_VALUE_CHARS = 4_096;

/**
 * Shared-workspace file/repository serialization is intentionally opt-in.
 * Prometheus historically allowed independent sessions to work in the same
 * workspace concurrently, and enabling these leases by default would be a
 * visible scheduling/workflow change. Singleton device/lifecycle resources
 * remain fenced regardless of this switch.
 */
export function fileResourceLeasesEnabled(): boolean {
  return process.env.PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES === '1';
}

export function classifyToolReplayPolicy(toolNameInput: string): ToolEffectReplayPolicy {
  const toolName = String(toolNameInput || '').trim().toLowerCase();
  if (NEVER_REPLAY_NAMES.has(toolName)) return 'never_replay';
  // Replay safety is a capability property, not a naming convention. Unknown
  // plugin, composite, or future tools must prove safety before being retried.
  if (SAFE_RETRY_NAMES.has(toolName)) return 'safe_retry';
  if (NEVER_REPLAY_PATTERN.test(toolName)) return 'never_replay';
  return 'verify_before_retry';
}

function normalizedId(value: unknown): string {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 240);
}

function normalizedArgumentKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function collectPathCandidates(args: unknown): { candidates: string[]; truncated: boolean } {
  const candidates = new Set<string>();
  const visited = new WeakSet<object>();
  let visitedValues = 0;
  let truncated = false;

  const addCandidate = (value: unknown): void => {
    if (candidates.size >= MAX_PATH_CANDIDATES || typeof value !== 'string') return;
    // A path-shaped field is not permission to scan/trim an arbitrary payload.
    // Real filesystem paths are tiny compared with tool bodies and media.
    if (value.length > MAX_PATH_VALUE_CHARS) {
      truncated = true;
      return;
    }
    const candidate = value.trim();
    if (candidate && !candidate.includes('\0')) candidates.add(candidate);
  };

  const visit = (value: unknown, depth: number): void => {
    visitedValues += 1;
    if (visitedValues > MAX_PATH_TRAVERSAL_VALUES || depth > MAX_PATH_TRAVERSAL_DEPTH) {
      truncated = true;
      return;
    }
    if (candidates.size >= MAX_PATH_CANDIDATES) return;
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, MAX_CONTAINER_ITEMS);
      if (value.length > limit) truncated = true;
      for (let index = 0; index < limit && visitedValues <= MAX_PATH_TRAVERSAL_VALUES; index += 1) {
        visit(value[index], depth + 1);
      }
      return;
    }

    let scanned = 0;
    for (const rawKey in value as Record<string, unknown>) {
      if (scanned >= MAX_CONTAINER_ITEMS || visitedValues > MAX_PATH_TRAVERSAL_VALUES) {
        truncated = true;
        break;
      }
      scanned += 1;
      const nested = (value as Record<string, unknown>)[rawKey];
      if (candidates.size >= MAX_PATH_CANDIDATES) break;
      const key = normalizedArgumentKey(rawKey);
      if (PATH_VALUE_KEYS.has(key)) {
        if (Array.isArray(nested)) {
          const limit = Math.min(nested.length, MAX_CONTAINER_ITEMS);
          if (nested.length > limit) truncated = true;
          for (let index = 0; index < limit; index += 1) addCandidate(nested[index]);
        } else {
          addCandidate(nested);
        }
      } else if (PATH_ARRAY_KEYS.has(key) && Array.isArray(nested)) {
        const limit = Math.min(nested.length, MAX_CONTAINER_ITEMS);
        if (nested.length > limit) truncated = true;
        for (let index = 0; index < limit; index += 1) addCandidate(nested[index]);
      }
      // Patchsets and wrapper tools commonly nest path-bearing records under
      // edits[], operations[], or another envelope. Traverse every container
      // while only accepting values from the explicit path-key allowlist.
      visit(nested, depth + 1);
    }
  };

  visit(args, 0);
  return { candidates: [...candidates], truncated };
}

function normalizeFileResource(candidate: string, workspacePath: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return null;
  const workspaceRoot = path.resolve(workspacePath || process.cwd());
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(workspaceRoot, candidate);
  return `file:${absolute.replace(/\\/g, '/').toLowerCase()}`;
}

/** Shared singleton resources stay gateway-owned and are fenced by these keys. */
export function inferToolResourceKeys(
  toolNameInput: string,
  args: any,
  workspacePath: string,
  sessionId: string,
): string[] {
  const toolName = String(toolNameInput || '').trim().toLowerCase();
  const keys = new Set<string>();

  if (toolName.startsWith('desktop_')) {
    if (!/(?:screenshot|screen|status|list|inspect|wait_for_change|diff)/.test(toolName)) keys.add('desktop:global-input');
  }
  if (toolName.startsWith('browser_')) keys.add(`browser:${normalizedId(sessionId) || 'default'}`);
  if (/(?:schedule|cron|automation)/.test(toolName)) keys.add('scheduler:store');
  if (/(?:gateway_restart|prom_apply_dev_changes|lifecycle)/.test(toolName)) keys.add('gateway:lifecycle');
  if (/(?:apply_dev|self_edit|self_repair)/.test(toolName)) keys.add('dev-apply:global');

  // Task/team orchestration stays in the gateway service, whose existing
  // manager locks are re-entrant across parent/child turns. Do not hold a
  // durable task/team lease while a tool synchronously awaits a child turn;
  // that would invert the dependency and deadlock a bounded worker pool.

  if (fileResourceLeasesEnabled() && WRITE_PATTERN.test(toolName) && !SAFE_RETRY_NAMES.has(toolName)) {
    const pathInference = collectPathCandidates(args);
    for (const candidate of pathInference.candidates) {
      const resource = normalizeFileResource(candidate, workspacePath);
      if (resource) keys.add(resource);
    }
    if (pathInference.truncated || /(?:shell|command|terminal|git|install|build)/.test(toolName)) {
      keys.add(`repo:${path.resolve(workspacePath || process.cwd()).replace(/\\/g, '/').toLowerCase()}`);
    }
  }

  return [...keys].sort();
}
