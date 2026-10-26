import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-schedule-deadline-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function main() {
  const { CronScheduler } = await import('./cron-scheduler');
  const { loadRunLog } = await import('./schedule-memory');
  // Match the CommonJS scheduler import; tsx dynamic ESM import creates a separate ALS instance.
  const { rejectScheduledFinalAction } = require('./scheduled-approval-policy') as typeof import('./scheduled-approval-policy');
  const { scheduledRunTimeoutMs } = await import('./scheduled-run-deadline');
  assert.equal(scheduledRunTimeoutMs({}), 1_800_000);
  assert.equal(scheduledRunTimeoutMs({ timeoutMs: -1 }), 1_800_000);
  const events: any[] = [], deliveries: string[] = [];
  let resolveOld!: (value: any) => void;
  let oldSignal: any;
  let mode = 'stalled';
  const scheduler = new CronScheduler({
    storePath: path.join(root, 'cron', 'jobs.json'),
    broadcast: event => events.push(event),
    deliverTelegram: async text => { deliveries.push(text); },
    handleChat: async (_message, _session, send, _pins, signal) => {
      if (mode === 'approval') {
        // Even a tool loop swallowing the error and never returning cannot strand the job.
        try { rejectScheduledFinalAction(); } catch { /* model-facing tool catches */ }
        return new Promise(() => {});
      }
      if (mode === 'stalled') {
        oldSignal = signal;
        return new Promise(resolve => { resolveOld = resolve; });
      }
      await delay(40);
      assert.equal(signal?.aborted, false, 'healthy work is not cancelled');
      return { type: 'chat', text: 'Healthy result' };
    },
  });
  const job = scheduler.createJob({ name: 'Deadline fixture', prompt: 'Test only', schedule: '0 9 * * *',
    assignmentTarget: 'main', sessionTarget: 'isolated', timeoutMs: 120 });
  const started = Date.now();
  const settled = await Promise.race([scheduler.runJobNow(job.id).then(() => true), delay(900).then(() => false)]);
  assert.equal(settled, true, 'stalled in-process run must settle without waiting for gateway death');
  assert.ok(Date.now() - started < 900);
  assert.equal(oldSignal.aborted, true);
  assert.equal(job.runningPid, null);
  assert.equal(job.status, 'scheduled');
  assert.match(job.lastResult!, /ERROR:.*timed out/i);
  assert.ok(events.some(e => e.type === 'session_notification' && /timed out/i.test(e.text)));
  assert.ok(deliveries.some(text => /timed out/i.test(text)), 'timeout is delivered to configured channel');
  const persisted = JSON.parse(fs.readFileSync(path.join(root, 'cron', 'jobs.json'), 'utf8'));
  assert.equal(persisted.jobs.find((j: any) => j.id === job.id).runningPid, null);
  mode = 'healthy';
  scheduler.updateJob(job.id, { timeoutMs: 500 });
  await scheduler.runJobNow(job.id);
  assert.equal(job.lastResult, 'Healthy result', 'released slot accepts next healthy run');
  resolveOld({ type: 'chat', text: 'Stale result must never win' });
  await delay(40);
  assert.equal(job.lastResult, 'Healthy result', 'late completion cannot overwrite newer run');
  assert.equal(events.filter(e => e.type === 'session_notification').length, 2);
  const runs = loadRunLog(job.id).runs;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[1].status, 'complete');
  mode = 'approval';
  const approvalStarted = Date.now();
  await scheduler.runJobNow(job.id);
  assert.ok(Date.now() - approvalStarted < 1000, 'approval failure settles in <1s');
  assert.match(job.lastResult!, /ERROR: NEEDS_APPROVAL/);
  assert.ok(deliveries.some(text => /NEEDS_APPROVAL/.test(text)));
  assert.ok(events.some(e => e.type === 'session_notification' && /NEEDS_APPROVAL/.test(e.text)));
  assert.equal(loadRunLog(job.id).runs.at(-1)?.status, 'failed');
  console.log(`PASS scheduled lifecycle (9 scenarios): 120ms timeout, healthy, slot release, persistence, delivery, late completion, run log, defaults, needs-approval (${Date.now() - approvalStarted}ms)`);
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
