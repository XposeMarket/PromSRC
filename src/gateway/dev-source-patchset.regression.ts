import assert from 'node:assert/strict';
import {
  applyDeleteLinesEolSafe,
  applyInsertAfterEolSafe,
  applyLineEndingTolerantFindReplace,
  applyReplaceLinesEolSafe,
  normalizeDevSourcePatchsetArgs,
  splitLinesEolSafe,
} from './dev-source-patchset';

const providerStyle = normalizeDevSourcePatchsetArgs({
  file: 'src/gateway/example.ts',
  edits: [{ operation: 'replace', old: 'const before = 1;', new: 'const after = 2;' }],
});
assert.deepEqual(
  {
    file: providerStyle.edits[0].file,
    op: providerStyle.edits[0].op,
    find: providerStyle.edits[0].find,
    replace: providerStyle.edits[0].replace,
  },
  {
    file: 'src/gateway/example.ts',
    op: 'find_replace',
    find: 'const before = 1;',
    replace: 'const after = 2;',
  },
);

const inferredStyle = normalizeDevSourcePatchsetArgs({
  edits: [{ path: 'web-ui/src/example.js', find: 'old', replace: 'new' }],
});
assert.equal(inferredStyle.edits[0].op, 'find_replace');
assert.equal(inferredStyle.edits[0].file, 'web-ui/src/example.js');

const mixed = 'alpha\nconst value = 1;\r\nconst next = 2;\r\nomega\n';
const replaced = applyLineEndingTolerantFindReplace(
  mixed,
  'const value = 1;\nconst next = 2;',
  'const value = 3;\nconst next = 4;',
  false,
);
assert.ok(replaced);
assert.ok(replaced.updated.includes('const value = 3;\r\nconst next = 4;'));
assert.doesNotMatch(replaced.updated, /const value = 1/);
assert.ok(replaced.updated.startsWith('alpha\n'));
assert.ok(replaced.updated.endsWith('omega\n'));

const directToolStyle = normalizeDevSourcePatchsetArgs({
  edits: [{ filename: 'src/example.ts', action: 'replace_text', before: 'one', after: 'two' }],
});
assert.equal(directToolStyle.edits[0].file, 'src/example.ts');
assert.equal(directToolStyle.edits[0].op, 'find_replace');

const deleteByEmptyReplacement = normalizeDevSourcePatchsetArgs({
  file: 'src/example.ts',
  edits: [{ old: 'remove me', new: '' }],
});
assert.equal(deleteByEmptyReplacement.edits[0].op, 'find_replace');
assert.equal(deleteByEmptyReplacement.edits[0].replace, '');

const crlfFile = 'one\r\ntwo\r\nthree\r\n';
assert.deepEqual(splitLinesEolSafe(crlfFile), ['one', 'two', 'three', '']);
const replacedLines = applyReplaceLinesEolSafe(crlfFile, 2, 2, 'TWO\nTWO_B');
assert.equal(replacedLines.updated, 'one\r\nTWO\r\nTWO_B\r\nthree\r\n');
assert.doesNotMatch(replacedLines.updated, /\rtwo/);
assert.ok(!replacedLines.lines.some((line) => line.includes('\r')));

const inserted = applyInsertAfterEolSafe(crlfFile, 1, 'midA\nmidB');
assert.equal(inserted.updated, 'one\r\nmidA\r\nmidB\r\ntwo\r\nthree\r\n');

const deleted = applyDeleteLinesEolSafe(crlfFile, 2, 3);
assert.equal(deleted.updated, 'one\r\n');
assert.equal(deleted.endClamped, 3);

const lfIntoCrlf = applyReplaceLinesEolSafe('a\r\nb\r\nc\r\n', 1, 3, 'x\ny');
assert.equal(lfIntoCrlf.updated, 'x\r\ny\r\n');

console.log('dev-source patchset regression: ok');
