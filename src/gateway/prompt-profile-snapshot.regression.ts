import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getPromptProfileSnapshotStatus,
  memoizePromptProfileBlock,
  readPromptProfileText,
  resetPromptProfileSnapshots,
} from './prompt-profile-snapshot';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-profile-snapshot-'));
  try {
    resetPromptProfileSnapshots();
    const filePath = path.join(root, 'SOUL.md');
    fs.writeFileSync(filePath, 'first', 'utf-8');
    assert.equal(readPromptProfileText(filePath), 'first');
    assert.equal(readPromptProfileText(filePath), 'first');

    fs.writeFileSync(filePath, 'second-version', 'utf-8');
    assert.equal(readPromptProfileText(filePath), 'second-version', 'mtime/size changes must invalidate file snapshots');

    let builds = 0;
    const first = memoizePromptProfileBlock('tools', 'fingerprint-a', () => {
      builds += 1;
      return 'block-a';
    });
    const second = memoizePromptProfileBlock('tools', 'fingerprint-a', () => {
      builds += 1;
      return 'wrong';
    });
    const third = memoizePromptProfileBlock('tools', 'fingerprint-b', () => {
      builds += 1;
      return 'block-b';
    });
    assert.equal(first, 'block-a');
    assert.equal(second, 'block-a');
    assert.equal(third, 'block-b');
    assert.equal(builds, 2);

    const status = getPromptProfileSnapshotStatus();
    assert.equal(status.fileHits, 1);
    assert.equal(status.fileMisses, 2);
    assert.equal(status.blockHits, 1);
    assert.equal(status.blockMisses, 2);
    console.log('prompt-profile snapshot regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
