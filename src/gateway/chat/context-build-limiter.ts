type Waiter = {
  sessionId: string;
  queuedAt: number;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const configuredConcurrency = Number(process.env.PROMETHEUS_CONTEXT_BUILD_CONCURRENCY || 2);
const maxConcurrency = Number.isFinite(configuredConcurrency)
  ? Math.max(1, Math.min(8, Math.floor(configuredConcurrency)))
  : 2;
const waiters: Waiter[] = [];
let active = 0;
let admitted = 0;
let cancelled = 0;

function releasePermit(): void {
  active = Math.max(0, active - 1);
  setImmediate(admitNext);
}

function admitNext(): void {
  while (active < maxConcurrency && waiters.length) {
    const waiter = waiters.shift()!;
    if (waiter.signal?.aborted) {
      waiter.onAbort?.();
      cancelled += 1;
      waiter.reject(new Error('Context build cancelled while waiting for gateway capacity.'));
      continue;
    }
    waiter.onAbort?.();
    active += 1;
    admitted += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      releasePermit();
    });
  }
}

function acquireContextBuildPermit(sessionId: string, signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('Context build cancelled before gateway admission.'));
  }
  if (active < maxConcurrency) {
    active += 1;
    admitted += 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      releasePermit();
    });
  }
  return new Promise<() => void>((resolve, reject) => {
    const waiter: Waiter = {
      sessionId: String(sessionId || '').trim() || 'unknown',
      queuedAt: Date.now(),
      resolve,
      reject,
      signal,
    };
    if (signal) {
      const abort = () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        cancelled += 1;
        reject(new Error('Context build cancelled while waiting for gateway capacity.'));
      };
      signal.addEventListener('abort', abort, { once: true });
      waiter.onAbort = () => signal.removeEventListener('abort', abort);
    }
    waiters.push(waiter);
  });
}

export async function runWithContextBuildPermit<T>(
  sessionId: string,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const release = await acquireContextBuildPermit(sessionId, signal);
  try {
    return await run();
  } finally {
    release();
  }
}

export function getContextBuildLimiterStatus(): {
  active: number;
  queued: number;
  maxConcurrency: number;
  oldestQueuedAt?: number;
  admitted: number;
  cancelled: number;
} {
  return {
    active,
    queued: waiters.length,
    maxConcurrency,
    oldestQueuedAt: waiters[0]?.queuedAt,
    admitted,
    cancelled,
  };
}
