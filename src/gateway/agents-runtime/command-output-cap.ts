// Bounds command output returned to the agent. Output over the limit keeps the
// start AND the end (errors and exit summaries usually sit at the end) with one
// marker line between them, so the agent can tell that output was cut.

export const DEFAULT_COMMAND_OUTPUT_CHARS = 4000;
export const MIN_COMMAND_OUTPUT_CHARS = 1000;
export const MAX_COMMAND_OUTPUT_CHARS = 100000;

// Same 1000-100000 clamp the git diff handler uses. Missing, zero or invalid values use the default.
export function resolveCommandOutputLimit(raw: unknown): number {
  const requested = raw == null || raw === '' ? Number.NaN : Number(raw);
  const value = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_COMMAND_OUTPUT_CHARS;
  return Math.max(MIN_COMMAND_OUTPUT_CHARS, Math.min(MAX_COMMAND_OUTPUT_CHARS, value));
}

function truncationMarker(total: number, omitted: number, runId?: string | null): string {
  const next = runId
    ? `full output: workspace_run(action:"log", runId:"${runId}", maxChars:${Math.min(MAX_COMMAND_OUTPUT_CHARS, total)})`
    : 'no run id, so the rest cannot be fetched; rerun a narrower command or write its output to a file';
  return `\n...[output truncated: ${total} chars total, ${omitted} chars omitted; ${next}]\n`;
}

export function capCommandOutput(output: unknown, options: { maxChars?: unknown; runId?: string | null } = {}): string {
  const text = String(output ?? '');
  const limit = resolveCommandOutputLimit(options.maxChars);
  if (text.length <= limit) return text;
  const total = text.length;
  // Reserve room for the widest possible marker (omitted never exceeds total) so the result stays within the limit.
  const keep = limit - truncationMarker(total, total, options.runId).length;
  const head = Math.floor(keep * 0.4);
  const tail = keep - head;
  const omitted = total - keep;
  return `${text.slice(0, head)}${truncationMarker(total, omitted, options.runId)}${text.slice(total - tail)}`;
}
