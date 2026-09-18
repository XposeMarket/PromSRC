export type MemoryAccessKind = 'search' | 'maintenance';

export interface MemoryAccessOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PendingAccess {
  kind: MemoryAccessKind;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  timeoutHandle?: NodeJS.Timeout;
}

// The query and maintenance workers are separate child processes, but they
// open the same SQLite database. Keep their critical sections exclusive in
// the gateway so a writer cannot start in the middle of a read (or vice
// versa). The search and maintenance clients already serialize their own
// queues; this small broker only coordinates the two queues with each other.
//
// Policy:
//  - `search` holders are read-only (WAL readers), so any number of searches
//    may hold the gate concurrently.
//  - `maintenance` is exclusive: it waits for all searches to drain and blocks
//    new searches while it runs.
//  - Queued `search` waiters are granted before queued `maintenance` waiters,
//    so a user-facing search never sits FIFO behind a not-yet-started
//    maintenance pass (that ordering is what produced "Memory access timed
//    out after 7998ms while queued" during a background refresh).
let activeKind: MemoryAccessKind | null = null;
let activeCount = 0;
const pending: PendingAccess[] = [];

function removePending(waiter: PendingAccess): void {
  const index = pending.indexOf(waiter);
  if (index >= 0) pending.splice(index, 1);
}

function clearWaiter(waiter: PendingAccess): void {
  if (waiter.timeoutHandle) clearTimeout(waiter.timeoutHandle);
  if (waiter.signal && waiter.abortListener) {
    waiter.signal.removeEventListener('abort', waiter.abortListener);
  }
}

function makeRelease(kind: MemoryAccessKind): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeKind !== kind) return;
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount === 0) activeKind = null;
    grantNext();
  };
}

function canGrant(kind: MemoryAccessKind): boolean {
  if (!activeKind) return true;
  return kind === 'search' && activeKind === 'search';
}

function grantWaiter(waiter: PendingAccess): void {
  clearWaiter(waiter);
  if (waiter.signal?.aborted) {
    waiter.reject(abortError());
    return;
  }
  activeKind = waiter.kind;
  activeCount += 1;
  waiter.resolve(makeRelease(waiter.kind));
}

function grantNext(): void {
  // Grant every queued search that can share the current read lock first.
  for (let i = 0; i < pending.length;) {
    const waiter = pending[i];
    if (waiter.kind === 'search' && canGrant('search')) {
      pending.splice(i, 1);
      grantWaiter(waiter);
      continue;
    }
    i += 1;
  }
  // Then, if the gate is fully idle, grant the oldest maintenance waiter.
  if (activeKind) return;
  const index = pending.findIndex((w) => w.kind === 'maintenance');
  if (index < 0) return;
  const [waiter] = pending.splice(index, 1);
  grantWaiter(waiter);
  if (!activeKind) grantNext();
}

function abortError(): Error {
  const error = new Error('Memory access was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function acquireMemoryAccess(
  kind: MemoryAccessKind,
  options: MemoryAccessOptions = {},
): Promise<() => void> {
  if (options.signal?.aborted) return Promise.reject(abortError());
  // Fast path: nothing running, or a read-only search joining other searches.
  // Maintenance never takes the fast path while searches are queued so it
  // cannot starve them.
  const maintenanceQueued = pending.some((w) => w.kind === 'maintenance');
  if (canGrant(kind) && (kind === 'search' || (!maintenanceQueued && pending.length === 0))) {
    activeKind = kind;
    activeCount += 1;
    return Promise.resolve(makeRelease(kind));
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter: PendingAccess = { kind, resolve, reject, signal: options.signal };
    const onAbort = () => {
      removePending(waiter);
      clearWaiter(waiter);
      reject(abortError());
      grantNext();
    };
    waiter.abortListener = onAbort;
    if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });

    const timeoutMs = Number(options.timeoutMs);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      waiter.timeoutHandle = setTimeout(() => {
        removePending(waiter);
        clearWaiter(waiter);
        reject(new Error(
          `Memory access timed out after ${Math.floor(timeoutMs)}ms while queued behind ${activeKind || 'idle'} (${activeCount} active, ${pending.length} pending).`,
        ));
        grantNext();
      }, Math.floor(timeoutMs));
      waiter.timeoutHandle.unref?.();
    }
    pending.push(waiter);
  });
}

export function isMemorySearchInFlight(): boolean {
  return activeKind === 'search';
}

/** Test/diagnostic hook: current gate occupancy. */
export function getMemoryAccessGateState(): { activeKind: MemoryAccessKind | null; activeCount: number; pending: MemoryAccessKind[] } {
  return { activeKind, activeCount, pending: pending.map((w) => w.kind) };
}

