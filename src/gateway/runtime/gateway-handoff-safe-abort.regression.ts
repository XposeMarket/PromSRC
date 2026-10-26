import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { writeGatewayHandoffManifest } from './gateway-handoff-protocol';
import { releaseHandoffListeners, canExitAfterFailedHandoff, predecessorOwnsHandoffListener } from './gateway-handoff-safe-abort';
import { listenWithHandoffRetry } from './handoff-replacement-bind';

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
  console.log('gateway safe handoff regression: passed');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
