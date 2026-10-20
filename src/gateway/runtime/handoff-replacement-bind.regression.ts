import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import {
  closeListeningHandle,
  listenWithHandoffRetry,
  runtimeBelongsToLiveHandoffHost,
  shouldExitOnGatewayListenerError,
  HANDOFF_BIND_RETRY_WINDOW_MS,
} from './handoff-replacement-bind';

async function testPersistentListener(hotRestart: boolean): Promise<void> {
  const blocker = createServer();
  const replacement = createServer();
  let exitCalls = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  replacement.on('error', (err: NodeJS.ErrnoException) => {
    if (shouldExitOnGatewayListenerError(err, { hotRestart, listening: replacement.listening })) exitCalls += 1;
  });
  const close = (server: Server): Promise<void> => new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', resolve);
    });
    const address = blocker.address();
    assert.ok(address && typeof address !== 'string');
    releaseTimer = setTimeout(() => { blocker.close(); }, 200);
    await listenWithHandoffRetry(() => new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        replacement.off('listening', onListening);
        replacement.off('error', onError);
      };
      const onListening = (): void => { cleanup(); resolve(); };
      const onError = (error: NodeJS.ErrnoException): void => { cleanup(); reject(error); };
      replacement.once('listening', onListening);
      replacement.once('error', onError);
      try { replacement.listen(address.port, '127.0.0.1'); } catch (error) { cleanup(); reject(error); }
    }), { enabled: true, maxWaitMs: 5_000, initialDelayMs: 50 });
    assert.equal(replacement.listening, true, 'replacement must bind after the blocker releases');
    if (hotRestart) assert.equal(exitCalls, 0, 'persistent listener must not exit during warm-handoff retries');
    else assert.ok(exitCalls > 0, 'ordinary-start persistent listener must retain its exit behavior');
  } finally {
    clearTimeout(releaseTimer);
    await Promise.all([close(replacement), close(blocker)]);
  }
}

async function main(): Promise<void> {
  const occupied = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
  assert.equal(shouldExitOnGatewayListenerError(occupied, { hotRestart: true, listening: false }), false);
  assert.equal(shouldExitOnGatewayListenerError(occupied, { hotRestart: false, listening: false }), true);
  assert.equal(shouldExitOnGatewayListenerError(occupied, { hotRestart: true, listening: true }), true);
  assert.equal(shouldExitOnGatewayListenerError(Object.assign(new Error('denied'), { code: 'EACCES' }), { hotRestart: true, listening: false }), true);
  assert.equal(shouldExitOnGatewayListenerError(null, { hotRestart: true, listening: false }), true);
  assert.equal(shouldExitOnGatewayListenerError(undefined, { hotRestart: true, listening: false }), true);
  await testPersistentListener(true);
  await testPersistentListener(false);

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
