import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-chat-retrigger-'));
const dataDir = path.join(testRoot, 'data');
const workspaceDir = path.join(testRoot, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

process.env.PROMETHEUS_DATA_DIR = dataDir;
process.env.PROMETHEUS_WORKSPACE_DIR = workspaceDir;
const unexpectedSessionId = `restart_retrigger_${Date.now()}`;
const plannedSessionId = `${unexpectedSessionId}_planned`;

const fixture = String.raw`
const sessions = require('./dist/gateway/session.js');
const runtimes = require('./dist/gateway/live-runtime-registry.js');

function register(sessionId, message, plannedTool) {
  sessions.addMessage(sessionId, { role: 'user', content: message, timestamp: Date.now(), channel: 'mobile' });
  const id = runtimes.registerLiveRuntime({
    kind: 'main_chat',
    label: 'Main chat',
    sessionId,
    source: 'mobile',
    clientRequestId: sessionId + '_request',
    recoveryPolicy: 'mark_interrupted',
    recoveryData: {
      message,
      origin: { channel: 'mobile', surface: 'mobile_app', device: 'phone' },
    },
  });
  runtimes.updateLiveRuntimeCheckpoint(id, {
    event: plannedTool ? 'tool_call' : 'heartbeat',
    toolName: plannedTool,
    message: plannedTool ? 'Restart tool accepted.' : 'Visible response had started.',
  });
  sessions.flushSession(sessionId);
}

register(process.env.UNEXPECTED_SESSION_ID, 'finish the interrupted foreground work', undefined);
register(process.env.PLANNED_SESSION_ID, 'restart the gateway', 'gateway_restart');
`;

const child = spawnSync(process.execPath, ['-e', fixture], {
  cwd: root,
  env: { ...process.env, UNEXPECTED_SESSION_ID: unexpectedSessionId, PLANNED_SESSION_ID: plannedSessionId },
  encoding: 'utf8',
  timeout: 20_000,
});
assert.equal(child.status, 0, `fixture failed\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);

const require = createRequire(import.meta.url);
const recovery = require('../dist/gateway/runtime-recovery.js');
const sessions = require('../dist/gateway/session.js');

const chatSource = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');
const recoverySource = fs.readFileSync(path.join(root, 'src/gateway/runtime-recovery.ts'), 'utf8');
assert.match(chatSource, /export function retriggerInterruptedMainChat\(/);
assert.match(chatSource, /syntheticRestartRecovery: true, preAcquiredTurnLease: admissionLease/);
assert.match(
  chatSource,
  /isGoalContinuationTurn \|\| isSyntheticSubagentCompletionTurn \|\| isSyntheticThreadSupervisionReview \|\| isSyntheticInternalWatch \|\| isSyntheticRestartRecovery/,
  'the retrigger must not persist the already-durable user message a second time',
);
assert.match(
  recoverySource,
  /runtime\.recoveryPolicy === 'resume'/,
  'restart-safe background tasks and subagent threads should resume without a global opt-in',
);

try {
  const attempts = [];
  const result = recovery.recoverInterruptedRuntimes({
    retriggerInterruptedMainChat: (runtime) => {
      attempts.push({ id: runtime.id, sessionId: runtime.sessionId, message: runtime.recoveryData?.message });
      return true;
    },
  });

  assert.deepEqual(result.retriggeredChats, [unexpectedSessionId]);
  assert.equal(attempts.length, 1, 'only an unexpected foreground turn should be retriggered');
  assert.equal(attempts[0].sessionId, unexpectedSessionId);
  assert.equal(attempts[0].message, 'finish the interrupted foreground work');
  assert.ok(result.interruptedChats.includes(plannedSessionId), 'planned restarts still preserve a checkpoint');

  const unexpectedCheckpoint = sessions.getHistory(unexpectedSessionId, 10).find((entry) =>
    entry.role === 'assistant' && /^\[Interrupted by gateway restart\]/.test(String(entry.content || ''))
  );
  assert.ok(unexpectedCheckpoint, 'recovery must preserve a visible interruption checkpoint');
  assert.match(unexpectedCheckpoint.content, /automatically continue this turn/i);

  const duplicate = recovery.recoverInterruptedRuntimes({ retriggerInterruptedMainChat: () => true });
  assert.equal(duplicate.inspected, 0, 'a recovered runtime must never be retriggered twice');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

console.log('main-chat restart retrigger regression passed');
