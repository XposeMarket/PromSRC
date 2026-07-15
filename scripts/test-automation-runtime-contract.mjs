import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.');
const timerRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/timers/timer-runner.ts'), 'utf8');
const watchRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/internal-watch/internal-watch-runner.ts'), 'utf8');
const cronSource = fs.readFileSync(path.join(root, 'src/gateway/scheduling/cron-scheduler.ts'), 'utf8');
const backgroundTaskSource = fs.readFileSync(path.join(root, 'src/gateway/tasks/background-task-runner.ts'), 'utf8');

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
assert.doesNotMatch(cronSource, /interruptTaskForSchedule\(/, 'a scheduled job must not interrupt unrelated long-running tasks');
assert.doesNotMatch(cronSource, /interruptedTasksBySchedule/, 'scheduler must not retain cross-task interruption state');
assert.match(cronSource, /!hasExpectedArtifacts/, 'artifact jobs must not enter generic report synthesis');
assert.ok((cronSource.match(/const abortController = new AbortController\(\)/g) || []).length >= 2,
  'cron-owned model turns must own abort controllers for provider/tool I/O');
assert.ok((cronSource.match(/onShutdownInterrupt:\s*\(\) =>/g) || []).length >= 2,
  'each cron-owned model turn must expose a restart-only interruption hook');
assert.match(cronSource, /Scheduled orchestration[\s\S]{0,500}onShutdownInterrupt:[\s\S]{0,260}shutdownState\.interrupted = true/,
  'cron orchestration must fence every assignment path during restart');
assert.match(cronSource, /if \(shutdownState\.interrupted\) \{[\s\S]{0,260}runtime-recovery owns the paused\/checkpointed state[\s\S]{0,260}return;/,
  'cron restart interruption must bypass failure and run-history finalization');
assert.match(cronSource, /await handleManagerConversationDetailed\([\s\S]{0,500}if \(shutdownState\.interrupted\) return;/,
  'team-manager schedules must fence completion after an interrupted manager turn');
assert.match(cronSource, /await runTeamAgentViaChatLazy\([\s\S]{0,320}if \(shutdownState\.interrupted\) return;/,
  'team-member schedules must fence completion after an interrupted agent turn');
const cronHistoryIndex = cronSource.indexOf('this.appendRunHistory(job.id');
const cronStoreCommitIndex = cronSource.indexOf('this.saveStore();', cronHistoryIndex);
const deferredReviewIndex = cronSource.indexOf('void triggerManagerReview(deferredManagerReviewTeamId');
assert.ok(
  cronHistoryIndex >= 0 && cronStoreCommitIndex > cronHistoryIndex && deferredReviewIndex > cronStoreCommitIndex,
  'ancillary manager review must start only after cron history and store persistence',
);
assert.match(backgroundTaskSource, /const abortController = new AbortController\(\)[\s\S]{0,900}onShutdownInterrupt:/,
  'durable background tasks must own restart-cancellable provider/tool I/O');
assert.match(backgroundTaskSource, /if \(roundOutcome\.interrupted \|\| abortSignal\.interrupted\)[\s\S]{0,260}return;/,
  'background restart interruption must bypass needs-assistance finalization');
assert.match(backgroundTaskSource, /if \(abortSignal\.interrupted\) \{[\s\S]{0,180}_persistResumeContextSnapshot/,
  'background restart interruption must retain resumable session context');

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
