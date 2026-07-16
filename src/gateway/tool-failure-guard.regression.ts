import assert from 'node:assert/strict';
import { countEquivalentFailedReads, equivalentFailedReadSignature } from './tool-failure-guard.js';

const sourceRead = equivalentFailedReadSignature('read_source', { file: 'gateway/routes/chat.router.ts' });
assert.equal(
  sourceRead,
  equivalentFailedReadSignature('workspace_read', { action: 'read', path: 'src\\gateway\\routes\\chat.router.ts' }),
  'source and workspace wrappers must recognize the same failed source target',
);
assert.equal(
  sourceRead,
  equivalentFailedReadSignature('read_file', { filename: 'C:\\Users\\rafel\\PromSRC\\src\\gateway\\routes\\chat.router.ts' }),
  'absolute and source-relative spellings must be equivalent',
);
assert.notEqual(
  sourceRead,
  equivalentFailedReadSignature('read_source', { file: 'gateway/routes/tasks.router.ts' }),
  'materially different files must remain retryable',
);
assert.notEqual(
  equivalentFailedReadSignature('grep_source', { file: 'gateway/routes/chat.router.ts', pattern: 'handleChat' }),
  equivalentFailedReadReadSignatureForDifferentPattern(),
  'materially different search inputs must remain retryable',
);

const prior = [
  { name: 'workspace_read', args: { action: 'read', path: 'src/gateway/routes/chat.router.ts' }, result: 'Source file not found (attempt 1001)', error: true },
  { name: 'read_source', args: { file: 'gateway/routes/chat.router.ts' }, result: 'Source file not found (attempt 1002)', error: true },
  { name: 'read_source', args: { file: 'gateway/routes/tasks.router.ts' }, result: 'Source file not found', error: true },
];
assert.equal(countEquivalentFailedReads('read_file', { filename: 'src/gateway/routes/chat.router.ts' }, prior), 2);
assert.equal(countEquivalentFailedReads('read_file', { filename: 'src/gateway/routes/tasks.router.ts' }, prior), 1);
assert.equal(
  countEquivalentFailedReads('read_file', { filename: 'src/gateway/routes/chat.router.ts' }, [
    ...prior.slice(0, 1),
    { name: 'read_source', args: { file: 'gateway/routes/chat.router.ts' }, result: 'Permission denied', error: true },
  ]),
  1,
  'different failure causes must not be treated as the same failed attempt',
);

function equivalentFailedReadReadSignatureForDifferentPattern(): string | null {
  return equivalentFailedReadSignature('grep_source', {
    file: 'gateway/routes/chat.router.ts',
    pattern: 'executeTool',
  });
}

console.log('tool failure guard regression passed');
