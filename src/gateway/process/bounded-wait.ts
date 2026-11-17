export const DEFAULT_PROCESS_WAIT_MS = 10_000;
export const MAX_PROCESS_WAIT_MS = 300_000;
export function processWaitBudget(raw: unknown): number {
  const value = Number(raw ?? DEFAULT_PROCESS_WAIT_MS);
  return Number.isFinite(value) ? Math.max(1_000, Math.min(MAX_PROCESS_WAIT_MS, value)) : DEFAULT_PROCESS_WAIT_MS;
}

export type WaitCancellation = { aborted: boolean; signal?: AbortSignal };
export type BoundedWaitResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'deadline' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' };
export interface WaitClock {
  now(): number;
  every(callback: () => void, ms: number): unknown;
  after(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const systemClock: WaitClock = {
  now: Date.now,
  every: (fn, ms) => setInterval(fn, ms),
  after: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => { clearTimeout(handle as NodeJS.Timeout); clearInterval(handle as NodeJS.Timeout); },
};

/** Observation only: cancellation must never terminate the observed process. */
export async function boundedProcessWait<T>(options: {
  timeoutMs?: unknown;
  cancellation?: WaitCancellation;
  subscribe: (complete: (value: T | null) => void, fail: (error: unknown) => void) => () => void;
  onProgress?: (elapsedMs: number, budgetMs: number) => void;
}, clock: WaitClock = systemClock): Promise<BoundedWaitResult<T>> {
  const budget = processWaitBudget(options.timeoutMs);
  const started = clock.now();
  const deadline = started + budget;
  const token = options.cancellation;
  const cancelled = () => token?.aborted || token?.signal?.aborted;
  if (cancelled()) return { kind: 'cancelled' };
  let settled = false;
  let unsubscribe: (() => void) | undefined;
  const handles: unknown[] = [];
  let onAbort = () => {};
  try {
    return await new Promise<BoundedWaitResult<T>>((resolve, reject) => {
      const finish = (result: BoundedWaitResult<T>) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      onAbort = () => finish({ kind: 'cancelled' });
      token?.signal?.addEventListener('abort', onAbort, { once: true });
      if (cancelled()) { onAbort(); return; }
      handles.push(clock.after(() => finish({ kind: cancelled() ? 'cancelled' : 'deadline' }), budget));
      // Some agent owners mutate the wrapper even when a native signal also exists.
      if (token) handles.push(clock.every(() => { if (cancelled()) onAbort(); }, 100));
      if (options.onProgress) handles.push(clock.every(() => {
        if (settled) return;
        if (cancelled()) { onAbort(); return; }
        if (clock.now() >= deadline) { finish({ kind: 'deadline' }); return; }
        try { options.onProgress?.(clock.now() - started, budget); } catch { /* advisory transport */ }
      }, 15_000));
      unsubscribe = options.subscribe((value) => {
        if (cancelled()) { onAbort(); return; }
        finish(value === null ? { kind: 'unavailable' } : { kind: 'completed', value });
      }, (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
  } finally {
    settled = true;
    for (const handle of handles) clock.clear(handle);
    token?.signal?.removeEventListener('abort', onAbort);
    unsubscribe?.();
  }
}
