import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATH_RECOVERY_BUDGET, findPathSuggestions, scanPathSuggestions } from './workspace-path-recovery';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-path-recovery-'));
  try {
    // Wide directory where the filter rejects every entry: the scan must stop at the visit budget.
    const wide = path.join(root, 'wide');
    fs.mkdirSync(wide);
    for (let i = 0; i < 6000; i += 1) fs.writeFileSync(path.join(wide, `filler-${i}.txt`), '');
    const rejected = await scanPathSuggestions({ rootDir: wide, score: () => 1, include: () => false });
    assert.equal(rejected.suggestions.length, 0, 'a filter that rejects everything yields no suggestions');
    assert.equal(rejected.exhausted, true, 'a wide rejected directory must stop at the budget, not walk all entries');
    assert.ok(rejected.visited <= PATH_RECOVERY_BUDGET.maxVisited, `visited ${rejected.visited} exceeds the visit budget`);

    // Deep tree: traversal must not descend past the depth budget.
    const deep = path.join(root, 'deep');
    let deepDir = deep;
    for (let i = 0; i < 40; i += 1) {
      deepDir = path.join(deepDir, `level${i}`);
      fs.mkdirSync(deepDir, { recursive: true });
    }
    fs.writeFileSync(path.join(deepDir, 'deep-target.ts'), '');
    const deepScan = await scanPathSuggestions({ rootDir: deep, score: () => 1, include: () => false });
    assert.ok(deepScan.dirsOpened <= PATH_RECOVERY_BUDGET.maxDepth + 1, `opened ${deepScan.dirsOpened} directories past the depth budget`);

    // Valid close match is still returned; node_modules is skipped; symlinks are not followed.
    const project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, 'src', 'providers'), { recursive: true });
    fs.mkdirSync(path.join(project, 'node_modules', 'junk'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'providers', 'openai-codex-adapter.ts'), '');
    fs.writeFileSync(path.join(project, 'node_modules', 'junk', 'openai-codex-adapter.ts'), '');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'openai-codex-adapter.ts'), '');
    try {
      fs.symlinkSync(outside, path.join(project, 'linked-outside'), 'junction');
    } catch {
      // Symlink creation is not permitted here; the symlink assertion below is then vacuous.
    }
    const ranked = await findPathSuggestions({
      rootDir: project,
      score: (rel) => (rel.endsWith('openai-codex-adapter.ts') ? 100 - rel.length : 0),
    });
    assert.equal(ranked[0]?.rel, 'src/providers/openai-codex-adapter.ts', 'the valid close match must rank first');
    assert.ok(!ranked.some((item) => item.rel.includes('node_modules')), 'skipped directories must not be traversed');
    assert.ok(!ranked.some((item) => item.rel.startsWith('linked-outside')), 'symlinks must not be followed');

    // Open-directory budget of 1 must still scan the root (the last allowed directory) and return its entries.
    const oneDir = await scanPathSuggestions({ rootDir: project, score: () => 1, budget: { maxDirs: 1 } });
    assert.equal(oneDir.dirsOpened, 1, 'maxDirs=1 opens exactly the root');
    assert.ok(oneDir.suggestions.some((item) => item.rel === 'src'), 'maxDirs=1 must still return the root entries');

    // Per-entry count cap: a wide tree stops at exactly maxVisited entries.
    const capped = await scanPathSuggestions({ rootDir: wide, score: () => 1, include: () => false, budget: { maxVisited: 50 } });
    assert.equal(capped.visited, 50, 'the entry budget must cap traversal at maxVisited');
    assert.equal(capped.exhausted, true, 'hitting the entry cap must be reported as exhausted');

    // Missing root (permission/read failure equivalent) returns no suggestions instead of throwing.
    const missing = await findPathSuggestions({ rootDir: path.join(root, 'absent'), score: () => 1 });
    assert.deepEqual(missing, [], 'an unreadable root must produce no suggestions, not an error');

    console.log('workspace-path-recovery regression: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
