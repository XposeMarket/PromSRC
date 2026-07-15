import assert from 'node:assert/strict';
import path from 'node:path';
import { classifyToolReplayPolicy, fileResourceLeasesEnabled, inferToolResourceKeys } from './resource-policy.js';

function fileResource(workspaceRoot: string, candidate: string): string {
  return `file:${path.resolve(workspaceRoot, candidate).replace(/\\/g, '/').toLowerCase()}`;
}

const workspaceRoot = path.resolve(process.cwd(), 'workspace', 'resource-policy-regression');
const previousFileLeaseSetting = process.env.PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES;
delete process.env.PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES;

assert.equal(classifyToolReplayPolicy('read_file'), 'safe_retry');
assert.equal(classifyToolReplayPolicy('read_dev_sources'), 'safe_retry');
assert.equal(classifyToolReplayPolicy('WEB_FETCH'), 'safe_retry');
assert.equal(classifyToolReplayPolicy('browser_snapshot'), 'safe_retry');
assert.equal(classifyToolReplayPolicy('get_agent_models'), 'safe_retry');
assert.equal(classifyToolReplayPolicy('get_plugin_state'), 'verify_before_retry');
assert.equal(classifyToolReplayPolicy('read_composite_and_update'), 'verify_before_retry');
assert.equal(classifyToolReplayPolicy('find_replace'), 'verify_before_retry');
assert.equal(classifyToolReplayPolicy('snapshot_workspace'), 'verify_before_retry');
assert.equal(classifyToolReplayPolicy('list_and_delete_records'), 'never_replay');
assert.equal(classifyToolReplayPolicy('custom_plugin_action'), 'verify_before_retry');

assert.equal(fileResourceLeasesEnabled(), false);
assert.deepEqual(
  inferToolResourceKeys('rename_file', { old_path: 'src/old.ts', new_path: 'src/new.ts' }, workspaceRoot, 'session-a'),
  [],
  'shared-workspace file/repository serialization must not change normal multi-thread workflow by default',
);
assert.deepEqual(
  inferToolResourceKeys('desktop_click', { x: 1, y: 1 }, workspaceRoot, 'session-a'),
  ['desktop:global-input'],
  'true singleton resources must remain fenced when file leases are disabled',
);

process.env.PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES = '1';

const renameResources = inferToolResourceKeys('rename_file', {
  old_path: 'src/old-name.ts',
  newPath: 'src/new-name.ts',
}, workspaceRoot, 'session-a');
assert.deepEqual(renameResources, [
  fileResource(workspaceRoot, 'src/new-name.ts'),
  fileResource(workspaceRoot, 'src/old-name.ts'),
].sort());

assert.deepEqual(
  inferToolResourceKeys('delete_file', { filename: 'obsolete.txt' }, workspaceRoot, 'session-a'),
  [fileResource(workspaceRoot, 'obsolete.txt')],
  'direct filename mutations must receive a file lease',
);

const patchResources = inferToolResourceKeys('apply_patchset', {
  edits: [
    { filename: 'src/alpha.ts', op: 'find_replace' },
    { filePath: 'src/beta.ts', op: 'write_file' },
    { nested: { output_path: 'generated/result.json' } },
  ],
  files: [
    { filename: 'src/gamma.ts' },
    'src/delta.ts',
  ],
  target: 'https://example.com/not-a-local-resource',
}, workspaceRoot, 'session-a');
assert.deepEqual(patchResources, [
  fileResource(workspaceRoot, 'generated/result.json'),
  fileResource(workspaceRoot, 'src/alpha.ts'),
  fileResource(workspaceRoot, 'src/beta.ts'),
  fileResource(workspaceRoot, 'src/delta.ts'),
  fileResource(workspaceRoot, 'src/gamma.ts'),
].sort());

const cyclic: Record<string, unknown> = { filename: 'cycle-safe.txt' };
cyclic.self = cyclic;
assert.deepEqual(
  inferToolResourceKeys('write_file', cyclic, workspaceRoot, 'session-a'),
  [fileResource(workspaceRoot, 'cycle-safe.txt')],
  'recursive inference must tolerate cyclic wrapper arguments',
);

const oversizedSparseArray: unknown[] = [];
oversizedSparseArray.length = 1_000_000;
Object.defineProperty(oversizedSparseArray, '512', {
  get() { throw new Error('resource inference traversed an unbounded tool-argument array'); },
});
assert.deepEqual(
  inferToolResourceKeys('write_batch', { edits: oversizedSparseArray }, workspaceRoot, 'session-a'),
  [`repo:${workspaceRoot.replace(/\\/g, '/').toLowerCase()}`],
  'bounded resource inference must fail closed to a repository lease for an arbitrarily large argument container',
);

assert.deepEqual(
  inferToolResourceKeys('write_file', { path: 'x'.repeat(1_000_000) }, workspaceRoot, 'session-a'),
  [`repo:${workspaceRoot.replace(/\\/g, '/').toLowerCase()}`],
  'oversized path-shaped payloads must fail closed without trim/path normalization',
);

assert.deepEqual(
  inferToolResourceKeys('run_command', { cwd: '.', command: 'npm test' }, workspaceRoot, 'session-a'),
  [fileResource(workspaceRoot, '.'), `repo:${workspaceRoot.replace(/\\/g, '/').toLowerCase()}`].sort(),
);

if (previousFileLeaseSetting === undefined) delete process.env.PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES;
else process.env.PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES = previousFileLeaseSetting;

console.log('turn resource/replay policy regression: ok');
