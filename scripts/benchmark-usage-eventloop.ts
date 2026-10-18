import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readIndexedSessionUsage, resetSessionUsageIndexes } from '../src/providers/model-usage-index';

async function main() {
  const source = process.argv[2] || path.join(process.env.APPDATA || '', 'Prometheus', '.prometheus', 'model-usage.jsonl');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'usage-stall-benchmark-'));
  const copy = path.join(dir, 'model-usage.jsonl');
  try {
    if (process.argv[2] === '--synthetic') {
      // Deterministic 110 MiB ledger; do not depend on a developer's telemetry.
      const handle = await fs.promises.open(copy, 'w');
      let bytes = 0;
      let row = 0;
      try {
        while (bytes < 110 * 1024 * 1024) {
          let chunk = '';
          for (let i = 0; i < 1000; i++, row++) {
            chunk += JSON.stringify({ sessionId: `session-${row % 1000}`, timestamp: '2026-10-18T12:00:00.000Z', provider: 'openai', model: 'benchmark', inputTokens: 100, outputTokens: 25, padding: 'x'.repeat(256) }) + '\n';
          }
          await handle.write(chunk);
          bytes += Buffer.byteLength(chunk);
        }
      } finally { await handle.close(); }
    } else {
      await fs.promises.copyFile(source, copy);
    }
    const size = (await fs.promises.stat(copy)).size;
    const handle = await fs.promises.open(copy, 'r');
    const buffer = Buffer.alloc(Math.min(size, 128 * 1024));
    await handle.read(buffer, 0, buffer.length, size - buffer.length);
    await handle.close();
    const rows = buffer.toString('utf8').split('\n').filter(Boolean);
    const session = JSON.parse(rows[rows.length - 1]).sessionId || '';
    let started = performance.now();
    const before = fs.readFileSync(copy, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { const e = JSON.parse(line); return e.sessionId === session ? [e] : []; } catch { return []; }
    });
    const baselineMs = performance.now() - started;
    let worstDrift = 0;
    let last = performance.now();
    const heartbeat = setInterval(() => { const now = performance.now(); worstDrift = Math.max(worstDrift, now - last - 10); last = now; }, 10);
    resetSessionUsageIndexes();
    started = performance.now();
    const after = await readIndexedSessionUsage(copy, session);
    const coldMs = performance.now() - started;
    started = performance.now();
    await readIndexedSessionUsage(copy, session);
    const warmMs = performance.now() - started;
    await fs.promises.appendFile(copy, JSON.stringify({ ...after[after.length - 1], sessionId: session }) + '\n');
    started = performance.now();
    const appended = await readIndexedSessionUsage(copy, session);
    const appendMs = performance.now() - started;
    clearInterval(heartbeat);
    if (JSON.stringify(before) !== JSON.stringify(after) || appended.length !== after.length + 1) throw new Error('benchmark result mismatch');
    console.log(JSON.stringify({ bytes: size, sessionRows: after.length, baselineMs, coldMs, warmMs, appendMs, worstAsyncTimerDriftMs: worstDrift }, null, 2));
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
