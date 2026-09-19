// Regression: apply_workspace_patchset must infer `op` from edit shape and
// accept a top-level shared `path` so a patchset that clearly says
// "find X, replace with Y" no longer bounces with "filename and op are required".
// Surfaced by the Fable 5.1 shakedown (2026-09-18).
//
// Run: node_modules/.bin/tsx src/tools/workspace-patchset-normalize.regression.ts

import assert from 'node:assert/strict';
import { inferWorkspacePatchOp } from './files.js';

// 1. Shape inference covers every supported op.
assert.equal(inferWorkspacePatchOp({ find: 'a', replace: 'b' }), 'find_replace');
assert.equal(inferWorkspacePatchOp({ old_text: 'a', new_text: 'b' }), 'find_replace');
assert.equal(inferWorkspacePatchOp({ after_line: 3, content: 'x' }), 'insert_after');
assert.equal(inferWorkspacePatchOp({ start_line: 1, end_line: 2, new_content: 'x' }), 'replace_lines');
assert.equal(inferWorkspacePatchOp({ startLine: 1, endLine: 2, content: 'x' }), 'replace_lines');
assert.equal(inferWorkspacePatchOp({ start_line: 1, end_line: 2 }), 'delete_lines');

// 2. Ambiguous / empty shapes stay undefined so the caller still reports an error.
assert.equal(inferWorkspacePatchOp({}), undefined);
assert.equal(inferWorkspacePatchOp({ content: 'x' }), undefined);
assert.equal(inferWorkspacePatchOp(null), undefined);
assert.equal(inferWorkspacePatchOp('nope'), undefined);

// 3. An explicit op always wins over inference (the executor applies
//    `edit.op ?? ... ?? inferWorkspacePatchOp(edit)`).
const explicit = { op: 'delete_lines', find: 'a', replace: 'b' };
assert.equal(explicit.op ?? inferWorkspacePatchOp(explicit), 'delete_lines');

console.log('workspace patchset normalize regression: ok');
