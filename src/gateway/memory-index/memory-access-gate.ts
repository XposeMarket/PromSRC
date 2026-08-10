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
let activeKind: MemoryAccessKind | null = null;
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

function grantNext(): void {
  if (activeKind || pending.length === 0) return;

  const waiter = pending.shift()!;
  clearWaiter(waiter);
  if (waiter.signal?.aborted) {
    waiter.reject(abortError());
    grantNext();
    return;
  }

  activeKind = waiter.kind;
  let released = false;
  waiter.resolve(() => {
    if (released) return;
    released = true;
    if (activeKind !== waiter.kind) return;
    activeKind = null;
    grantNext();
  });
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
  if (!activeKind && pending.length === 0) {
    activeKind = kind;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      if (activeKind !== kind) return;
      activeKind = null;
      grantNext();
    });
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
        reject(new Error(`Memory access timed out after ${Math.floor(timeoutMs)}ms while queued.`));
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
