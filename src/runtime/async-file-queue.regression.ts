// Size-based rotation for the async append queue (memory high-water log).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueAsyncAppend } from './async-file-queue';

const MB = 1024 * 1024;

function read(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

async function waitFor(pred: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > 5_000) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-rotate-'));
  const file = path.join(dir, 'gateway-memory-highwater.ndjson');
  try {
    // A pre-existing >2 MB file is rotated to .1; the new line lands in a fresh file.
    fs.writeFileSync(file, 'x'.repeat(2 * MB + 10));
    enqueueAsyncAppend(file, 'LINE-1\n', undefined, 2 * MB);
    await waitFor(() => read(file) === 'LINE-1\n', 'first rotation');
    assert.equal(fs.statSync(file + '.1').size, 2 * MB + 10);

    // Repeated rotation replaces .1 and keeps only one rotated file.
    fs.writeFileSync(file, 'y'.repeat(2 * MB + 5));
    enqueueAsyncAppend(file, 'LINE-2\n', undefined, 2 * MB);
    await waitFor(() => read(file) === 'LINE-2\n', 'second rotation');
    assert.equal(fs.statSync(file + '.1').size, 2 * MB + 5);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['gateway-memory-highwater.ndjson', 'gateway-memory-highwater.ndjson.1']);

    // Under the limit: plain append, no rotation.
    enqueueAsyncAppend(file, 'LINE-3\n', undefined, 2 * MB);
    await waitFor(() => read(file) === 'LINE-2\nLINE-3\n', 'plain append');
    assert.equal(fs.statSync(file + '.1').size, 2 * MB + 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('async-file-queue rotation regression: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
