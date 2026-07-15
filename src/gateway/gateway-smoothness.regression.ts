import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

function tickCounter(intervalMs = 1): { read: () => number; stop: () => void } {
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, intervalMs);
  return {
    read: () => ticks,
    stop: () => clearInterval(timer),
  };
}

async function main(): Promise<void> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prometheus-gateway-smoothness-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
  process.env.PROMETHEUS_TOOL_OBSERVATION_WORKERS = '1';

  const configDir = path.join(root, '.prometheus');
  const cooperativePath = path.join(root, 'cooperative', 'state.json');
  const cooperativeValue = {
    text: `${'a'.repeat(65_535)}\ud83d\ude80${'b'.repeat(700_000)}\n\"\\`,
    array: [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, true, 'done'],
    omitted: undefined,
    date: new Date('2026-07-15T12:00:00.000Z'),
    nested: { alpha: 1, beta: ['x', { y: 'z' }] },
  };

  const { writeJsonAtomicCooperatively } = await import('./storage/cooperative-json.js');
  const cooperativeTicks = tickCounter();
  await writeJsonAtomicCooperatively(cooperativePath, cooperativeValue, { spaces: 2, flushChars: 32 * 1024 });
  cooperativeTicks.stop();
  const cooperativeText = await fs.promises.readFile(cooperativePath, 'utf8');
  assert.equal(cooperativeText, JSON.stringify(cooperativeValue, null, 2), 'cooperative serializer must match JSON.stringify');
  assert.ok(cooperativeTicks.read() > 0, 'cooperative serialization should yield to the gateway event loop');
  await writeJsonAtomicCooperatively(cooperativePath, { replaced: true }, { spaces: 2 });
  assert.deepEqual(JSON.parse(await fs.promises.readFile(cooperativePath, 'utf8')), { replaced: true }, 'atomic writer must replace existing files');
  await assert.rejects(
    () => writeJsonAtomicCooperatively(cooperativePath, { tooLarge: 'x'.repeat(128 * 1024) }, { maxBytes: 4_096 }),
    /exceeded its 4096-byte limit/,
  );
  assert.deepEqual(JSON.parse(await fs.promises.readFile(cooperativePath, 'utf8')), { replaced: true }, 'rejected bounded write must preserve the prior target');

  const sessionId = 'mobile_gateway_smoothness';
  const sessionModule = await import('./session.js');
  const session = sessionModule.getSession(sessionId);
  session.history = Array.from({ length: 80 }, (_value, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `${index}: ${'session-payload '.repeat(8_192)}`,
    timestamp: Date.now() + index,
  }));
  const persistenceTicks = tickCounter();
  const firstFlush = sessionModule.flushSessionAsync(sessionId);
  await new Promise<void>((resolve) => setImmediate(resolve));
  session.history.push({ role: 'assistant', content: 'mutation-after-flush-start', timestamp: Date.now() + 1000 });
  const secondFlush = sessionModule.flushSessionAsync(sessionId);
  await Promise.all([firstFlush, secondFlush]);
  persistenceTicks.stop();
  const persistedSession = JSON.parse(await fs.promises.readFile(path.join(configDir, 'sessions', `${sessionId}.json`), 'utf8'));
  assert.equal(persistedSession.history.at(-1)?.content, 'mutation-after-flush-start', 'generation fence must retain overlapping mutations');
  assert.ok(persistenceTicks.read() >= 2, `large session persistence should remain cooperative (ticks=${persistenceTicks.read()})`);
  session.history.push({
    messageId: 'deferred-observation-target',
    role: 'assistant',
    content: 'final response',
    timestamp: Date.now() + 1100,
  });
  await sessionModule.flushSessionAsync(sessionId);
  assert.equal(await sessionModule.attachAssistantToolObservationMetadataAsync(
    sessionId,
    'deferred-observation-target',
    '[TOOL_STATE_SUMMARY]\ndeferred: attached',
    { resultTokens: 12 },
  ), true);
  const deferredSession = JSON.parse(await fs.promises.readFile(path.join(configDir, 'sessions', `${sessionId}.json`), 'utf8'));
  assert.match(deferredSession.history.at(-1)?.toolLog || '', /deferred: attached/);

  const observationModule = await import('./tool-observations.js');
  const observationClient = await import('./tool-observation-persistence-client.js');
  const observationTicks = tickCounter();
  const observationResult = await observationModule.persistToolResultsAsObservationsAsync(sessionId, 'turn-large-result', [{
    stepNum: 1,
    name: 'read_file',
    args: { path: 'large-result.txt' },
    result: 'large-observation-result\n'.repeat(400_000),
  }]);
  observationTicks.stop();
  assert.equal(observationResult.observations.length, 1);
  assert.ok(observationResult.observations[0].resultRawRef, 'large tool result should be moved to raw observation storage');
  assert.ok(observationResult.toolLogText.includes('read_file'), 'worker should return the bounded tool-state summary');
  const observationStatus = observationClient.getToolObservationPersistenceStatus();
  assert.notEqual(observationStatus.workers[0]?.pid, process.pid, 'tool observation persistence must run in a child process');
  assert.ok(observationTicks.read() > 0, 'gateway event loop should tick while a large observation is persisted');

  const observationPath = path.join(configDir, 'tool-observations', `${sessionId}.jsonl`);
  const tailRecords = Array.from({ length: 240 }, (_value, index) => ({
    id: `tail-${index}`,
    sessionId,
    turnId: `tail-turn-${Math.floor(index / 4)}`,
    stepNum: index,
    toolName: 'tail_test',
    category: 'other',
    status: 'ok',
    argsPreview: '',
    resultPreview: `record-${index}-${'q'.repeat(4_096)}`,
    createdAt: Date.now() + index,
  }));
  await fs.promises.appendFile(observationPath, `${tailRecords.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  const syncTail = observationModule.readToolObservations(sessionId, 73);
  const asyncTail = await observationModule.readToolObservationsAsync(sessionId, 73);
  assert.deepEqual(asyncTail, syncTail, 'async backwards reader must preserve the exact last-N observation semantics');

  const footprintClient = await import('./context-window/context-footprint-client.js');
  const footprintCalculator = await import('./context-window/stored-thread-footprint.js');
  const footprintTicks = tickCounter();
  const isolatedFootprint = await footprintClient.calculateStoredThreadFootprintIsolated(sessionId, session, 'heuristic');
  footprintTicks.stop();
  const directFootprint = footprintCalculator.calculateStoredThreadFootprint({
    sessionId,
    session,
    configDir,
    tokenizer: 'heuristic',
  });
  assert.deepEqual(isolatedFootprint, directFootprint, 'child context calculation must match the previous exact calculation');
  assert.notEqual(footprintClient.getContextFootprintWorkerStatus().broker.pid, process.pid, 'context footprint must run in a child process');
  assert.ok(footprintTicks.read() > 0, 'gateway event loop should tick during isolated context calculation');

  session.history.push({ role: 'assistant', content: 'delete-race '.repeat(500_000), timestamp: Date.now() + 2000 });
  const racingFlush = sessionModule.flushSessionAsync(sessionId);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(sessionModule.deleteSession(sessionId), true);
  await racingFlush;
  assert.equal(fs.existsSync(path.join(configDir, 'sessions', `${sessionId}.json`)), false, 'in-flight persistence must not resurrect a deleted session');

  await Promise.allSettled([
    footprintClient.shutdownContextFootprintWorker(),
    observationClient.shutdownToolObservationPersistence(),
    sessionModule.shutdownSessionPersistence(),
  ]);
  await fs.promises.rm(root, { recursive: true, force: true });
}

main().then(() => {
  console.log('gateway smoothness regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
