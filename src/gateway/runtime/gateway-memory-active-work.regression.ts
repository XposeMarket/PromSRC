import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as recovery from './gateway-memory-recovery';
import { decideActiveWorkMemoryRecovery as decide, runMemoryRecoveryRestart } from './gateway-memory-recovery';

const GB = 1024 ** 3;
const healthy = { activeWork: true, rssBytes: 4.2 * GB, heapUsedBytes: 2.2 * GB, heapLimitBytes: 4.1 * GB, freeMemoryBytes: 8 * GB, thresholdBytes: 4 * GB };
assert.equal(decide(healthy), 'defer_active_work');
assert.equal(decide({ ...healthy, activeWork: false }), 'restart_idle');
for (const overrides of [
  { heapUsedBytes: healthy.heapLimitBytes * 0.9 },
  { rssBytes: 6 * GB },
  { freeMemoryBytes: 255 * 1024 ** 2 },
  { heapLimitBytes: 0 },
  { heapUsedBytes: NaN },
]) assert.equal(decide({ ...healthy, ...overrides }), 'restart_emergency');
assert.equal(decide({ ...healthy, heapLimitBytes: 8 * GB, heapUsedBytes: 4 * GB }), 'defer_active_work', 'uses actual heap limit, not a hardcoded machine setting');

async function main() {
  let calls = 0;
  let policy = '';
  const load = async () => async (p: 'prefer' | 'never') => { calls++; policy = p; };
  assert.equal(await runMemoryRecoveryRestart(() => decide(healthy), load), 'defer_active_work');
  assert.equal(calls, 0, 'active work never enters lifecycle');
  assert.equal(await runMemoryRecoveryRestart(() => decide({ ...healthy, activeWork: false }), load), 'restart_idle');
  assert.equal(policy, 'prefer', 'idle routine restart retains normal handoff if work is admitted later');
  assert.equal(await runMemoryRecoveryRestart(() => decide({ ...healthy, rssBytes: 6 * GB }), load), 'restart_emergency');
  assert.equal(policy, 'never', 'exhaustion releases the process instead of doubling its memory');
  let busy = false;
  const prior = calls;
  assert.equal(await runMemoryRecoveryRestart(() => decide({ ...healthy, activeWork: busy }), async () => {
    busy = true; // A chat, tool, team or background runtime is admitted during import.
    return load();
  }), 'defer_active_work');
  assert.equal(calls, prior, 'second check closes the async-import race');
  let emergency = false;
  await runMemoryRecoveryRestart(() => decide({ ...healthy, activeWork: false, rssBytes: (emergency ? 6 : 4.2) * GB }), async () => {
    emergency = true;
    return load();
  });
  assert.equal(policy, 'never', 'uses fresh emergency reading, not initial idle decision');
  await assert.rejects(runMemoryRecoveryRestart(() => 'restart_idle', async () => { throw Error('load failed'); }), /load failed/);
  const source = fs.readFileSync(path.join(__dirname, '../comms/broadcaster.ts'), 'utf8');
  assert.match(source, /activeWork: _modelBusyCount > 0 \|\| countLocalRunningRuntimes\(\) > 0/, 'guard covers non-model runtimes, not just foreground provider calls');
  assert.match(source, /runMemoryRecoveryRestart\(readMemoryRecoveryDecision/);
  assert.match(source, /memoryPressureDeferredForActiveWork:/);
  // Execute the actual watchdog functions with fake process/lifecycle dependencies.
  // No gateway imports, live state, timers or restart side effects are permitted.
  // The watchdog loads lifecycle through loadLifecycle() (require, never a
  // dynamic import). The harness supplies a fake loadLifecycle.
  assert.equal(/(?<!typeof\s)import\(\s*['"]\.\.\/lifecycle(\.js)?['"]\s*\)/.test(source), false, 'broadcaster must not dynamically import lifecycle');
  const watchdogSource = source.slice(source.indexOf('export function shouldScheduleGatewayMemoryRecovery('), source.indexOf('function writeRuntimeStatus('));
  const compiled = ts.transpileModule(watchdogSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  function harness() {
    let active = 1;
    let memory = { rss: 4.2 * GB, heapUsed: 2.2 * GB, heapTotal: 3 * GB, external: 0, arrayBuffers: 0 };
    let timer: (() => Promise<void>) | undefined;
    let restartError = '';
    let restartOutcome = 'exiting';
    let onRestart: (() => void) | undefined;
    let activateOnLoad = false;
    const restarts: string[] = [];
    const exits: number[] = [];
    const box: any = {
      ...recovery, exports: {}, console: { warn() {}, error() {} }, path,
      process: { memoryUsage: () => memory, uptime: () => 600, pid: 1, exit: (code: number) => exits.push(code) },
      getHeapStatistics: () => ({ heap_size_limit: 4.1 * GB }), freemem: () => 8 * GB,
      countLocalRunningRuntimes: () => active,
      getConfig: () => ({ getConfigDir: () => 'unused' }), enqueueAsyncAppend() {}, getRuntimeWorkerDiagnostics: () => ({}),
      setTimeout: (fn: () => Promise<void>) => { timer = fn; return { unref() {} }; },
      // loadLifecycle() is synchronous require() in production (never a dynamic import).
      runRecoveryGc: () => ({ gcRan: false }),
      loadLifecycle: () => {
        if (activateOnLoad) active = 1;
        return {
          gracefulRestart: async (ctx: any) => { if (restartError) throw Error(restartError); restarts.push(ctx.handoffPolicy); onRestart?.(); return restartOutcome; },
          restartLeftProcessServing: (o: unknown) => o === 'handoff_aborted' || o === 'spawn_failed',
        };
      },
      canAttemptRecoveryGc: () => false,
      MEMORY_RESTART_RSS_BYTES: 4 * GB, MEMORY_RESTART_CONSECUTIVE_SAMPLES: 3,
      MEMORY_AUTORESTART_ENABLED: true, MEMORY_RESTART_MIN_UPTIME_MS: 120000, MEMORY_RESTART_RETRY_COOLDOWN_MS: 300000,
      _gatewayDraining: false, _modelBusyCount: 0, _memoryPressureConsecutiveSamples: 0,
      _memoryPressureDeferredForActiveWork: false, _memoryPressureRestartScheduled: false,
      _eventLoopStallRestartScheduled: false, _lastMemoryRecoveryGcAt: 0,
      _lastMemoryRecoverySkippedAfterGcAt: 0, _memoryPressureRetryAfter: 0, _lastEmergencyConfirmGcAt: 0, EMERGENCY_CONFIRM_GC_MIN_INTERVAL_MS: 30000, _lastHeartbeatAt: 0, _nodeRuntime: {}, _lastMainSessionId: 'test',
    };
    vm.createContext(box);
    vm.runInContext(compiled, box);
    return { box, restarts, exits,
      setActive: (n: number) => { active = n; },
      setRss: (n: number) => { memory = { ...memory, rss: n }; },
      setError: (s: string) => { restartError = s; },
      setOutcome: (s: string) => { restartOutcome = s; },
      setOnRestart: (fn: () => void) => { onRestart = fn; },
      setMemory: (m: Partial<typeof memory>) => { memory = { ...memory, ...m }; },
      activateDuringLoad: () => { activateOnLoad = true; },
      tick: () => { for (let i = 0; i < 3; i++) box.maybeScheduleMemoryPressureRecovery(memory, 1000000 + i); },
      fire: async () => { const cb = timer; timer = undefined; if (cb) await cb(); },
      scheduled: () => !!timer,
    };
  }
  const busyRun = harness(); busyRun.tick();
  assert.equal(busyRun.scheduled(), false, 'real watchdog defers running background runtime with modelBusy=0');
  assert.equal(busyRun.box._memoryPressureDeferredForActiveWork, true);
  busyRun.setActive(0); busyRun.tick(); await busyRun.fire();
  assert.deepEqual(busyRun.restarts, ['prefer'], 'real watchdog restarts after work completes');
  const modelRun = harness(); modelRun.setActive(0); modelRun.box._modelBusyCount = 1; modelRun.tick();
  assert.equal(modelRun.scheduled(), false, 'foreground provider busy guard');
  const callbackRace = harness(); callbackRace.setActive(0); callbackRace.tick(); callbackRace.setActive(1); await callbackRace.fire();
  assert.deepEqual(callbackRace.restarts, []); assert.equal(callbackRace.box._memoryPressureRestartScheduled, false);
  const importRace = harness(); importRace.setActive(0); importRace.tick(); importRace.activateDuringLoad(); await importRace.fire();
  assert.deepEqual(importRace.restarts, []);
  const emergencyRun = harness(); emergencyRun.setRss(6 * GB); emergencyRun.tick(); await emergencyRun.fire();
  assert.deepEqual(emergencyRun.restarts, ['never'], 'real watchdog emergency does not wait forever');
  const emergencyGcSkip = harness(); emergencyGcSkip.setRss(6 * GB);
  emergencyGcSkip.box.shouldKeepSkippingWithinGcWindow = () => true;
  emergencyGcSkip.tick(); await emergencyGcSkip.fire();
  assert.deepEqual(emergencyGcSkip.restarts, ['never'], 'old GC skip cannot hide emergency RSS');
  const postGcEmergency = harness(); postGcEmergency.setRss(6 * GB);
  postGcEmergency.box.canAttemptRecoveryGc = () => true;
  postGcEmergency.box.runRecoveryGc = () => ({ gcRan: true, postGcHeapUsedBytes: GB });
  postGcEmergency.tick(); await postGcEmergency.fire();
  assert.deepEqual(postGcEmergency.restarts, ['never'], 'small GC heap cannot hide emergency RSS');
  const disabled = harness(); disabled.box.MEMORY_AUTORESTART_ENABLED = false; disabled.setRss(7 * GB); disabled.tick();
  assert.equal(disabled.scheduled(), false);
  const blocked = harness(); blocked.setRss(6 * GB); blocked.setError('Gateway restart deferred because source edit is active'); blocked.tick(); await blocked.fire();
  assert.deepEqual(blocked.exits, []); assert.equal(blocked.box._memoryPressureRestartScheduled, false);
  const failedRoutine = harness(); failedRoutine.setActive(0); failedRoutine.setError('load failure'); failedRoutine.tick(); await failedRoutine.fire();
  assert.deepEqual(failedRoutine.exits, [], 'routine failure cannot force-exit other work');
  const drained = harness(); drained.setActive(0); drained.tick(); drained.box._gatewayDraining = true; await drained.fire();
  assert.deepEqual(drained.restarts, []);
  const aborted = harness(); aborted.setActive(0); aborted.setOutcome('handoff_aborted'); aborted.tick(); await aborted.fire();
  assert.deepEqual(aborted.restarts, ['prefer', 'never'], 'idle: an aborted warm handoff falls back to one cold restart (no work to lose)');
  const abortedBusy = harness(); abortedBusy.setActive(0); abortedBusy.setOutcome('handoff_aborted');
  abortedBusy.setOnRestart(() => abortedBusy.setActive(1)); abortedBusy.tick(); await abortedBusy.fire();
  assert.deepEqual(abortedBusy.restarts, ['prefer'], 'no cold fallback once work is running again');
  const spawnFailed = harness(); spawnFailed.setActive(0); spawnFailed.setOutcome('spawn_failed'); spawnFailed.tick(); await spawnFailed.fire();
  assert.deepEqual(spawnFailed.restarts, ['prefer'], 'no cold fallback after spawn_failed (the cold path is what failed)');
  assert.equal(abortedBusy.box._memoryPressureRestartScheduled, false);
  assert.equal(aborted.box._memoryPressureRestartScheduled, false, 'aborted handoff re-arms the memory watchdog');
  aborted.tick();
  assert.equal(aborted.scheduled(), false, 'a still-serving outcome starts a retry cooldown, not a listener release/reopen loop');
  aborted.box._memoryPressureRetryAfter = 0; aborted.tick();
  assert.equal(aborted.scheduled(), true, 'recovery retries after the cooldown');
  const windowAt = 1000000 - 60_000;
  const gcWindow = harness(); gcWindow.setActive(0); gcWindow.setMemory({ rss: 3.4 * GB, heapUsed: 3.0 * GB });
  gcWindow.box._lastMemoryRecoveryGcAt = windowAt; gcWindow.box._lastMemoryRecoverySkippedAfterGcAt = windowAt; gcWindow.tick();
  assert.equal(gcWindow.scheduled(), false, 'a pre-GC heap reading inside the GC window cannot override a GC-confirmed skip');
  const clearedEmergency = harness(); clearedEmergency.setActive(1); clearedEmergency.setMemory({ rss: 3.9 * GB, heapUsed: 3.6 * GB });
  clearedEmergency.box._lastMemoryRecoveryGcAt = windowAt; clearedEmergency.box._lastMemoryRecoverySkippedAfterGcAt = windowAt;
  let forcedGcs = 0;
  clearedEmergency.box.runRecoveryGc = () => { forcedGcs++; clearedEmergency.setMemory({ heapUsed: 1.5 * GB }); return { gcRan: true, postGcHeapUsedBytes: 1.5 * GB }; };
  clearedEmergency.tick();
  assert.equal(forcedGcs, 1, 'a pre-GC emergency reading is confirmed with one forced GC');
  assert.equal(clearedEmergency.scheduled(), false, 'an emergency the forced GC clears does not cold-recycle active work');
  clearedEmergency.setMemory({ heapUsed: 3.6 * GB }); clearedEmergency.tick();
  assert.equal(forcedGcs, 1, 'confirm-GC is rate limited (no full GC on every sample)');
  assert.equal(clearedEmergency.scheduled(), true, 'an emergency that returns within the interval is treated as real');
  const exiting = harness(); exiting.setActive(0); exiting.tick(); await exiting.fire();
  assert.equal(exiting.box._memoryPressureRestartScheduled, true, 'an exiting restart keeps its latch');
  const heapOnly = harness(); heapOnly.setActive(0); heapOnly.setMemory({ rss: 3.4 * GB, heapUsed: 3.0 * GB }); heapOnly.tick();
  assert.equal(heapOnly.scheduled(), true, 'heap ratio triggers recovery before RSS reaches the old 4 GiB threshold');
  console.log('gateway active-work memory recovery regression: PASS (policy + actual watchdog busy/idle/emergency/disabled/races/drain/barrier paths)');
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
