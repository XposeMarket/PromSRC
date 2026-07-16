export interface PostTurnJob {
  sessionId: string;
  label: string;
  run: () => Promise<void> | void;
}

export interface PostTurnQueueStatus {
  queued: number;
  active: boolean;
  oldestQueuedAt?: number;
  completed: number;
  failed: number;
}

type QueuedPostTurnJob = PostTurnJob & { queuedAt: number };

const queue: QueuedPostTurnJob[] = [];
const idleWaiters = new Set<() => void>();
let scheduled = false;
let active = false;
let completed = 0;
let failed = 0;

function resolveIdleWaiters(): void {
  if (active || scheduled || queue.length) return;
  for (const resolve of idleWaiters) resolve();
  idleWaiters.clear();
}

function scheduleDrain(): void {
  if (scheduled || active) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    void drainQueue();
  });
}

async function drainQueue(): Promise<void> {
  if (active) return;
  active = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        await job.run();
        completed += 1;
      } catch (error: any) {
        failed += 1;
        console.warn(
          `[post-turn] ${job.label} failed for ${job.sessionId}:`,
          String(error?.message || error),
        );
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    active = false;
    if (queue.length) scheduleDrain();
    resolveIdleWaiters();
  }
}

export function enqueuePostTurnJob(job: PostTurnJob): void {
  queue.push({
    sessionId: String(job.sessionId || '').trim() || 'unknown',
    label: String(job.label || '').trim() || 'post_turn',
    run: job.run,
    queuedAt: Date.now(),
  });
  scheduleDrain();
}

export function getPostTurnQueueStatus(): PostTurnQueueStatus {
  return {
    queued: queue.length,
    active,
    oldestQueuedAt: queue[0]?.queuedAt,
    completed,
    failed,
  };
}

export function flushPostTurnJobs(): Promise<void> {
  if (!active && !scheduled && queue.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    idleWaiters.add(resolve);
    scheduleDrain();
  });
}
