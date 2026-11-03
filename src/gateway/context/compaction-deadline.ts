/** Floor/ceiling for one whole compaction transaction (all batches + repair). */
export const COMPACTION_DEADLINE_FLOOR_MS = 120_000;
export const COMPACTION_DEADLINE_CEILING_MS = 600_000;

/**
 * Scale the transaction deadline with the work actually requested. A fixed
 * 120s cap failed every large-context summary (a ~230k-token prompt needs
 * minutes of prefill + decode), so each tool round retried, failed, and the
 * transcript kept growing past the window. Conservative throughput: ~3k prompt
 * tokens/s prefill, ~40 output tokens/s decode, plus fixed overhead per pass
 * (later passes re-emit a smaller merged handoff). Dead provider streams are
 * still cut by the adapters' own idle timeouts.
 */
export function compactionDeadlineMs(input: { sourceTokens: number; targetOutputTokens: number; passes?: number }): number {
  const passes = Math.max(1, Math.ceil(Number(input.passes) || 1));
  const prefillMs = Math.max(0, Number(input.sourceTokens) || 0) / 3;
  const decodeMs = (Math.max(0, Number(input.targetOutputTokens) || 0) + 3_000 * (passes - 1)) * 25;
  const ms = 45_000 * passes + prefillMs + decodeMs;
  return Math.round(Math.min(COMPACTION_DEADLINE_CEILING_MS, Math.max(COMPACTION_DEADLINE_FLOOR_MS, ms)));
}

/** Bound the entire summary transaction, including repair and batch calls. */
export async function withCompactionDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
  timeoutMs = COMPACTION_DEADLINE_FLOOR_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new Error('Context compaction cancelled; original transcript retained.'));
    };
    if (parent?.aborted) { onAbort(); return; }
    parent?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Context compaction exceeded its ${Math.max(1, Math.round(timeoutMs / 1000))}-second deadline; original transcript retained.`));
    }, timeoutMs);
  });
  try {
    // Do not start work for an already-cancelled caller. Promise.race also
    // releases the caller if a provider does not promptly honor cancellation.
    return await Promise.race([stopped, ...(controller.signal.aborted ? [] : [run(controller.signal)])]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener('abort', onAbort);
  }
}

/**
 * Failed mid-workflow attempts per session. A failed compactor is retried only
 * after the request grew meaningfully (scaled by consecutive failures) or after
 * a cooldown, so one slow/broken summary cannot cost every tool round.
 */
const MID_WORKFLOW_RETRY_COOLDOWN_MS = 5 * 60_000;
const midWorkflowCompactionBackoff = new Map<string, { projectedTokens: number; failures: number; at: number }>();

export function midWorkflowCompactionRetryAllowed(
  sessionId: string,
  projectedTokens: number,
  triggerTokens: number,
  now = Date.now(),
  contextWindowTokens = 0,
): boolean {
  const last = midWorkflowCompactionBackoff.get(sessionId);
  if (!last) return true;
  if (now - last.at >= MID_WORKFLOW_RETRY_COOLDOWN_MS) return true;
  // Near the real provider window the next request may fail outright, so retry
  // sooner there, but still at most once a minute rather than every round.
  if (contextWindowTokens > 0 && projectedTokens >= Math.floor(contextWindowTokens * 0.95) && now - last.at >= 60_000) return true;
  const growth = Math.max(8_000, Math.floor(Math.max(0, triggerTokens) * 0.05)) * Math.min(2, last.failures);
  return projectedTokens >= last.projectedTokens + growth;
}

export function recordMidWorkflowCompactionOutcome(sessionId: string, projectedTokens: number, compacted: boolean, now = Date.now()): void {
  const prior = midWorkflowCompactionBackoff.get(sessionId);
  midWorkflowCompactionBackoff.delete(sessionId);
  if (compacted) return;
  midWorkflowCompactionBackoff.set(sessionId, { projectedTokens, failures: (prior?.failures || 0) + 1, at: now });
  if (midWorkflowCompactionBackoff.size > 256) {
    const oldest = midWorkflowCompactionBackoff.keys().next().value;
    if (oldest !== undefined) midWorkflowCompactionBackoff.delete(oldest);
  }
}
