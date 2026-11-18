// Proves the workspace tracking guard in both directions:
// allow-listed workspace paths pass, any other tracked workspace path fails.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findDisallowedWorkspacePaths, isAllowedWorkspacePath } from './check-workspace-tracking.mjs';

// Unit level.
for (const allowed of ['workspace/skills/foo/SKILL.md', 'workspace/self/01-overview.md', 'src/index.ts', 'workspace\\self\\a.md']) {
  assert.equal(isAllowedWorkspacePath(allowed), true, `${allowed} should be allowed`);
}
for (const denied of ['workspace/MEMORY.md', 'workspace/USER.md', 'workspace/memory/2026-01-01.md', 'workspace/Brain/x.md',
  'workspace/skills/.history/foo/SKILL.md', 'workspace/skills/.cache/x.json', 'workspace/selfish.md', 'workspace/skills']) {
  assert.equal(isAllowedWorkspacePath(denied), false, `${denied} should be denied`);
}
assert.deepEqual(findDisallowedWorkspacePaths(['workspace/self/a.md', 'workspace/uploads/a.png', 'README.md']), ['workspace/uploads/a.png']);

// End to end: run the real privacy audit against a throwaway git repo.
const here = import.meta.dirname;
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-ws-guard-'));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
};
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
const audit = () => spawnSync(process.execPath, [path.join(repo, 'scripts', 'audit-repo-privacy.mjs')], { cwd: repo, encoding: 'utf8' });

try {
  for (const name of ['audit-repo-privacy.mjs', 'check-workspace-tracking.mjs']) {
    write(`scripts/${name}`, fs.readFileSync(path.join(here, name), 'utf8'));
  }
  git('init', '-q');
  write('workspace/self/doc.md', '# developer doc\n');
  write('workspace/skills/demo/SKILL.md', '# demo skill\n');
  git('add', '-A');

  const pass = audit();
  assert.equal(pass.status, 0, `allow-listed paths must pass:\n${pass.stdout}\n${pass.stderr}`);

  write('workspace/MEMORY.md', '- synthetic note\n');
  git('add', '-f', 'workspace/MEMORY.md');
  const fail = audit();
  assert.equal(fail.status, 1, 'a tracked disallowed workspace path must fail the audit');
  assert.match(fail.stdout, /workspace-path-not-allowlisted/);
  assert.match(fail.stdout, /workspace\/MEMORY\.md/);

  git('rm', '-q', '--cached', 'workspace/MEMORY.md');
  write('workspace/skills/.history/demo/SKILL.md', '# old\n');
  git('add', '-f', 'workspace/skills/.history/demo/SKILL.md');
  assert.equal(audit().status, 1, 'skills/.history must fail the audit');
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

console.log('workspace tracking guard: allowed paths pass, disallowed paths fail');
