import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-goal-crash-recovery-'));
const dataDir = path.join(testRoot, 'data');
const workspaceDir = path.join(testRoot, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

process.env.PROMETHEUS_DATA_DIR = dataDir;
process.env.PROMETHEUS_WORKSPACE_DIR = workspaceDir;

const crashSessionId = `goal_crash_contract_${Date.now()}`;
const plannedSessionId = `${crashSessionId}_planned`;
const crashDevEditId = `dev_edit_crash_${Date.now()}`;
const plannedDevEditId = `${crashDevEditId}_planned`;

const childSetup = String.raw`
const goals = require('./dist/gateway/main-chat-goals.js');
const sessions = require('./dist/gateway/session.js');
const approvals = require('./dist/gateway/dev-source-approvals.js');
const runtimes = require('./dist/gateway/live-runtime-registry.js');

const sessionId = process.env.CRASH_SESSION_ID;
const devEditId = process.env.CRASH_DEV_EDIT_ID;
const now = Date.now();
const started = goals.handleMainChatGoalCommand(sessionId, '/goal finish and verify the interrupted source edit');
approvals.upsertDevSourceEditContinuation({
  id: devEditId,
  sessionId,
  status: 'approved',
  completionNoteTag: 'dev_edit_complete',
  allowedFiles: ['src/gateway/example-a.ts', 'src/gateway/example-b.ts'],
  affectedFiles: ['src/gateway/example-a.ts', 'src/gateway/example-b.ts'],
  summary: 'Partial crash-recovery test edit',
  createdAt: now,
  updatedAt: now,
});
goals.recordMainChatGoalTurnPlanProgress(sessionId, {
  source: 'declared',
  activeIndex: 1,
  items: [
    { id: 'inspect', text: 'Inspect current source', status: 'done' },
    { id: 'edit', text: 'Apply the scoped changes', status: 'in_progress' },
    { id: 'verify', text: 'Verify and apply live', status: 'pending' },
  ],
});
const runtimeId = runtimes.registerLiveRuntime({
  kind: 'main_chat_goal',
  label: 'Main chat goal',
  sessionId,
  source: 'goal',
  recoveryPolicy: 'resume',
  recoveryData: { goalId: started.goal.id },
});
runtimes.updateLiveRuntimeCheckpoint(runtimeId, {
  event: 'tool_result',
  toolName: 'prom_workspace_patchset',
  goalId: started.goal.id,
  message: 'First source file changed; verification has not run.',
});
sessions.flushSession(sessionId);
runtimes.markActiveRuntimesInterrupted('gateway_crash');
`;

const child = spawnSync(process.execPath, ['-e', childSetup], {
  cwd: root,
  env: {
    ...process.env,
    CRASH_SESSION_ID: crashSessionId,
    CRASH_DEV_EDIT_ID: crashDevEditId,
  },
  encoding: 'utf8',
  timeout: 20_000,
});
assert.equal(
  child.status,
  0,
  `old gateway fixture process must exit cleanly\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
);

const require = createRequire(import.meta.url);
const recovery = require('../dist/gateway/runtime-recovery.js');
const goals = require('../dist/gateway/main-chat-goals.js');
const sessions = require('../dist/gateway/session.js');
const approvals = require('../dist/gateway/dev-source-approvals.js');
const lifecycle = require('../dist/gateway/lifecycle.js');
const boot = require('../dist/gateway/boot.js');

try {
  const recovered = recovery.recoverInterruptedRuntimes();
  assert.deepEqual(
    recovered.crashRecoveredGoalSessionIds,
    [crashSessionId],
    'an unplanned interrupted goal must return its exact session ID for startup resume',
  );
  assert.ok(recovered.interruptedChats.includes(crashSessionId));

  const crashGoal = sessions.getMainChatGoal(crashSessionId);
  assert.equal(crashGoal?.status, 'restarting');
  assert.equal(crashGoal?.pausedReason, 'gateway_crash');
  assert.equal(crashGoal?.restartCheckpoint?.phase, 'crash_recovered');
  assert.equal(crashGoal?.restartCheckpoint?.devEditId, crashDevEditId);
  assert.match(crashGoal?.nextStepDirective || '', /reread/i);
  assert.match(crashGoal?.nextStepDirective || '', /before the current changes were verified or applied/i);

  const crashContinuation = approvals.getDevSourceEditContinuation(crashDevEditId);
  assert.equal(
    crashContinuation?.status,
    'approved',
    'crash recovery must not complete the pending dev edit or claim it was applied',
  );

  const crashMessages = sessions.getHistory(crashSessionId, 20);
  const crashStatus = crashMessages.find((message) => message.messageKind === 'restart_status');
  assert.ok(crashStatus, 'crash recovery must persist a visible restart status');
  assert.match(crashStatus.content, /not yet verified, applied, or confirmed live/i);
  assert.doesNotMatch(crashStatus.content, /changes are live|restart completed successfully/i);

  assert.deepEqual(
    recovery.consumeCrashRecoveredMainChatGoalSessionIds(),
    [crashSessionId],
    'the startup handoff must expose the recovered goal exactly once',
  );
  assert.deepEqual(
    recovery.consumeCrashRecoveredMainChatGoalSessionIds(),
    [],
    'a second startup consumer must not acquire duplicate ownership',
  );
  const duplicateRecovery = recovery.recoverInterruptedRuntimes();
  assert.equal(duplicateRecovery.inspected, 0, 'a recovered runtime must not be processed twice');
  assert.deepEqual(recovery.consumeCrashRecoveredMainChatGoalSessionIds(), []);

  const plannedStarted = goals.handleMainChatGoalCommand(
    plannedSessionId,
    '/goal verify a planned apply restart',
  );
  const plannedNow = Date.now();
  approvals.upsertDevSourceEditContinuation({
    id: plannedDevEditId,
    sessionId: plannedSessionId,
    status: 'applying_live',
    completionNoteTag: 'dev_edit_complete',
    allowedFiles: ['src/gateway/planned-example.ts'],
    affectedFiles: ['src/gateway/planned-example.ts'],
    summary: 'Verified planned restart fixture',
    lastVerification: {
      profileIds: ['backend_build'],
      changedFiles: ['src/gateway/planned-example.ts'],
      success: true,
      summary: 'backend build passed',
      completedAt: plannedNow,
    },
    createdAt: plannedNow,
    updatedAt: plannedNow,
  });
  goals.recordMainChatGoalInterruptedForRestart(
    plannedSessionId,
    'prom_apply_dev_changes',
    plannedNow,
  );
  sessions.flushSession(plannedSessionId);
  lifecycle.writeRestartContext({
    reason: 'prom_apply_dev_changes',
    title: 'Apply verified source changes',
    summary: 'Approved source changes were built and applied.',
    previousSessionId: plannedSessionId,
    affectedFiles: ['src/gateway/planned-example.ts'],
    devEditContinuation: approvals.getDevSourceEditContinuation(plannedDevEditId),
    createdAt: plannedNow,
  });

  const plannedBoot = await boot.runBootMd(workspaceDir, async () => {
    throw new Error('planned goal restart must not require a model follow-up');
  });
  assert.equal(plannedBoot.status, 'ran');
  assert.deepEqual(plannedBoot.resumableGoalSessionIds, [plannedSessionId]);
  const plannedGoal = sessions.getMainChatGoal(plannedSessionId);
  assert.equal(plannedGoal?.id, plannedStarted.goal.id);
  assert.equal(plannedGoal?.restartCheckpoint?.phase, 'boot_finalized');
  assert.equal(approvals.getDevSourceEditContinuation(plannedDevEditId)?.status, 'complete');
  const plannedStatus = sessions.getHistory(plannedSessionId, 20)
    .find((message) => message.messageKind === 'restart_status');
  assert.match(plannedStatus?.content || '', /changes are live/i);

  const noContextSessionId = `${plannedSessionId}_no_context`;
  goals.handleMainChatGoalCommand(noContextSessionId, '/goal do not claim live without restart context');
  goals.recordMainChatGoalInterruptedForRestart(noContextSessionId, 'prom_apply_dev_changes', Date.now());
  sessions.flushSession(noContextSessionId);
  const noContextBoot = await boot.runBootMd(workspaceDir, async () => ({ text: 'daily boot' }));
  assert.notEqual(noContextBoot.status === 'ran' ? noContextBoot.source : undefined, 'hot_restart');
  assert.equal(
    sessions.getMainChatGoal(noContextSessionId)?.restartCheckpoint?.phase,
    'interrupted',
    'without durable restart context BOOT must not finalize or claim apply success',
  );
  assert.equal(
    sessions.getHistory(noContextSessionId, 20)
      .some((message) => /changes are live/i.test(String(message.content || ''))),
    false,
  );

  const chatHelpers = fs.readFileSync(path.join(root, 'src/gateway/chat/chat-helpers.ts'), 'utf8');
  assert.match(chatHelpers, /const plannedRestartSessionIds = bootResult\?\.status === 'ran'/);
  assert.match(chatHelpers, /const crashRecoveredSessionIds = consumeCrashRecoveredMainChatGoalSessionIds\(\)/);
  assert.match(chatHelpers, /_resumeMainChatGoalsAfterBoot\?\.\(resumableSessionIds\)/);
  assert.doesNotMatch(
    chatHelpers,
    /_resumeMainChatGoalsAfterBoot\?\.\(\s*bootResult\?\.status === 'ran'[\s\S]*?: undefined/,
    'startup must pass an exact empty-or-populated target list instead of triggering a broad goal scan',
  );

  const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
  assert.match(
    mobile,
    /crash_recovered/,
    'mobile goal rendering must explicitly understand crash-recovered state',
  );

  console.log('main-chat goal crash recovery: ok');
} finally {
  lifecycle.clearRestartContext();
  for (const sessionId of [crashSessionId, plannedSessionId, `${plannedSessionId}_no_context`]) {
    sessions.deleteSession(sessionId);
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
}
