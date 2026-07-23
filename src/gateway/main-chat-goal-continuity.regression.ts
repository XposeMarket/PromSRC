import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// This is deliberately source-only: it exercises the durable state handoff
// used by eight planned restarts without starting or reloading a gateway.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-goal-continuity-'));
async function main(): Promise<void> {
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_APP_ROOT = root;

const session = await import('./session');
const goals = await import('./main-chat-goals');
const edits = await import('./dev-source-approvals');
const coding = await import('./coding-context-packet');
const historyReconciliation = await import('./history-reconciliation');

const sessionId = 'mobile_continuity_e2e';
const now = Date.now();
let goal: any = {
  id: 'goal_continuity_e2e', sessionId,
  goal: 'Create captioned Creative video clips and repair the gateway continuity workflow.',
  status: 'active', turnsUsed: 0, goalSummaryTurn: 0, createdAt: now, updatedAt: now,
  progressSummary: 'Initial source edit was verified; remaining acceptance is post-restart verification.',
  requirementsLedger: [{ id: 'initial', text: 'Keep Creative video source-edit context across restarts.', at: now, source: 'initial_goal' }],
  turnPlans: [{ id: 'plan', turnNumber: 1, status: 'in_progress', source: 'declared', activeIndex: 1, startedAt: now, updatedAt: now, steps: [
    { id: 'edit', text: 'Implement source continuity changes', status: 'done' },
    { id: 'apply', text: 'Apply live dev changes and restart', status: 'in_progress' },
    { id: 'verify', text: 'Run post-restart verification', status: 'pending' },
  ] }],
  currentIteration: 1, iterations: [], consecutiveJudgeFailures: 0, consecutiveRuntimeFailures: 0,
};
session.setMainChatGoal(sessionId, goal);
goals.recordMainChatGoalRequirement(sessionId, 'Once workflow is down 110% create a reusable skill.', 'user_message');
goals.recordMainChatGoalRequirement(sessionId, 'Keep the late mobile amendment after compaction.', 'user_message');

// A Creative session may still be a source-edit continuation when the explicit
// fast path is enabled. This is the packet needed after a restart boundary.
coding.resetCodingContextPacketsForTest();
coding.observeCodingContext({
  sessionId,
  objective: goal.goal,
  projectRoot: process.cwd(),
  toolName: 'workspace_read',
  args: { action: 'read', path: 'src/gateway/session.ts', startLine: 1, endLine: 20 },
  result: 'observed source evidence',
  now,
});
const creativePacket = coding.selectCodingContextPacket({
  enabled: true,
  sessionId,
  message: `[Continuing toward active main-chat goal]\nGoal: ${goal.goal}`,
  projectRoot: process.cwd(),
  executionMode: 'interactive',
  creativeMode: 'video',
  allowCreativeCoding: true,
  now: now + 1,
});
assert.equal(creativePacket.status, 'injected');
assert.match(creativePacket.block, /src\/gateway\/session\.ts/);

edits.upsertDevSourceEditContinuation({
  id: 'dev_continuity_e2e', sessionId, status: 'applying_live', completionNoteTag: 'dev_edit_complete',
  allowedFiles: ['src/gateway/session.ts'], affectedFiles: ['src/gateway/session.ts'], changedSurfaces: ['backend'],
  lastVerification: { profileIds: ['backend_build'], changedFiles: ['src/gateway/session.ts'], success: true, summary: 'tsc passed', completedAt: now },
  createdAt: now, updatedAt: now,
});

assert.equal(edits.isCompletedDevSourceEditApply(edits.getDevSourceEditContinuation('dev_continuity_e2e')), false);

for (let restart = 0; restart < 8; restart++) {
  goals.recordMainChatGoalInterruptedForRestart(sessionId, 'prom_apply_dev_changes');
  const interrupted = session.getMainChatGoal(sessionId)!;
  assert.equal(interrupted.restartCheckpoint?.devEditId, 'dev_continuity_e2e');
  const recovered = goals.finalizeMainChatGoalRestartRecovery(sessionId, { devEditId: 'dev_continuity_e2e', verificationSummary: 'tsc passed' })!;
  assert.equal(recovered.turnPlans?.[0]?.steps?.[1]?.status, 'done');
  assert.equal(recovered.turnPlans?.[0]?.steps?.[2]?.status, 'in_progress');
  if (restart === 0) {
    edits.markDevSourceEditContinuationComplete({ id: 'dev_continuity_e2e', tag: 'dev_edit_complete', note: 'restart applied' });
  }
  // The completed edit stays complete for every later restart; the test never
  // rewrites it to applying_live merely to make a checkpoint convenient.
  assert.equal(edits.getDevSourceEditContinuation('dev_continuity_e2e')?.status, 'complete');
  assert.equal(edits.isCompletedDevSourceEditApply(edits.getDevSourceEditContinuation('dev_continuity_e2e')), true);
  const replayedRecovery = goals.finalizeMainChatGoalRestartRecovery(sessionId, { devEditId: 'dev_continuity_e2e', verificationSummary: 'must not duplicate' })!;
  assert.equal(replayedRecovery.progressSummary, recovered.progressSummary, 'replayed boot recovery must not append duplicate progress');
  session.updateMainChatGoal(sessionId, (current) => current ? { ...current, status: 'active' } : current);
}

goal = session.getMainChatGoal(sessionId)!;
const prompt = goals.buildMainChatGoalContinuationPrompt(goal);
assert.match(prompt, /reusable skill/);
assert.match(prompt, /late mobile amendment/);
assert.match(prompt, /LIVE APPLY ALREADY COMPLETED/);
assert.match(prompt, /do not call prom_apply_dev_changes/i);
assert.match(String(goal.progressSummary), /Restart recovered/);
assert.equal((String(goal.progressSummary).match(/Restart recovered at/g) || []).length, 8, 'each planned restart contributes exactly one recovery progress record');
assert.equal(goal.requirementsLedger?.filter((item: any) => /reusable skill/i.test(item.text)).length, 1, 'durable user amendments are recorded exactly once');

const boundarySteps = [
  { text: 'Apply live dev changes and restart' },
  { text: 'Post-restart verification' },
  { text: 'Restart status review' },
];
assert.equal(goals.findMainChatGoalLiveApplyBoundaryStepIndex(boundarySteps), 0);
assert.equal(goals.findMainChatGoalLiveApplyBoundaryStepIndex([{ text: 'Post-restart verification' }]), -1, 'verification is never mistaken for the apply boundary');

const durableServerHistory = [
  { role: 'user', messageId: 'request', content: 'original request', timestamp: now },
  { role: 'assistant', messageId: 'answer', content: 'initial answer', timestamp: now + 1 },
  { role: 'user', messageId: 'late-amendment', content: 'keep the late mobile amendment after compaction', timestamp: now + 2 },
];
const truncatedMobileHistory = [
  { role: 'user', messageId: 'request', content: 'original request', timestamp: now },
  { role: 'assistant', messageId: 'answer', content: 'initial answer', timestamp: now + 1 },
  { role: 'user', messageId: 'new-client-message', content: 'new incoming mobile message', timestamp: now + 3 },
  { role: 'user', messageId: 'new-client-message', content: 'new incoming mobile message', timestamp: now + 3 },
];
const reconciledMobileHistory = historyReconciliation.mergeHistoryWithExistingMessageMetadata(durableServerHistory, truncatedMobileHistory, { preserveAllExisting: true });
assert.equal(reconciledMobileHistory.filter((item: any) => item.messageId === 'late-amendment').length, 1, 'truncated mobile snapshots retain omitted ordinary server amendments');
assert.equal(reconciledMobileHistory.filter((item: any) => item.messageId === 'new-client-message').length, 1, 'new client messages merge once by stable id');

// Stable compaction marker remaps after a mobile-like replacement that inserts
// a later user amendment before the old positional checkpoint.
session.clearHistory(sessionId);
session.addMessage(sessionId, { role: 'user', content: 'original request', timestamp: now });
session.addMessage(sessionId, { role: 'assistant', content: 'work', timestamp: now + 1 });
session.recordSessionCompaction(sessionId, 'rolling', 'summary', 2);
session.replaceHistory(sessionId, [
  { role: 'user', content: 'original request', timestamp: now },
  { role: 'assistant', content: 'work', timestamp: now + 1 },
  { role: 'user', content: 'once workflow is down 110% create a reusable skill', timestamp: now + 2 },
  { role: 'user', content: 'keep the late mobile amendment after compaction', timestamp: now + 3 },
]);
assert.match(session.getHistoryForApiCall(sessionId, 20).map((m) => m.content).join('\n'), /reusable skill/);
const compactedHistory = session.getHistoryForApiCall(sessionId, 20).map((m) => m.content).join('\n');
assert.match(compactedHistory, /late mobile amendment/);
assert.doesNotMatch(compactedHistory, /\[(?:Stopped|Generation stopped|Interrupted) by user\]/i, 'planned restart recovery must not fabricate a generic user interruption checkpoint');

fs.rmSync(root, { recursive: true, force: true });
console.log('main-chat-goal continuity e2e regression: ok');
}

void main().catch((error) => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  throw error;
});
