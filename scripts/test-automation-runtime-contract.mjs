import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.');
const timerRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/timers/timer-runner.ts'), 'utf8');
const watchRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/internal-watch/internal-watch-runner.ts'), 'utf8');
const cronSource = fs.readFileSync(path.join(root, 'src/gateway/scheduling/cron-scheduler.ts'), 'utf8');

assert.doesNotMatch(timerRunnerSource, /if \(isModelBusy\(\)\)/, 'due timers must dispatch even while a foreground turn is active');
assert.match(watchRunnerSource, /pendingMatchObservation/, 'watch matches must be latched while delivery waits');
assert.match(watchRunnerSource, /refreshInternalWatchObservation/, 'watch inspection must refresh real state even if the poller is unhealthy');
assert.doesNotMatch(watchRunnerSource, /await this\.fire(?:Match|Timeout)\(/, 'one watch delivery must not block observation of every later watch');
assert.match(watchRunnerSource, /candidate\.scheduleId === taskId/, 'task watches may follow a scheduled job id to its linked task');
assert.match(watchRunnerSource, /findArchivedScheduledJob/, 'scheduled-job watches must resolve retained one-shots');
assert.match(watchRunnerSource, /addPendingRuntimeSteerForSession/, 'a watch that completes during an active turn must use the live steer inbox');
assert.match(watchRunnerSource, /steerActiveTurn\(watch, obs, 'match'/, 'matched watches must attempt live in-turn delivery while Prometheus is busy');
assert.match(watchRunnerSource, /deliveryMode: 'live_steer' \| 'follow_up'/, 'watch payloads must support both in-turn steering and post-turn follow-up delivery');
assert.match(watchRunnerSource, /runInteractiveTurn/, 'post-turn watch delivery must still launch a normal Prometheus follow-up turn');
const chatSource = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');
assert.match(chatSource, /liveEventsAppliedBeforeFinal = await injectPendingChatSteers\(\)/, 'finalization must drain watch events that arrive during the provider response');
assert.match(cronSource, /normalizedType === 'one-shot' \? null/, 'one-shot jobs must not expose a cron schedule');
assert.match(cronSource, /archiveCompletedScheduledJob\(job\)/, 'completed one-shots must be retained');
assert.doesNotMatch(cronSource, /getIsModelBusy\?\.\(\)[\s\S]{0,160}deferring scheduled job start/, 'due runAt jobs must not wait for the foreground model');
assert.match(cronSource, /!hasExpectedArtifacts/, 'artifact jobs must not enter generic report synthesis');

const adminSource = fs.readFileSync(path.join(root, 'src/gateway/scheduling/schedule-admin-tools.ts'), 'utf8');
assert.match(adminSource, /lastRunStartedAt/, 'output freshness must use run start rather than completion');

const archive = await import(pathToFileURL(path.join(root, 'dist/gateway/scheduling/schedule-archive.js')).href);
const id = `job_automation_contract_${Date.now()}`;
const fixture = {
  id,
  name: 'Automation contract one-shot',
  prompt: 'fixture',
  type: 'one-shot',
  schedule: null,
  runAt: new Date().toISOString(),
  sessionTarget: 'isolated',
  payloadKind: 'agentTurn',
  enabled: true,
  priority: 0,
  delivery: 'web',
  lastRun: new Date().toISOString(),
  lastResult: 'AUTOMATION_CONTRACT=PASS',
  lastDuration: 1,
  nextRun: null,
  status: 'running',
  lastOutputSessionId: null,
  createdAt: new Date().toISOString(),
};

try {
  archive.archiveCompletedScheduledJob(fixture, 60_000);
  const retained = archive.findArchivedScheduledJob(id);
  assert.equal(retained?.id, id);
  assert.equal(retained?.status, 'completed');
  assert.equal(retained?.schedule, null);
  assert.equal(retained?.lastResult, 'AUTOMATION_CONTRACT=PASS');
} finally {
  archive.deleteArchivedScheduledJob(id);
}

console.log('PASS: timer dispatch, watch latching, and one-shot retention contracts');
