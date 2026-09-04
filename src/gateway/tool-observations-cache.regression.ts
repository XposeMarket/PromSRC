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

    console.log('tool observation cache regression: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main();
