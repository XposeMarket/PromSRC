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

    assert.equal(usage.readModelUsageEvents().length, 2);
    assert.equal(usage.readModelUsageEventsForSession('session-a').length, 1);
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

    assert.equal(usage.readModelUsageEvents().length, 3, 'external appends must be consumed from the new byte range');
    assert.equal(usage.readModelUsageEventsForSession('session-a').length, 2);
    assert.deepEqual(usage.getUsageCalibration('test-provider', 'test-model'), {
      factor: 1,
      samples: 3,
      source: 'calibrated',
    });

    const firstLine = fs.readFileSync(logPath, 'utf-8').split('\n').find(Boolean) || '';
    fs.writeFileSync(logPath, `${firstLine}\n`, 'utf-8');
    assert.equal(usage.readModelUsageEvents().length, 1, 'truncation/rotation must rebuild the in-memory index');
    assert.equal(usage.readModelUsageEventsForSession('session-b').length, 0);

    console.log('model-usage incremental index regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
