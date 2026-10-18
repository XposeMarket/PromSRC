import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-usage-history-'));
const log = path.join(tmp, 'model-usage.jsonl');
const row = (timestamp: string, id: string) => JSON.stringify({ timestamp, provider: 'test', model: 'm', totalTokens: 1, id });

async function main(): Promise<void> {
  const mod: any = await import('./model-usage-history');
  const { enqueueModelUsageAppend, readModelUsageHistory, rotateModelUsageLog } = mod;
  const oldA = row('2026-01-11T12:00:00.000Z', 'old-a');
  const oldB = row('2026-02-13T12:00:00.000Z', 'old-b');
  const recent = row('2026-10-15T12:00:00.000Z', 'recent');
  const malformed = '{not json}';
  const partial = '{"timestamp":"2026-01-01T00:00:00.000Z","id":"partial"';
  fs.writeFileSync(log, [oldA, oldB, recent, malformed].join('\n') + '\n' + partial, 'utf8');

  const rotated = await rotateModelUsageLog(log, {
    maxBytes: 1,
    now: new Date('2026-10-18T12:00:00.000Z'),
    retentionDays: 35,
  });
  assert.equal(rotated.rotated, true, 'oversized log rotates');
  assert.equal(fs.readFileSync(path.join(tmp, 'model-usage.2026-01.jsonl'), 'utf8'), `${oldA}\n`);
  assert.equal(fs.readFileSync(path.join(tmp, 'model-usage.2026-02.jsonl'), 'utf8'), `${oldB}\n`);
  assert.equal(fs.readFileSync(log, 'utf8'), `${recent}\n${malformed}\n${partial}`, 'recent, malformed, and partial data remain verbatim in the active log');

  await Promise.all(Array.from({ length: 80 }, (_, i) => enqueueModelUsageAppend(log, `${row('2026-10-18T13:00:00.000Z', `append-${i}`)}\n`)));
  // Simulate a crash after staged active has been installed, before journal cleanup.
  const journalPath = `${log}.rotation-journal.json`;
  const activeStagePath = `${log}.recovery-test.stage`;
  fs.copyFileSync(log, activeStagePath);
  const activeSha256 = createHash('sha256').update(fs.readFileSync(activeStagePath)).digest('hex');
  fs.writeFileSync(journalPath, JSON.stringify({ version: 1, activePath: log, activeStagePath, activeSha256, archives: [] }));
  fs.rmSync(log);
  fs.renameSync(activeStagePath, log);
  await mod.withModelUsageReadLock(log, async () => undefined);
  assert.equal(fs.existsSync(journalPath), false, 'journal recovery is idempotent after active rename');

  const files = await mod.listModelUsageHistoryFiles(log);
  assert.deepEqual(files, [path.join(tmp, 'model-usage.2026-01.jsonl'), path.join(tmp, 'model-usage.2026-02.jsonl'), log], 'history file discovery is chronological');
  const events = await readModelUsageHistory(log);
  assert.equal(events.length, 83, 'history streams archived and active valid rows once');
  assert.deepEqual(new Set(events.map((event: any) => event.id)), new Set(['old-a', 'old-b', 'recent', ...Array.from({ length: 80 }, (_, i) => `append-${i}`)]));
  assert.equal(fs.readFileSync(log, 'utf8').match(/"id":"append-/g)?.length, 80, 'queued appends are never lost');

  console.log('model-usage-history regression: ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
