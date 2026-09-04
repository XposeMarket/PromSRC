import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-tool-observation-cache-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

  try {
    const { getConfig } = await import('../config/config');
    const observations = await import('./tool-observations');
    const observationRoot = path.join(getConfig().getConfigDir(), 'tool-observations');
    fs.mkdirSync(observationRoot, { recursive: true });

    const firstObservation = {
      id: 'observation-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      stepNum: 1,
      toolName: 'read_file',
      category: 'file',
      status: 'ok' as const,
      argsPreview: '{}',
      resultPreview: 'ok',
      createdAt: 1_700_000_000_000,
    };
    fs.writeFileSync(
      path.join(observationRoot, 'session-1.jsonl'),
      `${JSON.stringify(firstObservation)}\n`,
      'utf8',
    );

    const firstRead = observations.readAllToolObservations(100);
    const secondRead = observations.readAllToolObservations(100);
    assert.deepEqual(secondRead, firstRead, 'repeat reads should reuse the same snapshot contents');

    const firstSessionSnapshot = observations.readToolObservationSnapshot('session-1', 1, 'heuristic');
    assert.equal(firstSessionSnapshot.observations.length, 1);
    assert.equal(firstSessionSnapshot.usage.calls, 1, 'session snapshots must expose lifetime call totals');
    assert.ok(firstSessionSnapshot.storedObservationTokens > 0, 'session snapshots must expose stored observation footprint');

    const secondObservation = {
      ...firstObservation,
      id: 'observation-2',
      turnId: 'turn-2',
      stepNum: 2,
      toolName: 'write_file',
      createdAt: 1_700_000_000_001,
    };
    observations.persistToolObservations('session-1', [secondObservation]);
    const afterWrite = observations.readAllToolObservations(100);
    assert.equal(afterWrite.length, 2, 'a local append must invalidate the snapshot');
    assert.equal(afterWrite.at(-1)?.id, 'observation-2');

    const afterSessionWrite = observations.readToolObservationSnapshot('session-1', 1, 'heuristic');
    assert.equal(afterSessionWrite.observations.length, 1, 'recent observations must honor the requested bound');
    assert.equal(afterSessionWrite.observations.at(-1)?.id, 'observation-2');
    assert.equal(afterSessionWrite.usage.calls, 2, 'local appends must update lifetime totals');
    observations.clearToolObservationSnapshotCache('session-1');

    const boundedRows = Array.from({ length: 600 }, (_, index) => ({
      ...firstObservation,
      id: `bounded-${index}`,
      stepNum: index + 1,
      createdAt: firstObservation.createdAt + index,
    }));
    fs.writeFileSync(
      path.join(observationRoot, 'session-2.jsonl'),
      `${boundedRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      'utf8',
    );
    const boundedSnapshot = observations.readToolObservationSnapshot('session-2', 12, 'heuristic');
    assert.equal(boundedSnapshot.observations.length, 12, 'recent snapshot retention must stay bounded');
    assert.equal(boundedSnapshot.usage.calls, 600, 'bounded snapshots must retain exact lifetime totals');
    assert.ok(observations.getToolObservationCacheStatus().recentObservationCount <= 512, 'cache must cap retained recent observations');

    console.log('tool observation cache regression: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main();
