import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  DesktopTargetAdapter,
  DesktopTargetLeaseManager,
  DesktopTargetLeaseManagerOptions,
} from './desktop-target-lease.js';
import { createDesktopTargetLeaseManager } from './desktop-target-lease.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class FakeDesktopTarget implements DesktopTargetAdapter {
  readonly targetId = 'regression-fake-target';
  readonly kind = 'fake';
  starts = 0;
  probes = 0;
  readinessWaits = 0;
  stops = 0;
  running = false;
  failReadiness = false;
  startDelayMs = 8;
  readinessDelayMs = 4;
  stopDelayMs = 2;

  async start(): Promise<{ ownership: 'owned' }> {
    this.starts++;
    await sleep(this.startDelayMs);
    this.running = true;
    return { ownership: 'owned' };
  }

  async probe(): Promise<{ ready: boolean; ownership?: 'owned' }> {
    this.probes++;
    return this.running ? { ready: true, ownership: 'owned' } : { ready: false };
  }

  async waitUntilReady(): Promise<void> {
    this.readinessWaits++;
    await sleep(this.readinessDelayMs);
    if (this.failReadiness) throw new Error('fake readiness timeout');
    if (!this.running) throw new Error('fake target stopped before readiness');
  }

  async stop(): Promise<void> {
    this.stops++;
    await sleep(this.stopDelayMs);
    this.running = false;
  }
}

function tempStatePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-desktop-lease-'));
  return path.join(root, 'runtime.json');
}

function managerFor(adapter: FakeDesktopTarget, options: Partial<DesktopTargetLeaseManagerOptions> = {}): DesktopTargetLeaseManager {
  return createDesktopTargetLeaseManager(adapter, {
    idleTimeoutMs: 60_000,
    startTimeoutMs: 1_000,
    stopGraceMs: 20,
    stopForceAfterMs: 20,
    statePath: tempStatePath(),
    ...options,
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.equal(predicate(), true, 'condition did not become true before timeout');
}

async function testSingleFlightReferenceCountingAndIdleStop(): Promise<void> {
  const adapter = new FakeDesktopTarget();
  const events: string[] = [];
  const statePath = tempStatePath();
  const eventsPath = path.join(path.dirname(statePath), 'events.ndjson');
  const manager = managerFor(adapter, {
    idleTimeoutMs: 35,
    statePath,
    eventsPath,
    onEvent: event => events.push(event.event),
  });

  const leases = await Promise.all([
    manager.acquire('session-a'),
    manager.acquire('session-a'),
    manager.acquire('session-b'),
  ]);
  assert.equal(adapter.starts, 1, 'concurrent acquires must single-flight startup');
  assert.equal(adapter.readinessWaits, 1);
  assert.equal(manager.status().activeLeases, 3);
  assert.equal(manager.status().activeSessions, 2);

  leases[0].renew();
  assert.ok(events.includes('renew'));
  leases[0].release();
  leases[0].release();
  assert.equal(manager.status().activeLeases, 2, 'duplicate release must be idempotent');
  leases[1].release();
  assert.equal(adapter.stops, 0, 'target must stay alive while another lease is active');
  leases[2].release();
  await waitFor(() => adapter.stops === 1 && manager.status().state === 'stopped');
  assert.equal(manager.status().state, 'stopped');
  assert.ok(events.includes('start_begin'));
  assert.ok(events.includes('ready'));
  const persistedEvents = fs.readFileSync(eventsPath, 'utf8');
  assert.match(persistedEvents, /"event":"acquire"/);
  assert.match(persistedEvents, /"event":"idle_stop"/);
}

async function testExplicitSessionReleaseAndWarmMode(): Promise<void> {
  const adapter = new FakeDesktopTarget();
  const manager = managerFor(adapter, { idleTimeoutMs: 60_000 });
  const lease = await manager.acquire('session-explicit');
  manager.releaseSession('session-explicit');
  assert.equal(adapter.stops, 0, 'session release must not stop an active command');
  lease.release();
  await waitFor(() => adapter.stops === 1);

  const warmAdapter = new FakeDesktopTarget();
  const warm = managerFor(warmAdapter, { idleTimeoutMs: 20, warmMode: true });
  const warmLease = await warm.acquire('warm-session');
  warmLease.release();
  await sleep(60);
  assert.equal(warmAdapter.stops, 0, 'warm mode must suppress automatic idle stop');
  await warm.shutdown();
  assert.equal(warmAdapter.stops, 1, 'shutdown must override warm mode');
}

async function testReadinessFailureAndCrashRecovery(): Promise<void> {
  const failingAdapter = new FakeDesktopTarget();
  failingAdapter.failReadiness = true;
  const failingManager = managerFor(failingAdapter);
  await assert.rejects(() => failingManager.acquire('failed-session'), /readiness timeout/);
  assert.equal(failingAdapter.starts, 1);
  assert.equal(failingAdapter.stops, 1, 'owned target must be cleaned up after readiness failure');
  assert.equal(failingManager.status().state, 'failed');

  const adapter = new FakeDesktopTarget();
  const manager = managerFor(adapter);
  const first = await manager.acquire('crash-session');
  first.release();
  adapter.running = false;
  const second = await manager.acquire('crash-session');
  assert.equal(adapter.starts, 2, 'a target crash must trigger a fresh start');
  assert.equal(manager.status().lastEvent, 'acquire');
  second.release();
  await manager.shutdown();
}

async function testStaleRecoveryAndMissingTarget(): Promise<void> {
  const statePath = tempStatePath();
  fs.writeFileSync(statePath, JSON.stringify({
    targetId: 'regression-fake-target',
    kind: 'fake',
    state: 'ready',
    ownership: 'owned',
    instanceId: 'previous-instance',
    lastActivityAt: Date.now(),
  }));
  const adoptedAdapter = new FakeDesktopTarget();
  adoptedAdapter.running = true;
  const adopted = managerFor(adoptedAdapter, { statePath, idleTimeoutMs: 35 });
  const lease = await adopted.acquire('recovered-session');
  assert.equal(adoptedAdapter.starts, 0, 'healthy stale target should be adopted');
  assert.equal(adopted.status().ownership, 'owned');
  lease.release();
  await waitFor(() => adoptedAdapter.stops === 1);

  const missingStatePath = tempStatePath();
  fs.writeFileSync(missingStatePath, JSON.stringify({
    targetId: 'regression-fake-target',
    state: 'ready',
    ownership: 'owned',
    instanceId: 'missing-instance',
  }));
  const missingAdapter = new FakeDesktopTarget();
  const recovered = managerFor(missingAdapter, { statePath: missingStatePath });
  const recoveredLease = await recovered.acquire('missing-session');
  assert.equal(missingAdapter.starts, 1, 'missing stale target should be restarted');
  recoveredLease.release();
  await recovered.shutdown();
}

async function testCancellationAndShutdownRace(): Promise<void> {
  const adapter = new FakeDesktopTarget();
  adapter.startDelayMs = 50;
  const manager = managerFor(adapter, { idleTimeoutMs: 30 });
  const controller = new AbortController();
  const cancelled = manager.acquire('cancelled-session', controller.signal);
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(cancelled, error => (error as Error).name === 'AbortError');
  await waitFor(() => adapter.stops === 1);

  const raceAdapter = new FakeDesktopTarget();
  const raceManager = managerFor(raceAdapter);
  const lease = await raceManager.acquire('shutdown-session');
  const shutdown = raceManager.shutdown();
  await sleep(10);
  assert.equal(raceAdapter.stops, 0, 'shutdown must defer while a lease is active');
  lease.release();
  await shutdown;
  await waitFor(() => raceAdapter.stops === 1);
  await assert.rejects(() => raceManager.acquire('after-shutdown'), /shutting down/);
}

async function main(): Promise<void> {
  await testSingleFlightReferenceCountingAndIdleStop();
  await testExplicitSessionReleaseAndWarmMode();
  await testReadinessFailureAndCrashRecovery();
  await testStaleRecoveryAndMissingTarget();
  await testCancellationAndShutdownRace();
  console.log('desktop-target-lease regression tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
