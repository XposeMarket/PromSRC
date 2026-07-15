import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyTransactionalPatchset } from './transactional-patch';

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-transactional-patch-'));
  const resolvePath = (requested: string) => path.resolve(root, requested);
  const checkAllowed = (absolutePath: string) => ({ allowed: absolutePath === root || absolutePath.startsWith(root + path.sep) });
  try {
    const aPath = path.join(root, 'a.ts');
    const bPath = path.join(root, 'b.ts');
    const originalA = 'export const speed = 40;\nexport const accel = 1;\n';
    const originalB = 'export const drift = false;\n';
    fs.writeFileSync(aPath, originalA, 'utf-8');
    fs.writeFileSync(bPath, originalB, 'utf-8');

    const success = applyTransactionalPatchset({
      edits: [
        { filename: 'a.ts', op: 'find_replace', find: 'speed = 40', replace: 'speed = 50', expected_hash: hash(originalA) },
        { filename: 'a.ts', op: 'find_replace', find: 'accel = 1', replace: 'accel = 2', expected_hash: hash(originalA) },
        { filename: 'b.ts', op: 'find_replace', find: 'false', replace: 'true', expected_before: 'drift = false' },
      ],
      resolvePath,
      checkAllowed,
      validateSyntax: true,
    });
    assert.equal(success.ok, true, success.error);
    assert.equal(success.files.length, 2);
    assert.match(fs.readFileSync(aPath, 'utf-8'), /speed = 50/);
    assert.match(fs.readFileSync(aPath, 'utf-8'), /accel = 2/);
    assert.match(fs.readFileSync(bPath, 'utf-8'), /drift = true/);

    const beforeFailedA = fs.readFileSync(aPath, 'utf-8');
    const beforeFailedB = fs.readFileSync(bPath, 'utf-8');
    const failed = applyTransactionalPatchset({
      edits: [
        { filename: 'a.ts', op: 'find_replace', find: 'speed = 50', replace: 'speed = 60', expected_hash: hash(beforeFailedA) },
        { filename: 'b.ts', op: 'find_replace', find: 'does not exist', replace: 'never', expected_hash: hash(beforeFailedB) },
      ],
      resolvePath,
      checkAllowed,
      validateSyntax: true,
    });
    assert.equal(failed.ok, false);
    assert.equal(fs.readFileSync(aPath, 'utf-8'), beforeFailedA, 'preflight failure must not partially write the first file');
    assert.equal(fs.readFileSync(bPath, 'utf-8'), beforeFailedB, 'preflight failure must not change later files');

    const stale = applyTransactionalPatchset({
      edits: [{ filename: 'a.ts', op: 'find_replace', find: 'speed = 50', replace: 'speed = 70', expected_hash: hash('stale') }],
      resolvePath,
      checkAllowed,
    });
    assert.equal(stale.ok, false);
    assert.equal(fs.readFileSync(aPath, 'utf-8'), beforeFailedA);

    const createThenEdit = applyTransactionalPatchset({
      edits: [
        { filename: 'new.ts', op: 'create_file', content: 'export const value = 1;\n' },
        { filename: 'new.ts', op: 'find_replace', find: 'value = 1', replace: 'value = 2' },
      ],
      resolvePath,
      checkAllowed,
      validateSyntax: true,
    });
    assert.equal(createThenEdit.ok, true, createThenEdit.error);
    assert.match(fs.readFileSync(path.join(root, 'new.ts'), 'utf-8'), /value = 2/);

    const snapshotFailure = applyTransactionalPatchset({
      edits: [{ filename: 'a.ts', op: 'find_replace', find: 'speed = 50', replace: 'speed = 80', expected_hash: hash(beforeFailedA) }],
      resolvePath,
      checkAllowed,
      beforeCommit: () => { throw new Error('simulated snapshot failure'); },
    });
    assert.equal(snapshotFailure.ok, false);
    assert.equal(fs.readFileSync(aPath, 'utf-8'), beforeFailedA);

    console.log('transactional patch regression: PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
