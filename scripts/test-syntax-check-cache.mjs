#!/usr/bin/env node
// Regression test for scripts/lib/syntax-check-cache.cjs, the content-addressed record of
// web-ui files that already passed check-public-web-ui-sync's syntax checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cache = require('./lib/syntax-check-cache.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-cache-'));
const file = path.join(dir, 'nested', 'web-ui-syntax.json');
const salt = 'node v20|esbuild 0.x|esm chrome100';

try {
  // Keys change with the content AND with the salt (a Node/esbuild upgrade re-checks everything).
  const a = cache.cacheKey(Buffer.from('export const a = 1;\n'), salt);
  assert.equal(a, cache.cacheKey(Buffer.from('export const a = 1;\n'), salt));
  assert.notEqual(a, cache.cacheKey(Buffer.from('export const a = 2;\n'), salt));
  assert.notEqual(a, cache.cacheKey(Buffer.from('export const a = 1;\n'), 'node v22|esbuild 0.x|esm chrome100'));

  // Missing file: empty, so every file is checked.
  assert.equal(cache.load(file, salt).size, 0);

  // Round trip (creates the parent directory, leaves no temp files).
  assert.equal(cache.save(file, salt, new Set([a])), true);
  assert.deepEqual([...cache.load(file, salt)], [a]);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['web-ui-syntax.json']);

  // A different salt or format version never reuses entries.
  assert.equal(cache.load(file, 'node v22|esbuild 0.x|esm chrome100').size, 0);
  fs.writeFileSync(file, JSON.stringify({ version: cache.FORMAT_VERSION + 1, salt, passed: [a] }));
  assert.equal(cache.load(file, salt).size, 0);

  // Corrupt or foreign content is ignored instead of throwing.
  for (const bad of ['{not json', 'null', '[]', JSON.stringify({ version: cache.FORMAT_VERSION, salt, passed: 'x' })]) {
    fs.writeFileSync(file, bad);
    assert.equal(cache.load(file, salt).size, 0, `ignored: ${bad}`);
  }

  // Cap: keys used by the current run survive; the least recently used are dropped first.
  const many = new Set(Array.from({ length: cache.MAX_ENTRIES + 10 }, (_, i) => `k${i}`));
  cache.save(file, salt, many, ['k0', 'k1']);
  const kept = cache.load(file, salt);
  assert.equal(kept.size, cache.MAX_ENTRIES);
  assert.ok(kept.has('k0') && kept.has('k1'), 'current keys are kept');
  assert.ok(!kept.has('k2'), 'oldest unused key is dropped');

  // Opt-out switch.
  assert.equal(cache.enabled({}), true);
  assert.equal(cache.enabled({ PROMETHEUS_NO_SYNTAX_CACHE: '1' }), false);

  console.log('[test-syntax-check-cache] ok');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
