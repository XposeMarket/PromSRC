/**
 * Scheduled-job pause state (state-machine audit 2026-11-06).
 * `status` and `enabled` are written together by CronScheduler.applyPauseState
 * for every caller: UI toggle (PATCH {enabled}), REST status edits, pauseJob/
 * resumeJob and the schedule_job tool.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-schedule-pause-state-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main(): Promise<void> {
  const cron = await import('./cron-scheduler');
  const { automationCapabilityExecutor } = await import('../agents-runtime/capabilities/automation-executor');

  const storePath = path.join(root, 'cron', 'jobs.json');
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const scheduler = new cron.CronScheduler({
    storePath,
    handleChat: async () => ({ type: 'chat', text: 'ok' }),
    broadcast: () => {},
  } as any);
  const get = (id: string) => scheduler.getJobs().find((j) => j.id === id)! as any;
  const raw = (id: string) => (scheduler as any).store.jobs.find((j: any) => j.id === id);
  const make = (name: string) => scheduler.createJob({ name, prompt: 'x', schedule: '0 9 * * *', tz: 'UTC' });
  const isFuture = (iso: string | null | undefined) => !!iso && Date.parse(iso) > Date.now();
  const assertPaused = (id: string, label: string) => {
    const job = get(id);
    assert.equal(job.status, 'paused', `${label}: status paused`);
    assert.equal(job.enabled, false, `${label}: enabled false`);
    assert.equal(job.nextRun, null, `${label}: no nextRun`);
  };
  const assertActive = (id: string, label: string) => {
    const job = get(id);
    assert.equal(job.status, 'scheduled', `${label}: status scheduled`);
    assert.equal(job.enabled, true, `${label}: enabled true`);
    assert.equal(job.pausedReason, undefined, `${label}: pausedReason cleared`);
    assert.ok(isFuture(job.nextRun), `${label}: fresh nextRun`);
  };

  // ── UI toggle (desktop SchedulePage + mobile send only {enabled}) ──────────
  const toggle = make('toggle');
  scheduler.updateJob(toggle.id, { enabled: false });
  assertPaused(toggle.id, 'toggle off');
  assert.equal(get(toggle.id).pausedReason, 'manual');
  scheduler.updateJob(toggle.id, { enabled: true });
  assertActive(toggle.id, 'toggle on');

  // ── status-only edits map to pause/resume intent ────────────────────────────
  scheduler.updateJob(toggle.id, { status: 'paused' } as any);
  assertPaused(toggle.id, 'status paused');
  scheduler.updateJob(toggle.id, { status: 'scheduled' } as any);
  assertActive(toggle.id, 'status scheduled');

  // ── canonical methods keep enabled in sync ──────────────────────────────────
  const methods = make('methods');
  scheduler.pauseJob(methods.id);
  assertPaused(methods.id, 'pauseJob');
  scheduler.resumeJob(methods.id);
  assertActive(methods.id, 'resumeJob');

  // ── legacy disabled-but-"scheduled" job (pre-fix toggle) recovers ───────────
  const legacy = make('legacy');
  Object.assign(raw(legacy.id), { enabled: false, status: 'scheduled' });
  scheduler.resumeJob(legacy.id);
  assertActive(legacy.id, 'legacy resume');

  // ── other run states are owned by the scheduler ─────────────────────────────
  const guarded = make('guarded');
  for (const status of ['running', 'completed', 'queued', 'bogus']) {
    scheduler.updateJob(guarded.id, { status } as any);
    assert.equal(get(guarded.id).status, 'scheduled', `updateJob ignores status "${status}"`);
  }

  // ── completed one-shot: disable keeps completed, re-enable schedules ────────
  const done = make('completed');
  Object.assign(raw(done.id), { status: 'completed', enabled: false, nextRun: null });
  scheduler.updateJob(done.id, { enabled: false });
  assert.equal(get(done.id).status, 'completed', 'disabling a completed job leaves it completed');
  assert.equal(get(done.id).enabled, false);
  scheduler.updateJob(done.id, { enabled: true });
  assertActive(done.id, 're-enabled completed job');

  // ── resume of an active job is a no-op ──────────────────────────────────────
  const active = make('active');
  const nextRunBefore = get(active.id).nextRun;
  scheduler.resumeJob(active.id);
  scheduler.updateJob(active.id, { enabled: true });
  assert.equal(get(active.id).nextRun, nextRunBefore, 'active job nextRun untouched');
  assert.equal(get(active.id).status, 'scheduled');

  // ── editing a paused job does not give it a nextRun ─────────────────────────
  scheduler.pauseJob(active.id);
  scheduler.updateJob(active.id, { schedule: '0 10 * * *' });
  assertPaused(active.id, 'schedule edit while paused');
  assert.equal(get(active.id).schedule, '0 10 * * *');

  // ── configuration pause keeps its reason on a repeated pause ────────────────
  const config = make('config');
  scheduler.updateJob(config.id, { enabled: false, pausedReason: 'configuration_error' } as any);
  scheduler.updateJob(config.id, { status: 'paused' } as any);
  assert.equal(get(config.id).pausedReason, 'configuration_error');

  // ── schedule_job tool pause/resume ──────────────────────────────────────────
  const tool = make('tool');
  const exec = (args: any) => automationCapabilityExecutor.execute({
    name: 'schedule_job', args, sessionId: 'main_session', workspacePath: root,
    deps: { cronScheduler: scheduler },
  } as any);
  let res: any = await exec({ action: 'pause', job_id: tool.id, confirm: true });
  assert.equal(res.error, false, String(res.result));
  assertPaused(tool.id, 'schedule_job pause');
  res = await exec({ action: 'resume', job_id: tool.id, confirm: true });
  assert.equal(res.error, false, String(res.result));
  assertActive(tool.id, 'schedule_job resume');

  // ── a job created disabled starts paused ────────────────────────────────────
  const createdOff = scheduler.createJob({ name: 'created-off', prompt: 'x', schedule: '0 9 * * *', tz: 'UTC', enabled: false });
  assertPaused(createdOff.id, 'created disabled');
  scheduler.resumeJob(createdOff.id);
  assertActive(createdOff.id, 'created disabled then resumed');

  // ── persisted state agrees on disk ──────────────────────────────────────────
  const onDisk = JSON.parse(fs.readFileSync(storePath, 'utf-8')).jobs.find((j: any) => j.id === methods.id);
  assert.equal(onDisk.status, 'scheduled');
  assert.equal(onDisk.enabled, true);

  console.log('schedule pause state regression passed');
}

main()
  .then(() => { fs.rmSync(root, { recursive: true, force: true }); process.exit(0); })
  .catch((err) => { console.error(err); fs.rmSync(root, { recursive: true, force: true }); process.exit(1); });
