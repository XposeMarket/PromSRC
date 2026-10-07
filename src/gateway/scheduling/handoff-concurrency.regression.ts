import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-handoff-concurrency-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function main(): Promise<void> {
  const { isForeignLiveGatewayPid, renameFileWithRetrySync, CronScheduler } = await import('./cron-scheduler');

  // 1. Pid liveness: self and dead pids are not "foreign live"; a live child is.
  assert.equal(isForeignLiveGatewayPid(process.pid), false, 'own pid is not foreign');
  assert.equal(isForeignLiveGatewayPid(null), false);
  assert.equal(isForeignLiveGatewayPid(0), false);
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(isForeignLiveGatewayPid(child.pid), true, 'live child pid is foreign+live');
  child.kill();
  await new Promise((r) => child.once('exit', r));
  assert.equal(isForeignLiveGatewayPid(child.pid), false, 'dead pid is not live');

  // 2. Atomic rename helper works and cleans up.
  const target = path.join(root, 'x.json');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, '{"a":1}');
  renameFileWithRetrySync(tmp, target);
  assert.equal(fs.readFileSync(target, 'utf-8'), '{"a":1}');
  assert.equal(fs.existsSync(tmp), false);

  // 3. Two schedulers sharing one jobs.json (warm handoff): a job created or
  //    paused by the "draining" instance is seen by the "replacement" instead
  //    of being overwritten from a stale in-memory copy.
  const storePath = path.join(root, 'cron', 'jobs.json');
  const deps: any = { storePath, broadcast: () => {}, handleChat: async () => ({}) };
  const draining = new CronScheduler(deps);
  const replacement = new CronScheduler(deps);
  const job = draining.createJob({ name: 'handoff job', prompt: 'p', schedule: '*/2 * * * *' });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(replacement.getJobs().some((j) => j.id === job.id), 'replacement sees job created by draining gateway');
  draining.pauseJob(job.id);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(replacement.getJobs().find((j) => j.id === job.id)?.status, 'paused', 'replacement sees the pause');
  replacement.deleteJob(job.id);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(draining.getJobs().some((j) => j.id === job.id), false, 'draining sees the delete');

  // 4. A job marked running by another live gateway stays running on load
  //    (so the replacement does not re-fire it); a dead owner resets it.
  const liveChild = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 200));
  const raw = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  raw.jobs.push(
    { id: 'job_live', name: 'live', prompt: 'p', type: 'one-shot', runAt: new Date(Date.now() - 1000).toISOString(), nextRun: new Date(Date.now() - 1000).toISOString(), enabled: true, status: 'running', runningPid: liveChild.pid, priority: 0, schedule: null, sessionTarget: 'isolated', payloadKind: 'agentTurn', delivery: 'web', lastRun: null, lastResult: null, lastDuration: null, lastOutputSessionId: null, createdAt: new Date().toISOString() },
    { id: 'job_dead', name: 'dead', prompt: 'p', type: 'one-shot', runAt: new Date(Date.now() - 1000).toISOString(), nextRun: new Date(Date.now() - 1000).toISOString(), enabled: true, status: 'running', runningPid: 999999, priority: 0, schedule: null, sessionTarget: 'isolated', payloadKind: 'agentTurn', delivery: 'web', lastRun: null, lastResult: null, lastDuration: null, lastOutputSessionId: null, createdAt: new Date().toISOString() },
  );
  fs.writeFileSync(storePath, JSON.stringify(raw));
  const fresh = new CronScheduler(deps);
  assert.equal(fresh.getJobs().find((j) => j.id === 'job_live')?.status, 'running', 'job owned by live foreign gateway stays running');
  assert.equal(fresh.getJobs().find((j) => j.id === 'job_dead')?.status, 'scheduled', 'job owned by dead gateway is reset');
  liveChild.kill();

  draining.stop(); replacement.stop(); fresh.stop();
  console.log('handoff-concurrency regression: ok');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
