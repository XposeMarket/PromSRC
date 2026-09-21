// Regression: read_files_batch returns capped content when no mode is given.
// Summary output remains available as an explicit opt-in.
//
// Run: node_modules/.bin/tsx src/tools/files.regression.ts

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'prom-batch-read-'));
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;
  const { executeReadFilesBatch } = await import('./files.js');

  try {
    await fs.writeFile(
      path.join(workspace, 'fixture.txt'),
      Array.from({ length: 100 }, (_, index) => 'line-' + (index + 1)).join('\n'),
      'utf8',
    );

    const content = await executeReadFilesBatch({
      files: [{ filename: 'fixture.txt' }],
      inline: true,
    });
    assert.equal(content.success, true);
    assert.match(content.stdout || '', /1: line-1/);
    assert.match(content.stdout || '', /80: line-80/);
    assert.doesNotMatch(content.stdout || '', /81: line-81/);
    assert.match(content.stdout || '', /\[READ_DEFAULT_CAP\]/);

    const summary = await executeReadFilesBatch({
      files: [{ filename: 'fixture.txt' }],
      content: false,
      inline: true,
    });
    assert.equal(summary.success, true);
    assert.doesNotMatch(summary.stdout || '', /1: line-1/);
    assert.match(summary.stdout || '', /fixture\.txt/);
    assert.match(summary.stdout || '', /100 lines/);

    console.log('read_files_batch default content and explicit summary regression: ok');
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
