/**
 * Gateway restart-path regression (plans/gateway-restart-interruptions, PR A).
 *
 *   npx tsx src/gateway/runtime/gateway-restart-outcome.regression.ts
 *
 * 1. A dynamic import() of lifecycle from a non-entry module (the old
 *    broadcaster pattern) sees the shutdown hooks registered on the main
 *    instance, and so does a later require().
 * 2. RestartOutcome: only handoff_aborted / spawn_failed mean "still serving".
 * 3. Stall watchdog latch: released on a still-serving outcome (with cooldown),
 *    expires after a bounded wait otherwise, never while draining.
 * 4. Heap-ratio memory signals fire before the V8 OOM point.
 * Isolated temp data dir; no gateway, ports, timers or live state.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const GB = 1024 ** 3;

function heapSignals(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const r = require('./gateway-memory-recovery') as typeof import('./gateway-memory-recovery');
  assert.equal(r.MEMORY_RECOVERY_HEAP_RATIO, 0.7);
  assert.equal(r.MEMORY_EMERGENCY_HEAP_RATIO, 0.85);
  const base = { rssBytes: 1 * GB, heapLimitBytes: 4 * GB, rssThresholdBytes: 4 * GB };
  assert.equal(r.isMemoryPressureSample({ ...base, heapUsedBytes: 0.69 * 4 * GB }), false);
  assert.equal(r.isMemoryPressureSample({ ...base, heapUsedBytes: 0.71 * 4 * GB }), true);
  assert.equal(r.isMemoryPressureSample({ ...base, heapUsedBytes: 0.71 * 4 * GB, heapRatio: 0 }), false, 'ratio 0 disables the heap signal');
  assert.equal(r.isMemoryPressureSample({ ...base, rssBytes: 4 * GB, heapUsedBytes: 0 }), true, 'RSS signal remains');
  const scaled = { heapLimitBytes: 8 * GB, rssThresholdBytes: 4 * GB, heapUsedBytes: 1 * GB };
  assert.equal(r.isMemoryPressureSample({ ...scaled, rssBytes: 4.5 * GB }), false, '8 GB heap: 4.5 GB RSS is not pressure (RSS line follows the heap line)');
  assert.equal(r.isMemoryPressureSample({ ...scaled, rssBytes: 5.7 * GB }), true, '8 GB heap: RSS above 70% of the heap limit is pressure');
  // The Nov 2026 crash shape: default 4144 MB heap, heap climbing, RSS still under 4 GiB.
  assert.equal(r.isMemoryPressureSample({ rssBytes: 3.4 * GB, heapUsedBytes: 3.0 * GB, heapLimitBytes: 4144 * 1024 ** 2, rssThresholdBytes: 4 * GB }), true);
  const d = { activeWork: true, rssBytes: 1 * GB, heapLimitBytes: 4 * GB, freeMemoryBytes: 8 * GB, thresholdBytes: 4 * GB };
  assert.equal(r.decideActiveWorkMemoryRecovery({ ...d, heapUsedBytes: 0.84 * 4 * GB }), 'defer_active_work');
  assert.equal(r.decideActiveWorkMemoryRecovery({ ...d, heapUsedBytes: 0.86 * 4 * GB }), 'restart_emergency');
  // Review R2 N1: the RSS emergency line scales with the real heap limit.
  assert.equal(r.decideActiveWorkMemoryRecovery({ ...d, heapLimitBytes: 4144 * 1024 ** 2, heapUsedBytes: 1 * GB, rssBytes: 6 * GB }), 'restart_emergency', 'default heap: 6 GB RSS is still an emergency');
  assert.equal(r.decideActiveWorkMemoryRecovery({ ...d, heapLimitBytes: 8 * GB, heapUsedBytes: 0.1 * GB, rssBytes: 6.6 * GB }), 'defer_active_work', '8 GB heap: 6.6 GB RSS of uncollected garbage (RSS lags a GC) is not an emergency');
  assert.equal(r.decideActiveWorkMemoryRecovery({ ...d, heapLimitBytes: 8 * GB, heapUsedBytes: 1 * GB, rssBytes: 8.5 * GB }), 'restart_emergency', '8 GB heap: RSS above 1.5 x 70% of the heap limit is an emergency');
  assert.equal(r.decideActiveWorkMemoryRecovery({ ...d, thresholdBytes: 0, heapUsedBytes: 0.75 * 4 * GB, rssBytes: 9 * GB }), 'defer_active_work', 'RSS threshold 0 disables only the RSS arm; it is not an emergency');
  assert.equal(r.decideActiveWorkMemoryRecovery({ ...d, thresholdBytes: 0, heapUsedBytes: 0.86 * 4 * GB }), 'restart_emergency', 'heap emergency still applies with the RSS arm disabled');
  console.log('  heap signals: OK');
}

function sourceGuard(): void {
  for (const rel of ['../comms/broadcaster.ts', '../comms/telegram-channel.ts', '../routes/settings.router.ts']) {
    const text = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    // `typeof import('../lifecycle')` is a type-only reference and is allowed.
    assert.equal(/(?<!typeof\s)import\(\s*['"][./]+lifecycle(\.js)?['"]\s*\)/.test(text), false, `${rel} must not dynamically import lifecycle`);
  }
  console.log('  no dynamic lifecycle imports in restart callers: OK');
}

function stallHarness(outcome: string | Error) {
  const source = fs.readFileSync(path.join(__dirname, '../comms/broadcaster.ts'), 'utf8');
  const start = source.indexOf('function loadLifecycle(');
  const end = source.indexOf('export function shouldScheduleGatewayMemoryRecovery(');
  assert.ok(start > 0 && end > start, 'stall watchdog section located');
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const timers: Array<() => unknown> = [];
  const events: any[] = [];
  const restarts: any[] = [];
  const exits: number[] = [];
  const box: any = {
    exports: {}, path, console: { warn() {}, error() {}, log() {} },
    process: { uptime: () => 600, pid: 1, memoryUsage: () => ({}), exit: (code: number) => { exits.push(code); } },
    require: (id: string) => {
      assert.equal(id, '../lifecycle', 'stall watchdog loads lifecycle with require()');
      return {
        gracefulRestart: async (ctx: unknown) => { restarts.push(ctx); if (outcome instanceof Error) throw outcome; return outcome; },
        restartLeftProcessServing: (o: unknown) => o === 'handoff_aborted' || o === 'spawn_failed',
      };
    },
    parseNonNegativeIntEnv: (_name: string, fallback: number) => fallback,
    setTimeout: (fn: () => unknown) => { timers.push(fn); return { unref() {} }; },
    enqueueAsyncAppend: (_file: string, line: string) => { events.push(JSON.parse(line)); },
    getConfig: () => ({ getConfigDir: () => 'unused' }),
    getRuntimeWorkerDiagnostics: () => ({}),
    EVENT_LOOP_STALL_AUTORESTART_ENABLED: true, EVENT_LOOP_STALL_RESTART_MS: 8_000, EVENT_LOOP_STALL_RESTART_MIN_UPTIME_MS: 120_000,
    _gatewayDraining: false, _eventLoopStallRestartScheduled: false, _memoryPressureRestartScheduled: false,
    _nodeRuntime: {}, _modelBusyCount: 0, _lastMainSessionId: 'test',
  };
  vm.createContext(box);
  vm.runInContext(compiled, box);
  return {
    box, events, restarts, exits,
    stall: (now = Date.now()) => box.maybeScheduleEventLoopStallRecovery(9_000, now),
    fire: async () => { const fn = timers.shift(); assert.ok(fn, 'expected a pending timer'); await fn(); },
    pending: () => timers.length,
  };
}

async function stallLatch(): Promise<void> {
  const aborted = stallHarness('handoff_aborted');
  aborted.stall();
  assert.equal(aborted.box._eventLoopStallRestartScheduled, true);
  await aborted.fire();
  assert.equal(aborted.restarts.length, 1);
  assert.equal(aborted.box._eventLoopStallRestartScheduled, false, 'aborted handoff releases the latch (memory watchdog re-armed)');
  assert.ok(aborted.events.some((e) => e.event === 'event_loop_stall_recovery_incomplete' && e.reason === 'handoff_aborted'));
  aborted.stall();
  assert.equal(aborted.pending(), 0, 'cooldown blocks an immediate restart loop');
  aborted.stall(Date.now() + 11 * 60_000);
  assert.equal(aborted.box._eventLoopStallRestartScheduled, true, 'stall recovery re-arms after the cooldown');

  const started = stallHarness('handoff_started');
  started.stall();
  await started.fire();
  assert.equal(started.box._eventLoopStallRestartScheduled, true, 'a started handoff keeps the latch');
  started.box._gatewayDraining = true;
  await started.fire();
  assert.equal(started.box._eventLoopStallRestartScheduled, true, 'a draining gateway never re-arms');

  const lingering = stallHarness('exiting');
  lingering.stall();
  await lingering.fire();
  assert.equal(lingering.box._eventLoopStallRestartScheduled, true);
  await lingering.fire();
  assert.equal(lingering.box._eventLoopStallRestartScheduled, false, 'bounded expiry when the process never left');
  assert.ok(lingering.events.some((e) => e.reason === 'timeout'));

  const deferred = stallHarness(new Error('Gateway restart deferred because 1 coordinated Prometheus dev edit(s) are active'));
  deferred.stall();
  await deferred.fire();
  assert.equal(deferred.box._eventLoopStallRestartScheduled, false);
  assert.deepEqual(deferred.exits, []);
  console.log('  stall latch: OK (aborted/started/draining/expiry/deferred/cooldown)');
}

async function lifecycleSingleton(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lifecycle = require('../lifecycle') as typeof import('../lifecycle');
  lifecycle.setShutdownHooks({ closeListenersForHandoff: async () => {}, hasListeningGateway: () => true });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const probe = require('./__fixtures__/lifecycle-instance-probe') as typeof import('./__fixtures__/lifecycle-instance-probe');
  const loaded = await probe.loadLifecycleDynamically();
  const dyn = (typeof loaded?.hasRegisteredShutdownHook === 'function' ? loaded : loaded?.default) as typeof import('../lifecycle');
  const duplicated = dyn.setShutdownHooks !== lifecycle.setShutdownHooks;
  assert.equal(dyn.hasRegisteredShutdownHook('closeListenersForHandoff'), true, 'import()ed lifecycle sees the registered hooks');
  assert.equal(dyn.hasRegisteredShutdownHook('hasListeningGateway'), true);
  assert.equal(dyn.isGatewayHandoffDraining(), lifecycle.isGatewayHandoffDraining());
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const after = require('../lifecycle') as typeof import('../lifecycle');
  assert.equal(after.hasRegisteredShutdownHook('closeListenersForHandoff'), true, 'require() after an import() still sees the hooks');
  for (const o of ['handoff_aborted', 'spawn_failed']) assert.equal(lifecycle.restartLeftProcessServing(o), true, o);
  for (const o of ['handoff_started', 'exiting', 'forwarded', undefined]) assert.equal(lifecycle.restartLeftProcessServing(o), false, String(o));
  console.log(`  lifecycle process singleton: OK (duplicate module instance observed: ${duplicated})`);
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-restart-outcome-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;
  try {
    heapSignals();
    sourceGuard();
    await stallLatch();
    await lifecycleSingleton();
    console.log('gateway restart outcome regression: PASS');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}

void main().then(() => process.exit(process.exitCode ?? 0), (error) => { console.error(error); process.exit(1); });
