import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Set every storage root before loading application modules. This exercises the
// real backgroundSpawn path without touching the developer's config/session/
// runtime ledger or calling a provider.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-steer-identity-'));
process.env.PROMETHEUS_CONFIG_PATH = path.join(root, 'config.json');
process.env.PROMETHEUS_APP_DATA_DIR = root;
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = root;
process.env.APPDATA = root;
process.env.USERPROFILE = root;
process.env.HOME = root;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve: () => resolve() };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await sleep(10);
  }
}

async function run(): Promise<void> {
  try {
    const configModule = require('../../config/config');
    const config = configModule.getConfig();
    config.getConfigDir = () => root;
    config.getWorkspacePath = () => root;

    const runner = require('./task-runner');
    const runtime = require('../live-runtime-registry');
    const gates = new Map<string, Deferred>();
    const started = new Set<string>();
    const consumed = new Map<string, any[]>();
    runner.setBackgroundAgentDeps({
      broadcastWS() {},
      async handleChat(_prompt: string, sessionId: string): Promise<{ text: string }> {
        // Install the per-worker deferred before announcing startup so the test
        // never races backgroundSpawn's async admission/registration boundary.
        const gate = deferred();
        gates.set(sessionId, gate);
        started.add(sessionId);
        await gate.promise;
        const steers = runtime.consumePendingRuntimeSteersForSession(sessionId, 16);
        consumed.set(sessionId, steers);
        return { text: 'isolated fake worker completed' };
      },
    });

    // Set gates before either async executor reaches its injected handler.
    const firstParent = `steer-parent-first-${randomUUID()}`;
    const secondParent = `steer-parent-second-${randomUUID()}`;
    const first = runner.backgroundSpawn({ prompt: 'fake first worker', spawnerSessionId: firstParent,
      workDir: root, providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [] });
    const second = runner.backgroundSpawn({ prompt: 'fake second worker', spawnerSessionId: secondParent,
      workDir: root, providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [] });
    const firstSession = first.backgroundSessionId;
    const secondSession = second.backgroundSessionId;
    if (!gates.has(firstSession)) gates.set(firstSession, deferred());
    if (!gates.has(secondSession)) gates.set(secondSession, deferred());

    await waitFor(() => started.has(firstSession) && started.has(secondSession), 'both fake workers to enter handleChat');

    const queued = runner.backgroundSteer(first.id, 'Only the first worker should receive this.', { source: 'regression' });
    assert.equal(queued.queued, true, `actual spawned ID should resolve to its live runtime: ${queued.error || ''}`);
    assert.equal(queued.state, 'in_progress');
    const registryEvent = runtime.addPendingRuntimeSteerForBackgroundAgent(`bg_unknown_${randomUUID()}`, { message: 'must not route' });
    assert.equal(registryEvent.ok, false, 'registry must reject an unknown/wrong public ID');
    assert.equal(runner.backgroundSteer('bg_unknown-regression', 'wrong worker').queued, false,
      'task runner must reject an unknown ID before enqueue');

    assert.deepEqual(runtime.consumePendingRuntimeSteersForSession(secondSession, 16), [],
      'steering the first ID must not route to the unrelated second worker session');
    gates.get(firstSession)!.resolve();
    await runner.backgroundWait({ backgroundId: first.id, timeoutMs: 5_000 });
    assert.equal(consumed.get(firstSession)?.length, 1, 'the targeted fake model loop must consume the queued steer once');
    assert.equal(consumed.get(firstSession)?.[0]?.message, 'Only the first worker should receive this.');
    assert.deepEqual(runtime.consumePendingRuntimeSteersForSession(firstSession, 16), [],
      'consumed guidance must not be delivered a second time');

    const terminal = runner.backgroundSteer(first.id, 'too late');
    assert.equal(terminal.queued, false, 'completed worker must reject a later steer');
    assert.match(String(terminal.error), /already completed/);

    gates.get(secondSession)!.resolve();
    await runner.backgroundWait({ backgroundId: second.id, timeoutMs: 5_000 });
    assert.deepEqual(consumed.get(secondSession), [], 'unrelated worker completes without receiving the first worker steer');
    console.log('PASS background steer identity: actual spawn registration, exact-ID queueing, isolated once-only delivery, unknown-ID rejection, terminal rejection');
  } finally {
    // Runtime ledger/progress-lease writes are coalesced on short unref'ed timers.
    // Allow those isolated async writes to drain before removing their root.
    await sleep(800);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
