import assert from 'node:assert/strict';
import { summarizeRuntimeDiagnostics } from './system-diagnostics.js';

function main(): void {
  const now = Date.parse('2026-09-05T16:30:00.000Z');
  const rows = [
    { id: 'active-1', status: 'running', updatedAt: now - 1_000 },
    { id: 'active-2', status: 'running', updatedAt: now - 2_000 },
    { id: 'hidden-failure', status: 'failed', updatedAt: now - 3_000 },
  ];

  const summary = summarizeRuntimeDiagnostics(rows, now, 2, 'summary');
  assert.equal(summary.count, 3);
  assert.equal(summary.interruptedCount, 1, 'fault counts must cover every observed runtime, not only displayed rows');
  assert.deepEqual(summary.items.map((row) => row.id), ['hidden-failure'], 'a summary must surface a fault even when it falls after the normal display limit');
  assert.equal(summary.items[0]?.ageMs, 3_000);

  const full = summarizeRuntimeDiagnostics(rows, now, 2, 'full');
  assert.deepEqual(full.items.map((row) => row.id), ['active-1', 'active-2'], 'full snapshots retain their existing bounded display order');
  assert.equal(full.interruptedCount, 1, 'full snapshots retain truthful fault counts despite truncation');

  console.log('system diagnostics runtime truth regression: ok');
}

main();
