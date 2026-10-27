import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { writeGatewayHandoffManifest } from './gateway-handoff-protocol';
import { releaseHandoffListeners, canExitAfterFailedHandoff, predecessorOwnsHandoffListener, runListenerReleaseHandoff } from './gateway-handoff-safe-abort';
import { listenWithHandoffRetry } from './handoff-replacement-bind';

/** Behavioral fakes: `listening` models the real socket; every step is observable. */
async function runOrchestratorScenarios(): Promise<void> {
  const makeFakes = (opts: { prepareFails?: boolean; releasePartial?: boolean; commitFails?: boolean; reopenFails?: boolean }) => {
    const calls: string[] = [];
    const state = { listening: true };
    const logs: string[] = [];
    const steps = {
      prepare: async () => {
        calls.push('prepare');
        if (opts.prepareFails) throw new Error('socket bind failed');
        return { id: 'host' };
      },
      release: async () => {
        calls.push('release');
        state.listening = false;
        if (opts.releasePartial) throw new Error('https timed out');
      },
      commit: async () => {
        calls.push('commit');
        if (opts.commitFails) throw new Error('context write failed');
      },
      dispose: async () => { calls.push('dispose'); },
      reopen: async () => {
        calls.push('reopen');
        if (opts.reopenFails) throw new Error('EADDRINUSE');
        state.listening = true;
      },
      coldRecover: async () => { calls.push('coldRecover'); },
      log: (message: string) => { logs.push(message); },
    };
    return { steps, calls, state, logs };
  };

  // (a) prepare throws: nothing released, still serving.
  {
    const f = makeFakes({ prepareFails: true });
    const result = await runListenerReleaseHandoff(f.steps);
    assert.deepEqual(result, { ok: false, stage: 'prepare', recovered: 'serving' });
    assert.deepEqual(f.calls, ['prepare']);
    assert.equal(f.state.listening, true, 'prepare failure must never darken the gateway');
  }
  // (b) release partially closes then throws: disposed, reopened, serving again.
  {
    const f = makeFakes({ releasePartial: true });
    const result = await runListenerReleaseHandoff(f.steps);
    assert.deepEqual(result, { ok: false, stage: 'release', recovered: 'serving' });
    assert.deepEqual(f.calls, ['prepare', 'release', 'dispose', 'reopen']);
    assert.equal(f.state.listening, true);
    assert.ok(f.logs.some(line => line.includes('https timed out')), 'the abort must be logged honestly');
  }
  // (c) commit throws after release: disposed, reopened, serving, no commit left behind.
  {
    const f = makeFakes({ commitFails: true });
    const result = await runListenerReleaseHandoff(f.steps);
    assert.deepEqual(result, { ok: false, stage: 'commit', recovered: 'serving' });
    assert.deepEqual(f.calls, ['prepare', 'release', 'commit', 'dispose', 'reopen']);
    assert.equal(f.state.listening, true);
  }
  // (d) commit throws and reopen throws: cold recovery takes over.
  {
    const f = makeFakes({ commitFails: true, reopenFails: true });
    const result = await runListenerReleaseHandoff(f.steps);
    assert.deepEqual(result, { ok: false, stage: 'commit', recovered: 'cold' });
    assert.deepEqual(f.calls, ['prepare', 'release', 'commit', 'dispose', 'reopen', 'coldRecover']);
    assert.equal(f.state.listening, false, 'cold recovery, not a silent dark gateway');
  }
  // (e) happy path: committed host returned, no unwind.
  {
    const f = makeFakes({});
    const result = await runListenerReleaseHandoff(f.steps);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.host, { id: 'host' });
    assert.deepEqual(f.calls, ['prepare', 'release', 'commit']);
    assert.equal(f.state.listening, false, 'successful handoff keeps the listeners released for the replacement');
  }
}
async function main(): Promise<void> {
  await assert.rejects(releaseHandoffListeners({}), /not registered/);
  let listening = true;
  const hooks = { hasListeningGateway: () => listening, closeListenersForHandoff: async () => {} };
  await assert.rejects(releaseHandoffListeners(hooks), /still owns/);
  assert.equal(listening, true, 'failed preparation must leave the serving host alone');
  hooks.closeListenersForHandoff = async () => { listening = false; };
  await releaseHandoffListeners(hooks);
  assert.equal(listening, false);
  hooks.closeListenersForHandoff = async () => { throw new Error('close failed'); };
  await assert.rejects(releaseHandoffListeners(hooks), /close failed/);

  assert.equal(canExitAfterFailedHandoff(true, 0), false, 'serving host must never exit');
  assert.equal(canExitAfterFailedHandoff(true, 16), false);
  assert.equal(canExitAfterFailedHandoff(false, 16), false, 'all carried agents survive a dead replacement');
  assert.equal(canExitAfterFailedHandoff(false, 0), true, 'idle non-serving host may request cold recovery');

  // 06:39-06:42 incident: 40s bind deadline, old host still owns port,
  // replacement otherwise exits and the predecessor exits 30s later with 16 live runtimes.
  let now = 0;
  let probes = 0;
  await listenWithHandoffRetry(async () => {
    if (now < 95_000) throw Object.assign(new Error('predecessor draining'), { code: 'EADDRINUSE' });
  }, {
    enabled: true, now: () => now, sleep: async ms => { now += ms; },
    predecessorOwnsListener: async () => { probes++; return true; },
  });
  assert.ok(now >= 95_000 && now <= 97_000);
  assert.ok(probes > 0, 'extension must require fresh ownership proof');
  console.log(JSON.stringify({ scenario: 'slow predecessor', old: 'EADDRINUSE at 40000ms; both exit', newBindMs: now, predecessorExitsWith16Agents: canExitAfterFailedHandoff(false, 16) }));
  now = 0;
  await assert.rejects(listenWithHandoffRetry(async () => { throw Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }); }, {
    enabled: true, now: () => now, sleep: async ms => { now += ms; },
    predecessorOwnsListener: async () => now < 60_000,
  }));
  assert.equal(now, 60_000, 'lost ownership stops extensions immediately');
  now = 0;
  await assert.rejects(listenWithHandoffRetry(async () => { throw Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }); }, {
    enabled: true, now: () => now, sleep: async ms => { now += ms; },
    predecessorOwnsListener: async () => false,
  }));
  assert.equal(now, 40_000, 'foreign/stale port owner retains bounded retry');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-proof-'));
  const started = Date.now() - 60_000;
  let reportedPid = process.ppid;
  const server = createServer((_req, res) => res.end(JSON.stringify({ ok: true, pid: reportedPid, processStartedAt: started })));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    assert.equal(await predecessorOwnsHandoffListener(dir, port), false, 'health alone is not a drain proof');
    writeGatewayHandoffManifest(dir, { version: 1, hostPid: process.ppid, processStartedAt: started, socketPath: 'test-only', startedAt: started, reason: 'test', runtimeIds: ['agent-1'] });
    assert.equal(await predecessorOwnsHandoffListener(dir, port), true);
    reportedPid = process.pid;
    assert.equal(await predecessorOwnsHandoffListener(dir, port), false, 'a different port owner must not extend retry');
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  await runOrchestratorScenarios();
  console.log('gateway safe handoff regression: passed');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
