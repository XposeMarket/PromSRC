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

    const rows = Array.from({ length: 799 }, (_, i) => i === 180 ? 'middle-' + 'x'.repeat(1500) + '-intact' : String(i + 1).padStart(3, '0') + '-line-' + 'z'.repeat(28));
    await fs.writeFile(path.join(workspace, 'large.txt'), rows.join('\n'));
    const { executeRead, executeApplyWorkspacePatchset } = await import('./files.js');
    const patch = { dry_run: true, edits: [{ filename: 'fixture.txt', op: 'find_replace' as const, find: 'line-1', replace: 'SHOULD-NOT-WRITE' }] };
    const { normalizeWorkspaceWrapperTool } = await import('../gateway/agents-runtime/wrapper-normalizers.js');
    for (const action of ['create', 'write', 'append', 'find_replace', 'replace_lines', 'insert_after', 'delete_lines', 'delete_file', 'mkdir', 'patchset']) {
      assert.match(normalizeWorkspaceWrapperTool('workspace_edit', { action, ...patch })?.error ?? '', /No files changed/);
    }
    assert.equal(normalizeWorkspaceWrapperTool('workspace_edit', { action: 'apply_patch', dry_run: true })?.name, 'preview_patch');
    assert.equal(normalizeWorkspaceWrapperTool('workspace_edit', { action: 'copy', check: true })?.args.dry_run, true);
    const before = await fs.readFile(path.join(workspace, 'fixture.txt'));
    assert.equal((await executeApplyWorkspacePatchset(patch)).success, false);
    assert.deepEqual(await fs.readFile(path.join(workspace, 'fixture.txt')), before);
    const one = await executeRead({ path: 'large.txt', start_line: 1, num_lines: 350 });
    const batch = await executeReadFilesBatch({ files: [{ filename: 'large.txt', num_lines: 350 }] });
    for (const body of [(one.data as any)?.content, batch.stdout]) {
      assert.ok(body); assert.ok(body.includes('350: ' + rows[349])); assert.ok(body.includes(rows[180])); assert.ok(!body.includes('351: '));
    }
    // Extra lines elsewhere in the file do not make a complete request partial.
    const exact = await executeReadFilesBatch({ files: [{ filename: 'fixture.txt', start_line: 2, num_lines: 4 }] });
    assert.match(exact.stdout || '', /5: line-5/);
    assert.doesNotMatch(exact.stdout || '', /truncated|READ_DEFAULT_CAP|next chunk/i);
    const read = async (args: Record<string, number | boolean | undefined>) => (await executeRead({ path: 'fixture.txt', ...args })).data as any;
    for (const args of [{ start_line: 2, num_lines: 4 }, { start_line: 99, num_lines: 20 }, { around_line: 1, before: 4, after: 2 }]) {
      const result = await read(args);
      assert.equal(result.window.truncated, false); assert.equal(result.window.next_start_line, undefined);
    }
    assert.equal((await read({ around_line: 2, before: 0, after: 0 })).content, '2: line-2');
    assert.equal((await read({ around_line: 1, before: 4, after: 2 })).content.split('\n').length, 3);
    const partial = await read({ start_line: 2, num_lines: 8, max_lines: 3 });
    assert.equal(partial.window.next_start_line, 5); assert.equal(partial.window.next_num_lines, 5);
    const rest = await read({ start_line: 5, num_lines: 5 }); assert.equal(rest.window.truncated, false); assert.match(rest.content, /9: line-9$/);
    const capped = await executeReadFilesBatch({ files: [{ filename: 'fixture.txt', start_line: 2, num_lines: 8 }], max_lines_per_file: 3 });
    assert.match(capped.stdout || '', /READ_TRUNCATED.*start_line:5, num_lines:5/);
    // The workspace_read wrapper must not turn "no cap given" into an explicit 80-line cap.
    const wrapped = normalizeWorkspaceWrapperTool('workspace_read', { action: 'batch_read', files: [{ filename: 'large.txt', start_line: 1, num_lines: 350 }] });
    assert.equal(wrapped?.name, 'read_files_batch');
    assert.equal(wrapped?.args.max_lines_per_file, undefined);
    const viaWrapper = await executeReadFilesBatch(wrapped!.args);
    assert.ok((viaWrapper.stdout || '').includes('350: ' + rows[349]), 'a requested range survives the workspace_read wrapper');
    const wrappedDefault = await executeReadFilesBatch(normalizeWorkspaceWrapperTool('workspace_read', { action: 'batch_read', files: [{ filename: 'large.txt' }] })!.args);
    assert.ok(!(wrappedDefault.stdout || '').includes('81: '), 'unranged files still default to 80 lines');
    assert.equal(((await executeRead({ path: 'large.txt', full: true })).data as any).content.split('\n').length, 799);
    const tail = await read({ tail: 8, max_lines: 3 }); assert.equal(tail.window.start_line, 98); assert.equal(tail.window.next_start_line, 93); assert.equal(tail.window.next_num_lines, 5);
    assert.equal((await executeRead({ path: 'fixture.txt', start_line: 101 })).success, false);
    await assert.rejects(fs.access(path.join(workspace, 'temp', 'tool-results')));
    console.log('PASS: 350 of 799 lines inline on single and batch read, long middle line intact, no scratch artifact');
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
