/**
 * Regression coverage for the 2026-09-26 scheduled-jobs / task-system review.
 * Each block reproduces one finding and asserts the fixed behavior.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-sched-task-review-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main(): Promise<void> {
  const cron = await import('./cron-scheduler');
  const taskApi = await import('../tasks/task-store');
  const taskRouter = await import('../tasks/task-router');
  const policy = await import('../internal-watch/internal-watch-policy');
  const admin = await import('./schedule-admin-tools');
  const { automationCapabilityExecutor } = await import('../agents-runtime/capabilities/automation-executor');

  // ── cron / timezone validation (P2 #7) ────────────────────────────────────
  assert.equal(cron.validateCronExpression('0 9 * * 1-5', 'America/New_York'), null);
  assert.equal(cron.validateCronExpression('*/15 * * * *'), null);
  assert.match(String(cron.validateCronExpression('not a cron')), /Invalid cron/);
  assert.match(String(cron.validateCronExpression('61 9 * * *')), /Invalid cron/);
  assert.match(String(cron.validateCronExpression('0 9 * * *', 'Mars/Olympus')), /Invalid timezone/);
  assert.equal(cron.validateScheduleTimezone('UTC'), null);
  assert.equal(cron.validateScheduleTimezone(''), null);

  const storePath = path.join(root, 'cron', 'jobs.json');
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const scheduler = new cron.CronScheduler({
    storePath,
    handleChat: async () => ({ type: 'chat', text: 'ok' }),
    broadcast: () => {},
  } as any);

  assert.throws(() => scheduler.createJob({ name: 'bad', prompt: 'x', schedule: 'nope nope' }), /Invalid cron/);
  assert.throws(() => scheduler.createJob({ name: 'badtz', prompt: 'x', schedule: '0 9 * * *', tz: 'Not/AZone' }), /Invalid timezone/);
  const job = scheduler.createJob({ name: 'good', prompt: 'x', schedule: '0 9 * * *', tz: 'UTC' });
  assert.throws(() => scheduler.updateJob(job.id, { schedule: '99 99 * * *' } as any), /Invalid cron/);
  assert.equal(scheduler.getJobs().find((j) => j.id === job.id)?.schedule, '0 9 * * *', 'rejected update leaves job intact');

  // ── paused jobs: no stale nextRun; resume recomputes (P1 #5) ─────────────
  const paused = scheduler.updateJob(job.id, { status: 'paused', enabled: false } as any)!;
  assert.equal(paused.nextRun, null, 'pausing clears nextRun');
  const resumed = scheduler.updateJob(job.id, { status: 'scheduled', enabled: true } as any)!;
  assert.ok(resumed.nextRun && new Date(resumed.nextRun).getTime() > Date.now(), 'resume computes a future nextRun');

  // ── pause during a run is not undone (P2 #9) ──────────────────────────────
  // updateJob now mutates the live job object, so the in-flight run's
  // reference observes the pause. The completion path must keep it paused.
  const live = scheduler.getJobs().find((j) => j.id === job.id)!;
  scheduler.updateJob(job.id, { status: 'paused', enabled: false, pausedReason: 'manual' } as any);
  assert.equal(live.status, 'paused', 'running job reference sees the pause (same object)');
  const cronSource = fs.readFileSync(path.join(__dirname, 'cron-scheduler.ts'), 'utf8');
  assert.match(cronSource, /else if \(job\.status === 'paused' \|\| job\.enabled === false\)/, 'completion path preserves any in-flight pause');

  // ── blocker only from real errors (P2 #6) ─────────────────────────────────
  live.lastResult = 'Report: the API timeout setting is 30s. All good.';
  live.consecutiveErrors = 0;
  assert.equal(admin.jobHealth(live).blockerReason, null, 'successful output mentioning "timeout" is not a blocker');
  live.lastResult = 'ERROR: request timed out after 120s';
  assert.equal(admin.jobHealth(live).blockerReason, 'timeout');
  assert.match(String(admin.jobHealth(live).lastError), /timed out/);

  // ── failed task last_issue reports the real error (P1 #1) ────────────────
  const task = taskApi.createTask({
    title: 'Brain Thought fixture',
    prompt: 'think',
    sessionId: 'brain_thought_fixture',
    channel: 'web',
    plan: [{ index: 0, description: 'think', status: 'pending' }],
  });
  taskApi.appendJournal(task.id, { type: 'error', content: 'Provider error 429: usage limit reached', detail: 'openai_codex' } as any);
  taskApi.updateTaskStatus(task.id, 'failed', { finalSummary: 'Provider error 429: usage limit reached' });
  const summary = taskRouter.summarizeTaskRecord(taskApi.loadTask(task.id)!);
  assert.notEqual(summary.last_issue, 'paused', 'failed task must not report "paused"');
  assert.match(String(summary.last_issue), /429/);
  const done = taskApi.createTask({ title: 'done', prompt: 'x', sessionId: 's', channel: 'web', plan: [] } as any);
  taskApi.updateTaskStatus(done.id, 'complete', { finalSummary: 'ok' });
  assert.equal(taskRouter.summarizeTaskRecord(taskApi.loadTask(done.id)!).last_issue, null, 'complete task has no issue');

  // ── atomic task writes (P2 #10) ───────────────────────────────────────────
  const taskDir = path.dirname(path.join(root, 'tasks', `${task.id}.json`));
  const leftovers = fs.existsSync(taskDir) ? fs.readdirSync(taskDir).filter((f) => f.endsWith('.tmp')) : [];
  assert.equal(leftovers.length, 0, 'no temp files left behind');
  assert.ok(taskApi.loadTask(task.id), 'task still loads after atomic save');

  // ── live-steered watch does not block unrelated tasks (P1 #2) ────────────
  const liveCtx = { watchId: 'w1', actionPolicy: 'review_only' as const, targetTaskId: task.id, delivery: 'live_steer' as const };
  assert.equal(policy.evaluateInternalWatchTaskControlPolicy(liveCtx, { action: 'delete', task_id: done.id }), null,
    'live watch policy must not gate an unrelated task');
  assert.ok(policy.evaluateInternalWatchTaskControlPolicy(liveCtx, { action: 'rerun', task_id: task.id }),
    'live watch policy still gates the watched task');
  const noTarget = { watchId: 'w2', actionPolicy: 'review_only' as const, delivery: 'live_steer' as const };
  assert.equal(policy.evaluateInternalWatchTaskControlPolicy(noTarget, { action: 'delete', task_id: done.id }), null,
    'file/schedule watch with no task target never gates task_control in a live turn');
  const followUp = { ...liveCtx, delivery: 'follow_up' as const };
  assert.ok(policy.evaluateInternalWatchTaskControlPolicy(followUp, { action: 'delete', task_id: done.id }),
    'synthetic follow-up watch turns remain fully gated');

  // ── schedule_job passes preview_only / expected_outputs, validates (P2 #7/#8) ─
  const exec = (args: any) => automationCapabilityExecutor.execute({
    name: 'schedule_job', args, sessionId: 'main_session', workspacePath: root,
    deps: { cronScheduler: scheduler },
  } as any);
  let res = await exec({ action: 'create', confirm: true, name: 'bad', instruction_prompt: 'x', schedule: { kind: 'recurring', cron: 'whenever' } });
  assert.equal(res.error, true, 'tool rejects invalid cron');
  res = await exec({ action: 'create', confirm: true, name: 'badtz', instruction_prompt: 'x', schedule: { cron: '0 9 * * *' }, timezone: 'Nowhere/Land' });
  assert.equal(res.error, true, 'tool rejects invalid timezone');
  res = await exec({
    action: 'create', confirm: true, name: 'contract', instruction_prompt: 'write report',
    schedule: { kind: 'recurring', cron: '0 8 * * *' }, timezone: 'UTC',
    preview_only: true, expected_outputs: ['reports/daily.md', { path: 'reports/x.md', required_text: 'OK' }],
  });
  assert.equal(res.error, false, String(res.result));
  const createdId = JSON.parse(String(res.result)).job.id;
  const created = scheduler.getJobs().find((j: any) => j.id === createdId) as any;
  assert.equal(created.previewOnly, true, 'preview_only reaches the scheduler');
  assert.equal(created.expectedOutputs?.length, 2, 'expected_outputs reach the scheduler');
  res = await exec({ action: 'update', confirm: true, job_id: createdId, preview_only: false, expected_outputs: [] });
  assert.equal(res.error, false, String(res.result));
  assert.equal((scheduler.getJobs().find((j: any) => j.id === createdId) as any).previewOnly, false);
  res = await exec({ action: 'update', confirm: true, job_id: createdId, schedule: { cron: '77 * * * *' } });
  assert.equal(res.error, true, 'update rejects invalid cron');

  // ── run_now reports rejections instead of "queued" (P3 #12) ───────────────
  const rejecting = {
    getJobs: () => scheduler.getJobs(),
    runJobNow: async () => { throw new Error('Job is already running'); },
  };
  const runRes = await automationCapabilityExecutor.execute({
    name: 'schedule_job', args: { action: 'run_now', job_id: createdId }, sessionId: 'main_session', workspacePath: root,
    deps: { cronScheduler: rejecting },
  } as any);
  assert.equal(runRes.error, true);
  assert.match(String(runRes.result), /already running/);
  assert.doesNotMatch(String(runRes.result), /queued/);

  // ── timers from background agents route to the spawning main chat (P3 #14) ─
  const { resolveBackgroundTimerOwnerSession } = await import('../agents-runtime/capabilities/automation-executor');
  assert.equal(resolveBackgroundTimerOwnerSession('cron_job_1'), null);
  assert.equal(resolveBackgroundTimerOwnerSession('background_bg_missing'), null, 'unknown background id has no owner');

  scheduler.stop?.();
  console.log('sched-task-review regression: ok');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
