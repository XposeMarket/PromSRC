import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_FILE_TOOL_EXCLUDES,
  createSearchMatcher,
} from '../tools/file-intelligence';
import { runBoundedWorkspaceSearch } from './workspace-search';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-workspace-search-'));
  try {
    for (let dir = 0; dir < 30; dir += 1) {
      const folder = path.join(root, `folder-${String(dir).padStart(2, '0')}`);
      fs.mkdirSync(folder, { recursive: true });
      for (let file = 0; file < 30; file += 1) {
        fs.writeFileSync(
          path.join(folder, `file-${String(file).padStart(2, '0')}.txt`),
          file === 0 ? `needle-${dir}\n` : `ordinary-${dir}-${file}\n`,
        );
      }
    }

    let timerFired = false;
    setTimeout(() => { timerFired = true; }, 0);
    const limited = await runBoundedWorkspaceSearch({
      searchDir: root,
      displayRoot: '.',
      matcher: createSearchMatcher('ordinary', {}),
      globs: [],
      excludes: new Set(DEFAULT_FILE_TOOL_EXCLUDES),
      gitignoreRules: [],
      maxResults: 5,
      storeLimit: 5,
      maxFileBytes: 1024,
      maxFiles: 500,
      maxDurationMs: 5_000,
      maxDepth: 8,
      contextLines: 0,
      before: 20,
      after: 20,
      includeLockfiles: false,
      pathOnly: false,
    });
    assert.equal(timerFired, true, 'large searches must yield to unrelated gateway work');
    assert.equal(limited.stopReason, 'result_limit');
    assert.equal(limited.truncated, true);
    assert.equal(limited.filesRemainingUnknown, true);
    assert.equal(limited.matches.length, 5);
    assert.ok(limited.filesVisited < 900);

    const fileLimited = await runBoundedWorkspaceSearch({
      searchDir: root,
      displayRoot: '.',
      matcher: createSearchMatcher('never-present', {}),
      globs: [],
      excludes: new Set(DEFAULT_FILE_TOOL_EXCLUDES),
      gitignoreRules: [],
      maxResults: 50,
      storeLimit: 50,
      maxFileBytes: 1024,
      maxFiles: 17,
      maxDurationMs: 5_000,
      maxDepth: 8,
      contextLines: 0,
      before: 20,
      after: 20,
      includeLockfiles: false,
      pathOnly: false,
    });
    assert.equal(fileLimited.stopReason, 'file_limit');
    assert.equal(fileLimited.filesVisited, 17);

    const pathOnly = await runBoundedWorkspaceSearch({
      searchDir: root,
      displayRoot: '.',
      matcher: createSearchMatcher('file-00.txt', {}),
      globs: [],
      excludes: new Set(DEFAULT_FILE_TOOL_EXCLUDES),
      gitignoreRules: [],
      maxResults: 50,
      storeLimit: 50,
      maxFileBytes: 1024,
      maxFiles: 2_000,
      maxDurationMs: 5_000,
      maxDepth: 8,
      contextLines: 0,
      before: 20,
      after: 20,
      includeLockfiles: false,
      pathOnly: true,
    });
    assert.equal(pathOnly.stopReason, 'completed');
    assert.equal(pathOnly.pathMatches.length, 30);
    assert.equal(pathOnly.filesSearched, 0, 'path lookup must not read file contents');

    const controller = new AbortController();
    controller.abort();
    const aborted = await runBoundedWorkspaceSearch({
      searchDir: root,
      displayRoot: '.',
      matcher: createSearchMatcher('ordinary', {}),
      globs: [],
      excludes: new Set(DEFAULT_FILE_TOOL_EXCLUDES),
      gitignoreRules: [],
      maxResults: 50,
      storeLimit: 50,
      maxFileBytes: 1024,
      maxFiles: 2_000,
      maxDurationMs: 5_000,
      maxDepth: 8,
      contextLines: 0,
      before: 20,
      after: 20,
      includeLockfiles: false,
      pathOnly: false,
      signal: controller.signal,
    });
    assert.equal(aborted.stopReason, 'aborted');
    assert.equal(aborted.filesVisited, 0);

    console.log('workspace-search regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
