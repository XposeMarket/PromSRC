import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeTool } from './agents-runtime/subagent-executor';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-evidence-executor-'));
const deps = {
  broadcastWS() {},
  broadcastTeamEvent() {},
  sendSSE() {},
} as any;

async function main(): Promise<void> {
try {
  const created = await executeTool('create_file', { filename: 'example.ts', content: 'export const value = 1;\n' }, workspace, deps, 'evidence-regression');
  assert.equal(created.error, false);
  assert.equal(created.extra?.codeEvidence?.files?.[0]?.operation, 'create');
  assert.equal(created.extra?.codeEvidence?.files?.[0]?.exists_after, true);

  const edited = await executeTool('find_replace', { filename: 'example.ts', find: 'value = 1', replace: 'value = 2' }, workspace, deps, 'evidence-regression');
  assert.equal(edited.error, false);
  assert.equal(edited.extra?.codeEvidence?.files?.[0]?.operation, 'update');
  assert.match(edited.extra?.codeEvidence?.files?.[0]?.post_edit_windows?.[0]?.content || '', /value = 2/);

  const read = await executeTool('read_file', { filename: 'example.ts', start_line: 1, num_lines: 2 }, workspace, deps, 'evidence-regression');
  assert.equal(read.error, false);
  assert.equal(read.extra?.codeEvidence?.files?.[0]?.operation, 'read');

  fs.writeFileSync(path.join(workspace, 'partial.ts'), 'export const partial = 1;\n', 'utf8');
  const partial = await executeTool('apply_workspace_patchset', { edits: [
    { filename: 'partial.ts', op: 'find_replace', find: 'partial = 1', replace: 'partial = 2' },
    { filename: 'missing.ts', op: 'find_replace', find: 'missing', replace: 'changed' },
  ] }, workspace, deps, 'evidence-regression');
  assert.equal(partial.error, true);
  assert.equal(partial.extra?.codeEvidence?.files?.length, 1);
  assert.equal(partial.extra?.codeEvidence?.files?.[0]?.path, 'partial.ts');
  assert.match(partial.extra?.codeEvidence?.files?.[0]?.post_edit_windows?.[0]?.content || '', /partial = 2/);

  const deleted = await executeTool('delete_file', { filename: 'example.ts' }, workspace, deps, 'evidence-regression');
  assert.equal(deleted.error, false);
  assert.equal(deleted.extra?.codeEvidence?.files?.[0]?.operation, 'delete');
  assert.equal(deleted.extra?.codeEvidence?.files?.[0]?.exists_after, false);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('code-evidence executor regression: ok');
}

void main();
