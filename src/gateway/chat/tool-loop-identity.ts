import { createHash } from 'crypto';

function normalizeToolArgs(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeToolArgs(entry, seen));
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeToolArgs((value as Record<string, unknown>)[key], seen);
    }
    seen.delete(value);
    return normalized;
  }
  return value;
}

export function serializeCanonicalToolArgs(args: unknown): string {
  try {
    const serialized = JSON.stringify(normalizeToolArgs(args ?? {}, new WeakSet<object>()));
    return serialized === undefined ? String(args ?? '') : serialized;
  } catch {
    return String(args ?? '');
  }
}

export function digestCanonicalToolArgs(args: unknown): string {
  return createHash('sha256').update(serializeCanonicalToolArgs(args), 'utf8').digest('hex');
}

// Polling a long-running process or background agent legitimately repeats the
// exact same call (same runId, same wait). Those calls are self-rate-limited by
// their wait and must not trip the identical-call loop gate. They get their own
// counter that only advances when the poll result is unchanged.
const POLL_TOOL_NAMES = new Set([
  'process_wait', 'process_status', 'process_log',
  'background_wait', 'background_status', 'background_progress',
]);
const POLL_WRAPPER_ACTIONS = new Set(['wait', 'status', 'log', 'progress']);

export const POLL_LOOP_WARNING_THRESHOLD = 12;
export const POLL_LOOP_CRITICAL_THRESHOLD = 20;

export function isPollingToolCall(toolName: string, args: unknown): boolean {
  const name = String(toolName || '').trim();
  if (POLL_TOOL_NAMES.has(name)) return true;
  if (name !== 'workspace_run' && name !== 'background_ops') return false;
  const a = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  const action = String(a.action ?? a.operation ?? a.mode ?? '').trim().toLowerCase();
  if (!POLL_WRAPPER_ACTIONS.has(action)) return false;
  if (name === 'workspace_run') return !!String(a.runId ?? a.run_id ?? a.id ?? '').trim();
  return true;
}

/** Digest of a poll result with numbers removed, so "running after 30s" and
 * "running after 60s" with no new output count as the same (stale) result. */
export function digestPollResult(resultText: unknown): string {
  const normalized = String(resultText ?? '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function previewCanonicalToolArgs(args: unknown, maxChars = 200): string {
  return serializeCanonicalToolArgs(args).slice(0, Math.max(0, maxChars));
}
