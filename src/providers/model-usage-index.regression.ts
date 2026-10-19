import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSessionUsageIndex, readIndexedSessionUsage, readRecentUsage, readUsageRange, resetSessionUsageIndexes } from './model-usage-index';

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'usage-byte-index-'));
  const file = path.join(dir, 'model-usage.jsonl');
  const row = (sessionId: string, n: number, timestamp = new Date().toISOString()) => JSON.stringify({ sessionId, inputTokens: n, timestamp, model: '😀' }) + '\n';
  try {
    await fs.promises.writeFile(file, row('a', 1) + row('b', 2));
    assert.deepEqual((await readIndexedSessionUsage(file, 'a')).map(e => e.inputTokens), [1]);
    const offset = (await fs.promises.stat(file)).size;
    await fs.promises.appendFile(file, row('a', 3) + row('b', 4));
    assert.deepEqual((await readIndexedSessionUsage(file, 'a')).map(e => e.inputTokens), [1, 3]);
    assert.deepEqual((await readUsageRange(file, offset, (await fs.promises.stat(file)).size, 'a')).map(e => e.inputTokens), [3]);
    const partial = row('a', 5);
    await fs.promises.appendFile(file, partial.slice(0, 18));
    assert.equal((await readIndexedSessionUsage(file, 'a')).length, 2);
    await fs.promises.appendFile(file, partial.slice(18));
    assert.deepEqual((await readIndexedSessionUsage(file, 'a')).map(e => e.inputTokens), [1, 3, 5]);
    await fs.promises.writeFile(file, row('b', 9));
    assert.equal((await readIndexedSessionUsage(file, 'a')).length, 0);
    assert.equal((await readIndexedSessionUsage(file, 'b'))[0].inputTokens, 9);
    const replacement = path.join(dir, 'replacement');
    await fs.promises.writeFile(replacement, row('c', 8));
    await fs.promises.rename(replacement, file);
    assert.equal((await readIndexedSessionUsage(file, 'b')).length, 0);
    assert.equal((await readIndexedSessionUsage(file, 'c'))[0].inputTokens, 8);
    assert.equal((await ensureSessionUsageIndex(file)).count, 1, 'replacement rebuilds aggregates and ranges');
    await Promise.all([readIndexedSessionUsage(file, 'c'), readIndexedSessionUsage(file, 'c')]);
    assert.equal((await ensureSessionUsageIndex(file)).count, 1, 'concurrent readers do not double count');
    // Warm reads must not parse unrelated sessions, even when there are many rows.
    await fs.promises.writeFile(file, row('old', 0, '2000-01-01T00:00:00Z') + Array.from({ length: 12000 }, (_, i) => row('noise', i)).join('') + row('target', 99));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    await ensureSessionUsageIndex(file);
    clearInterval(timer);
    assert.ok(ticks > 0, 'cold indexing yields the event loop between bounded chunks');
    const parse = JSON.parse;
    let parsed = 0;
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => { parsed++; return parse(...args); }) as typeof JSON.parse;
    try {
      assert.equal((await readIndexedSessionUsage(file, 'target'))[0].inputTokens, 99);
      assert.equal(parsed, 1, 'warm session query parses only its own row');
    } finally { JSON.parse = parse; }
    const recent = await readRecentUsage(file, Date.now() - 86400000);
    assert.equal(recent.length, 12001);
    assert.ok(recent.every(e => e.sessionId !== 'old'));
    console.log('model-usage byte index regressions passed');
  } finally { resetSessionUsageIndexes(); await fs.promises.rm(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
