import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { planDueSlots, SchedulerAdmission, validateScheduledExecution } from './scheduler-admission';
import type { CronJob } from './cron-scheduler';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-scheduler-misfire-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main() {
  const now = new Date('2026-10-14T12:05:00.000Z');
  const job = { id: 'fake-clock', type: 'recurring', schedule: '* * * * *', tz: 'UTC', nextRun: '2026-10-14T12:00:00.000Z' } as CronJob;
  const once = planDueSlots(job, now);
  assert.equal(once.slots.length, 1);
  assert.equal(once.slots[0].reason, 'catch_up');
  assert.equal(once.missedCount, 6);
  assert.equal(once.nextRun, '2026-10-14T12:06:00.000Z');
  assert.equal(planDueSlots({ ...job, misfire_policy: 'skip' }, now).slots.length, 0);
  const all = planDueSlots({ ...job, misfire_policy: 'run_all' }, now);
  assert.equal(all.slots.length, 3);
  assert.deepEqual(all.slots.map(s => s.scheduledAt), ['2026-10-14T12:03:00.000Z', '2026-10-14T12:04:00.000Z', '2026-10-14T12:05:00.000Z']);
  assert.equal(planDueSlots({ ...job, nextRun: once.nextRun }, now).slots.length, 0);
  assert.equal(planDueSlots({ ...job, nextRun: now.toISOString() }, now).slots[0].reason, 'scheduled');
  console.log('PASS fake clock: skip/run_once/run_all capped at 3, next slot advancement');

  const store = path.join(root, 'jobs.json');
  const admission = new SchedulerAdmission(store);
  const second = new SchedulerAdmission(store);
  const slot = once.slots[0].scheduledAt;
  const release = admission.acquire(job.id, slot, 1000, +now)!;
  assert.ok(release);
  assert.equal(second.acquire(job.id, 'another-slot', 1000, +now), null, 'overlap blocked across scheduler instances');
  assert.equal(second.acquire(job.id, 'another-slot', 1000, +now + 2000), null, 'expired lease does not overlap a live process');
  release();
  assert.equal(second.acquire(job.id, slot, 1000, +now), null, 'catch-up and normal tick share slot dedupe');
  const next = second.acquire(job.id, once.nextRun!, 1000, +now)!;
  assert.ok(next); next();
  const hash = crypto.createHash('sha256').update('crashed').digest('hex');
  fs.writeFileSync(path.join(`${store}.admission`, `${hash}.lease`), JSON.stringify({ token: 'dead', pid: 99999999, expiresAt: +now + 1000 }));
  assert.equal(second.acquire('crashed', slot, 1000, +now), null);
  const recovered = second.acquire('crashed', slot, 1000, +now + 2000);
  assert.ok(recovered); recovered!();
  console.log('PASS durable overlap lease, catch-up/tick dedupe, crash expiry recovery');

  assert.throws(() => validateScheduledExecution({ kind: 'script', command: '' }));
  assert.throws(() => validateScheduledExecution({ misfire_policy: 'bad' as any }));
  assert.throws(() => validateScheduledExecution({ timeoutMs: -1 }));
  const { getConfig } = await import('../../config/config');
  // Isolated test user explicitly chooses Lite permissions, exercising the real
  // runner without manufacturing an approval token or changing production policy.
  (getConfig().getConfig() as any).tools = { permissions: { shell: { approval_mode: 'lite' } } };
  const { CronScheduler } = await import('./cron-scheduler');
  const { loadRunLog } = await import('./schedule-memory');
  let modelCalls = 0;
  const scheduler = new CronScheduler({ storePath: store, broadcast: () => {}, handleChat: async () => { modelCalls++; throw new Error('script must never call model'); } });
  const script = scheduler.createJob({ name: 'script regression', prompt: '', kind: 'script', command: 'node -e "console.log(1)"', timeoutMs: 15000, type: 'one-shot', runAt: new Date().toISOString() });
  await scheduler.runJobNow(script.id);
  const history = loadRunLog(script.id);
  assert.equal(history.runs.length, 1);
  assert.equal(history.runs[0].status, 'complete', history.runs[0].errorIfAny);
  assert.match(history.runs[0].output || '', /\b1\b/);
  assert.equal(modelCalls, 0);
  console.log('PASS script executes node command through policy-gated runner, records output, no model call');
  const recurring = scheduler.createJob({ name: 'catch-up integration', prompt: '', kind: 'script', command: 'node -e "console.log(1)"', schedule: '* * * * *', tz: 'UTC', misfire_policy: 'run_all', timeoutMs: 15000 });
  recurring.nextRun = job.nextRun;
  await (scheduler as any).executeDueJob(recurring, now);
  const recoveredHistory = loadRunLog(recurring.id);
  assert.equal(recoveredHistory.runs.length, 3);
  assert.ok(recoveredHistory.runs.every(r => r.reason === 'catch_up' && r.missedCount === 6 && r.status === 'complete'));
  await (scheduler as any).executeJob(recurring, all.slots[2], all.nextRun);
  assert.equal(loadRunLog(recurring.id).runs.length, 3, 'repeated normal slot is deduped');
  assert.equal(recurring.nextRun, all.nextRun);
  const skipped = scheduler.createJob({ name: 'skip integration', prompt: '', kind: 'script', command: 'node -e "console.log(1)"', schedule: '* * * * *', tz: 'UTC', misfire_policy: 'skip' });
  skipped.nextRun = job.nextRun;
  await (scheduler as any).executeDueJob(skipped, now);
  assert.equal(loadRunLog(skipped.id).runs[0].status, 'skipped');
  assert.equal(loadRunLog(skipped.id).runs[0].missedCount, 6);
  assert.equal(modelCalls, 0);
  console.log('PASS real scheduler catch-up capped at 3, history metadata, skipped history, repeated tick dedupe');
  scheduler.stop();
}
main().then(() => { fs.rmSync(root, { recursive: true, force: true }); console.log('scheduler-misfire regression: PASS'); process.exit(0); }).catch(err => { console.error(err); process.exit(1); });
