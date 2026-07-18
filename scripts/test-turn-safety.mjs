import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { classifyCommandTermination } = require(path.join(root, 'dist', 'gateway', 'process', 'command-outcome.js'));
const { decideTurnAdmission, SessionTurnCoordinator } = require(path.join(root, 'dist', 'gateway', 'chat', 'turn-coordinator.js'));
const { ProcessRunStore } = require(path.join(root, 'dist', 'gateway', 'process', 'store.js'));
const { ProcessSupervisor } = require(path.join(root, 'dist', 'gateway', 'process', 'supervisor.js'));

assert.deepEqual(classifyCommandTermination({ code: 0, reason: 'exit' }), { ok: true, reason: 'exit', label: 'exit 0' });
assert.equal(classifyCommandTermination({ code: 7, reason: 'exit' }).ok, false);
assert.deepEqual(classifyCommandTermination({ code: 0, timedOut: true, reason: 'overall_timeout' }), { ok: false, reason: 'overall_timeout', label: 'TIMED OUT' });
assert.equal(classifyCommandTermination({ code: 0, reason: 'no_output_timeout' }).label, 'NO OUTPUT TIMEOUT');
assert.equal(classifyCommandTermination({ code: 0, reason: 'signal', signal: 'SIGTERM' }).ok, false);
assert.equal(classifyCommandTermination({ code: 0, reason: 'spawn_error' }).ok, false);
assert.equal(classifyCommandTermination({ code: 0, reason: 'manual_cancel' }).ok, false);
assert.equal(classifyCommandTermination({ code: null }).ok, false);

const processFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-turn-safety-'));
try {
  const supervisor = new ProcessSupervisor(new ProcessRunStore(processFixture));
  const successRun = await supervisor.spawn({
    command: `node -e "console.log('ok')"`,
    cwd: root,
    mode: 'foreground',
    timeoutMs: 10_000,
    captureOutput: true,
  });
  const successExit = await successRun.wait();
  assert.equal(classifyCommandTermination({ code: successExit.exitCode, timedOut: successExit.timedOut, reason: successExit.reason, signal: successExit.exitSignal }).ok, true);

  const failedRun = await supervisor.spawn({
    command: `node -e "process.exit(7)"`,
    cwd: root,
    mode: 'foreground',
    timeoutMs: 10_000,
    captureOutput: true,
  });
  const failedExit = await failedRun.wait();
  assert.notEqual(failedExit.exitCode, 0);
  assert.equal(classifyCommandTermination({ code: failedExit.exitCode, timedOut: failedExit.timedOut, reason: failedExit.reason, signal: failedExit.exitSignal }).ok, false);

  const timeoutRun = await supervisor.spawn({
    command: `node -e "setTimeout(() => {}, 5000)"`,
    cwd: root,
    mode: 'foreground',
    timeoutMs: 250,
    captureOutput: true,
  });
  const timeoutExit = await timeoutRun.wait();
  assert.equal(timeoutExit.reason, 'overall_timeout');
  assert.equal(timeoutExit.timedOut, true);
  assert.equal(classifyCommandTermination({ code: timeoutExit.exitCode, timedOut: timeoutExit.timedOut, reason: timeoutExit.reason, signal: timeoutExit.exitSignal }).ok, false);
  const timeoutRecord = supervisor.get(timeoutRun.runId);
  assert.equal(timeoutRecord?.completionSummary, undefined);
  assert.ok(timeoutRecord?.failureSummary, 'timed-out process must persist a failure summary');

  const cancelledRun = await supervisor.spawn({
    command: `node -e "setTimeout(() => {}, 5000)"`,
    cwd: root,
    mode: 'foreground',
    captureOutput: true,
  });
  cancelledRun.cancel('manual_cancel');
  const cancelledExit = await cancelledRun.wait();
  assert.equal(cancelledExit.reason, 'manual_cancel');
  assert.equal(classifyCommandTermination({ code: cancelledExit.exitCode, reason: cancelledExit.reason, signal: cancelledExit.exitSignal }).ok, false);
} finally {
  fs.rmSync(processFixture, { recursive: true, force: true });
}

assert.deepEqual(decideTurnAdmission({ active: false, fingerprint: 'a' }), { kind: 'new' });
assert.deepEqual(decideTurnAdmission({ active: true, activeStreamId: 'stream-a', fingerprint: 'a' }), { kind: 'busy', streamId: 'stream-a' });
assert.deepEqual(decideTurnAdmission({
  active: true,
  clientRequestId: 'request-a',
  fingerprint: 'same',
  previous: { streamId: 'stream-a', fingerprint: 'same' },
}), { kind: 'duplicate', streamId: 'stream-a' });
assert.deepEqual(decideTurnAdmission({
  active: false,
  clientRequestId: 'request-a',
  fingerprint: 'changed',
  previous: { streamId: 'stream-a', fingerprint: 'original' },
}), { kind: 'idempotency_conflict', streamId: 'stream-a' });

const coordinator = new SessionTurnCoordinator();
const atomicFirst = coordinator.tryAcquire('atomic-admission');
assert.ok(atomicFirst, 'the first concurrent admission must claim the session');
assert.equal(coordinator.tryAcquire('atomic-admission'), null, 'a concurrent admission must not create a second active turn');
coordinator.release(atomicFirst);
const first = await coordinator.acquire('same-session');
let secondResolved = false;
const secondPromise = coordinator.acquire('same-session').then((lease) => {
  secondResolved = true;
  return lease;
});
await Promise.resolve();
assert.equal(secondResolved, false, 'same-session turns must queue');
const other = await coordinator.acquire('other-session');
assert.equal(coordinator.isActive('other-session'), true, 'different sessions may run concurrently');
assert.equal(coordinator.release({ ...first, leaseId: 'wrong-owner' }), false, 'only the current lease can release a session');
assert.equal(coordinator.release(first), true);
const second = await secondPromise;
assert.equal(secondResolved, true);
assert.equal(second.sessionId, 'same-session');
coordinator.release(second);
coordinator.release(other);

const held = await coordinator.acquire('abort-session');
const abortController = new AbortController();
const abortedWaiter = coordinator.acquire('abort-session', abortController.signal);
abortController.abort();
await assert.rejects(abortedWaiter, (error) => error?.name === 'AbortError');
coordinator.release(held);
assert.equal(coordinator.isActive('abort-session'), false);

const orphaned = await coordinator.acquire('reconcile-session');
const abandonedWaiter = coordinator.acquire('reconcile-session');
assert.equal(coordinator.discard('reconcile-session'), true, 'an orphaned lease must be discardable as one unit');
await assert.rejects(abandonedWaiter, (error) => error?.name === 'TurnDiscardedError');
assert.equal(coordinator.isActive('reconcile-session'), false, 'reconciliation must not promote an abandoned queued request');
assert.equal(coordinator.release(orphaned), false, 'a discarded lease cannot release a later turn');

const executorSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'agents-runtime', 'subagent-executor.ts'), 'utf8');
assert.doesNotMatch(executorSource, /captured\.code !== 0 && !captured\.timedOut/);
assert.match(executorSource, /classifyCommandTermination\(captured\)/);

const routeSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'routes', 'chat.router.ts'), 'utf8');
assert.match(routeSource, /code: 'SESSION_TURN_ACTIVE'/);
assert.match(routeSource, /code: 'IDEMPOTENCY_KEY_REUSED'/);
assert.match(routeSource, /mainChatTurnCoordinator\.acquire\(sessionId, abortSignal\?\.signal\)/);
assert.match(routeSource, /const admissionLease = mainChatTurnCoordinator\.tryAcquire\(resolvedSessionId\)/, 'HTTP admission must acquire before opening a stream');
assert.match(routeSource, /reconcileMainChatTurn\(resolvedSessionId\)/, 'HTTP admission must reconcile orphaned stream/lease state');
assert.match(routeSource, /preAcquiredTurnLease: admissionLease/, 'the admitted lease must remain owned by the HTTP lifecycle');
assert.doesNotMatch(routeSource, /mobileChatRequestDedupe/);

console.log('Command outcome and per-session turn safety regression tests passed.');
