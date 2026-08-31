import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-tool-observations-'));
  const previousDataRoot = process.env.PROMETHEUS_DATA_DIR;
  process.env.PROMETHEUS_DATA_DIR = dataRoot;

  try {
    const {
      persistToolObservations,
      readToolObservationSnapshot,
    } = await import('./tool-observations.js');

    const sessionId = 'tool_observation_snapshot_regression';
    const observation = (id: string, toolName: string, status: 'ok' | 'error', argsTokens: number, resultTokens: number) => ({
      id,
      sessionId,
      turnId: 'turn-1',
      stepNum: Number(id.replace(/\D/g, '')) || 1,
      toolName,
      category: 'regression',
      status,
      argsPreview: '{}',
      resultPreview: 'result',
      tokenEstimate: {
        argsTokens,
        resultTokens,
        totalTokens: argsTokens + resultTokens,
        argsChars: argsTokens * 4,
        resultChars: resultTokens * 4,
        resultBytes: resultTokens * 8,
      },
      createdAt: Date.now(),
    });

    persistToolObservations(sessionId, [
      observation('obs-1', 'alpha', 'ok', 2, 5),
      observation('obs-2', 'beta', 'error', 3, 11),
      observation('obs-3', 'alpha', 'ok', 1, 4),
    ]);

    // The recent observation window is intentionally smaller than the lifetime
    // aggregate here. This proves the cumulative totals are not capped by the
    // number of observations retained for footprint estimation.
    const first = readToolObservationSnapshot(sessionId, 2);
    assert.equal(first.observations.length, 2);
    assert.equal(first.usage.calls, 3);
    assert.equal(first.usage.successfulCalls, 2);
    assert.equal(first.usage.failedCalls, 1);
    assert.equal(first.usage.argsTokens, 6);
    assert.equal(first.usage.resultTokens, 20);
    assert.equal(first.usage.totalTokens, 26);
    assert.equal(first.usage.tools.find((row) => row.tool === 'alpha')?.calls, 2);
    assert.equal(first.usage.tools.find((row) => row.tool === 'beta')?.totalTokens, 14);

    // Persistence updates the in-memory index incrementally, so the next
    // context refresh sees the new lifetime total without rescanning the file.
    persistToolObservations(sessionId, [observation('obs-4', 'alpha', 'ok', 7, 13)]);
    const second = readToolObservationSnapshot(sessionId, 2);
    assert.equal(second.observations.length, 2);
    assert.equal(second.usage.calls, 4);
    assert.equal(second.usage.argsTokens, 13);
    assert.equal(second.usage.resultTokens, 33);
    assert.equal(second.usage.totalTokens, 46);
    assert.equal(second.usage.tools.find((row) => row.tool === 'alpha')?.calls, 3);

    console.log('tool-observation snapshot regression: ok');
  } finally {
    if (previousDataRoot === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataRoot;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
