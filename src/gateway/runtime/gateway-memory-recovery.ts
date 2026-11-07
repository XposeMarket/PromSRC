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

/**
 * Inside the GC throttle window after a GC-confirmed skip, keep skipping. A
 * pre-GC heapUsed reading cannot disprove a GC that just showed the heap was
 * garbage: heap-ratio samples always sit above the post-GC skip line, so the
 * old "re-validate from current heapUsed" rule recycled healthy gateways
 * minutes after a GC cleared them. A real leak recycles at the next GC once
 * the throttle expires; emergencies are confirmed by the caller with a forced
 * GC instead.
 */
export function shouldKeepSkippingWithinGcWindow(input: {
  now: number;
  lastGcAt: number;
  lastSkipAt: number;
  throttleMs?: number;
}): boolean {
  if (input.lastSkipAt <= 0 || input.lastSkipAt !== input.lastGcAt) return false;
  return !canAttemptRecoveryGc(input.lastGcAt, input.now, input.throttleMs);
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

function readRatioEnv(name: string, fallback: number, allowZero: boolean): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n < 1 && (allowZero ? n >= 0 : n > 0) ? n : fallback;
}

/**
 * Routine recycle once heapUsed reaches this share of the REAL V8 heap limit.
 * The old trigger was RSS >= 4 GiB, which on a default 4144 MB heap is the OOM
 * point itself, so the watchdog never acted before V8 aborted (exit 134).
 * 0 disables the heap signal (RSS signal remains).
 */
export const MEMORY_RECOVERY_HEAP_RATIO = readRatioEnv('PROMETHEUS_GATEWAY_MEMORY_RESTART_HEAP_RATIO', 0.7, true);
/** Emergency recycle (does not wait for active work) at this share of the heap limit. */
export const MEMORY_EMERGENCY_HEAP_RATIO = readRatioEnv('PROMETHEUS_GATEWAY_MEMORY_EMERGENCY_HEAP_RATIO', 0.85, false);

/** One watchdog sample: under pressure when RSS crosses its threshold OR heap crosses its ratio. */
export function isMemoryPressureSample(input: {
  rssBytes: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
  rssThresholdBytes: number;
  heapRatio?: number;
}): boolean {
  if (input.rssThresholdBytes > 0 && input.rssBytes >= input.rssThresholdBytes) return true;
  const ratio = input.heapRatio ?? MEMORY_RECOVERY_HEAP_RATIO;
  return ratio > 0 && input.heapLimitBytes > 0 && input.heapUsedBytes >= input.heapLimitBytes * ratio;
}

/**
 * Line a post-GC heap must stay above to justify a recycle (skip below half of
 * it). The RSS threshold on default heaps; on large heaps (PROMETHEUS heap
 * scaling) it follows the routine heap-ratio line so a healthy multi-GB live
 * set is not recycled.
 */
export function gcConfirmThresholdBytes(rssThresholdBytes: number, heapLimitBytes: number, heapRatio = MEMORY_RECOVERY_HEAP_RATIO): number {
  const heapLine = heapRatio > 0 && heapLimitBytes > 0 ? heapLimitBytes * heapRatio : 0;
  return Math.max(rssThresholdBytes > 0 ? rssThresholdBytes : 0, heapLine);
}

export type ActiveWorkMemoryDecision = 'defer_active_work' | 'restart_idle' | 'restart_emergency';

/** Routine maintenance must not kill unrelated work. True exhaustion still wins. */
export function decideActiveWorkMemoryRecovery(input: {
  activeWork: boolean;
  rssBytes: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
  freeMemoryBytes: number;
  thresholdBytes: number;
}): ActiveWorkMemoryDecision {
  const valid = [input.rssBytes, input.heapUsedBytes, input.heapLimitBytes, input.freeMemoryBytes, input.thresholdBytes]
    .every((n) => Number.isFinite(n) && n >= 0);
  const emergency = !valid || input.heapLimitBytes <= 0 || input.thresholdBytes <= 0
    || input.heapUsedBytes >= input.heapLimitBytes * MEMORY_EMERGENCY_HEAP_RATIO
    || input.rssBytes >= input.thresholdBytes * 1.5
    || input.freeMemoryBytes < 256 * 1024 * 1024;
  if (emergency) return 'restart_emergency';
  return input.activeWork ? 'defer_active_work' : 'restart_idle';
}

/** Recheck after loading lifecycle code: work may start while that await yields. */
export async function runMemoryRecoveryRestart(
  readDecision: () => ActiveWorkMemoryDecision,
  loadRestart: () => Promise<(policy: 'prefer' | 'never') => Promise<void>>,
): Promise<ActiveWorkMemoryDecision> {
  if (readDecision() === 'defer_active_work') return 'defer_active_work';
  const restart = await loadRestart();
  const decision = readDecision();
  if (decision !== 'defer_active_work') await restart(decision === 'restart_emergency' ? 'never' : 'prefer');
  return decision;
}
