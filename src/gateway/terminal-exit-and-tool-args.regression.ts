// Regressions for the 2026-09-25 weekly tool-failure review (tool_audit.log 9/18-9/25).
import assert from 'assert';
import { spawnSync } from 'child_process';
import { applyRequiredArgAliases } from './tool-search.js';
import { buildWindowsPowerShellWrapper } from './process/supervisor.js';
import { coerceBatchFileList, normalizeWorkspacePatchsetArgs } from './agents-runtime/subagent-executor.js';
import { executeApplyWorkspacePatchset } from '../tools/files.js';

async function main() {
  // 1) tool_call bridge: connector_github_merge_pr with pull_number (failed 9/25 17:24 + 19:06).
  const merged = applyRequiredArgAliases(['owner', 'repo', 'pr_number'], { owner: 'o', repo: 'r', pull_number: 443 });
  assert.equal(merged.pr_number, 443);
  assert.equal(applyRequiredArgAliases(['pr_number'], { pr_number: 5, pull_number: 9 }).pr_number, 5, 'explicit key wins');
  assert.equal(applyRequiredArgAliases(['file_id'], { fileId: 'abc' }).file_id, 'abc', 'camelCase fallback');
  assert.equal(applyRequiredArgAliases(['pr_number'], {}).pr_number, undefined, 'no invention');
  const original = { pull_number: 1 };
  applyRequiredArgAliases(['pr_number'], original);
  assert.equal((original as any).pr_number, undefined, 'input not mutated');

  // 2) patchset edits as JSON string / single object (7/7 failures all-time).
  const edit = { filename: 'a.txt', find: 'x', replace: 'y' };
  const fromString = normalizeWorkspacePatchsetArgs({ action: 'patchset', edits: JSON.stringify([edit]) });
  assert.equal(fromString.edits.length, 1);
  assert.equal(fromString.edits[0].op, 'find_replace');
  const fromObject = normalizeWorkspacePatchsetArgs({ edits: edit });
  assert.equal(fromObject.edits.length, 1);
  const bad = await executeApplyWorkspacePatchset({ edits: 'not json' } as any);
  assert.equal(bad.success, false);

  // 2b) batch_read with `paths` instead of `files` (failed live 2026-09-25).
  assert.deepEqual(coerceBatchFileList({ paths: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(coerceBatchFileList({ files: '["x"]' }), ['x']);
  assert.deepEqual(coerceBatchFileList({ files: 'one.md' }), ['one.md']);
  assert.deepEqual(coerceBatchFileList({}), []);

  // 3) PowerShell wrapper exit codes (27 false "exit -1" on 9/23-25).
  if (process.platform === 'win32') {
    const run = (cmd: string) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildWindowsPowerShellWrapper(cmd)], { encoding: 'utf8' }).status;
    // Early pipeline stop on a native command -> $LASTEXITCODE -1, output complete.
    assert.equal(run(`cmd /c "for /l %i in (1,1,3000) do @echo line%i" | Select-Object -First 1`), 0, 'early pipeline stop is success');
    // Stderr-only native output stays success.
    assert.equal(run(`node -e "console.error('[Vault] warning'); console.log('ok')"`), 0, 'stderr warning is success');
    // Real failures still fail.
    assert.equal(run(`cmd /c exit 3`), 3, 'nonzero native exit preserved');
    assert.equal(run(`Get-Item C:\\definitely\\missing\\path -ErrorAction Stop`), 1, 'cmdlet error fails');
  }

  console.log('terminal-exit-and-tool-args regression: OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
