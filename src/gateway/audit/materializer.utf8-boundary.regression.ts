import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { streamLinesSync } from './materializer.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-audit-utf8-'));
try {
  const file = path.join(root, 'boundary.txt');
  const prefix = 'x'.repeat((64 * 1024) - 1);
  const expected = prefix + '😀' + '-tail';
  fs.writeFileSync(file, expected + '\n', 'utf8');
  const lines: string[] = [];
  const result = streamLinesSync(file, 2 * 1024 * 1024, (line, truncated) => {
    assert.equal(truncated, false);
    lines.push(line);
  });
  assert.equal(result.lines, 1);
  assert.deepEqual(lines, [expected]);
  assert.equal(lines[0].includes('�'), false, 'split UTF-8 sequence must never be replaced');
  console.log('audit UTF-8 boundary regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
