import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverStrandedMainChatTimers, type MainChatTimer } from './timers/timer-store.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-timer-stranded-'));
try {
  const bootAt = Date.parse('2026-10-14T12:00:00.000Z');
  const statePath = path.join(tempRoot, 'timers.json');
  const state: { timers: MainChatTimer[] } = { timers: [
    { id: 'past', sessionId: 's', label: 'past', instruction: 'run', dueAt: '2026-10-14T11:00:00.000Z', status: 'running', createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:30:00.000Z', firedAt: '2026-10-14T10:30:00.000Z' },
    { id: 'future', sessionId: 's', label: 'future', instruction: 'run', dueAt: '2026-10-14T13:00:00.000Z', status: 'running', createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:30:00.000Z', firedAt: '2026-10-14T10:30:00.000Z' },
  ] };
  fs.writeFileSync(statePath, JSON.stringify(state));
  const isolated = JSON.parse(fs.readFileSync(statePath, 'utf8')) as typeof state;
  assert.equal(recoverStrandedMainChatTimers(isolated.timers, bootAt), true);
  assert.equal(isolated.timers[0].status, 'due_waiting');
  assert.equal(isolated.timers[1].status, 'pending');
  assert.equal(isolated.timers[0].firedAt, undefined);
  assert.match(isolated.timers[0].error || '', /Recovered after the process/);
  console.log('timer-stranded regression: 5 passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
