import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  closeListeningHandle,
  listenWithHandoffRetry,
  runtimeBelongsToLiveHandoffHost,
  HANDOFF_BIND_RETRY_WINDOW_MS,
} from './handoff-replacement-bind';

async function main(): Promise<void> {
  let attempts = 0;
  const delays: number[] = [];
  await listenWithHandoffRetry(async () => {
    attempts += 1;
    if (attempts < 4) throw Object.assign(new Error('still bound'), { code: 'EADDRINUSE' });
  }, {
    enabled: true,
    maxWaitMs: 5_000,
    initialDelayMs: 100,
    sleep: async (ms) => { delays.push(ms); },
  });
  assert.equal(attempts, 4, 'handoff bind should retry EADDRINUSE until the predecessor releases its port');
  assert.deepEqual(delays, [100, 200, 400]);

  let ordinaryAttempts = 0;
  await assert.rejects(listenWithHandoffRetry(async () => {
    ordinaryAttempts += 1;
    throw Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
  }, { enabled: false }));
  assert.equal(ordinaryAttempts, 1, 'non-handoff binds must remain fail-fast');
  assert.ok(
    HANDOFF_BIND_RETRY_WINDOW_MS >= 30_000 && HANDOFF_BIND_RETRY_WINDOW_MS <= 45_000,
    'handoff retry window must cover a slow replacement handoff without becoming unbounded',
  );

  let elapsedMs = 0;
  let deadlineAttempts = 0;
  await assert.rejects(listenWithHandoffRetry(async () => {
    deadlineAttempts += 1;
    throw Object.assign(new Error('still occupied'), { code: 'EADDRINUSE' });
  }, {
    enabled: true,
    maxWaitMs: 250,
    initialDelayMs: 200,
    now: () => elapsedMs,
    sleep: async (ms) => { elapsedMs += ms; },
  }));
  assert.equal(deadlineAttempts, 3, 'handoff retry must stop at its bounded deadline');
  assert.equal(elapsedMs, 250, 'last handoff retry sleep must be capped by the remaining deadline');

  class FakeListener extends EventEmitter {
    listening = true;
    close(): this {
      setTimeout(() => { this.listening = false; this.emit('close'); }, 15);
      return this;
    }
  }
  const listener = new FakeListener();
  const closeStartedAt = Date.now();
  await closeListeningHandle(listener as unknown as Parameters<typeof closeListeningHandle>[0], 250);
  assert.equal(listener.listening, false, 'close must wait until the listening handle releases');
  assert.ok(Date.now() - closeStartedAt >= 10, 'close promise must not resolve synchronously after server.close()');

  assert.equal(runtimeBelongsToLiveHandoffHost({ pid: 51612, status: 'running' }, 51612, 64288, (pid) => pid === 51612), true);
  assert.equal(runtimeBelongsToLiveHandoffHost({ pid: 51612, status: 'running' }, 51612, 64288, () => false), false);
  assert.equal(runtimeBelongsToLiveHandoffHost({ pid: 51612, status: 'interrupted' }, 51612, 64288, () => true), false);
  console.log('handoff replacement bind regression: passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
