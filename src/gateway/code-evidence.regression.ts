import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceSnapshot, toSnapshotRef } from '../workspace-history';
import { attachCodeEvidenceToToolResult } from './code-evidence';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-code-evidence-'));
try {
  const filePath = path.join(workspace, 'src', 'example.ts');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'export const value = 1;\nexport const stable = true;\n', 'utf8');
  const snapshot = toSnapshotRef(createWorkspaceSnapshot({
    workspacePath: workspace,
    targetPath: filePath,
    displayPath: 'src/example.ts',
    operation: 'find_replace',
  }));
  assert.ok(snapshot);
  fs.writeFileSync(filePath, 'export const value = 2;\nexport const stable = true;\n', 'utf8');

  const enriched = attachCodeEvidenceToToolResult({
    name: 'find_replace',
    args: { filename: 'src/example.ts', find: '1', replace: '2' },
    result: 'OK',
    error: false,
    extra: { workspaceSnapshots: [snapshot] },
  }, { workspacePath: workspace });
  const evidence = enriched.extra?.codeEvidence;
  assert.equal(evidence?.version, 1);
  assert.equal(evidence?.files?.length, 1);
  assert.equal(evidence.files[0].path, 'src/example.ts');
  assert.equal(evidence.files[0].operation, 'update');
  assert.equal(evidence.files[0].exists_after, true);
  assert.equal(
    evidence.files[0].authoritative_content_sha256,
    crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  );
  assert.deepEqual(evidence.files[0].changed_ranges[0], {
    before_start_line: 1,
    before_end_line: 1,
    after_start_line: 1,
    after_end_line: 1,
  });
  assert.match(evidence.files[0].post_edit_windows[0].content, /value = 2/);

  const deleteSnapshot = toSnapshotRef(createWorkspaceSnapshot({
    workspacePath: workspace,
    targetPath: filePath,
    displayPath: 'src/example.ts',
    operation: 'delete_file',
  }));
  fs.unlinkSync(filePath);
  const deleted = attachCodeEvidenceToToolResult({
    name: 'delete_file', args: { filename: 'src/example.ts' }, result: 'OK', error: false,
    extra: { workspaceSnapshots: [deleteSnapshot] },
  }, { workspacePath: workspace });
  assert.equal(deleted.extra?.codeEvidence?.files?.[0]?.operation, 'delete');
  assert.equal(deleted.extra?.codeEvidence?.files?.[0]?.exists_after, false);
  assert.equal(deleted.extra?.codeEvidence?.files?.[0]?.authoritative_content_sha256, undefined);
  assert.equal(deleted.extra?.codeEvidence?.files?.[0]?.evidence_complete, true);

  const secretPath = path.join(workspace, 'secret.ts');
  fs.writeFileSync(secretPath, 'export const api_key = "supersecret";\nexport const safe = true;\n', 'utf8');
  const read = attachCodeEvidenceToToolResult({
    name: 'read_file', args: { filename: 'secret.ts', start_line: 1, num_lines: 2 }, result: 'numbered read', error: false,
  }, { workspacePath: workspace });
  assert.equal(read.extra?.codeEvidence?.files?.[0]?.operation, 'read');
  assert.match(read.extra?.codeEvidence?.files?.[0]?.post_edit_windows?.[0]?.content || '', /api_key = "\*\*\*"/);
  assert.doesNotMatch(read.extra?.codeEvidence?.files?.[0]?.post_edit_windows?.[0]?.content || '', /supersecret/);

  const moveSource = path.join(workspace, 'move-source.ts');
  const moveDestination = path.join(workspace, 'move-destination.ts');
  fs.writeFileSync(moveSource, 'export const moved = true;\n', 'utf8');
  const sourceSnapshot = toSnapshotRef(createWorkspaceSnapshot({ workspacePath: workspace, targetPath: moveSource, displayPath: 'move-source.ts', operation: 'move_file:source' }));
  const destinationSnapshot = toSnapshotRef(createWorkspaceSnapshot({ workspacePath: workspace, targetPath: moveDestination, displayPath: 'move-destination.ts', operation: 'move_file:destination' }));
  fs.renameSync(moveSource, moveDestination);
  const moved = attachCodeEvidenceToToolResult({
    name: 'move_file', args: { source: 'move-source.ts', destination: 'move-destination.ts' }, result: 'OK', error: false,
    extra: { workspaceSnapshots: [sourceSnapshot, destinationSnapshot] },
  }, { workspacePath: workspace });
  assert.equal(moved.extra?.codeEvidence?.files?.length, 2);
  assert.equal(moved.extra?.codeEvidence?.files?.find((file: any) => file.exists_after)?.previous_path, 'move-source.ts');
  assert.equal(moved.extra?.codeEvidence?.files?.find((file: any) => !file.exists_after)?.operation, 'move');

  const binaryPath = path.join(workspace, 'binary.dat');
  fs.writeFileSync(binaryPath, Buffer.from([1, 0, 2, 3]));
  const binary = attachCodeEvidenceToToolResult({
    name: 'read_file', args: { filename: 'binary.dat' }, result: 'binary', error: false,
  }, { workspacePath: workspace });
  assert.equal(binary.extra?.codeEvidence?.files?.[0]?.binary, true);
  assert.equal(binary.extra?.codeEvidence?.files?.[0]?.post_edit_windows?.length, 0);

  const dryRun = attachCodeEvidenceToToolResult({
    name: 'move_file', args: { source: 'a', destination: 'b', dry_run: true }, result: 'plan', error: false,
  }, { workspacePath: workspace });
  assert.equal(dryRun.extra?.codeEvidence, undefined);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('code-evidence regression: ok');
