// A gateway with a ~1 GB live set but 4 GB of uncollected garbage must not be
// recycled (which interrupts every running turn); a genuinely full heap must.
import assert from 'node:assert/strict';
import {
  canAttemptRecoveryGc,
  decideMemoryRecoveryAfterGc,
  getFullGc,
  MEMORY_RECOVERY_GC_THROTTLE_MS,
  runRecoveryGc,
  shouldKeepSkippingWithinGcWindow,
  gcConfirmThresholdBytes,
} from './gateway-memory-recovery';

const GB = 1024 ** 3;
const threshold = 4 * GB;

assert.equal(decideMemoryRecoveryAfterGc({ gcRan: true, postGcHeapUsedBytes: 1.2 * GB, thresholdBytes: threshold }), 'skip_after_gc', 'garbage-only RSS is not recycled');
assert.equal(decideMemoryRecoveryAfterGc({ gcRan: true, postGcHeapUsedBytes: 3.6 * GB, thresholdBytes: threshold }), 'recycle', 'a genuinely full heap is recycled');
assert.equal(decideMemoryRecoveryAfterGc({ gcRan: true, postGcHeapUsedBytes: 2 * GB, thresholdBytes: threshold }), 'recycle', 'exactly 50% is not below the skip ratio');
assert.equal(decideMemoryRecoveryAfterGc({ gcRan: false, thresholdBytes: threshold }), 'recycle', 'no GC available keeps the old behavior');
assert.equal(decideMemoryRecoveryAfterGc({ gcRan: true, postGcHeapUsedBytes: Number.NaN, thresholdBytes: threshold }), 'recycle', 'unknown heap keeps the old behavior');
assert.equal(decideMemoryRecoveryAfterGc({ gcRan: true, postGcHeapUsedBytes: 1, thresholdBytes: 0 }), 'recycle', 'disabled threshold never skips');

const now = 10_000_000;
assert.equal(canAttemptRecoveryGc(0, now), true, 'first attempt allowed');
assert.equal(canAttemptRecoveryGc(now - 1000, now), false, 'throttled within 5 minutes');
assert.equal(canAttemptRecoveryGc(now - MEMORY_RECOVERY_GC_THROTTLE_MS, now), true, 'allowed again after the throttle window');

// Review F1 + 2026-11-07 heap-signal fix: skip, then a second breach inside the throttle window.
const gcAt = now - 60_000;
assert.equal(shouldKeepSkippingWithinGcWindow({ now, lastGcAt: gcAt, lastSkipAt: gcAt }), true, 'inside the window after a GC-confirmed skip, keep skipping (a pre-GC reading is not evidence)');
assert.equal(shouldKeepSkippingWithinGcWindow({ now, lastGcAt: gcAt, lastSkipAt: 0 }), false, 'no prior skip: last GC said recycle');
assert.equal(shouldKeepSkippingWithinGcWindow({ now, lastGcAt: gcAt, lastSkipAt: gcAt - 1 }), false, 'skip from an older GC does not carry over');
assert.equal(shouldKeepSkippingWithinGcWindow({ now, lastGcAt: now - MEMORY_RECOVERY_GC_THROTTLE_MS, lastSkipAt: now - MEMORY_RECOVERY_GC_THROTTLE_MS }), false, 'after the window a fresh GC decides');
assert.equal(gcConfirmThresholdBytes(threshold, 4144 * 1024 ** 2, 0.7), threshold, 'default heap: the RSS threshold is the GC-confirm line');
assert.equal(gcConfirmThresholdBytes(threshold, 8 * GB, 0.7), 8 * GB * 0.7, 'large heap: the GC-confirm line follows the real heap limit');
assert.equal(gcConfirmThresholdBytes(0, 4 * GB, 0), 0, 'both signals disabled');

// The runtime GC hook works without --expose-gc on the command line.
assert.equal(typeof getFullGc(), 'function', 'full GC can be enabled at runtime');
let garbage: unknown[] | null = Array.from({ length: 200_000 }, (_, i) => ({ i, s: `x${i}` }));
garbage = null;
void garbage;
const result = runRecoveryGc();
assert.equal(result.gcRan, true, 'recovery GC runs');
assert.ok(typeof result.postGcHeapUsedBytes === 'number' && result.postGcHeapUsedBytes > 0, 'post-GC heap is reported');

console.log('gateway memory recovery regression: ok');
