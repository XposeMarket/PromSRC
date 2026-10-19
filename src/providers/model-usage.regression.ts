import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-model-usage-'));
  process.env.PROMETHEUS_DATA_DIR = root;

  try {
    const usage = await import('./model-usage');
    usage.resetModelUsageIndexForTests();

    usage.appendModelUsageEvent({
      provider: 'test-provider',
      model: 'test-model',
      callType: 'chat',
      sessionId: 'session-a',
      agentId: 'main',
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 120,
      source: 'provider',
      estimatedProviderInputTokens: 100,
    });
    usage.appendModelUsageEvent({
      provider: 'test-provider',
      model: 'test-model',
      callType: 'chat',
      sessionId: 'session-b',
      agentId: 'main',
      inputTokens: 50,
      outputTokens: 10,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 60,
      source: 'provider',
      estimatedProviderInputTokens: 50,
    });

    assert.equal((await usage.readModelUsageEvents()).length, 2);
    assert.equal((await usage.readModelUsageEventsForSession('session-a')).length, 1);
    assert.deepEqual(usage.getUsageCalibration('test-provider', 'test-model'), {
      factor: 1,
      samples: 2,
      source: 'calibrated',
    });

    const logPath = path.join(root, '.prometheus', 'model-usage.jsonl');
    const externalEvent = {
      timestamp: new Date().toISOString(),
      provider: 'test-provider',
      model: 'test-model',
      callType: 'chat',
      sessionId: 'session-a',
      agentId: 'main',
      inputTokens: 200,
      outputTokens: 10,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 210,
      source: 'provider',
      estimatedProviderInputTokens: 100,
    };
    fs.appendFileSync(logPath, `${JSON.stringify(externalEvent)}\n`, 'utf-8');

    assert.equal((await usage.readModelUsageEvents()).length, 3, 'external appends must be consumed from the new byte range');
    assert.equal((await usage.readModelUsageEventsForSession('session-a')).length, 2);
    assert.deepEqual(usage.getUsageCalibration('test-provider', 'test-model'), {
      factor: 1,
      samples: 3,
      source: 'calibrated',
    });

    const cursor = usage.captureModelUsageLogCursor();
    const appendedTurnEvent = {
      ...externalEvent,
      traceId: 'turn-cursor-test',
      sessionId: 'session-a',
      totalTokens: 220,
      inputTokens: 210,
    };
    fs.appendFileSync(logPath, `${JSON.stringify(appendedTurnEvent)}\n`, 'utf-8');
    assert.deepEqual(
      (await usage.readModelUsageEventsSince(cursor, 'session-a')).map((event) => event.traceId),
      ['turn-cursor-test'],
      'cursor reads must return only rows appended after the turn started',
    );
    assert.equal((await usage.readModelUsageEventsSince(cursor, 'session-b')).length, 0);

    const rotatedCursor = usage.captureModelUsageLogCursor();
    fs.writeFileSync(logPath, `${JSON.stringify({ ...appendedTurnEvent, traceId: 'turn-rotated-test' })}\n`, 'utf-8');
    assert.deepEqual(
      (await usage.readModelUsageEventsSince(rotatedCursor, 'session-a', 'turn-rotated-test')).map((event) => event.traceId),
      ['turn-rotated-test'],
      'rotation fallback must remain scoped to the current turn',
    );

    // A small, unrotated ledger must include old rows in lifetime accounting.
    const old = { ...externalEvent, timestamp: new Date(Date.now() - 60 * 86400000).toISOString(), accountId: 'one', totalTokens: 1000, totalCostMicros: 7 };
    const recent = { ...externalEvent, accountId: 'one', totalTokens: 200, totalCostMicros: 3 };
    fs.writeFileSync(logPath, [old, recent, { ...recent, accountId: 'two', totalTokens: 90 }].map(e => JSON.stringify(e) + '\n').join(''));
    const { internalTokens } = await import('./provider-usage-limits');
    const recentRows = await usage.readRecentModelUsageEvents(Date.now() - 35 * 86400000);
    assert.equal(recentRows.length, 2);
    let totals = await usage.readModelUsageLifetimeTotals();
    assert.equal(internalTokens('test-provider', recentRows, 'one', totals).total, 1200);
    assert.equal(internalTokens('test-provider', recentRows, 'one', totals).monthTotal, 200);
    assert.equal(totals.find(t => t.accountId === 'one')?.totalCostMicros, 10);
    fs.appendFileSync(logPath, JSON.stringify(recent) + '\n');
    totals = await usage.readModelUsageLifetimeTotals();
    assert.equal(internalTokens('test-provider', recentRows, 'one', totals).total, 1400);
    assert.equal(totals.find(t => t.accountId === 'one')?.calls, 3);
    fs.writeFileSync(logPath, JSON.stringify(recent) + '\n');
    totals = await usage.readModelUsageLifetimeTotals();
    assert.equal(internalTokens('test-provider', [recent] as any, 'one', totals).total, 200, 'truncation resets lifetime aggregates');
    const firstLine = fs.readFileSync(logPath, 'utf-8').split('\n').find(Boolean) || '';
    fs.writeFileSync(logPath, `${firstLine}\n`, 'utf-8');
    assert.equal((await usage.readModelUsageEvents()).length, 1, 'truncation/rotation must rebuild the in-memory index');
    assert.equal((await usage.readModelUsageEventsForSession('session-b')).length, 0);

    fs.unlinkSync(logPath);
    fs.mkdirSync(logPath);
    await assert.rejects(usage.readModelUsageEvents(), 'read failures must not become zero usage');
    fs.rmdirSync(logPath);
    assert.deepEqual(await usage.readModelUsageEvents(), [], 'missing ledger is normal on fresh installs');
    console.log('model-usage incremental index and lifetime accounting regressions passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
