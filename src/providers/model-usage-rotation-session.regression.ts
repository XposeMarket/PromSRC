import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'usage-rotate-session-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  try {
    const usage = await import('./model-usage');
    const history = await import('./model-usage-history');
    const file = path.join(root, '.prometheus', 'model-usage.jsonl');
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const row = (inputTokens: number, timestamp: string) => JSON.stringify({ sessionId: 'a', inputTokens, timestamp }) + '\n';
    await fs.promises.writeFile(file, row(1, '2000-01-01T00:00:00Z') + row(2, new Date().toISOString()));
    assert.equal((await usage.readModelUsageEventsForSession('a')).length, 2);
    const cursor = usage.captureModelUsageLogCursor();
    const rotation = history.rotateModelUsageLog(file, { maxBytes: 1 });
    const append = history.enqueueModelUsageAppend(file, row(3, new Date().toISOString()));
    await Promise.all([rotation, append]);
    assert.deepEqual((await usage.readModelUsageEventsForSession('a')).map(e => e.inputTokens), [1, 2, 3]);
    assert.equal((await usage.readModelUsageEvents()).length, 3);
    assert.deepEqual((await usage.readRecentModelUsageEvents(Date.now() - 86400000)).map(e => e.inputTokens), [2, 3]);
    assert.equal((await usage.readModelUsageEventsSince(cursor, 'a')).length, 3, 'replaced cursor falls back to indexed session history');
    console.log('model-usage rotation/session integration passed');
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
