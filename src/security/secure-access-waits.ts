// Blocking waits for secure_access cards (2026-11-12): like ask_prometheus_questions, the
// model's turn pauses until the owner resolves the sign-in/credential card, cancels it,
// it expires, a steer arrives, or the turn is aborted.
type SteerListener = (message: string) => void;
const steerListeners = new Map<string, Set<SteerListener>>();
const blockingIds = new Set<string>();

export function markSecureAccessBlocking(id: string): void { blockingIds.add(id); }
export function isSecureAccessBlocking(id: string): boolean { return blockingIds.has(id); }

/** Called by the chat steer route so a waiting secure_access call returns to address the steer. */
export function notifySecureAccessSteer(sessionId: string, message: string): void {
  for (const listener of [...(steerListeners.get(sessionId) || [])]) {
    try { listener(message); } catch { /* best effort */ }
  }
}

export type SecureAccessWaitResult<T> =
  | { kind: 'resolved'; value: T }
  | { kind: 'steer'; message: string }
  | { kind: 'aborted' }
  | { kind: 'timeout' };

/**
 * Poll `check` until it returns a value. Polling (not events) keeps this independent of
 * which HTTP route resolved the card (desktop, phone, settings page).
 */
export function waitForSecureAccess<T>(opts: {
  id: string; sessionId: string; timeoutMs: number; intervalMs?: number;
  check: () => T | undefined | Promise<T | undefined>;
  abortSignal?: { aborted?: boolean; signal?: AbortSignal };
}): Promise<SecureAccessWaitResult<T>> {
  markSecureAccessBlocking(opts.id);
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + Math.max(5_000, opts.timeoutMs);
    const listeners = steerListeners.get(opts.sessionId) || new Set<SteerListener>();
    steerListeners.set(opts.sessionId, listeners);
    const finish = (result: SecureAccessWaitResult<T>) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      listeners.delete(onSteer);
      if (!listeners.size) steerListeners.delete(opts.sessionId);
      opts.abortSignal?.signal?.removeEventListener?.('abort', onAbort);
      // A card resolved after the wait ended (steer/abort/timeout) must continue the chat itself.
      if (result.kind !== 'resolved') blockingIds.delete(opts.id);
      resolve(result);
    };
    const onSteer: SteerListener = (message) => finish({ kind: 'steer', message });
    const onAbort = () => finish({ kind: 'aborted' });
    listeners.add(onSteer);
    opts.abortSignal?.signal?.addEventListener?.('abort', onAbort, { once: true });
    const tick = async () => {
      if (done) return;
      if (opts.abortSignal?.aborted || opts.abortSignal?.signal?.aborted) { finish({ kind: 'aborted' }); return; }
      try {
        const value = await opts.check();
        if (value !== undefined) { finish({ kind: 'resolved', value }); return; }
      } catch { /* transient read failure: keep waiting until the deadline */ }
      if (Date.now() >= deadline) { finish({ kind: 'timeout' }); return; }
      timer = setTimeout(tick, opts.intervalMs ?? 1000);
    };
    void tick();
  });
}
