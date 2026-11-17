/**
 * Main-targeted scheduled agent turns must run isolated (2026-11-17).
 * Before: sessionTarget:'main' ran the job INSIDE getLastMainSessionId(), i.e.
 * whichever chat the user touched last. The job inherited that chat's context
 * (answering with an unrelated status report) and its turn landed in that chat.
 * Run: npx tsx src/gateway/scheduling/schedule-main-target-isolation.regression.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-schedule-main-isolation-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main(): Promise<void> {
  const cron = await import('./cron-scheduler');
  const resolve = cron.resolveScheduledRunSessionId;
  const MAIN = 'mobile_user_last_chat';
  const at = 1794879685139;

  // Agent turn targeted at main: isolated per-run session, never the user's chat.
  const mainAgent = resolve({ id: 'job_a', sessionTarget: 'main', payloadKind: 'agentTurn' }, MAIN, at);
  assert.equal(mainAgent, `cron_job_a_${at}`);
  assert.notEqual(mainAgent, MAIN, 'main-target agent turn must not run in the last-used chat');

  // Isolated agent turn unchanged.
  assert.equal(resolve({ id: 'job_b', sessionTarget: 'isolated', payloadKind: 'agentTurn' }, MAIN, at), `cron_job_b_${at}`);

  // System events targeted at main still inject into the main chat by design.
  assert.equal(resolve({ id: 'job_c', sessionTarget: 'main', payloadKind: 'systemEvent' }, MAIN, at), MAIN);
  assert.equal(resolve({ id: 'job_d', sessionTarget: 'isolated', payloadKind: 'systemEvent' }, MAIN, at), `cron_job_d_${at}`);

  // End to end: a main-target job never calls handleChat with the main session id.
  const seen: string[] = [];
  const storePath = path.join(root, 'cron', 'jobs.json');
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const scheduler = new cron.CronScheduler({
    storePath,
    handleChat: async (_msg: string, sessionId: string) => { seen.push(sessionId); return { type: 'chat', text: 'Reviewed 3: published 1.' }; },
    broadcast: () => {},
    getMainSessionId: () => MAIN,
  } as any);
  const job = scheduler.createJob({ name: 'main-target', prompt: 'do the thing', schedule: '0 9 * * *', tz: 'UTC', sessionTarget: 'main' } as any);
  await scheduler.runJobNow(job.id);
  for (let i = 0; i < 50 && !seen.length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(seen.length > 0, 'handleChat was called');
  assert.ok(seen.every((s) => s !== MAIN), `ran in ${seen.join(',')}, must not be main chat`);
  assert.ok(seen.every((s) => s.startsWith(`cron_${job.id}_`)), 'ran in its own cron session');

  console.log('schedule-main-target-isolation regression: OK');
  scheduler.stop?.();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
