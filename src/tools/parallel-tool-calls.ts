/**
 * Small, provider-neutral execution helper for independent read-only tool calls.
 *
 * Providers may return several tool calls in one assistant message, but the
 * runtime still owns the safety decision and the concurrency bound.  This
 * module deliberately starts with a conservative allowlist: reads and web
 * lookups can overlap; mutations, browser/desktop actions, shell commands,
 * connector writes, and unknown tools stay serial at the caller.
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
  'time_now',
  'web_search',
  'web_search_single',
  'web_search_multi',
  'web_fetch',
  'web_fetch_batch',
  'shopping_search_products',
  'source_stats',
  'webui_source_stats',
]);

function normalizeConcurrency(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(2, Math.min(8, Math.floor(parsed)));
}

export function getParallelToolCallLimit(value?: unknown): number {
  if (value !== undefined) return normalizeConcurrency(value);
  return normalizeConcurrency(process.env.PROMETHEUS_MAX_PARALLEL_TOOL_CALLS || 4);
}

export function isParallelSafeToolCall(call: ParallelToolCall): boolean {
  return PARALLEL_SAFE_TOOL_NAMES.has(String(call?.name || '').trim());
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
  for (const call of calls) {
    if (!isParallelSafeToolCall(call)) return false;
    const fingerprint = callFingerprint(call);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
  }
  return true;
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
