/**
 * GC-confirmed memory-pressure recycling.
 *
 * High RSS alone is not proof of a leak: under heavy allocation churn V8 lets
 * old-space grow toward its ~4 GB limit before a major GC, so a gateway with a
 * ~1 GB live set can sit above the 4 GB recycle threshold for minutes. Before
 * recycling (which interrupts every running turn and agent) we force one full
 * GC and only recycle if the heap is still genuinely large.
 */
import v8 from 'node:v8';
import vm from 'node:vm';

export const MEMORY_RECOVERY_GC_THROTTLE_MS = 5 * 60_000;
/** Skip the recycle when the post-GC heap is below this share of the threshold. */
export const MEMORY_RECOVERY_POST_GC_RATIO = 0.5;

export type MemoryRecoveryDecision = 'recycle' | 'skip_after_gc';

export function decideMemoryRecoveryAfterGc(input: {
  gcRan: boolean;
  postGcHeapUsedBytes?: number;
  thresholdBytes: number;
  ratio?: number;
}): MemoryRecoveryDecision {
  if (!input.gcRan || typeof input.postGcHeapUsedBytes !== 'number' || !Number.isFinite(input.postGcHeapUsedBytes)) return 'recycle';
  if (!(input.thresholdBytes > 0)) return 'recycle';
  const ratio = input.ratio ?? MEMORY_RECOVERY_POST_GC_RATIO;
  return input.postGcHeapUsedBytes < input.thresholdBytes * ratio ? 'skip_after_gc' : 'recycle';
}

export function canAttemptRecoveryGc(lastAttemptAt: number, now: number, throttleMs = MEMORY_RECOVERY_GC_THROTTLE_MS): boolean {
  return lastAttemptAt <= 0 || now - lastAttemptAt >= throttleMs;
}

let cachedGc: (() => void) | null | undefined;

/** Returns a full-GC function, enabling it at runtime when --expose-gc was not passed. */
export function getFullGc(): (() => void) | null {
  if (cachedGc !== undefined) return cachedGc;
  const existing = (globalThis as any).gc;
  if (typeof existing === 'function') return (cachedGc = existing);
  try {
    v8.setFlagsFromString('--expose-gc');
    const fn = vm.runInNewContext('gc');
    cachedGc = typeof fn === 'function' ? fn : null;
  } catch {
    cachedGc = null;
  }
  return cachedGc ?? null;
}

/** Forces one full GC and returns the post-GC heap usage (or gcRan:false). */
export function runRecoveryGc(): { gcRan: boolean; postGcHeapUsedBytes?: number; postGcRssBytes?: number; gcMs?: number } {
  const gc = getFullGc();
  if (!gc) return { gcRan: false };
  const started = Date.now();
  try {
    gc();
  } catch {
    return { gcRan: false };
  }
  const memory = process.memoryUsage();
  return { gcRan: true, postGcHeapUsedBytes: memory.heapUsed, postGcRssBytes: memory.rss, gcMs: Date.now() - started };
}
