/**
 * Small, provider-neutral execution helper for independent tool calls.
 *
 * Providers may return several tool calls in one assistant message, but the
 * runtime still owns the safety decision and the concurrency bound.  This
 * Reads and web lookups can overlap. Explicitly marked shell probes/process
 * starts may overlap when they declare distinct resources; browser/desktop
 * actions, connector writes, approvals, and unknown tools stay serial.
 */

export interface ParallelToolCall {
  id?: string;
  name: string;
  args?: unknown;
}
export interface ParallelToolExecution<T> {
  call: ParallelToolCall;
  index: number;
  result?: T;
  error?: unknown;
}

export interface ParallelToolExecutionOptions {
  maxConcurrency?: number;
  signal?: AbortSignal;
}

/**
 * Tools whose current contracts are read-only and safe to overlap.
 *
 * Keep this list explicit for the first rollout.  Capability metadata is
 * useful for policy, but read-only alone is not enough to prove that a tool
 * has no shared session/browser/connector state.
 */
export const PARALLEL_SAFE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read',
  'read_file',
  'read_files_batch',
  'list',
  'list_files',
  'list_directory',
  'stat',
  'file_stats',
  'path_exists',
  'grep_file',
  'grep_files',
  'search_files',
  'file_tree',
  'validate_file',
  'validate_file_syntax',
  'show_diff',
  'preview_patch',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'code_outline',
  'get_symbols',
  'go_to_definition',
  'find_references',
  'read_source',
  'read_dev_sources',
  'list_source',
  'grep_source',
  'source_stats',
  'src_stats',
  'read_webui_source',
  'list_webui_source',
  'grep_webui_source',
  'webui_source_stats',
  'webui_stats',
  'time_now',
  'web_search',
  'web_search_single',
  'web_search_multi',
  'web_fetch',
  'web_fetch_batch',
  'shopping_search_products',
  // Read-only lookups that 7-day telemetry showed serializing whole batches.
  'skill_list',
  'skill_read',
  'tool_search',
  'tool_describe',
  'tool_result_read',
  'workspace_code_nav',
  'analyze_image',
  'x_search',
  'connector_google_drive',
]);

// Wrappers that are read-only only for some actions.
const READ_ONLY_ACTIONS_BY_TOOL: Record<string, ReadonlySet<string>> = {
  memory: new Set(['read', 'search', 'recall', 'ideas']),
  connector_github: new Set(['get_file', 'get_pr', 'list_check_runs', 'list_commits', 'list_issues', 'list_prs', 'list_repos', 'search']),
  connector_gmail: new Set(['get_email', 'get_profile', 'get_thread', 'list_emails', 'list_labels']),
  background_ops: new Set(['status', 'progress']),
  x_search_ops: new Set(['x_search', 'search_recent', 'search_all', 'search_spaces', 'get_trends', 'get_space']),
  vercel_ops: new Set(['status', 'list_teams', 'list_projects', 'get_project', 'list_deployments', 'get_deployment', 'deployment_events', 'list_aliases', 'get_project_domain']),
};

function normalizeConcurrency(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(2, Math.min(8, Math.floor(parsed)));
}

export function getParallelToolCallLimit(value?: unknown): number {
  if (value !== undefined) return normalizeConcurrency(value);
  return normalizeConcurrency(process.env.PROMETHEUS_MAX_PARALLEL_TOOL_CALLS || 4);
}

function toolArgs(call: ParallelToolCall): Record<string, unknown> {
  if (call.args && typeof call.args === 'object' && !Array.isArray(call.args)) return call.args as Record<string, unknown>;
  if (typeof call.args === 'string') {
    try {
      const parsed = JSON.parse(call.args);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* malformed tool args cannot be admitted in parallel */ }
  }
  return {};
}

/** Default yield for a workspace_run run before it returns "[still running]". */
export const DEFAULT_RUN_YIELD_MS = 30_000;

function shellOperation(call: ParallelToolCall): { kind: 'run' | 'start' | 'wait' | 'other'; resource: string; readOnly?: boolean } | null {
  const name = String(call?.name || '').trim();
  if (name !== 'workspace_run' && name !== 'terminal') return null;
  const args = toolArgs(call);
  const action = String(args.action || (args.mode === 'background' ? 'start' : 'run')).toLowerCase();
  if (action === 'wait') {
    const runId = String(args.runId || args.process_id || '').trim();
    return { kind: 'wait', resource: runId };
  }
  if (action !== 'run' && action !== 'start') return { kind: 'other', resource: '' };
  const command = String(args.command || '').trim();
  const flagged = args.elevated === true || args.pty === true || args.stdin === true || args.visible === true;
  if (action === 'run' && !flagged && command && isReadOnlyShellCommand(command, String(args.shell || 'auto'))) {
    // Unique per call: identical read-only probes must not collide on resource.
    // Stable per call when the provider gave an id; counter only as a fallback.
    const callId = String(call?.id || '').trim();
    if (!callId) readOnlyShellRunSequence += 1;
    return { kind: 'run', resource: callId ? `readonly:id:${callId}` : `readonly:n:${readOnlyShellRunSequence}`, readOnly: true };
  }
  const resource = String(args.parallel_key || '').trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
  if (args.parallel_safe !== true || !resource || !String(args.command || '').trim()
    || args.elevated === true || args.pty === true || args.stdin === true || args.visible === true) {
    return { kind: 'other', resource: '' };
  }
  return { kind: action, resource };
}

export function isParallelSafeToolCall(call: ParallelToolCall): boolean {
  const operation = shellOperation(call);
  if (operation) return operation.kind !== 'other' && Boolean(operation.resource);
  const name = String(call?.name || '').trim();
  const args = toolArgs(call);
  if (name === 'workspace_read') {
    return new Set(['read', 'batch_read', 'list', 'list_files', 'tree', 'exists', 'stats', 'grep', 'search', 'validate', 'validate_syntax', 'syntax']).has(String(args.action || '').toLowerCase());
  }
  if (name === 'workspace_git') {
    return new Set(['status', 'diff', 'log', 'branch']).has(String(args.action || '').toLowerCase());
  }
  const readOnlyActions = READ_ONLY_ACTIONS_BY_TOOL[name];
  if (readOnlyActions) {
    const action = String(args.action || '').toLowerCase();
    // connector_* api_request is read-only only for GET/HEAD.
    if (action === 'api_request' && name.startsWith('connector_')) {
      return ['', 'GET', 'HEAD'].includes(String(args.method || '').toUpperCase());
    }
    return readOnlyActions.has(action);
  }
  return PARALLEL_SAFE_TOOL_NAMES.has(name);
}

// Read-only shell classifier. Allowlist only: any doubt means "not read-only".
const READ_ONLY_SHELL_READERS: ReadonlySet<string> = new Set([
  'cd', 'set-location', 'sl', 'pushd', 'pwd', 'get-location',
  'rg', 'grep', 'findstr', 'select-string', 'sls',
  'ls', 'dir', 'get-childitem', 'gci',
  'cat', 'type', 'get-content', 'gc', 'head', 'tail', 'wc',
  'get-item', 'gi', 'test-path', 'resolve-path', 'get-command', 'where', 'where.exe', 'which',
  'echo', 'write-output',
  'node', 'npm', 'git',
]);

const READ_ONLY_SHELL_FILTERS: ReadonlySet<string> = new Set([
  'select-object', 'select', 'sort-object', 'sort', 'measure-object', 'measure',
  'format-table', 'ft', 'format-list', 'fl', 'out-string', 'where-object', '?', 'where',
  'select-string', 'sls', 'findstr', 'grep', 'head', 'tail', 'wc', 'convertto-json',
]);

const READ_ONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'grep',
  'describe', 'merge-base', 'cat-file',
]);

const READ_ONLY_GIT_BRANCH_FLAGS: ReadonlySet<string> = new Set([
  '-a', '-r', '-v', '-vv', '--list', '--show-current', '--contains', '--merged',
]);

// Only these stderr-redirect tokens are allowed; every other '>' is rejected.
const ALLOWED_STDERR_REDIRECT_TOKEN = /(^|\s)2>(\$null|&1|\/dev\/null)(?=[\s;|]|$)/g;

// Monotonic counter so two identical-cwd read-only probes never share a resource key.
let readOnlyShellRunSequence = 0;

/** True when a quoted span holds a pipe, semicolon or redirect, or quotes are unbalanced. */
function quotesUnsafeOrUnbalanced(command: string): boolean {
  let quote = '';
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = '';
      else if (ch === '|' || ch === ';' || ch === '>') return true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    }
  }
  return quote !== '';
}

function gitCommandIsReadOnly(words: string[]): boolean {
  let rest = words.slice(1);
  if (rest[0] === '-C') {
    if (rest.length < 2) return false;
    rest = rest.slice(2);
  }
  const sub = (rest[0] || '').toLowerCase();
  const args = rest.slice(1);
  if (sub === '--version') return rest.length === 1;
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(sub)) {
    if (sub === 'remote') return args.length === 0 || (args.length === 1 && args[0] === '-v');
    if (sub === 'branch') return args.every((arg) => READ_ONLY_GIT_BRANCH_FLAGS.has(arg));
    if (sub === 'worktree' || sub === 'stash') return args.length === 1 && args[0] === 'list';
    if (sub === 'config') return args.length >= 1 && (args[0] === '--get' || args[0] === '--list');
    return false;
  }
  // Git accepts unambiguous long-option prefixes (--outp == --output), so match the prefix.
  if (args.some((arg) => /^--ou/.test(arg))) return false;
  // git grep -O / --open-files-in-pager launches an arbitrary program.
  if (sub === 'grep' && args.some((arg) => /^-[A-Za-z]*O/.test(arg) || /^--op/.test(arg))) return false;
  // cat-file --batch* reads stdin until EOF; not a bounded probe.
  if (sub === 'cat-file' && args.some((arg) => /^--batch/.test(arg))) return false;
  return true;
}

function rgArgsAreReadOnly(words: string[]): boolean {
  return !words.slice(1).some((word) =>
    word.startsWith('--pre') || word.startsWith('--replace') || word === '-r'
    // --hostname-bin runs a program; -z/--search-zip spawn decompressors.
    || word.startsWith('--hostname-bin') || word.startsWith('--search-zip')
    || (word.startsWith('-') && !word.startsWith('--') && /[rz]/.test(word)));
}

function stageIsReadOnly(stage: string, first: boolean): boolean {
  const words = stage.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const head = words[0].toLowerCase();
  // Follow/wait modes never exit (tail -f, Get-Content -Wait), so they are not probes.
  if (['tail', 'get-content', 'gc', 'cat', 'type'].includes(head)
    && words.slice(1).some((word) => /^(-f|--follow.*|-wa(i(t)?)?(:.*)?)$/i.test(word)
      // tail accepts combined short flags (-qf, -nf, -F).
      || (head === 'tail' && /^-[a-z]*f/i.test(word)))) return false;
  if (!first) {
    if (!READ_ONLY_SHELL_FILTERS.has(head)) return false;
    // GNU sort can write a file (-o / --output); anything output-like is not read-only.
    return !words.slice(1).some((word) => /^-o/.test(word) || word.startsWith('--output'));
  }
  if (head === 'rg') return rgArgsAreReadOnly(words);
  if (head === 'git') return gitCommandIsReadOnly(words);
  if (head === 'node' || head === 'npm') return words.length === 2 && words[1] === '--version';
  return READ_ONLY_SHELL_READERS.has(head);
}

/**
 * Conservative allowlist check for a shell command. Returns true only when every
 * `;`/`&&`/`||` segment is a read-only pipeline of allowed readers and filters.
 */
export function isReadOnlyShellCommand(command: string, shell: string = 'auto'): boolean {
  const shellName = String(shell || 'auto').toLowerCase();
  // Only PowerShell prints a bare quoted string; bash/cmd execute it as a program.
  const literalsArePrinted = shellName === 'powershell' || shellName === 'pwsh'
    || (shellName === 'auto' && process.platform === 'win32');
  if (typeof command !== 'string') return false;
  const text = command.trim();
  if (!text || /[\r\n]/.test(text)) return false;
  if (/[`<(){}@]/.test(text) || text.includes('$(')) return false;
  if (/\b(invoke-expression|iex|start-process|function|for|foreach|while)\b/i.test(text)) return false;
  if (/-exec\b/i.test(text)) return false;
  if (quotesUnsafeOrUnbalanced(text)) return false;
  const stripped = text.replace(ALLOWED_STDERR_REDIRECT_TOKEN, '$1');
  if (stripped.includes('>')) return false;
  if (stripped.replace(/&&/g, '').includes('&')) return false;
  if (/\$[A-Za-z_][\w:]*\s*=(?!=)/.test(stripped)) return false;
  for (const segment of stripped.split(/;|&&|\|\|/)) {
    const stages = segment.split('|');
    if (stages.some((stage) => !stage.trim())) return false;
    // A lone quoted literal is a section header (PowerShell prints it). Anything after the
    // closing quote (e.g. 'rm' -rf x) would execute under bash/cmd, so it must not match.
    // Header text must start with -, =, # or * and hold no path separators, so it can
    // never name a program ('---SELF' yes; "calc.exe" / './x' no).
    if (stages.length === 1 && literalsArePrinted && /^(['"])[-=#*][^'"\/\\]*\1$/.test(stages[0].trim())) continue;
    if (!stageIsReadOnly(stages[0], true)) return false;
    for (const stage of stages.slice(1)) {
      if (!stageIsReadOnly(stage, false)) return false;
    }
  }
  return true;
}

function callFingerprint(call: ParallelToolCall): string {
  let args = '';
  try {
    args = JSON.stringify(call?.args ?? null);
  } catch {
    args = String(call?.args ?? '');
  }
  return `${String(call?.name || '').trim()}\n${args}`;
}

/**
 * Returns true only for a whole independent batch.  Callers that receive a
 * mixed batch should keep the original order and partition it around serial
 * calls rather than running only a convenient subset ahead of a mutation.
 */
export function canExecuteToolCallsInParallel(calls: readonly ParallelToolCall[]): boolean {
  if (calls.length < 2) return false;
  const seen = new Set<string>();
  const shellResources = new Set<string>();
  let hasStartOrRun = false;
  let hasWait = false;
  let hasOtherTool = false;
  let hasReadOnlyRun = false;
  for (const call of calls) {
    if (!isParallelSafeToolCall(call)) return false;
    const fingerprint = callFingerprint(call);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    const operation = shellOperation(call);
    if (operation) {
      if (shellResources.has(operation.resource)) return false;
      shellResources.add(operation.resource);
      if (operation.kind === 'wait') hasWait = true;
      else if (operation.readOnly) hasReadOnlyRun = true;
      else hasStartOrRun = true;
    } else hasOtherTool = true;
  }
  // A non-read-only shell run/start (even when keyed) may mutate what an unkeyed
  // read-only probe inspects (e.g. git index.lock), so it never shares a batch with one.
  // A wait in the same batch as a new start is likely dependent, even when
  // the model supplied a runId. A shell run/start may also mutate data that a
  // separate read would inspect, so admit shell batches only with other shells.
  return !(hasStartOrRun && (hasWait || hasOtherTool || hasReadOnlyRun));
}

/**
 * Split a model batch into ordered groups. A safe group can be run with the
 * bounded executor; a serial group contains one call or an unsafe run.
 */
export function partitionToolCallsForParallelExecution(
  calls: readonly ParallelToolCall[],
): Array<{ parallel: boolean; calls: ParallelToolCall[] }> {
  const groups: Array<{ parallel: boolean; calls: ParallelToolCall[] }> = [];
  let safeGroup: ParallelToolCall[] = [];
  const flushSafeGroup = () => {
    if (!safeGroup.length) return;
    groups.push({
      parallel: canExecuteToolCallsInParallel(safeGroup),
      calls: safeGroup,
    });
    safeGroup = [];
  };

  for (const call of calls) {
    if (isParallelSafeToolCall(call)) {
      safeGroup.push(call);
      continue;
    }
    flushSafeGroup();
    groups.push({ parallel: false, calls: [call] });
  }
  flushSafeGroup();
  return groups;
}

/**
 * Execute a selected batch with bounded concurrency and input-order results.
 * Each worker catches its own failure so one failed read does not cancel the
 * other independent reads or force the caller back to serial execution.
 */
export async function executeToolCallsInParallel<T>(
  calls: readonly ParallelToolCall[],
  execute: (call: ParallelToolCall, index: number) => Promise<T>,
  options: ParallelToolExecutionOptions = {},
): Promise<Array<ParallelToolExecution<T>>> {
  if (!calls.length) return [];

  const results: Array<ParallelToolExecution<T> | undefined> = new Array(calls.length);
  const limit = Math.min(getParallelToolCallLimit(options.maxConcurrency), calls.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= calls.length) return;
      const call = calls[index];
      if (options.signal?.aborted) {
        results[index] = { call, index, error: options.signal.reason || new Error('Tool batch aborted') };
        continue;
      }
      try {
        results[index] = { call, index, result: await execute(call, index) };
      } catch (error) {
        results[index] = { call, index, error };
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results.filter((entry): entry is ParallelToolExecution<T> => Boolean(entry));
}
