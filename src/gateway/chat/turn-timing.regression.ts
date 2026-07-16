import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTurnTimingRecorder } from './turn-timing';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-turn-timing-'));
  try {
    const logPath = path.join(root, 'turn-timing.log');
    const first = createTurnTimingRecorder('session-a', {
      enabled: true,
      startedAt: Date.now() - 10,
      turnId: 'turn-a',
      phase: 'admission',
      logPath,
    });
    const second = createTurnTimingRecorder('session-b', {
      enabled: true,
      turnId: 'turn-b',
      phase: 'admission',
      logPath,
    });
    first.mark('lease_wait_start');
    second.mark('lease_wait_start');
    first.mark('lease_acquired', { waitMs: 4 });
    second.mark('lease_acquired', { waitMs: 9 });
    await Promise.all([first.flush(), second.flush()]);

    const rows = fs.readFileSync(logPath, 'utf-8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(rows.length, 4);
    assert.deepEqual(new Set(rows.map((row) => row.turnId)), new Set(['turn-a', 'turn-b']));
    assert.ok(rows.every((row) => row.sessionId === (row.turnId === 'turn-a' ? 'session-a' : 'session-b')));
    assert.ok(rows.every((row) => Number.isFinite(row.elapsedMs)));

    const disabledPath = path.join(root, 'disabled.log');
    const disabled = createTurnTimingRecorder('session-disabled', { enabled: false, logPath: disabledPath });
    disabled.mark('must_not_write');
    await disabled.flush();
    assert.equal(fs.existsSync(disabledPath), false, 'disabled telemetry must not touch disk');

    console.log('turn-timing regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
